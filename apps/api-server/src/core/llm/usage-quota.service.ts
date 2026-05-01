/**
 * UsageQuotaService — 用户级配额预扣 / 退还
 *
 * 设计要点：
 *  1. 调用方在发起 LLM 请求 *之前* 调用 `consume()` 原子扣减
 *  2. 若调用失败（非业务错误，比如 timeout / 5xx）调用 `refund()` 退还，避免误扣
 *  3. 业务错误（4xx，content_filter 等）算作"已消费"，不退还
 *  4. 没有 quota 行时按 default 创建（lazy init）
 *  5. quota_limit = 0 表示不限制（系统/付费用户）
 *  6. resetAt 由后台 Cron 处理，本服务只读不重置
 *
 * 性能：
 *  - 单条 update with where 原子操作，PG 行锁
 *  - 命中索引 idx_usage_quota_user_feature
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmFeature, LlmQuotaExceededError } from './llm.types';

interface QuotaPolicy {
  limit: number; // 0 = unlimited
  cycle: 'daily' | 'weekly' | 'monthly';
}

/**
 * 默认配额策略 — 免费用户每日上限。
 * 付费用户可通过修改 usage_quota.quota_limit 直接覆盖（无需改代码）。
 *
 * TODO: 上线前需与产品/运营对齐数值。这里先用保守默认值。
 */
const DEFAULT_QUOTA: Record<LlmFeature, QuotaPolicy> = {
  [LlmFeature.FoodText]: { limit: 50, cycle: 'daily' },
  [LlmFeature.FoodImage]: { limit: 20, cycle: 'daily' },
  [LlmFeature.FoodEnrichment]: { limit: 0, cycle: 'daily' }, // 系统级补全任务
  [LlmFeature.CoachChat]: { limit: 100, cycle: 'daily' },
  [LlmFeature.RecipeGeneration]: { limit: 10, cycle: 'daily' },
};

@Injectable()
export class UsageQuotaService {
  private readonly logger = new Logger(UsageQuotaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 预扣一次配额。
   * @throws LlmQuotaExceededError 用户配额已耗尽
   */
  async consume(userId: string, feature: LlmFeature): Promise<void> {
    const policy = DEFAULT_QUOTA[feature];
    if (!policy || policy.limit === 0) {
      // 不限额功能直接放行（仍记录使用量，便于后续审计）
      await this.incrementUsageBestEffort(userId, feature, policy?.cycle);
      return;
    }

    // 1. 尝试在限额内自增（原子）。注意 Prisma 不支持 CAS update
    //    所以走 raw query：UPDATE ... SET used = used + 1 WHERE used < quota_limit
    const updated = await this.prisma.$executeRaw<number>`
      UPDATE usage_quota
      SET used = used + 1,
          updated_at = NOW()
      WHERE user_id = ${userId}::uuid
        AND feature = ${feature}
        AND (quota_limit = 0 OR used < quota_limit)
    `;

    if (updated === 1) {
      return; // 扣减成功
    }

    // 2. updated === 0 有两种可能：
    //    a) 配额行不存在（首次使用）→ 创建并扣 1
    //    b) 配额已用尽 → 抛错
    //   先 upsert 试一次
    const existing = await this.prisma.usageQuota.findUnique({
      where: { userId_feature: { userId, feature } },
      select: { used: true, quotaLimit: true },
    });

    if (!existing) {
      await this.prisma.usageQuota.create({
        data: {
          userId,
          feature,
          used: 1,
          quotaLimit: policy.limit,
          cycle: policy.cycle,
          resetAt: this.computeNextReset(policy.cycle),
        },
      });
      return;
    }

    // 行存在但扣不下去 = 配额耗尽
    throw new LlmQuotaExceededError(
      userId,
      feature,
      existing.used,
      existing.quotaLimit,
    );
  }

  /**
   * 退还一次预扣（调用失败且应当不计费时）。
   * 永不抛错 —— 退款失败只记日志。
   */
  async refund(userId: string, feature: LlmFeature): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE usage_quota
        SET used = GREATEST(used - 1, 0),
            updated_at = NOW()
        WHERE user_id = ${userId}::uuid
          AND feature = ${feature}
      `;
    } catch (err) {
      this.logger.warn(
        `Quota refund failed (user=${userId} feature=${feature}): ${(err as Error).message}`,
      );
    }
  }

  /** 不限额功能也记录使用量（best-effort，不阻塞主流程，不抛错） */
  private async incrementUsageBestEffort(
    userId: string,
    feature: LlmFeature,
    cycle: 'daily' | 'weekly' | 'monthly' = 'daily',
  ): Promise<void> {
    try {
      await this.prisma.usageQuota.upsert({
        where: { userId_feature: { userId, feature } },
        create: {
          userId,
          feature,
          used: 1,
          quotaLimit: 0,
          cycle,
          resetAt: this.computeNextReset(cycle),
        },
        update: { used: { increment: 1 } },
      });
    } catch (err) {
      // 不限额场景的统计失败不影响主流程
      this.logger.debug(
        `Best-effort quota increment failed: ${(err as Error).message}`,
      );
    }
  }

  private computeNextReset(cycle: 'daily' | 'weekly' | 'monthly'): Date {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(0, 0, 0, 0);
    if (cycle === 'daily') {
      next.setUTCDate(next.getUTCDate() + 1);
    } else if (cycle === 'weekly') {
      // 重置到下周一 00:00 UTC
      const day = next.getUTCDay(); // 0=Sun
      const daysUntilNextMonday = ((8 - day) % 7) || 7;
      next.setUTCDate(next.getUTCDate() + daysUntilNextMonday);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
    }
    return next;
  }
}
