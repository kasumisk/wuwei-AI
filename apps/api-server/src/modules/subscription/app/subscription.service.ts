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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { PaymentRecord } from '../entities/payment-record.entity';
import { UsageQuota } from '../entities/usage-quota.entity';
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
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentRecord)
    private readonly paymentRepo: Repository<PaymentRecord>,
    @InjectRepository(UsageQuota)
    private readonly quotaRepo: Repository<UsageQuota>,
    private readonly redis: RedisCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlementResolver: PlanEntitlementResolver,
  ) {}

  // ==================== 计划管理（Admin） ====================

  /** 创建订阅计划 */
  async createPlan(data: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const plan = this.planRepo.create(data);
    const saved = await this.planRepo.save(plan);
    this.logger.log(
      `订阅计划已创建: ${saved.name} (${saved.tier}/${saved.billingCycle})`,
    );
    return saved;
  }

  /** 更新订阅计划 */
  async updatePlan(
    planId: string,
    data: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) throw new NotFoundException('订阅计划不存在');
    Object.assign(plan, data);
    return this.planRepo.save(plan);
  }

  /** 获取所有上架计划（前端展示用） */
  async getActivePlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', priceCents: 'ASC' },
    });
  }

  /** 获取所有计划（管理后台） */
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ order: { tier: 'ASC', sortOrder: 'ASC' } });
  }

  /** 根据 ID 获取计划 */
  async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
    return this.planRepo.findOneBy({ id: planId });
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
    const plan = await this.planRepo.findOneBy({ id: params.planId });
    if (!plan) throw new NotFoundException('订阅计划不存在');

    // 1. 失效旧订阅
    await this.subRepo.update(
      {
        userId: params.userId,
        status: In([
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.GRACE_PERIOD,
        ]),
      },
      { status: SubscriptionStatus.EXPIRED },
    );

    // 2. 创建新订阅
    const sub = this.subRepo.create({
      userId: params.userId,
      planId: params.planId,
      paymentChannel: params.paymentChannel,
      platformSubscriptionId: params.platformSubscriptionId ?? null,
      startsAt: params.startsAt ?? new Date(),
      expiresAt: params.expiresAt,
      status: SubscriptionStatus.ACTIVE,
      autoRenew: true,
    });
    const saved = await this.subRepo.save(sub);

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
    return saved;
  }

  /**
   * 取消订阅（当前周期结束后失效）
   */
  async cancelSubscription(userId: string): Promise<Subscription | null> {
    const sub = await this.getActiveSubscription(userId);
    if (!sub) return null;

    sub.status = SubscriptionStatus.CANCELLED;
    sub.cancelledAt = new Date();
    sub.autoRenew = false;
    const saved = await this.subRepo.save(sub);

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit('subscription.changed', {
      userId,
      subscriptionId: saved.id,
      tier: sub.plan.tier,
      action: 'cancelled',
    });

    this.logger.log(
      `用户 ${userId} 已取消订阅，将于 ${sub.expiresAt.toISOString()} 失效`,
    );
    return saved;
  }

  /**
   * 续费订阅（支付成功后调用）
   */
  async renewSubscription(
    userId: string,
    newExpiresAt: Date,
  ): Promise<Subscription | null> {
    const sub = await this.subRepo.findOne({
      where: {
        userId,
        status: In([
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.CANCELLED,
          SubscriptionStatus.GRACE_PERIOD,
        ]),
      },
      order: { expiresAt: 'DESC' },
    });
    if (!sub) return null;

    sub.status = SubscriptionStatus.ACTIVE;
    sub.expiresAt = newExpiresAt;
    sub.cancelledAt = null;
    sub.autoRenew = true;
    const saved = await this.subRepo.save(sub);

    await this.invalidateUserCache(userId);
    this.eventEmitter.emit('subscription.changed', {
      userId,
      subscriptionId: saved.id,
      tier: sub.plan.tier,
      action: 'renewed',
    });

    this.logger.log(
      `用户 ${userId} 订阅已续费至 ${newExpiresAt.toISOString()}`,
    );
    return saved;
  }

  // ==================== 查询 ====================

  /**
   * 获取用户当前有效订阅（ACTIVE / GRACE_PERIOD / CANCELLED 但未过期）
   */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    return this.subRepo.findOne({
      where: [
        { userId, status: SubscriptionStatus.ACTIVE },
        { userId, status: SubscriptionStatus.GRACE_PERIOD },
        {
          userId,
          status: SubscriptionStatus.CANCELLED,
          expiresAt: LessThanOrEqual(new Date()) as unknown as Date,
        },
      ],
      order: { expiresAt: 'DESC' },
    });
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
    const record = this.paymentRepo.create({
      ...data,
      status: PaymentStatus.PENDING,
    });
    return this.paymentRepo.save(record);
  }

  /** 更新支付状态（回调时调用） */
  async updatePaymentStatus(
    orderNo: string,
    status: PaymentStatus,
    platformTransactionId?: string,
    callbackPayload?: Record<string, unknown>,
  ): Promise<PaymentRecord | null> {
    const record = await this.paymentRepo.findOneBy({ orderNo });
    if (!record) return null;

    record.status = status;
    if (platformTransactionId) {
      record.platformTransactionId = platformTransactionId;
    }
    if (callbackPayload) {
      record.callbackPayload = callbackPayload;
    }
    if (status === PaymentStatus.SUCCESS) {
      record.paidAt = new Date();
    }
    if (status === PaymentStatus.REFUNDED) {
      record.refundedAt = new Date();
    }

    return this.paymentRepo.save(record);
  }

  /** 获取用户支付历史 */
  async getUserPayments(userId: string, limit = 20): Promise<PaymentRecord[]> {
    return this.paymentRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
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
    const expired = await this.subRepo
      .createQueryBuilder('sub')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.expires_at < :now', { now })
      .getMany();

    let count = 0;
    for (const sub of expired) {
      if (sub.autoRenew) {
        // 自动续费用户 → 宽限期（3 天）
        sub.status = SubscriptionStatus.GRACE_PERIOD;
        sub.gracePeriodEndsAt = new Date(
          now.getTime() + 3 * 24 * 60 * 60 * 1000,
        );
      } else {
        // 手动续费用户 → 直接过期
        sub.status = SubscriptionStatus.EXPIRED;
      }
      await this.subRepo.save(sub);
      await this.invalidateUserCache(sub.userId);
      this.eventEmitter.emit('subscription.changed', {
        userId: sub.userId,
        subscriptionId: sub.id,
        action: sub.autoRenew ? 'grace_period' : 'expired',
      });
      count++;
    }

    // 处理宽限期结束的订阅
    const graceExpired = await this.subRepo
      .createQueryBuilder('sub')
      .where('sub.status = :status', {
        status: SubscriptionStatus.GRACE_PERIOD,
      })
      .andWhere('sub.grace_period_ends_at < :now', { now })
      .getMany();

    for (const sub of graceExpired) {
      sub.status = SubscriptionStatus.EXPIRED;
      await this.subRepo.save(sub);
      await this.invalidateUserCache(sub.userId);

      // 重置为免费配额
      const freePlan = await this.planRepo.findOneBy({
        tier: SubscriptionTier.FREE,
        isActive: true,
      });
      if (freePlan) {
        await this.initQuotas(sub.userId, freePlan);
      }

      this.eventEmitter.emit('subscription.changed', {
        userId: sub.userId,
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
   * 构建用户订阅概要（无缓存，直接查 DB）
   *
   * V6.1: 使用 PlanEntitlementResolver 合并 DB 权益与默认值
   */
  private async buildUserSummary(
    userId: string,
  ): Promise<UserSubscriptionSummary> {
    const now = new Date();

    // 查找有效订阅（ACTIVE 或 GRACE_PERIOD 或 CANCELLED 但未过期）
    const sub = await this.subRepo.findOne({
      where: [
        { userId, status: SubscriptionStatus.ACTIVE },
        { userId, status: SubscriptionStatus.GRACE_PERIOD },
      ],
      relations: ['plan'],
      order: { expiresAt: 'DESC' },
    });

    // 额外检查: CANCELLED 但尚未过期的订阅仍然有效
    const cancelledButValid = sub
      ? null
      : await this.subRepo.findOne({
          where: { userId, status: SubscriptionStatus.CANCELLED },
          relations: ['plan'],
          order: { expiresAt: 'DESC' },
        });

    const activeSub =
      cancelledButValid && cancelledButValid.expiresAt > now
        ? cancelledButValid
        : sub;

    if (!activeSub || !activeSub.plan) {
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
      tier: activeSub.plan.tier,
      subscriptionId: activeSub.id,
      planName: activeSub.plan.name,
      expiresAt: activeSub.expiresAt,
      autoRenew: activeSub.autoRenew,
      entitlements: this.entitlementResolver.resolve(
        activeSub.plan.tier,
        activeSub.plan.entitlements,
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
    plan: SubscriptionPlan,
  ): Promise<void> {
    const entitlements = this.entitlementResolver.resolve(
      plan.tier,
      plan.entitlements,
    );
    const now = new Date();

    // 通过 resolver 动态获取所有计次类功能及其限额
    const countableFeatures =
      this.entitlementResolver.listCountableFeatures(entitlements);

    for (const { feature, limit } of countableFeatures) {
      const existing = await this.quotaRepo.findOneBy({ userId, feature });
      const resetAt = this.calcNextReset(now, QuotaCycle.DAILY);

      if (existing) {
        existing.quotaLimit = limit;
        existing.cycle = QuotaCycle.DAILY;
        // 升级时不重置 used，等自然重置
        await this.quotaRepo.save(existing);
      } else {
        const quota = this.quotaRepo.create({
          userId,
          feature,
          used: 0,
          quotaLimit: limit,
          cycle: QuotaCycle.DAILY,
          resetAt,
        });
        await this.quotaRepo.save(quota);
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
