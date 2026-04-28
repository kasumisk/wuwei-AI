/**
 * V6.5 Phase 3K: 解释自适应深度服务
 *
 * 问题：解释详细度仅由策略配置（simple/standard/detailed）二元控制，
 * 不考虑用户的实际互动意愿。低互动用户被过多信息淹没，高互动用户得不到深度分析。
 *
 * 方案：基于用户行为信号（记录频率、连胜天数、合规率、最近活跃度）
 * 计算 engagementScore (0-1)，映射到解释深度，作为策略级 detailLevel 的覆盖层。
 *
 * 覆盖规则：
 * - engagementScore < 0.3 → 强制 'simple'（减少认知负担）
 * - engagementScore 0.3-0.7 → 保持策略配置的 detailLevel
 * - engagementScore > 0.7 → 提升到至少 'standard'（高互动用户展示更多信息）
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { getBehavior } from '../../../../user/user-profile-merge.helper';

/** 用户互动意愿等级 */
export type EngagementLevel = 'low' | 'medium' | 'high';

/** 解释深度 */
export type ExplanationDetailLevel = 'simple' | 'standard' | 'detailed';

/** 用户互动意愿评估结果 */
export interface EngagementAssessment {
  /** 综合互动意愿评分 (0-1) */
  engagementScore: number;
  /** 互动意愿等级 */
  level: EngagementLevel;
  /** 推荐的解释深度 */
  recommendedDepth: ExplanationDetailLevel;
  /** 评分维度明细（调试用） */
  breakdown: {
    /** 记录频率评分 — 最近 7 天每天记录次数 */
    recordFrequency: number;
    /** 连胜天数评分 */
    streakScore: number;
    /** 合规率评分 */
    complianceScore: number;
    /** 最近活跃度评分 — 距上次记录的天数 */
    recencyScore: number;
  };
}

/** 缓存 TTL: 10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_NAMESPACE = 'engagement';

@Injectable()
export class AdaptiveExplanationDepthService {
  private readonly logger = new Logger(AdaptiveExplanationDepthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 评估用户的互动意愿等级
   * 结果缓存 10 分钟，避免每次推荐都查询
   */
  async assessEngagement(userId: string): Promise<EngagementAssessment> {
    const cacheKey = this.redis.buildKey(CACHE_NAMESPACE, userId);
    const cached = await this.redis.get<EngagementAssessment>(cacheKey);
    if (cached) return cached;

    const assessment = await this.computeEngagement(userId);

    await this.redis.set(cacheKey, assessment, CACHE_TTL_MS).catch(() => {
      /* cache failure is non-critical */
    });

    return assessment;
  }

  /**
   * 根据用户互动意愿调整解释深度
   *
   * @param strategyDepth 策略配置的 detailLevel
   * @param userId 用户 ID（可选，无则不调整）
   * @returns 最终使用的 detailLevel
   */
  async resolveDepth(
    strategyDepth: ExplanationDetailLevel,
    userId?: string,
  ): Promise<ExplanationDetailLevel> {
    if (!userId) return strategyDepth;

    try {
      const assessment = await this.assessEngagement(userId);
      return this.applyOverride(strategyDepth, assessment);
    } catch (err) {
      this.logger.warn(
        `Failed to assess engagement for ${userId}, using strategy depth: ${err}`,
      );
      return strategyDepth;
    }
  }

  // ─── 内部计算 ───

  private async computeEngagement(
    userId: string,
  ): Promise<EngagementAssessment> {
    // 并行查询行为数据
    const [userProfileRow, recentRecordCount, lastRecordDate] =
      await Promise.all([
        this.prisma.userProfiles.findUnique({
          where: { userId: userId },
        }),
        // 最近 7 天的记录数
        this.prisma.foodRecords.count({
          where: {
            userId: userId,
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
        // 最近一条记录的时间
        this.prisma.foodRecords.findFirst({
          where: { userId: userId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

    const behaviorProfile = userProfileRow ? getBehavior(userProfileRow) : null;

    // 1. 记录频率评分 (0-1): 7天内每天2条以上 = 满分
    const avgDailyRecords = recentRecordCount / 7;
    const recordFrequency = Math.min(1, avgDailyRecords / 2);

    // 2. 连胜天数评分 (0-1): 7天以上 = 满分
    const streakDays = behaviorProfile?.streakDays ?? 0;
    const streakScore = Math.min(1, streakDays / 7);

    // 3. 合规率评分 (0-1): 直接使用
    const complianceScore = Number(behaviorProfile?.avgComplianceRate ?? 0);

    // 4. 最近活跃度评分 (0-1): 今天记录过 = 1, 7天前 = 0
    let recencyScore = 0;
    if (lastRecordDate?.createdAt) {
      const daysSinceLastRecord =
        (Date.now() - lastRecordDate.createdAt.getTime()) /
        (24 * 60 * 60 * 1000);
      recencyScore = Math.max(0, 1 - daysSinceLastRecord / 7);
    }

    // 加权平均
    // 权重：记录频率 35%、合规率 25%、连胜 20%、活跃度 20%
    const engagementScore = round4(
      recordFrequency * 0.35 +
        complianceScore * 0.25 +
        streakScore * 0.2 +
        recencyScore * 0.2,
    );

    const level = this.classifyLevel(engagementScore);
    const recommendedDepth = this.mapToDepth(level);

    return {
      engagementScore,
      level,
      recommendedDepth,
      breakdown: {
        recordFrequency: round4(recordFrequency),
        streakScore: round4(streakScore),
        complianceScore: round4(complianceScore),
        recencyScore: round4(recencyScore),
      },
    };
  }

  private classifyLevel(score: number): EngagementLevel {
    if (score < 0.3) return 'low';
    if (score < 0.7) return 'medium';
    return 'high';
  }

  private mapToDepth(level: EngagementLevel): ExplanationDetailLevel {
    switch (level) {
      case 'low':
        return 'simple';
      case 'medium':
        return 'standard';
      case 'high':
        return 'detailed';
    }
  }

  /**
   * 应用覆盖规则
   *
   * - low engagement → 最多 'simple'（降级）
   * - medium engagement → 保持策略配置
   * - high engagement → 至少 'standard'（升级）
   */
  private applyOverride(
    strategyDepth: ExplanationDetailLevel,
    assessment: EngagementAssessment,
  ): ExplanationDetailLevel {
    const { level } = assessment;

    if (level === 'low') {
      // 低互动用户强制降级
      return 'simple';
    }

    if (level === 'high') {
      // 高互动用户：策略说 simple → 升级到 standard；否则保持
      if (strategyDepth === 'simple') return 'standard';
      return strategyDepth;
    }

    // medium：完全尊重策略配置
    return strategyDepth;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
