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
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { FeatureFlagService } from '../../../../feature-flag/feature-flag.service';
import { MetricsService } from '../../../../../core/metrics/metrics.service';
import { SCORE_DIMENSIONS } from '../types/recommendation.types';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../../core/cache/tiered-cache-manager';
import { getInferred } from '../../../../user/user-profile-merge.helper';

/** 特性开关 key */
const FF_LEARNED_RANKING = 'learned_ranking_enabled';

/** 样本最小数量（不足时跳过该分群） */
const MIN_SAMPLES = 50;

/** 梯度下降超参数 */
const LEARNING_RATE = 0.001;
const MAX_ITERATIONS = 1000;
const CONVERGENCE_THRESHOLD = 1e-6;

/** V6.7 Phase 3-A: L2 正则化系数 */
const L2_LAMBDA = 0.01;

/** V6.7 Phase 3-A: 验证集无改善容忍次数（early stopping） */
const EARLY_STOPPING_PATIENCE = 50;

/**
 * 权重维度数量（与 SCORE_DIMENSIONS 对齐）
 * V7.4 起 = 14（含 popularity / acquisition）
 * 不要硬编码数字 — 始终使用 SCORE_DIMENSIONS.length
 */
const DIM_COUNT = SCORE_DIMENSIONS.length;

/**
 * V6.7 Phase 3-A: 已知分群保留为 fallback
 * 当动态查询失败时回退到此列表
 */
const FALLBACK_SEGMENTS = [
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
  /** 维度原始评分向量（0~1），长度 = SCORE_DIMENSIONS.length */
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
    private readonly redisCache: RedisCacheService,
    private readonly metricsService: MetricsService,
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
   *
   * V6.7 Phase 3-A: 分群列表从 DB 动态获取（替代硬编码）
   */
  @Cron('0 6 * * 1')
  async recomputeWeights(): Promise<void> {
    await this.redisCache.runWithLock(
      'learned-ranking:recompute',
      60 * 60 * 1000, // 1 小时过期
      () => this.doRecomputeWeights(),
    );
  }

  private async doRecomputeWeights(): Promise<void> {
    // feature flag 检查（不传 userId，检查全局开关）
    const enabled = await this.featureFlagService.isEnabled(FF_LEARNED_RANKING);
    if (!enabled) {
      this.logger.debug('Learned ranking disabled via feature flag, skipping');
      return;
    }

    this.logger.log('Starting weekly learned ranking weight recomputation...');

    // V6.7 Phase 3-A: 动态获取分群列表
    const segments = await this.getActiveSegments();
    let updatedSegments = 0;

    for (const segment of segments) {
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
          `Failed to compute learned weights for segment [${segment}]: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log(
      `Learned ranking recomputation completed: ${updatedSegments}/${segments.length} segments updated`,
    );
  }

  /**
   * V6.7 Phase 3-A: 从 DB 动态获取活跃分群列表，替代硬编码 USER_SEGMENTS
   * 查询 user_profiles.inferred_data 中所有不为 null 的 distinct userSegment
   * 失败时回退到 FALLBACK_SEGMENTS
   */
  private async getActiveSegments(): Promise<string[]> {
    try {
      const profiles = await this.prisma.userProfiles.findMany({
        select: { inferredData: true },
        where: { inferredData: { not: undefined } },
      });
      const segmentSet = new Set<string>();
      for (const p of profiles) {
        const seg = getInferred(p).userSegment;
        if (seg) segmentSet.add(seg);
      }
      const dynamicSegments = Array.from(segmentSet);

      if (dynamicSegments.length > 0) {
        this.logger.debug(
          `Dynamic segments loaded: ${dynamicSegments.join(', ')}`,
        );
        return dynamicSegments;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load dynamic segments, falling back: ${(err as Error).message}`,
      );
    }
    return [...FALLBACK_SEGMENTS];
  }

  /**
   * 收集指定分群近 30 天的 trace + feedback 样本
   * 每个样本包含食物的 12 维原始评分向量 + 接受标记
   */
  private async collectSamples(segment: string): Promise<RankingSample[]> {
    const rows = await this.prisma.$queryRaw<
      {
        topFoods: any;
        action: string;
        foodName: string;
      }[]
    >`
      SELECT
        rt.top_foods,
        rf.action,
        rf.food_name
      FROM recommendation_traces rt
      INNER JOIN recommendation_feedbacks rf
        ON rf.trace_id = rt.id
      INNER JOIN user_profiles up
        ON up.user_id = rt.user_id
      WHERE rt.created_at >= NOW() - INTERVAL '30 days'
        AND up.inferred_data->>'userSegment' = ${segment}
        AND rt.top_foods IS NOT NULL
      LIMIT 2000
    `;

    const samples: RankingSample[] = [];

    for (const row of rows) {
      const topFoods = row.topFoods as Array<{
        foodName: string;
        dimScores?: Record<string, number>;
      }>;
      if (!Array.isArray(topFoods)) continue;

      const matchedFood = topFoods.find((f) => f.foodName === row.foodName);
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
   * V6.7 Phase 3-A: Logistic loss + L2 正则化 + 验证集 early stopping
   *
   * 替换原有 L2 loss 线性回归:
   * - 损失函数: binary cross-entropy (logistic loss) — 适合 0/1 标签
   * - L2 正则化: λ * ||w||² 防止权重过拟合
   * - 训练/验证分割 (80/20): 用验证集 loss 做 early stopping
   * - 投影约束: 非负 + 归一化（projectToSimplex）
   *
   * @param samples 训练样本
   * @returns 归一化后的 12 维最优权重向量
   */
  private fitWeights(samples: RankingSample[]): number[] {
    // 初始化均匀权重
    let weights = Array(DIM_COUNT).fill(1 / DIM_COUNT);

    // V6.7: 训练/验证集分割 (80/20)
    const splitIdx = Math.floor(samples.length * 0.8);
    const trainSamples = samples.slice(0, splitIdx);
    const valSamples = samples.slice(splitIdx);

    // 训练集不足时直接返回均匀权重
    if (trainSamples.length < 10) {
      return weights;
    }

    let bestValLoss = Infinity;
    let bestWeights = [...weights];
    let noImproveCount = 0;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // Forward: logistic loss on train set
      const gradient = Array(DIM_COUNT).fill(0);

      for (const sample of trainSamples) {
        const predicted = this.dotProduct(weights, sample.dimScores);
        const sigmoid = 1 / (1 + Math.exp(-predicted));
        const error = sigmoid - sample.accepted; // accepted: 0 or 1

        for (let d = 0; d < DIM_COUNT; d++) {
          gradient[d] += (error * sample.dimScores[d]) / trainSamples.length;
          gradient[d] += L2_LAMBDA * weights[d]; // L2 正则化梯度
        }
      }

      // Gradient descent step
      for (let d = 0; d < DIM_COUNT; d++) {
        weights[d] -= LEARNING_RATE * gradient[d];
      }

      // 投影约束：非负 + 归一化
      weights = this.projectToSimplex(weights);

      // 验证集 logistic loss
      if (valSamples.length > 0) {
        let valLoss = 0;
        for (const sample of valSamples) {
          const predicted = this.dotProduct(weights, sample.dimScores);
          const sigmoid = 1 / (1 + Math.exp(-predicted));
          valLoss +=
            -sample.accepted * Math.log(sigmoid + 1e-8) -
            (1 - sample.accepted) * Math.log(1 - sigmoid + 1e-8);
        }
        valLoss /= valSamples.length;

        // Early stopping based on validation loss
        if (valLoss < bestValLoss - CONVERGENCE_THRESHOLD) {
          bestValLoss = valLoss;
          bestWeights = [...weights];
          noImproveCount = 0;
        } else {
          noImproveCount++;
          if (noImproveCount >= EARLY_STOPPING_PATIENCE) {
            this.logger.debug(
              `LearnedRanking: early stopped at iter ${iter}, valLoss=${bestValLoss.toFixed(6)}`,
            );
            break;
          }
        }
      }
    }

    return valSamples.length > 0 ? bestWeights : weights;
  }

  /**
   * V6.7 Phase 3-A: 非负投影 + 归一化到概率单纯形
   * 确保所有权重 >= 0 且和为 1
   */
  private projectToSimplex(w: number[]): number[] {
    // 非负投影
    const clamped = w.map((v) => Math.max(0, v));
    // 归一化
    const sum = clamped.reduce((s, v) => s + v, 0);
    return sum > 0
      ? clamped.map((v) => v / sum)
      : Array(w.length).fill(1 / w.length);
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

      // P0-1 GUARD: 历史数据可能是旧维度（如 12 维）— 维度不一致直接弃用，
      // 避免与当前 SCORE_WEIGHTS（14 维）错位叠加，产生静默偏差
      if (cached && Array.isArray(cached) && cached.length !== DIM_COUNT) {
        // P0-4: 计数器，监控维度污染发生频率（>0 触发 weight-learner 重训补救）
        this.metricsService.seasonalityDimMismatch.inc();
        this.logger.warn(
          `[LearnedRanking] segment=${segment} learned weights dim mismatch: ` +
            `expected ${DIM_COUNT}, got ${cached.length}; falling back to baseline. ` +
            `Trigger weekly retrain to refresh.`,
        );
        return null;
      }

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
