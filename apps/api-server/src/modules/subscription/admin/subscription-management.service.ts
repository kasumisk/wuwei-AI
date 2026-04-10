import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { PaymentRecord } from '../entities/payment-record.entity';
import { UsageQuota } from '../entities/usage-quota.entity';
import { SubscriptionTriggerLog } from '../entities/subscription-trigger-log.entity';
import { AppUser } from '../../user/entities/app-user.entity';
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

@Injectable()
export class SubscriptionManagementService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(PaymentRecord)
    private readonly paymentRecordRepository: Repository<PaymentRecord>,
    @InjectRepository(UsageQuota)
    private readonly usageQuotaRepository: Repository<UsageQuota>,
    @InjectRepository(SubscriptionTriggerLog)
    private readonly triggerLogRepository: Repository<SubscriptionTriggerLog>,
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
  ) {}

  // ==================== 订阅计划管理 ====================

  /**
   * 获取订阅计划列表（分页）
   */
  async findPlans(query: GetSubscriptionPlansQueryDto) {
    const { page = 1, pageSize = 10, tier, isActive } = query;

    const qb = this.planRepository.createQueryBuilder('plan');

    if (tier) {
      qb.andWhere('plan.tier = :tier', { tier });
    }

    if (isActive !== undefined) {
      qb.andWhere('plan.isActive = :isActive', { isActive });
    }

    qb.orderBy('plan.sortOrder', 'ASC').addOrderBy('plan.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [list, total] = await qb.getManyAndCount();

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
    const plan = this.planRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      tier: dto.tier,
      billingCycle: dto.billingCycle,
      priceCents: dto.priceCents,
      currency: dto.currency ?? 'CNY',
      entitlements: dto.entitlements,
      appleProductId: dto.appleProductId ?? null,
      wechatProductId: dto.wechatProductId ?? null,
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.planRepository.save(plan);
  }

  /**
   * 更新订阅计划
   */
  async updatePlan(id: string, dto: UpdateSubscriptionPlanDto) {
    const plan = await this.planRepository.findOne({ where: { id } });

    if (!plan) {
      throw new NotFoundException(`订阅计划 #${id} 不存在`);
    }

    // 只更新传入的字段
    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.tier !== undefined) plan.tier = dto.tier;
    if (dto.billingCycle !== undefined) plan.billingCycle = dto.billingCycle;
    if (dto.priceCents !== undefined) plan.priceCents = dto.priceCents;
    if (dto.currency !== undefined) plan.currency = dto.currency;
    if (dto.entitlements !== undefined) plan.entitlements = dto.entitlements;
    if (dto.appleProductId !== undefined)
      plan.appleProductId = dto.appleProductId;
    if (dto.wechatProductId !== undefined)
      plan.wechatProductId = dto.wechatProductId;
    if (dto.sortOrder !== undefined) plan.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;

    return this.planRepository.save(plan);
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

    const qb = this.subscriptionRepository
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.plan', 'plan')
      .leftJoin(AppUser, 'user', 'user.id = sub.userId')
      .addSelect(['user.id', 'user.nickname', 'user.avatar', 'user.email']);

    if (userId) {
      qb.andWhere('sub.userId = :userId', { userId });
    }

    if (status) {
      qb.andWhere('sub.status = :status', { status });
    }

    if (paymentChannel) {
      qb.andWhere('sub.paymentChannel = :paymentChannel', { paymentChannel });
    }

    if (planId) {
      qb.andWhere('sub.planId = :planId', { planId });
    }

    if (startDate) {
      qb.andWhere('sub.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('sub.createdAt <= :endDate', { endDate });
    }

    qb.orderBy('sub.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [rawList, total] = await qb.getManyAndCount();

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((s) => s.userId))];
    const users =
      userIds.length > 0
        ? await this.appUserRepository
            .createQueryBuilder('user')
            .select(['user.id', 'user.nickname', 'user.avatar', 'user.email'])
            .where('user.id IN (:...userIds)', { userIds })
            .getMany()
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    const list = rawList.map((sub) => ({
      ...sub,
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
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: ['plan'],
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    // 查询用户信息
    const user = await this.appUserRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.nickname', 'user.avatar', 'user.email'])
      .where('user.id = :userId', { userId: subscription.userId })
      .getOne();

    // 查询关联支付记录
    const paymentRecords = await this.paymentRecordRepository.find({
      where: { subscriptionId: id },
      order: { createdAt: 'DESC' },
    });

    // 查询用户用量配额
    const usageQuotas = await this.usageQuotaRepository.find({
      where: { userId: subscription.userId },
      order: { feature: 'ASC' },
    });

    return {
      ...subscription,
      user,
      paymentRecords,
      usageQuotas,
    };
  }

  /**
   * 延长订阅到期时间
   */
  async extendSubscription(id: string, dto: ExtendSubscriptionDto) {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const baseDate =
      subscription.expiresAt > new Date() ? subscription.expiresAt : new Date();

    const newExpiresAt = new Date(baseDate);
    newExpiresAt.setDate(newExpiresAt.getDate() + dto.extendDays);

    subscription.expiresAt = newExpiresAt;

    // 如果订阅已过期，自动恢复为活跃状态
    if (subscription.status === SubscriptionStatus.EXPIRED) {
      subscription.status = SubscriptionStatus.ACTIVE;
    }

    return this.subscriptionRepository.save(subscription);
  }

  /**
   * 变更订阅计划
   */
  async changeSubscriptionPlan(id: string, dto: ChangeSubscriptionPlanDto) {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const newPlan = await this.planRepository.findOne({
      where: { id: dto.newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException(`订阅计划 #${dto.newPlanId} 不存在`);
    }

    subscription.planId = dto.newPlanId;

    return this.subscriptionRepository.save(subscription);
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

    const qb = this.paymentRecordRepository.createQueryBuilder('pr');

    if (userId) {
      qb.andWhere('pr.userId = :userId', { userId });
    }

    if (status) {
      qb.andWhere('pr.status = :status', { status });
    }

    if (channel) {
      qb.andWhere('pr.channel = :channel', { channel });
    }

    if (startDate) {
      qb.andWhere('pr.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('pr.createdAt <= :endDate', { endDate });
    }

    if (orderNo) {
      qb.andWhere('pr.orderNo LIKE :orderNo', { orderNo: `%${orderNo}%` });
    }

    qb.orderBy('pr.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [rawList, total] = await qb.getManyAndCount();

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((r) => r.userId))];
    const users =
      userIds.length > 0
        ? await this.appUserRepository
            .createQueryBuilder('user')
            .select(['user.id', 'user.nickname', 'user.avatar', 'user.email'])
            .where('user.id IN (:...userIds)', { userIds })
            .getMany()
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

    const qb = this.usageQuotaRepository
      .createQueryBuilder('uq')
      .where('uq.userId = :userId', { userId });

    if (feature) {
      qb.andWhere('uq.feature = :feature', { feature });
    }

    qb.orderBy('uq.feature', 'ASC');

    const list = await qb.getMany();

    return { list, userId };
  }

  /**
   * 重置用量配额（将 used 归零）
   */
  async resetUsageQuota(quotaId: string) {
    const quota = await this.usageQuotaRepository.findOne({
      where: { id: quotaId },
    });

    if (!quota) {
      throw new NotFoundException(`用量配额记录 #${quotaId} 不存在`);
    }

    quota.used = 0;

    return this.usageQuotaRepository.save(quota);
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
    const tierStats = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .leftJoin('sub.plan', 'plan')
      .select('plan.tier', 'tier')
      .addSelect('COUNT(sub.id)', 'count')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .groupBy('plan.tier')
      .getRawMany();

    // 活跃订阅总数
    const activeCount = await this.subscriptionRepository.count({
      where: { status: SubscriptionStatus.ACTIVE },
    });

    // MRR: 活跃订阅的月收入（将季度和年度价格折算为月度）
    const mrrResult = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .leftJoin('sub.plan', 'plan')
      .select(
        `SUM(
          CASE plan.billingCycle
            WHEN 'monthly' THEN plan.priceCents
            WHEN 'quarterly' THEN ROUND(plan.priceCents / 3.0)
            WHEN 'yearly' THEN ROUND(plan.priceCents / 12.0)
            ELSE 0
          END
        )`,
        'mrr',
      )
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .getRawOne();

    const mrr = parseInt(mrrResult?.mrr ?? '0', 10);

    // 最近 7 天新增订阅数
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentNewSubscribers = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .where('sub.createdAt >= :since', { since: sevenDaysAgo })
      .getCount();

    // 各状态订阅统计
    const statusStats = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .select('sub.status', 'status')
      .addSelect('COUNT(sub.id)', 'count')
      .groupBy('sub.status')
      .getRawMany();

    // 支付收入统计（本月成功支付总额）
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyRevenue = await this.paymentRecordRepository
      .createQueryBuilder('pr')
      .select('SUM(pr.amountCents)', 'total')
      .where('pr.status = :status', { status: PaymentStatus.SUCCESS })
      .andWhere('pr.paidAt >= :monthStart', { monthStart })
      .getRawOne();

    return {
      tierStats,
      activeCount,
      mrr,
      recentNewSubscribers,
      statusStats,
      monthlyRevenue: parseInt(monthlyRevenue?.total ?? '0', 10),
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
    const byFeatureQb = this.triggerLogRepository
      .createQueryBuilder('log')
      .select('log.feature', 'feature')
      .addSelect('COUNT(log.id)', 'totalTriggers')
      .addSelect(
        'SUM(CASE WHEN log.converted = true THEN 1 ELSE 0 END)',
        'conversions',
      )
      .where('log.createdAt >= :sinceDate', { sinceDate })
      .groupBy('log.feature');

    if (feature) {
      byFeatureQb.andWhere('log.feature = :feature', { feature });
    }

    if (triggerScene) {
      byFeatureQb.andWhere('log.triggerScene = :triggerScene', {
        triggerScene,
      });
    }

    const byFeature = await byFeatureQb.getRawMany();

    // 按场景分组统计
    const bySceneQb = this.triggerLogRepository
      .createQueryBuilder('log')
      .select('log.triggerScene', 'triggerScene')
      .addSelect('COUNT(log.id)', 'totalTriggers')
      .addSelect(
        'SUM(CASE WHEN log.converted = true THEN 1 ELSE 0 END)',
        'conversions',
      )
      .where('log.createdAt >= :sinceDate', { sinceDate })
      .groupBy('log.triggerScene');

    if (feature) {
      bySceneQb.andWhere('log.feature = :feature', { feature });
    }

    if (triggerScene) {
      bySceneQb.andWhere('log.triggerScene = :triggerScene', { triggerScene });
    }

    const byScene = await bySceneQb.getRawMany();

    // 计算转化率
    const enrichWithRate = (
      items: Array<{ totalTriggers: string; conversions: string }>,
    ) =>
      items.map((item) => {
        const total = parseInt(item.totalTriggers, 10);
        const converted = parseInt(item.conversions, 10);
        return {
          ...item,
          totalTriggers: total,
          conversions: converted,
          conversionRate:
            total > 0 ? +((converted / total) * 100).toFixed(2) : 0,
        };
      });

    // 按等级分组统计
    const byTierQb = this.triggerLogRepository
      .createQueryBuilder('log')
      .select('log.currentTier', 'currentTier')
      .addSelect('COUNT(log.id)', 'totalTriggers')
      .addSelect(
        'SUM(CASE WHEN log.converted = true THEN 1 ELSE 0 END)',
        'conversions',
      )
      .where('log.createdAt >= :sinceDate', { sinceDate })
      .groupBy('log.currentTier');

    if (feature) {
      byTierQb.andWhere('log.feature = :feature', { feature });
    }

    if (triggerScene) {
      byTierQb.andWhere('log.triggerScene = :triggerScene', { triggerScene });
    }

    const byTier = await byTierQb.getRawMany();

    // 汇总
    const totalTriggers = byFeature.reduce(
      (sum, item) => sum + parseInt(item.totalTriggers, 10),
      0,
    );
    const totalConversions = byFeature.reduce(
      (sum, item) => sum + parseInt(item.conversions, 10),
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
