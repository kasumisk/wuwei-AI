import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionPlan,
  Subscription,
  PaymentRecords as PaymentRecord,
  UsageQuota,
  SubscriptionTriggerLogs as SubscriptionTriggerLog,
  AppUsers as AppUser,
} from '@prisma/client';
import {
  SubscriptionStatus,
  SubscriptionTier,
  PaymentStatus,
} from '../subscription.types';
import {
  GetSubscriptionPlansQueryDto,
  CreateSubscriptionPlanDto,
  UpdateSubscriptionPlanDto,
  GetSubscriptionsQueryDto,
  ExtendSubscriptionDto,
  ChangeSubscriptionPlanDto,
  GetPaymentRecordsQueryDto,
  GetUsageQuotasQueryDto,
  GetTriggerStatsQueryDto,
} from './dto/subscription-management.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class SubscriptionManagementService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 订阅计划管理 ====================

  /**
   * 获取订阅计划列表（分页）
   */
  async findPlans(query: GetSubscriptionPlansQueryDto) {
    const { page = 1, pageSize = 10, tier, isActive } = query;

    const where: any = {};
    if (tier) {
      where.tier = tier;
    }
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 创建订阅计划
   */
  async createPlan(dto: CreateSubscriptionPlanDto) {
    return this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        tier: dto.tier,
        billingCycle: dto.billingCycle,
        priceCents: dto.priceCents,
        currency: dto.currency ?? 'CNY',
        entitlements: dto.entitlements as any,
        appleProductId: dto.appleProductId ?? null,
        wechatProductId: dto.wechatProductId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  /**
   * 更新订阅计划
   */
  async updatePlan(id: string, dto: UpdateSubscriptionPlanDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException(`订阅计划 #${id} 不存在`);
    }

    // 只更新传入的字段
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.tier !== undefined) updateData.tier = dto.tier;
    if (dto.billingCycle !== undefined)
      updateData.billingCycle = dto.billingCycle;
    if (dto.priceCents !== undefined) updateData.priceCents = dto.priceCents;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.entitlements !== undefined)
      updateData.entitlements = dto.entitlements;
    if (dto.appleProductId !== undefined)
      updateData.appleProductId = dto.appleProductId;
    if (dto.wechatProductId !== undefined)
      updateData.wechatProductId = dto.wechatProductId;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: updateData,
    });
  }

  // ==================== 用户订阅管理 ====================

  /**
   * 获取用户订阅列表（分页，含用户和计划信息）
   */
  async findSubscriptions(query: GetSubscriptionsQueryDto) {
    const {
      page = 1,
      pageSize = 10,
      userId,
      status,
      paymentChannel,
      planId,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (userId) {
      where.userId = userId;
    }
    if (status) {
      where.status = status;
    }
    if (paymentChannel) {
      where.paymentChannel = paymentChannel;
    }
    if (planId) {
      where.planId = planId;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const skip = (page - 1) * pageSize;

    const [rawList, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { subscriptionPlan: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((s) => s.userId))];
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    const list = rawList.map((sub) => ({
      ...sub,
      plan: sub.subscriptionPlan,
      user: userMap.get(sub.userId) ?? null,
    }));

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取订阅详情（含计划、支付记录、用量配额）
   */
  async getSubscriptionDetail(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { subscriptionPlan: true },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    // 查询用户信息
    const user = await this.prisma.appUsers.findUnique({
      where: { id: subscription.userId },
      select: { id: true, nickname: true, avatar: true, email: true },
    });

    // 查询关联支付记录
    const paymentRecords = await this.prisma.paymentRecords.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: 'desc' },
    });

    // 查询用户用量配额
    const usageQuotas = await this.prisma.usageQuota.findMany({
      where: { userId: subscription.userId },
      orderBy: { feature: 'asc' },
    });

    return {
      ...subscription,
      plan: subscription.subscriptionPlan,
      user,
      paymentRecords,
      usageQuotas,
    };
  }

  /**
   * 延长订阅到期时间
   */
  async extendSubscription(id: string, dto: ExtendSubscriptionDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const baseDate =
      subscription.expiresAt > new Date()
        ? subscription.expiresAt
        : new Date();

    const newExpiresAt = new Date(baseDate);
    newExpiresAt.setDate(newExpiresAt.getDate() + dto.extendDays);

    const updateData: any = {
      expiresAt: newExpiresAt,
    };

    // 如果订阅已过期，自动恢复为活跃状态
    if (subscription.status === SubscriptionStatus.EXPIRED) {
      updateData.status = SubscriptionStatus.ACTIVE;
    }

    return this.prisma.subscription.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * 变更订阅计划
   */
  async changeSubscriptionPlan(id: string, dto: ChangeSubscriptionPlanDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException(`订阅计划 #${dto.newPlanId} 不存在`);
    }

    return this.prisma.subscription.update({
      where: { id },
      data: { planId: dto.newPlanId },
    });
  }

  // ==================== 支付记录管理 ====================

  /**
   * 获取支付记录列表（分页，含用户信息）
   */
  async findPaymentRecords(query: GetPaymentRecordsQueryDto) {
    const {
      page = 1,
      pageSize = 10,
      userId,
      status,
      channel,
      startDate,
      endDate,
      orderNo,
    } = query;

    const where: any = {};
    if (userId) {
      where.userId = userId;
    }
    if (status) {
      where.status = status;
    }
    if (channel) {
      where.channel = channel;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }
    if (orderNo) {
      where.orderNo = { contains: orderNo };
    }

    const skip = (page - 1) * pageSize;

    const [rawList, total] = await Promise.all([
      this.prisma.paymentRecords.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.paymentRecords.count({ where }),
    ]);

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((r) => r.userId))];
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    const list = rawList.map((record) => ({
      ...record,
      user: userMap.get(record.userId) ?? null,
    }));

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ==================== 用量配额管理 ====================

  /**
   * 查询用户用量配额
   */
  async getUserUsageQuotas(query: GetUsageQuotasQueryDto) {
    const { userId, feature } = query;

    const where: any = { userId: userId };
    if (feature) {
      where.feature = feature;
    }

    const list = await this.prisma.usageQuota.findMany({
      where,
      orderBy: { feature: 'asc' },
    });

    return { list, userId };
  }

  /**
   * 重置用量配额（将 used 归零）
   */
  async resetUsageQuota(quotaId: string) {
    const quota = await this.prisma.usageQuota.findUnique({
      where: { id: quotaId },
    });

    if (!quota) {
      throw new NotFoundException(`用量配额记录 #${quotaId} 不存在`);
    }

    return this.prisma.usageQuota.update({
      where: { id: quotaId },
      data: { used: 0 },
    });
  }

  // ==================== 统计概览 ====================

  /**
   * 订阅概览统计
   * - 各等级订阅人数
   * - 活跃订阅数
   * - MRR（月经常性收入）
   * - 最近新增订阅
   */
  async getSubscriptionOverview() {
    // 各等级订阅人数
    const tierStats = await this.prisma.$queryRaw`
      SELECT p.tier, COUNT(s.id)::int as count
      FROM subscription s
      LEFT JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.status = ${SubscriptionStatus.ACTIVE}
      GROUP BY p.tier`;

    // 活跃订阅总数
    const activeCount = await this.prisma.subscription.count({
      where: { status: SubscriptionStatus.ACTIVE },
    });

    // MRR: 活跃订阅的月收入（将季度和年度价格折算为月度）
    const mrrResult = await this.prisma.$queryRaw<
      Array<{ mrr: number | null }>
    >`
      SELECT SUM(
        CASE p.billing_cycle
          WHEN 'monthly' THEN p.price_cents
          WHEN 'quarterly' THEN ROUND(p.price_cents / 3.0)
          WHEN 'yearly' THEN ROUND(p.price_cents / 12.0)
          ELSE 0
        END
      )::int as mrr
      FROM subscription s
      LEFT JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.status = ${SubscriptionStatus.ACTIVE}`;

    const mrr = (mrrResult as any)[0]?.mrr ?? 0;

    // 最近 7 天新增订阅数
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentNewSubscribers = await this.prisma.subscription.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    // 各状态订阅统计
    const statusStats = await this.prisma.$queryRaw`
      SELECT status, COUNT(id)::int as count
      FROM subscription
      GROUP BY status`;

    // 支付收入统计（本月成功支付总额）
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyRevenue = await this.prisma.$queryRaw<
      Array<{ total: number | null }>
    >`
      SELECT COALESCE(SUM(amount_cents), 0)::int as total
      FROM payment_records
      WHERE status = ${PaymentStatus.SUCCESS}
      AND paid_at >= ${monthStart}`;

    return {
      tierStats,
      activeCount,
      mrr,
      recentNewSubscribers,
      statusStats,
      monthlyRevenue: (monthlyRevenue as any)[0]?.total ?? 0,
    };
  }

  // ==================== 付费墙触发统计 ====================

  /**
   * 付费墙触发统计
   * - 按功能/场景分组的触发次数
   * - 转化率
   */
  async getTriggerStats(query: GetTriggerStatsQueryDto) {
    const { days = 30, feature, triggerScene } = query;

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // 按功能分组统计
    const byFeature = await this.prisma.$queryRaw<
      Array<{ feature: string; totalTriggers: number; conversions: number }>
    >`
      SELECT feature, COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY feature`;

    // 按场景分组统计
    const byScene = await this.prisma.$queryRaw<
      Array<{
        triggerScene: string;
        totalTriggers: number;
        conversions: number;
      }>
    >`
      SELECT trigger_scene as "triggerScene", COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY trigger_scene`;

    // 计算转化率
    const enrichWithRate = (
      items: Array<{ totalTriggers: number; conversions: number }>,
    ) =>
      items.map((item) => {
        const total = Number(item.totalTriggers);
        const converted = Number(item.conversions);
        return {
          ...item,
          totalTriggers: total,
          conversions: converted,
          conversionRate:
            total > 0 ? +((converted / total) * 100).toFixed(2) : 0,
        };
      });

    // 按等级分组统计
    const byTier = await this.prisma.$queryRaw<
      Array<{
        currentTier: string;
        totalTriggers: number;
        conversions: number;
      }>
    >`
      SELECT current_tier as "currentTier", COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY current_tier`;

    // 汇总
    const totalTriggers = byFeature.reduce(
      (sum, item) => sum + Number(item.totalTriggers),
      0,
    );
    const totalConversions = byFeature.reduce(
      (sum, item) => sum + Number(item.conversions),
      0,
    );

    return {
      days,
      totalTriggers,
      totalConversions,
      overallConversionRate:
        totalTriggers > 0
          ? +((totalConversions / totalTriggers) * 100).toFixed(2)
          : 0,
      byFeature: enrichWithRate(byFeature),
      byScene: enrichWithRate(byScene),
      byTier: enrichWithRate(byTier),
    };
  }
}
