/**
 * V6.6 Phase 3-A: LearnedRankingService — per-segment 学习权重优化
 *
 * 基于历史推荐 trace + 用户反馈，每周重新计算各用户分群的最优评分权重向量。
 * 使用简单的梯度下降线性回归（无神经网络），12维权重约束非负且归一化。
 *
 * 控制方式：通过 feature_flags 表的 'learned_ranking_enabled' 开关灰度开放。
 * 默认 false，Phase 3 灰度开放后再切换。
 *
 * 与 StrategyAutoTuner 协同：
 * - StrategyAutoTuner（周一 04:00）：调整 segment → strategy 映射（粗粒度）
 * - LearnedRankingService（周一 06:00）：在已选策略内优化评分权重向量（细粒度）
 *
 * 学到的权重存储位置：
 * - Redis key: learned_weights:{segment}（TTL 8天，保证下次 Cron 前有效）
 * - strategy.config.rank.learnedWeights.{segment}（DB 持久化）
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FeatureFlagService } from '../../../feature-flag/feature-flag.service';
import { SCORE_DIMENSIONS } from './recommendation.types';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';

/** 特性开关 key */
const FF_LEARNED_RANKING = 'learned_ranking_enabled';

/** 样本最小数量（不足时跳过该分群） */
const MIN_SAMPLES = 50;

/** 梯度下降超参数 */
const LEARNING_RATE = 0.001;
const MAX_ITERATIONS = 1000;
const CONVERGENCE_THRESHOLD = 1e-6;

/** 权重维度数量（与 SCORE_DIMENSIONS 对齐） */
const DIM_COUNT = SCORE_DIMENSIONS.length; // 12

/** 已知的用户分群列表 */
const USER_SEGMENTS = [
  'new_user',
  'returning_user',
  'disciplined_loser',
  'muscle_builder',
  'active_maintainer',
  'casual_maintainer',
  'binge_risk',
] as const;

/** 单个排序样本：食物维度评分向量 + 是否被接受 */
interface RankingSample {
  /** 12 维原始评分向量（0~1） */
  dimScores: number[];
  /** 用户是否接受（1 = accepted，0 = replaced/skipped） */
  accepted: 0 | 1;
}

@Injectable()
export class LearnedRankingService implements OnModuleInit {
  private readonly logger = new Logger(LearnedRankingService.name);
  private learnedWeightsCache!: TieredCacheNamespace<number[]>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly cacheManager: TieredCacheManager,
  ) {}

  onModuleInit(): void {
    this.learnedWeightsCache = this.cacheManager.createNamespace<number[]>({
      namespace: 'learned_weights',
      l1MaxEntries: 50,
      l1TtlMs: 8 * 24 * 3600 * 1000,
      l2TtlMs: 8 * 24 * 3600 * 1000,
    }) as any;
  }

  /**
   * 周一 06:00：遍历各分群，收集样本并优化权重
   * 晚于 StrategyAutoTuner（04:00），确保 segment→strategy 映射已更新
   */
  @Cron('0 6 * * 1')
  async recomputeWeights(): Promise<void> {
    // feature flag 检查（不传 userId，检查全局开关）
    const enabled = await this.featureFlagService.isEnabled(FF_LEARNED_RANKING);
    if (!enabled) {
      this.logger.debug('Learned ranking disabled via feature flag, skipping');
      return;
    }

    this.logger.log('Starting weekly learned ranking weight recomputation...');
    let updatedSegments = 0;

    for (const segment of USER_SEGMENTS) {
      try {
        const samples = await this.collectSamples(segment);
        if (samples.length < MIN_SAMPLES) {
          this.logger.debug(
            `Segment [${segment}]: insufficient samples (${samples.length} < ${MIN_SAMPLES}), skipping`,
          );
          continue;
        }

        const learnedWeights = this.fitWeights(samples);
        await this.saveWeights(segment, learnedWeights);
        updatedSegments++;
        this.logger.log(
          `Segment [${segment}]: updated learned weights (${samples.length} samples)`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to compute learned weights for segment [${segment}]: ${err.message}`,
          err.stack,
        );
      }
    }

    this.logger.log(
      `Learned ranking recomputation completed: ${updatedSegments}/${USER_SEGMENTS.length} segments updated`,
    );
  }

  /**
   * 收集指定分群近 30 天的 trace + feedback 样本
   * 每个样本包含食物的 12 维原始评分向量 + 接受标记
   */
  private async collectSamples(segment: string): Promise<RankingSample[]> {
    const rows = await this.prisma.$queryRaw<
      {
        top_foods: any;
        action: string;
        food_name: string;
      }[]
    >`
      SELECT
        rt.top_foods,
        rf.action,
        rf.food_name
      FROM recommendation_traces rt
      INNER JOIN recommendation_feedbacks rf
        ON rf.trace_id = rt.id
      INNER JOIN user_inferred_profiles uip
        ON uip.user_id = rt.user_id
      WHERE rt.created_at >= NOW() - INTERVAL '30 days'
        AND uip.user_segment = ${segment}
        AND rt.top_foods IS NOT NULL
      LIMIT 2000
    `;

    const samples: RankingSample[] = [];

    for (const row of rows) {
      const topFoods = row.top_foods as Array<{
        foodName: string;
        dimScores?: Record<string, number>;
      }>;
      if (!Array.isArray(topFoods)) continue;

      const matchedFood = topFoods.find((f) => f.foodName === row.food_name);
      if (!matchedFood?.dimScores) continue;

      // 将 dimScores Record 转换为有序数组（与 SCORE_DIMENSIONS 对齐）
      const dimArray: number[] = SCORE_DIMENSIONS.map(
        (dim) => matchedFood.dimScores![dim] ?? 0.5,
      );

      samples.push({
        dimScores: dimArray,
        accepted: row.action === 'accepted' ? 1 : 0,
      });
    }

    return samples;
  }

  /**
   * 简单梯度下降：最小化 L2 损失
   * predicted = dot(weights, dimScores)，target = accepted (0 or 1)
   * 约束：所有权重 >= 0，权重和 = 1（投影梯度下降）
   *
   * @param samples 训练样本
   * @returns 归一化后的 12 维最优权重向量
   */
  private fitWeights(samples: RankingSample[]): number[] {
    // 初始化均匀权重
    let weights = Array(DIM_COUNT).fill(1 / DIM_COUNT);
    let prevLoss = Infinity;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const gradients = Array(DIM_COUNT).fill(0);
      let totalLoss = 0;

      for (const sample of samples) {
        const predicted = this.dotProduct(weights, sample.dimScores);
        const error = predicted - sample.accepted;
        totalLoss += error * error;

        // 梯度 = 2 * error * dimScore[i]
        for (let i = 0; i < DIM_COUNT; i++) {
          gradients[i] += 2 * error * sample.dimScores[i];
        }
      }

      totalLoss /= samples.length;

      // 收敛检查
      if (Math.abs(prevLoss - totalLoss) < CONVERGENCE_THRESHOLD) {
        this.logger.debug(
          `Gradient descent converged at iteration ${iter}, loss=${totalLoss.toFixed(6)}`,
        );
        break;
      }
      prevLoss = totalLoss;

      // 梯度下降步
      for (let i = 0; i < DIM_COUNT; i++) {
        weights[i] -= (LEARNING_RATE * gradients[i]) / samples.length;
      }

      // 投影约束：所有权重 >= 0
      weights = weights.map((w) => Math.max(0, w));

      // 归一化：权重和 = 1
      const sum = weights.reduce((s, w) => s + w, 0);
      if (sum > 0) {
        weights = weights.map((w) => w / sum);
      } else {
        // 退化：回退到均匀权重
        weights = Array(DIM_COUNT).fill(1 / DIM_COUNT);
      }
    }

    return weights;
  }

  /**
   * 将学到的权重存入 Redis（快速访问）和 DB（持久化）
   */
  private async saveWeights(segment: string, weights: number[]): Promise<void> {
    // 1. Redis 缓存（通过 TieredCacheManager）
    try {
      await this.learnedWeightsCache.set(segment, weights);
    } catch (err) {
      this.logger.warn(
        `Failed to cache learned weights for [${segment}]: ${err.message}`,
      );
    }

    // 2. DB 持久化：写入全局激活策略的 rank.learnedWeights.{segment}
    try {
      const activeStrategy = await this.prisma.strategy.findFirst({
        where: { status: 'active', scope: 'global' },
        select: { id: true, config: true },
      });

      if (!activeStrategy) return;

      const config = (activeStrategy.config as any) ?? {};
      const rank = { ...(config.rank ?? {}) };
      const learnedWeights = { ...(rank.learnedWeights ?? {}) };
      learnedWeights[segment] = weights;
      rank.learnedWeights = learnedWeights;
      config.rank = rank;

      await this.prisma.strategy.update({
        where: { id: activeStrategy.id },
        data: { config },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist learned weights for [${segment}]: ${err.message}`,
      );
    }
  }

  /**
   * 获取指定分群的学习权重（供推荐引擎调用）
   * feature flag 未启用时返回 null（引擎使用默认权重）
   *
   * @param segment    用户分群
   * @param userId     用户 ID（用于 feature flag 灰度检查）
   * @returns 12 维权重数组，或 null（不可用时）
   */
  async getLearnedWeights(
    segment: string | undefined,
    userId: string,
  ): Promise<number[] | null> {
    if (!segment) return null;

    // feature flag 灰度检查（per-user）
    const enabled = await this.featureFlagService.isEnabled(
      FF_LEARNED_RANKING,
      userId,
    );
    if (!enabled) return null;

    // 优先从 Redis 缓存读取
    try {
      const cached = await this.learnedWeightsCache.getOrSet(
        segment,
        async () => {
          // Cache miss: 从 DB 加载
          const strategy = await this.prisma.strategy.findFirst({
            where: { status: 'active', scope: 'global' },
            select: { config: true },
          });
          const learnedWeights = (strategy?.config as any)?.rank
            ?.learnedWeights;
          return learnedWeights?.[segment] ?? null;
        },
      );
      return cached;
    } catch {
      return null;
    }
  }

  /** 向量点积 */
  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }
}
