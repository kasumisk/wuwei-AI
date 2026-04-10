/**
 * V6.1 — 用量配额服务
 *
 * 职责:
 * - check(userId, feature): 检查用户是否还有配额（返回 boolean）
 * - increment(userId, feature): 消耗一次配额
 * - getQuotaStatus(userId, feature): 获取配额详情（已用/上限/重置时间）
 * - resetExpiredQuotas(): Cron 定时批量重置过期配额
 *
 * V6.1 变更:
 * - 使用 PlanEntitlementResolver 解析权益，不再直接访问 TIER_ENTITLEMENTS
 * - 支持 V6.1 新增的计次功能（AI_TEXT_ANALYSIS, ANALYSIS_HISTORY）
 *
 * 设计决策:
 * - check + increment 分离: 允许业务先检查再消耗，避免预扣导致的回滚复杂度
 * - limit = -1 表示无限制（UNLIMITED），直接放行
 * - 缓存策略: 配额状态不走 Redis 缓存（写多读多，直接查 DB 简化一致性）
 * - 重置 Cron: 每小时执行一次，查找 resetAt < now 的记录批量重置
 */
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { usage_quota as UsageQuota } from '@prisma/client';
import { GatedFeature, QuotaCycle, UNLIMITED } from '../subscription.types';
import { SubscriptionService } from './subscription.service';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

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
  ) {}

  // ==================== 核心方法 ====================

  /**
   * 检查用户是否还有配额
   *
   * @returns true = 有配额或无限制，false = 已耗尽
   */
  async check(userId: string, feature: GatedFeature): Promise<boolean> {
    const quota = await this.getOrCreateQuota(userId, feature);
    if (!quota) return true; // 无记录 → 该功能不受配额限制

    // 无限制直接放行
    if (quota.quota_limit === UNLIMITED) return true;

    // 检查是否需要先重置（resetAt 已过）
    if (quota.reset_at && quota.reset_at <= new Date()) {
      await this.resetSingleQuota(quota);
      return true; // 刚重置，used=0
    }

    return quota.used < quota.quota_limit;
  }

  /**
   * 消耗一次配额
   *
   * @throws ForbiddenException 配额已耗尽
   */
  async increment(userId: string, feature: GatedFeature): Promise<QuotaStatus> {
    const quota = await this.getOrCreateQuota(userId, feature);
    if (!quota) {
      // 该功能不受计次限制 → 返回无限状态
      return {
        feature,
        used: 0,
        limit: UNLIMITED,
        remaining: UNLIMITED,
        unlimited: true,
        resetAt: null,
      };
    }

    // 无限制直接放行
    if (quota.quota_limit === UNLIMITED) {
      await this.prisma.usage_quota.update({
        where: { id: quota.id },
        data: { used: quota.used + 1 },
      });
      quota.used += 1;
      return this.toStatus(quota);
    }

    // 检查是否需要先重置
    if (quota.reset_at && quota.reset_at <= new Date()) {
      await this.resetSingleQuota(quota);
    }

    // 配额检查
    if (quota.used >= quota.quota_limit) {
      throw new ForbiddenException({
        code: 'QUOTA_EXCEEDED',
        message: `${feature} 今日配额已用完`,
        feature,
        used: quota.used,
        limit: quota.quota_limit,
        resetAt: quota.reset_at,
      });
    }

    // 消耗一次
    await this.prisma.usage_quota.update({
      where: { id: quota.id },
      data: { used: quota.used + 1 },
    });
    quota.used += 1;

    return this.toStatus(quota);
  }

  /**
   * 获取用户某功能的配额状态
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

    // 检查是否需要先重置
    if (quota.reset_at && quota.reset_at <= new Date()) {
      await this.resetSingleQuota(quota);
    }

    return this.toStatus(quota);
  }

  /**
   * 批量获取用户所有计次功能的配额状态
   */
  async getAllQuotaStatus(userId: string): Promise<QuotaStatus[]> {
    const quotas = await this.prisma.usage_quota.findMany({
      where: { user_id: userId },
    });
    const now = new Date();
    const results: QuotaStatus[] = [];

    for (const quota of quotas) {
      if (quota.reset_at && quota.reset_at <= now) {
        await this.resetSingleQuota(quota);
      }
      results.push(this.toStatus(quota));
    }

    return results;
  }

  // ==================== Cron 定时重置 ====================

  /**
   * 每小时执行: 批量重置过期配额
   *
   * 查找 resetAt <= now 的记录，将 used 重置为 0，更新 resetAt 到下一个周期。
   * 使用分批处理避免单次加载过多记录。
   */
  @Cron('0 * * * *', { name: 'quota-reset' })
  async resetExpiredQuotas(): Promise<number> {
    const now = new Date();
    const batchSize = 500;
    let totalReset = 0;

    // 分批处理
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const expired = await this.prisma.usage_quota.findMany({
        where: { reset_at: { lte: now } },
        take: batchSize,
      });

      if (expired.length === 0) break;

      for (const quota of expired) {
        await this.resetSingleQuota(quota);
        totalReset++;
      }
    }

    if (totalReset > 0) {
      this.logger.log(`配额重置 Cron: 已重置 ${totalReset} 条配额记录`);
    }
    return totalReset;
  }

  // ==================== 私有方法 ====================

  /**
   * 获取或按需创建配额记录
   *
   * 如果用户没有该功能的配额记录，根据其订阅等级自动创建。
   * 仅对计次类功能创建记录，布尔型功能不需要配额追踪。
   *
   * V6.1: 使用 PlanEntitlementResolver 判断功能类型和获取限额
   */
  private async getOrCreateQuota(
    userId: string,
    feature: GatedFeature,
  ): Promise<any | null> {
    // 先查已有记录
    const existing = await this.prisma.usage_quota.findUnique({
      where: { user_id_feature: { user_id: userId, feature } },
    });
    if (existing) return existing;

    // 使用 PlanEntitlementResolver 检查该功能是否为计次类型
    if (!this.entitlementResolver.isCountableFeature(feature)) return null;

    // 根据用户订阅概要获取权益配置
    const summary = await this.subscriptionService.getUserSummary(userId);
    const limit = this.entitlementResolver.getQuotaLimit(
      summary.entitlements,
      feature,
    );

    // 非数值型权益 → 不需要配额追踪
    if (limit === null) return null;

    // 自动创建配额记录
    const now = new Date();
    const resetAt = this.calcNextReset(now, QuotaCycle.DAILY);
    return this.prisma.usage_quota.create({
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

  /**
   * 判断功能是否为计次类型
   *
   * V6.1: 委托给 PlanEntitlementResolver
   */
  private isCountableFeature(feature: GatedFeature): boolean {
    return this.entitlementResolver.isCountableFeature(feature);
  }

  /**
   * 重置单条配额记录
   */
  private async resetSingleQuota(quota: any): Promise<void> {
    const newResetAt = this.calcNextReset(new Date(), quota.cycle);
    await this.prisma.usage_quota.update({
      where: { id: quota.id },
      data: { used: 0, reset_at: newResetAt },
    });
    quota.used = 0;
    quota.reset_at = newResetAt;
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
   * 将 UsageQuota entity 转换为 QuotaStatus DTO
   */
  private toStatus(quota: any): QuotaStatus {
    const unlimited = quota.quota_limit === UNLIMITED;
    return {
      feature: quota.feature as GatedFeature,
      used: quota.used,
      limit: quota.quota_limit,
      remaining: unlimited
        ? UNLIMITED
        : Math.max(0, quota.quota_limit - quota.used),
      unlimited,
      resetAt: quota.reset_at,
    };
  }
}
