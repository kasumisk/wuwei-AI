/**
 * V6.1 — 订阅服务
 *
 * 职责:
 * - 订阅计划 CRUD（管理后台）
 * - 用户订阅生命周期管理（创建/续费/取消/过期）
 * - 用户当前订阅等级查询（带 Redis 缓存）
 * - 支付记录管理
 *
 * V6.1 变更:
 * - 使用 PlanEntitlementResolver 解析权益，DB 中的 entitlements 与默认值合并
 * - 支持运行时通过修改 subscription_plan.entitlements 调整权益
 *
 * 设计原则:
 * - 订阅状态变更通过 EventEmitter2 发布 subscription.changed 事件
 * - 等级查询结果缓存 5 分钟，减轻每次请求的 DB 查询
 * - 免费用户不创建 Subscription 记录，查询返回 null 时降级为 Free
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  subscription_plan as SubscriptionPlan,
  subscription as Subscription,
  payment_record as PaymentRecord,
  usage_quota as UsageQuota,
} from '@prisma/client';
import {
  SubscriptionTier,
  SubscriptionStatus,
  PaymentChannel,
  PaymentStatus,
  GatedFeature,
  QuotaCycle,
  TIER_ENTITLEMENTS,
  UNLIMITED,
  FeatureEntitlements,
} from '../subscription.types';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 用户订阅状态概要（缓存友好的扁平结构） */
export interface UserSubscriptionSummary {
  /** 当前等级（无订阅时为 free） */
  tier: SubscriptionTier;
  /** 订阅 ID（无订阅时为 null） */
  subscriptionId: string | null;
  /** 计划名称 */
  planName: string;
  /** 到期时间（无订阅时为 null） */
  expiresAt: Date | null;
  /** 是否自动续费 */
  autoRenew: boolean;
  /** 功能权益 */
  entitlements: FeatureEntitlements;
}

/** 缓存 key 前缀 */
const CACHE_PREFIX = 'sub:user:';
/** 缓存 TTL: 5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlementResolver: PlanEntitlementResolver,
  ) {}

  // ==================== 计划管理（Admin） ====================

  /** 创建订阅计划 */
  async createPlan(data: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const saved = await this.prisma.subscription_plan.create({
      data: data as any,
    });
    this.logger.log(
      `订阅计划已创建: ${saved.name} (${saved.tier}/${saved.billing_cycle})`,
    );
    return saved as unknown as SubscriptionPlan;
  }

  /** 更新订阅计划 */
  async updatePlan(
    planId: string,
    data: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscription_plan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('订阅计划不存在');
    const updated = await this.prisma.subscription_plan.update({
      where: { id: planId },
      data: data as any,
    });
    return updated as unknown as SubscriptionPlan;
  }

  /** 获取所有上架计划（前端展示用） */
  async getActivePlans(): Promise<SubscriptionPlan[]> {
    const plans = await this.prisma.subscription_plan.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { price_cents: 'asc' }],
    });
    return plans as unknown as SubscriptionPlan[];
  }

  /** 获取所有计划（管理后台） */
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    const plans = await this.prisma.subscription_plan.findMany({
      orderBy: [{ tier: 'asc' }, { sort_order: 'asc' }],
    });
    return plans as unknown as SubscriptionPlan[];
  }

  /** 根据 ID 获取计划 */
  async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
    const plan = await this.prisma.subscription_plan.findUnique({
      where: { id: planId },
    });
    return plan as unknown as SubscriptionPlan | null;
  }

  // ==================== 用户订阅生命周期 ====================

  /**
   * 为用户创建订阅（支付成功后调用）
   *
   * 流程:
   * 1. 将用户已有的 ACTIVE 订阅标记为 EXPIRED
   * 2. 创建新的 ACTIVE 订阅
   * 3. 初始化/更新用量配额
   * 4. 清除缓存 + 发布事件
   */
  async createSubscription(params: {
    userId: string;
    planId: string;
    paymentChannel: PaymentChannel;
    platformSubscriptionId?: string;
    startsAt?: Date;
    expiresAt: Date;
  }): Promise<Subscription> {
    const plan = await this.prisma.subscription_plan.findUnique({
      where: { id: params.planId },
    });
    if (!plan) throw new NotFoundException('订阅计划不存在');

    // 1. 失效旧订阅
    await this.prisma.subscription.updateMany({
      where: {
        user_id: params.userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE_PERIOD],
        },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    // 2. 创建新订阅
    const saved = await this.prisma.subscription.create({
      data: {
        user_id: params.userId,
        plan_id: params.planId,
        payment_channel: params.paymentChannel,
        platform_subscription_id: params.platformSubscriptionId ?? null,
        starts_at: params.startsAt ?? new Date(),
        expires_at: params.expiresAt,
        status: SubscriptionStatus.ACTIVE,
        auto_renew: true,
      },
    });

    // 3. 初始化用量配额
    await this.initQuotas(params.userId, plan);

    // 4. 缓存失效 + 事件
    await this.invalidateUserCache(params.userId);
    this.eventEmitter.emit('subscription.changed', {
      userId: params.userId,
      subscriptionId: saved.id,
      tier: plan.tier,
      action: 'created',
    });

    this.logger.log(
      `用户 ${params.userId} 订阅已创建: ${plan.name} -> ${params.expiresAt.toISOString()}`,
    );
    return saved as unknown as Subscription;
  }

  /**
   * 取消订阅（当前周期结束后失效）
   */
  async cancelSubscription(userId: string): Promise<Subscription | null> {
    const sub = await this.getActiveSubscriptionWithPlan(userId);
    if (!sub) return null;

    const saved = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelled_at: new Date(),
        auto_renew: false,
      },
    });

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit('subscription.changed', {
      userId,
      subscriptionId: saved.id,
      tier: sub.subscription_plan.tier,
      action: 'cancelled',
    });

    this.logger.log(
      `用户 ${userId} 已取消订阅，将于 ${sub.expires_at.toISOString()} 失效`,
    );
    return saved as unknown as Subscription;
  }

  /**
   * 续费订阅（支付成功后调用）
   */
  async renewSubscription(
    userId: string,
    newExpiresAt: Date,
  ): Promise<Subscription | null> {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.CANCELLED,
            SubscriptionStatus.GRACE_PERIOD,
          ],
        },
      },
      include: { subscription_plan: true },
      orderBy: { expires_at: 'desc' },
    });
    if (!sub) return null;

    const saved = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        expires_at: newExpiresAt,
        cancelled_at: null,
        auto_renew: true,
      },
    });

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit('subscription.changed', {
      userId,
      subscriptionId: saved.id,
      tier: sub.subscription_plan.tier,
      action: 'renewed',
    });

    this.logger.log(
      `用户 ${userId} 订阅已续费至 ${newExpiresAt.toISOString()}`,
    );
    return saved as unknown as Subscription;
  }

  // ==================== 查询 ====================

  /**
   * 获取用户当前有效订阅（ACTIVE / GRACE_PERIOD / CANCELLED 但未过期）
   */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        OR: [
          { user_id: userId, status: SubscriptionStatus.ACTIVE },
          { user_id: userId, status: SubscriptionStatus.GRACE_PERIOD },
          {
            user_id: userId,
            status: SubscriptionStatus.CANCELLED,
            expires_at: { lte: new Date() },
          },
        ],
      },
      orderBy: { expires_at: 'desc' },
    });
    return sub as unknown as Subscription | null;
  }

  /**
   * 获取用户订阅概要（带缓存）
   *
   * 返回 UserSubscriptionSummary，未订阅时返回 Free 等级默认值。
   * 缓存 5 分钟，订阅变更时主动失效。
   */
  async getUserSummary(userId: string): Promise<UserSubscriptionSummary> {
    return this.redis.getOrSet<UserSubscriptionSummary>(
      `${CACHE_PREFIX}${userId}`,
      CACHE_TTL_MS,
      async () => this.buildUserSummary(userId),
    );
  }

  /**
   * 判断用户是否为付费用户（Pro 或 Premium）
   */
  async isPremiumUser(userId: string): Promise<boolean> {
    const summary = await this.getUserSummary(userId);
    return summary.tier !== SubscriptionTier.FREE;
  }

  /**
   * 获取用户当前订阅等级
   */
  async getUserTier(userId: string): Promise<SubscriptionTier> {
    const summary = await this.getUserSummary(userId);
    return summary.tier;
  }

  // ==================== 支付记录 ====================

  /** 创建支付记录（下单时调用） */
  async createPaymentRecord(data: {
    userId: string;
    subscriptionId?: string;
    orderNo: string;
    channel: PaymentChannel;
    amountCents: number;
    currency?: string;
  }): Promise<PaymentRecord> {
    const record = await this.prisma.payment_record.create({
      data: {
        user_id: data.userId,
        subscription_id: data.subscriptionId,
        order_no: data.orderNo,
        channel: data.channel,
        amount_cents: data.amountCents,
        currency: data.currency,
        status: PaymentStatus.PENDING,
      },
    });
    return record as unknown as PaymentRecord;
  }

  /** 更新支付状态（回调时调用） */
  async updatePaymentStatus(
    orderNo: string,
    status: PaymentStatus,
    platformTransactionId?: string,
    callbackPayload?: Record<string, unknown>,
  ): Promise<PaymentRecord | null> {
    const record = await this.prisma.payment_record.findFirst({
      where: { order_no: orderNo },
    });
    if (!record) return null;

    const updateData: Record<string, unknown> = { status };
    if (platformTransactionId) {
      updateData.platform_transaction_id = platformTransactionId;
    }
    if (callbackPayload) {
      updateData.callback_payload = callbackPayload;
    }
    if (status === PaymentStatus.SUCCESS) {
      updateData.paid_at = new Date();
    }
    if (status === PaymentStatus.REFUNDED) {
      updateData.refunded_at = new Date();
    }

    const updated = await this.prisma.payment_record.update({
      where: { id: record.id },
      data: updateData,
    });
    return updated as unknown as PaymentRecord;
  }

  /** 获取用户支付历史 */
  async getUserPayments(userId: string, limit = 20): Promise<PaymentRecord[]> {
    const records = await this.prisma.payment_record.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return records as unknown as PaymentRecord[];
  }

  // ==================== 过期检查（Cron 调用） ====================

  /**
   * 批量处理过期订阅
   * 由 Cron 定时任务调用（如每小时一次）
   *
   * 流程:
   * 1. 查找 expiresAt < now && status = ACTIVE 的记录
   * 2. 非自动续费: 直接标记 EXPIRED
   * 3. 自动续费: 标记 GRACE_PERIOD（3 天宽限）
   */
  async processExpiredSubscriptions(): Promise<number> {
    const now = new Date();

    // 查找已过期但仍活跃的订阅
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        expires_at: { lt: now },
      },
    });

    let count = 0;
    for (const sub of expired) {
      if (sub.auto_renew) {
        // 自动续费用户 → 宽限期（3 天）
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.GRACE_PERIOD,
            grace_period_ends_at: new Date(
              now.getTime() + 3 * 24 * 60 * 60 * 1000,
            ),
          },
        });
      } else {
        // 手动续费用户 → 直接过期
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }
      await this.invalidateUserCache(sub.user_id);
      this.eventEmitter.emit('subscription.changed', {
        userId: sub.user_id,
        subscriptionId: sub.id,
        action: sub.auto_renew ? 'grace_period' : 'expired',
      });
      count++;
    }

    // 处理宽限期结束的订阅
    const graceExpired = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.GRACE_PERIOD,
        grace_period_ends_at: { lt: now },
      },
    });

    for (const sub of graceExpired) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      await this.invalidateUserCache(sub.user_id);

      // 重置为免费配额
      const freePlan = await this.prisma.subscription_plan.findFirst({
        where: {
          tier: SubscriptionTier.FREE,
          is_active: true,
        },
      });
      if (freePlan) {
        await this.initQuotas(sub.user_id, freePlan);
      }

      this.eventEmitter.emit('subscription.changed', {
        userId: sub.user_id,
        subscriptionId: sub.id,
        action: 'expired',
      });
      count++;
    }

    if (count > 0) {
      this.logger.log(`处理了 ${count} 个过期/宽限期订阅`);
    }
    return count;
  }

  // ==================== 私有方法 ====================

  /**
   * 获取用户当前有效订阅（含 plan 关系，内部用）
   */
  private async getActiveSubscriptionWithPlan(userId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        OR: [
          { user_id: userId, status: SubscriptionStatus.ACTIVE },
          { user_id: userId, status: SubscriptionStatus.GRACE_PERIOD },
          {
            user_id: userId,
            status: SubscriptionStatus.CANCELLED,
            expires_at: { lte: new Date() },
          },
        ],
      },
      include: { subscription_plan: true },
      orderBy: { expires_at: 'desc' },
    });
  }

  /**
   * 构建用户订阅概要（无缓存，直接查 DB）
   *
   * V6.1: 使用 PlanEntitlementResolver 合并 DB 权益与默认值
   */
  private async buildUserSummary(
    userId: string,
  ): Promise<UserSubscriptionSummary> {
    const now = new Date();

    // 查找有效订阅（ACTIVE 或 GRACE_PERIOD 或 CANCELLED 但未过期）
    const sub = await this.prisma.subscription.findFirst({
      where: {
        OR: [
          { user_id: userId, status: SubscriptionStatus.ACTIVE },
          { user_id: userId, status: SubscriptionStatus.GRACE_PERIOD },
        ],
      },
      include: { subscription_plan: true },
      orderBy: { expires_at: 'desc' },
    });

    // 额外检查: CANCELLED 但尚未过期的订阅仍然有效
    const cancelledButValid = sub
      ? null
      : await this.prisma.subscription.findFirst({
          where: {
            user_id: userId,
            status: SubscriptionStatus.CANCELLED,
          },
          include: { subscription_plan: true },
          orderBy: { expires_at: 'desc' },
        });

    const activeSub =
      cancelledButValid && cancelledButValid.expires_at > now
        ? cancelledButValid
        : sub;

    if (!activeSub || !activeSub.subscription_plan) {
      // 免费用户: 使用 resolver 解析默认权益
      return {
        tier: SubscriptionTier.FREE,
        subscriptionId: null,
        planName: 'Free',
        expiresAt: null,
        autoRenew: false,
        entitlements: this.entitlementResolver.resolve(SubscriptionTier.FREE),
      };
    }

    // 付费用户: 使用 resolver 合并 DB 中的权益与默认值
    return {
      tier: activeSub.subscription_plan.tier as SubscriptionTier,
      subscriptionId: activeSub.id,
      planName: activeSub.subscription_plan.name,
      expiresAt: activeSub.expires_at,
      autoRenew: activeSub.auto_renew,
      entitlements: this.entitlementResolver.resolve(
        activeSub.subscription_plan.tier as SubscriptionTier,
        activeSub.subscription_plan.entitlements as any,
      ),
    };
  }

  /**
   * 初始化/更新用户用量配额
   *
   * 根据计划权益为计次类功能创建配额记录。
   *
   * V6.1: 使用 PlanEntitlementResolver.listCountableFeatures() 动态获取
   * 所有计次类功能，不再硬编码功能列表。新增功能时只需更新
   * TIER_ENTITLEMENTS / DB entitlements，此处自动适配。
   */
  private async initQuotas(
    userId: string,
    plan: { tier: string; entitlements: any },
  ): Promise<void> {
    const entitlements = this.entitlementResolver.resolve(
      plan.tier as SubscriptionTier,
      plan.entitlements,
    );
    const now = new Date();

    // 通过 resolver 动态获取所有计次类功能及其限额
    const countableFeatures =
      this.entitlementResolver.listCountableFeatures(entitlements);

    for (const { feature, limit } of countableFeatures) {
      const existing = await this.prisma.usage_quota.findUnique({
        where: {
          user_id_feature: { user_id: userId, feature },
        },
      });
      const resetAt = this.calcNextReset(now, QuotaCycle.DAILY);

      if (existing) {
        await this.prisma.usage_quota.update({
          where: { id: existing.id },
          data: {
            quota_limit: limit,
            cycle: QuotaCycle.DAILY,
            // 升级时不重置 used，等自然重置
          },
        });
      } else {
        await this.prisma.usage_quota.create({
          data: {
            user_id: userId,
            feature,
            used: 0,
            quota_limit: limit,
            cycle: QuotaCycle.DAILY,
            reset_at: resetAt,
          },
        });
      }
    }
  }

  /**
   * 计算下次重置时间
   */
  private calcNextReset(from: Date, cycle: QuotaCycle): Date {
    const next = new Date(from);
    switch (cycle) {
      case QuotaCycle.DAILY:
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
        break;
      case QuotaCycle.WEEKLY:
        next.setDate(next.getDate() + (7 - next.getDay()));
        next.setHours(0, 0, 0, 0);
        break;
      case QuotaCycle.MONTHLY:
        next.setMonth(next.getMonth() + 1, 1);
        next.setHours(0, 0, 0, 0);
        break;
    }
    return next;
  }

  /**
   * 清除用户订阅缓存
   */
  private async invalidateUserCache(userId: string): Promise<void> {
    await this.redis.del(`${CACHE_PREFIX}${userId}`);
  }
}
