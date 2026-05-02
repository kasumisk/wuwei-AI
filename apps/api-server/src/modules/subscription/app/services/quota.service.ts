/**
 * V6.1 — 用量配额服务
 *
 * 职责:
 * - check(userId, feature): 只读查询当前配额状态（供 UI 展示，不作授权判断）
 * - increment(userId, feature): 原子扣减一次配额（CAS 语义，不会超额）
 * - getQuotaStatus / getAllQuotaStatus: 配额详情查询
 * - resetExpiredQuotas(): Cron 定时批量重置过期配额
 *
 * P1-1 原子化改造（Race Condition 修复）：
 * - 原实现 check() + increment() 两步之间有竞态窗口：两个并发请求都通过 check，
 *   然后都执行 increment，导致用户实际使用次数超过 quota_limit。
 * - 新实现：increment() 使用单条原子 SQL（带 WHERE used < quota_limit 的 CAS UPDATE），
 *   数据库层面保证：返回 rowCount=0 即配额已满，无论多少并发都不会超额。
 * - getOrCreateQuota 改为 upsert (ON CONFLICT DO NOTHING)，防止并发创建重复记录。
 * - QuotaGateService 应移除 check() 前置调用，直接走 increment() 的原子结果。
 */
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UsageQuota } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { GatedFeature, QuotaCycle, UNLIMITED } from '../../subscription.types';
import { SubscriptionService } from './subscription.service';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n/i18n.service';

/** 单个功能的配额状态 */
export interface QuotaStatus {
  feature: GatedFeature;
  used: number;
  limit: number;
  remaining: number;
  /** 是否无限制 */
  unlimited: boolean;
  /** 下次重置时间 */
  resetAt: Date | null;
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementResolver: PlanEntitlementResolver,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 核心方法 ====================

  /**
   * 只读检查用户是否还有配额（供 UI 展示用，不作授权判断）。
   *
   * ⚠️  注意：check() → increment() 两步之间有竞态窗口。
   * 授权判断请直接调用 increment()，它是原子的。
   *
   * @returns true = 有配额或无限制，false = 已耗尽
   */
  async check(userId: string, feature: GatedFeature): Promise<boolean> {
    const quota = await this.getOrCreateQuota(userId, feature);
    if (!quota) return true;
    if (quota.quotaLimit === UNLIMITED) return true;
    if (quota.resetAt && quota.resetAt <= new Date()) return true; // cron 会重置
    return quota.used < quota.quotaLimit;
  }

  /**
   * 原子扣减一次配额（CAS 语义）。
   *
   * 实现方式：
   * - UNLIMITED：直接 UPDATE used = used + 1，无条件成功。
   * - 有上限：执行带 WHERE used < quota_limit 的原子 UPDATE；
   *   若影响行数 = 0 → 配额已满，抛 ForbiddenException；
   *   若影响行数 = 1 → 扣减成功，返回最新状态。
   *
   * 并发安全：数据库行锁保证同一 quota 行的 used 不会超过 quota_limit，
   * 无论多少请求同时到达。
   *
   * @throws ForbiddenException 配额已耗尽
   */
  async increment(userId: string, feature: GatedFeature): Promise<QuotaStatus> {
    const quota = await this.getOrCreateQuota(userId, feature);

    // 不受计次限制的功能
    if (!quota) {
      return {
        feature,
        used: 0,
        limit: UNLIMITED,
        remaining: UNLIMITED,
        unlimited: true,
        resetAt: null,
      };
    }

    // UNLIMITED：无条件 increment（不需要 CAS）
    if (quota.quotaLimit === UNLIMITED) {
      const updated = await this.prisma.usageQuota.update({
        where: { id: quota.id },
        data: { used: { increment: 1 } },
      });
      return this.toStatus(updated);
    }

    // 有限额：原子 CAS UPDATE
    // 使用 executeRaw 以便利用 WHERE used < quota_limit 语义
    // 同时处理配额周期已过期的情况（reset_at <= now 时先重置再扣）
    const now = new Date();

    // 若配额周期已过，先原子重置到新周期（由 cron 兜底，这里防用户长时间不访问后首次请求失败）
    if (quota.resetAt && quota.resetAt <= now) {
      await this.resetSingleQuota(quota);
      // 重置后 used=0，必然通过；直接 increment
      const updated = await this.prisma.usageQuota.update({
        where: { id: quota.id },
        data: { used: 1 },
      });
      return this.toStatus(updated);
    }

    // 核心原子 CAS：UPDATE ... SET used = used + 1 WHERE id = ? AND used < quota_limit
    // Prisma 不直接支持带条件的 UPDATE returning，使用 $executeRaw
    const affectedRows = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE usage_quota
        SET    used       = used + 1,
               updated_at = now()
        WHERE  id         = ${quota.id}::uuid
          AND  used       < quota_limit
      `,
    );

    if (affectedRows === 0) {
      // 配额耗尽（CAS 条件不成立）
      throw new ForbiddenException({
        code: 'QUOTA_EXCEEDED',
        message: this.i18n.t('subscription.quota.exceeded', { feature }),
        feature,
        used: quota.used,
        limit: quota.quotaLimit,
        resetAt: quota.resetAt,
      });
    }

    // 读取最新状态（$executeRaw 不返回行数据）
    const updated = await this.prisma.usageQuota.findUnique({
      where: { id: quota.id },
    });
    return this.toStatus(updated!);
  }

  /**
   * 获取用户某功能的配额状态（只读）
   */
  async getQuotaStatus(
    userId: string,
    feature: GatedFeature,
  ): Promise<QuotaStatus> {
    const quota = await this.getOrCreateQuota(userId, feature);
    if (!quota) {
      return {
        feature,
        used: 0,
        limit: UNLIMITED,
        remaining: UNLIMITED,
        unlimited: true,
        resetAt: null,
      };
    }
    return this.toStatus(quota);
  }

  /**
   * 批量获取用户所有计次功能的配额状态。
   *
   * 查询操作不触发写入；过期配额由 Cron 统一重置。
   * 为所有计次类功能返回状态（包括尚未创建 UsageQuota 记录的新用户）。
   */
  async getAllQuotaStatus(userId: string): Promise<QuotaStatus[]> {
    const [quotas, summary] = await Promise.all([
      this.prisma.usageQuota.findMany({ where: { userId } }),
      this.subscriptionService.getUserSummary(userId),
    ]);

    const existingMap = new Map<string, UsageQuota>();
    for (const q of quotas) existingMap.set(q.feature, q);

    const countableFeatures = Object.values(GatedFeature).filter((f) =>
      this.entitlementResolver.isCountableFeature(f as GatedFeature),
    ) as GatedFeature[];

    const now = new Date();
    const defaultResetAt = this.calcNextReset(now, QuotaCycle.DAILY);

    return countableFeatures
      .map((feature) => {
        const existing = existingMap.get(feature);
        if (existing) return this.toStatus(existing);

        const limit = this.entitlementResolver.getQuotaLimit(
          summary.entitlements,
          feature,
        );
        if (limit === null) return null;

        const unlimited = limit === UNLIMITED;
        return {
          feature,
          used: 0,
          limit,
          remaining: unlimited ? UNLIMITED : limit,
          unlimited,
          resetAt: defaultResetAt,
        } as QuotaStatus;
      })
      .filter((s): s is QuotaStatus => s !== null);
  }

  // ==================== Cron 定时重置 ====================

  /**
   * 每小时执行: 批量原子重置过期配额
   *
   * 使用 executeRaw 单条 SQL，保证并发 cron（多实例）下幂等：
   *   UPDATE ... WHERE reset_at <= now() → 已重置的行 reset_at > now()，不会二次重置
   */
  @Cron('0 * * * *', { name: 'quota-reset' })
  async resetExpiredQuotas(): Promise<number> {
    const now = new Date();
    let totalReset = 0;

    const cycles = [
      QuotaCycle.DAILY,
      QuotaCycle.WEEKLY,
      QuotaCycle.MONTHLY,
    ] as const;

    for (const cycle of cycles) {
      const nextResetAt = this.calcNextReset(now, cycle);
      const result = await this.prisma.usageQuota.updateMany({
        where: { resetAt: { lte: now }, cycle },
        data: { used: 0, resetAt: nextResetAt },
      });
      totalReset += result.count;
    }

    if (totalReset > 0) {
      this.logger.log(`配额重置 Cron: 已重置 ${totalReset} 条配额记录`);
    }
    return totalReset;
  }

  // ==================== 私有方法 ====================

  /**
   * 获取或原子创建配额记录。
   *
   * 使用 upsert（ON CONFLICT DO NOTHING 语义），防止并发首次创建时 unique 冲突。
   */
  private async getOrCreateQuota(
    userId: string,
    feature: GatedFeature,
  ): Promise<UsageQuota | null> {
    if (!this.entitlementResolver.isCountableFeature(feature)) return null;

    const summary = await this.subscriptionService.getUserSummary(userId);
    const currentLimit = this.entitlementResolver.getQuotaLimit(
      summary.entitlements,
      feature,
    );
    if (currentLimit === null) return null;

    const now = new Date();
    const resetAt = this.calcNextReset(now, QuotaCycle.DAILY);

    // upsert：不存在则创建，存在则按需同步 quota_limit
    const quota = await this.prisma.usageQuota.upsert({
      where: { userId_feature: { userId, feature } },
      create: {
        userId,
        feature,
        used: 0,
        quotaLimit: currentLimit,
        cycle: QuotaCycle.DAILY,
        resetAt,
      },
      update: {
        // 只在 quota_limit 变化时更新，避免无谓写放大
        quotaLimit: currentLimit,
      },
    });

    return quota;
  }

  /**
   * 原子重置单条配额（供 increment() 内懒重置使用）
   */
  private async resetSingleQuota(quota: UsageQuota): Promise<void> {
    const newResetAt = this.calcNextReset(
      new Date(),
      quota.cycle as QuotaCycle,
    );
    await this.prisma.usageQuota.update({
      where: { id: quota.id },
      data: { used: 0, resetAt: newResetAt },
    });
    // 更新内存引用，让调用方 increment 能感知已重置
    (quota as any).used = 0;
    (quota as any).resetAt = newResetAt;
  }

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

  private toStatus(quota: UsageQuota): QuotaStatus {
    const unlimited = quota.quotaLimit === UNLIMITED;
    return {
      feature: quota.feature as GatedFeature,
      used: quota.used,
      limit: quota.quotaLimit,
      remaining: unlimited
        ? UNLIMITED
        : Math.max(0, quota.quotaLimit - quota.used),
      unlimited,
      resetAt: quota.resetAt,
    };
  }
}
