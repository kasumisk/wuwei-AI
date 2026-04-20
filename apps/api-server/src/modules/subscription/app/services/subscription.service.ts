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
 * - 支持运行时通过修改 subscriptionPlan.entitlements 调整权益
 *
 * 设计原则:
 * - 订阅状态变更通过 EventEmitter2 发布 subscription.changed 事件
 * - 等级查询结果缓存 5 分钟，减轻每次请求的 DB 查询
 * - 免费用户不创建 Subscription 记录，查询返回 null 时降级为 Free
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SubscriptionPlan,
  Subscription,
  PaymentRecords as PaymentRecord,
  UsageQuota,
} from '@prisma/client';
import {
  SubscriptionTier,
  SubscriptionStatus,
  PaymentChannel,
  PaymentStatus,
  GatedFeature,
  QuotaCycle,
  FeatureEntitlements,
} from '../../subscription.types';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  DomainEvents,
  SubscriptionChangedEvent,
} from '../../../../core/events/domain-events';

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

/** 缓存 TTL: 5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);

  /** V6.2 3.9: 订阅摘要 TieredCache namespace */
  private cache!: TieredCacheNamespace<UserSubscriptionSummary>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheManager: TieredCacheManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlementResolver: PlanEntitlementResolver,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<UserSubscriptionSummary>({
      namespace: 'sub_user',
      l1MaxEntries: 500,
      l1TtlMs: 2 * 60 * 1000, // L1: 2 分钟
      l2TtlMs: CACHE_TTL_MS, // L2: 5 分钟
    });
  }

  // ==================== 计划管理（Admin） ====================

  /** 创建订阅计划 */
  async createPlan(data: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const saved = await this.prisma.subscriptionPlan.create({
      data: data as any,
    });
    this.logger.log(
      `订阅计划已创建: ${saved.name} (${saved.tier}/${saved.billingCycle})`,
    );
    return saved as unknown as SubscriptionPlan;
  }

  /** 更新订阅计划 */
  async updatePlan(
    planId: string,
    data: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('订阅计划不存在');
    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: data as any,
    });
    return updated as unknown as SubscriptionPlan;
  }

  /** 获取所有上架计划（前端展示用） */
  async getActivePlans(): Promise<SubscriptionPlan[]> {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    });
    return plans as unknown as SubscriptionPlan[];
  }

  /** 获取所有计划（管理后台） */
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    const plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: [{ tier: 'asc' }, { sortOrder: 'asc' }],
    });
    return plans as unknown as SubscriptionPlan[];
  }

  /** 根据 ID 获取计划 */
  async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
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
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: params.planId },
    });
    if (!plan) throw new NotFoundException('订阅计划不存在');

    // 1. 失效旧订阅
    await this.prisma.subscription.updateMany({
      where: {
        userId: params.userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE_PERIOD],
        },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    // 2. 创建新订阅
    const saved = await this.prisma.subscription.create({
      data: {
        userId: params.userId,
        planId: params.planId,
        paymentChannel: params.paymentChannel,
        platformSubscriptionId: params.platformSubscriptionId ?? null,
        startsAt: params.startsAt ?? new Date(),
        expiresAt: params.expiresAt,
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
      },
    });

    // 3. 初始化用量配额
    await this.initQuotas(params.userId, plan);

    // 4. 缓存失效 + 事件
    await this.invalidateUserCache(params.userId);
    this.eventEmitter.emit(
      DomainEvents.SUBSCRIPTION_CHANGED,
      new SubscriptionChangedEvent(
        params.userId,
        SubscriptionTier.FREE,
        plan.tier as string,
        'purchase',
      ),
    );

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
        cancelledAt: new Date(),
        autoRenew: false,
      },
    });

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit(
      DomainEvents.SUBSCRIPTION_CHANGED,
      new SubscriptionChangedEvent(
        userId,
        sub.subscriptionPlan.tier as string,
        sub.subscriptionPlan.tier as string,
        'cancel',
      ),
    );

    this.logger.log(
      `用户 ${userId} 已取消订阅，将于 ${sub.expiresAt.toISOString()} 失效`,
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
        userId: userId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.CANCELLED,
            SubscriptionStatus.GRACE_PERIOD,
          ],
        },
      },
      include: { subscriptionPlan: true },
      orderBy: { expiresAt: 'desc' },
    });
    if (!sub) return null;

    const saved = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        expiresAt: newExpiresAt,
        cancelledAt: null,
        autoRenew: true,
      },
    });

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit(
      DomainEvents.SUBSCRIPTION_CHANGED,
      new SubscriptionChangedEvent(
        userId,
        sub.subscriptionPlan.tier as string,
        sub.subscriptionPlan.tier as string,
        'upgrade',
      ),
    );

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
          { userId: userId, status: SubscriptionStatus.ACTIVE },
          { userId: userId, status: SubscriptionStatus.GRACE_PERIOD },
          {
            userId: userId,
            status: SubscriptionStatus.CANCELLED,
            // S3 fix: gte = 未过期（expires_at >= now），而非 lte（已过期）
            expiresAt: { gte: new Date() },
          },
        ],
      },
      orderBy: { expiresAt: 'desc' },
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
    return this.cache.getOrSet(userId, () => this.buildUserSummary(userId));
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
    const record = await this.prisma.paymentRecords.create({
      data: {
        userId: data.userId,
        subscriptionId: data.subscriptionId,
        orderNo: data.orderNo,
        channel: data.channel,
        amountCents: data.amountCents,
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
    const record = await this.prisma.paymentRecords.findFirst({
      where: { orderNo: orderNo },
    });
    if (!record) return null;

    const updateData: Record<string, unknown> = { status };
    if (platformTransactionId) {
      updateData.platformTransactionId = platformTransactionId;
    }
    if (callbackPayload) {
      updateData.callbackPayload = callbackPayload;
    }
    if (status === PaymentStatus.SUCCESS) {
      updateData.paidAt = new Date();
    }
    if (status === PaymentStatus.REFUNDED) {
      updateData.refundedAt = new Date();
    }

    const updated = await this.prisma.paymentRecords.update({
      where: { id: record.id },
      data: updateData,
    });
    return updated as unknown as PaymentRecord;
  }

  /** 获取用户支付历史 */
  async getUserPayments(userId: string, limit = 20): Promise<PaymentRecord[]> {
    const records = await this.prisma.paymentRecords.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
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
    const gracePeriodEndsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // 查找已过期但仍活跃的订阅
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { lt: now },
      },
      include: { subscriptionPlan: true },
    });

    let count = 0;

    if (expired.length > 0) {
      // V6.3 P1-6: 按 auto_renew 分组，批量 UPDATE 替代逐条更新
      const autoRenewIds = expired.filter((s) => s.autoRenew).map((s) => s.id);
      const manualIds = expired.filter((s) => !s.autoRenew).map((s) => s.id);

      if (autoRenewIds.length > 0) {
        await this.prisma.subscription.updateMany({
          where: { id: { in: autoRenewIds } },
          data: {
            status: SubscriptionStatus.GRACE_PERIOD,
            gracePeriodEndsAt: gracePeriodEndsAt,
          },
        });
      }

      if (manualIds.length > 0) {
        await this.prisma.subscription.updateMany({
          where: { id: { in: manualIds } },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }

      // 事件和缓存失效仍需逐条（每条包含不同 userId/tier）
      for (const sub of expired) {
        await this.invalidateUserCache(sub.userId);
        this.eventEmitter.emit(
          DomainEvents.SUBSCRIPTION_CHANGED,
          new SubscriptionChangedEvent(
            sub.userId,
            sub.subscriptionPlan.tier as string,
            sub.autoRenew
              ? (sub.subscriptionPlan.tier as string)
              : SubscriptionTier.FREE,
            sub.autoRenew ? 'downgrade' : 'expire',
          ),
        );
        count++;
      }
    }

    // 处理宽限期结束的订阅
    const graceExpired = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.GRACE_PERIOD,
        gracePeriodEndsAt: { lt: now },
      },
      include: { subscriptionPlan: true },
    });

    if (graceExpired.length > 0) {
      // V6.3 P1-6: 批量 UPDATE
      await this.prisma.subscription.updateMany({
        where: {
          id: { in: graceExpired.map((s) => s.id) },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      for (const sub of graceExpired) {
        await this.invalidateUserCache(sub.userId);

        // 重置为免费配额
        const freePlan = await this.prisma.subscriptionPlan.findFirst({
          where: {
            tier: SubscriptionTier.FREE,
            isActive: true,
          },
        });
        if (freePlan) {
          await this.initQuotas(sub.userId, freePlan);
        }

        this.eventEmitter.emit(
          DomainEvents.SUBSCRIPTION_CHANGED,
          new SubscriptionChangedEvent(
            sub.userId,
            sub.subscriptionPlan.tier as string,
            SubscriptionTier.FREE,
            'expire',
          ),
        );
        count++;
      }
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
          { userId: userId, status: SubscriptionStatus.ACTIVE },
          { userId: userId, status: SubscriptionStatus.GRACE_PERIOD },
          {
            userId: userId,
            status: SubscriptionStatus.CANCELLED,
            // S3 fix: gte = 未过期（expires_at >= now），而非 lte（已过期）
            expiresAt: { gte: new Date() },
          },
        ],
      },
      include: { subscriptionPlan: true },
      orderBy: { expiresAt: 'desc' },
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
          { userId: userId, status: SubscriptionStatus.ACTIVE },
          { userId: userId, status: SubscriptionStatus.GRACE_PERIOD },
        ],
      },
      include: { subscriptionPlan: true },
      orderBy: { expiresAt: 'desc' },
    });

    // 额外检查: CANCELLED 但尚未过期的订阅仍然有效
    const cancelledButValid = sub
      ? null
      : await this.prisma.subscription.findFirst({
          where: {
            userId: userId,
            status: SubscriptionStatus.CANCELLED,
          },
          include: { subscriptionPlan: true },
          orderBy: { expiresAt: 'desc' },
        });

    const activeSub =
      cancelledButValid && cancelledButValid.expiresAt > now
        ? cancelledButValid
        : sub;

    if (!activeSub || !activeSub.subscriptionPlan) {
      // 免费用户: 从 DB subscription_plan 表读 tier='free' 的权益，
      // 不使用硬编码的 TIER_ENTITLEMENTS，以确保 DB 中的配额修改生效
      const freePlan = await this.prisma.subscriptionPlan.findFirst({
        where: { tier: SubscriptionTier.FREE },
      });
      return {
        tier: SubscriptionTier.FREE,
        subscriptionId: null,
        planName: freePlan?.name ?? 'Free',
        expiresAt: null,
        autoRenew: false,
        entitlements: this.entitlementResolver.resolve(
          SubscriptionTier.FREE,
          freePlan?.entitlements as any,
        ),
      };
    }

    // 付费用户: 使用 resolver 合并 DB 中的权益与默认值
    return {
      tier: activeSub.subscriptionPlan.tier as SubscriptionTier,
      subscriptionId: activeSub.id,
      planName: activeSub.subscriptionPlan.name,
      expiresAt: activeSub.expiresAt,
      autoRenew: activeSub.autoRenew,
      entitlements: this.entitlementResolver.resolve(
        activeSub.subscriptionPlan.tier as SubscriptionTier,
        activeSub.subscriptionPlan.entitlements as any,
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
      const existing = await this.prisma.usageQuota.findUnique({
        where: {
          userId_feature: { userId: userId, feature },
        },
      });
      const resetAt = this.calcNextReset(now, QuotaCycle.DAILY);

      if (existing) {
        await this.prisma.usageQuota.update({
          where: { id: existing.id },
          data: {
            quotaLimit: limit,
            cycle: QuotaCycle.DAILY,
            // 升级时不重置 used，等自然重置
          },
        });
      } else {
        await this.prisma.usageQuota.create({
          data: {
            userId: userId,
            feature,
            used: 0,
            quotaLimit: limit,
            cycle: QuotaCycle.DAILY,
            resetAt: resetAt,
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
    await this.cache.invalidate(userId);
  }
}
