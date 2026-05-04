import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { CronBackend, CronHandlerRegistry } from '../../../../../core/cron';
import { GoalType } from '../../services/nutrition-score.service';
import { SCORE_DIMENSIONS, SCORE_WEIGHTS } from '../types/recommendation.types';

// ==================== V6.8 4.7: 在线权重学习（精准化升级） ====================

/** Redis key 前缀: 存储每个 goalType 的全局学习权重偏移 */
const REDIS_PREFIX = 'weight_learned:';

/** V6.8: Redis key 前缀: 存储用户级权重偏移 */
const USER_REDIS_PREFIX = 'weight_learner:user:';

/** V6.8 Phase 3-E: Redis key 前缀: 存储用户×餐次级权重偏移 */
const USER_MEAL_REDIS_PREFIX = 'weight_learner:user:';

/** P3-2.6: Redis key 前缀: 存储区域×goalType 学习权重偏移
 *  完整 key 形态：weight_learner:region:{regionCode}:{goalType}[:{mealType}] */
const REGION_REDIS_PREFIX = 'weight_learner:region:';

/** 学习率 — 每次反馈事件的权重调整步幅 */
const LEARNING_RATE = 0.01;

/** 权重偏移上限 — 相对于基线的最大变化幅度 (±20%) */
const MAX_OFFSET_RATIO = 0.2;

/** 最少反馈量 — 低于此数量不触发学习（防止冷启动噪声） */
const MIN_FEEDBACK_COUNT = 20;

/** V6.8: 用户级最少反馈量（较宽松） */
const MIN_USER_FEEDBACK_COUNT = 5;

/** P3-2.6: 区域级最少反馈量 */
const MIN_REGION_FEEDBACK_COUNT = 30;

/** 学习结果的 Redis TTL: 7 天 */
const LEARNED_TTL = 7 * 24 * 60 * 60 * 1000;

/** V6.8: 用户级学习结果的 Redis TTL: 14 天 */
const USER_LEARNED_TTL = 14 * 24 * 60 * 60 * 1000;

/** P3-2.6: 区域级学习结果的 Redis TTL: 30 天 */
const REGION_LEARNED_TTL = 30 * 24 * 60 * 60 * 1000;

/** P3-2.6: 四层加权融合默认系数（base + α·user + β·region + γ·global），下游可配置 */
const FUSION_USER_WEIGHT = 0.5;
const FUSION_REGION_WEIGHT = 0.3;
const FUSION_GLOBAL_WEIGHT = 0.2;

/** 每次批量处理的反馈天数 */
const FEEDBACK_WINDOW_DAYS = 14;

/** V6.8: 时间衰减半衰期（天） */
const DECAY_HALF_LIFE_DAYS = 7;

/**
 * 权重偏移数组 — 12 维，每个维度存储相对于基线的 delta
 * 正值 = 该维度权重增加，负值 = 该维度权重减少
 */
type WeightOffset = number[];

/**
 * 学习结果
 */
export interface LearnedWeights {
  /** 学习后的完整权重数组 (12 维) */
  weights: number[];
  /** 相对于基线的偏移量 */
  offsets: WeightOffset;
  /** 使用的反馈样本数 */
  sampleCount: number;
  /** 上次学习时间 */
  learnedAt: number;
  /** V6.8: 有 dimensionScores 的反馈比例 */
  targetedRatio?: number;
}

/**
 * V6.8: 带 trace dimensionScores 的反馈行（raw SQL 查询结果）
 */
interface FeedbackWithScores {
  id: string;
  userId: string;
  foodId: string | null;
  action: string;
  goalType: string;
  mealType: string;
  createdAt: Date;
  /** 来自 recommendation_traces.top_foods 中匹配食物的 dimensionScores */
  dimension_scores: Record<string, number> | null;
  /** P3-2.6: 反馈发生时用户的区域码（来自 user_profiles JOIN，可能为 null） */
  region_code: string | null;
}

/**
 * V6.8 4.7: 在线权重学习服务（精准化升级）
 *
 * 基于用户反馈（接受/拒绝推荐食物）的梯度更新，
 * 周期性调整各 goalType 的评分维度基础权重。
 *
 * V6.8 升级:
 * - JOIN recommendation_traces 获取 dimensionScores → per-dimension 精准梯度
 * - 时间衰减: 7 天半衰期，老反馈权重降低
 * - 用户级权重偏移: Redis 存储 per-user per-goalType 偏移
 * - 无 trace 数据时 fallback 到均匀梯度（V6.7 行为）
 *
 * 核心逻辑:
 * 1. 收集近 N 天的反馈数据，LEFT JOIN traces 获取 dimensionScores
 * 2. 对每条反馈:
 *    - 有 dimensionScores: computeTargetedGradient（精准方向）
 *    - 无 dimensionScores: computeUniformGradient（均匀方向，fallback）
 * 3. 按 goalType 聚合全局梯度 → 全局偏移
 * 4. 按 userId+goalType 聚合用户梯度 → 用户级偏移
 * 5. 偏移量 clamp 到 ±20% 防止过拟合
 * 6. 结果存入 Redis
 *
 * 安全措施:
 * - 全局: 最少 20 条反馈才触发学习（防冷启动噪声）
 * - 用户级: 最少 5 条反馈
 * - 权重偏移 ±20% 硬限制
 * - 全局 7 天 TTL, 用户级 14 天 TTL 自动衰减
 * - 全部异步，不阻塞推荐请求
 */
@Injectable()
export class WeightLearnerService implements OnModuleInit {
  private readonly logger = new Logger(WeightLearnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.cronRegistry.register('weight-learner-daily', () => this.runDailyCron());
  }

  /**
   * 获取指定 goalType 的全局学习后权重
   * 如果没有学习数据，返回 null（调用方使用默认基线权重）
   */
  async getLearnedWeights(goalType: GoalType): Promise<number[] | null> {
    const cached = await this.redis.get<LearnedWeights>(
      REDIS_PREFIX + goalType,
    );
    if (!cached) return null;
    return cached.weights;
  }

  /**
   * 获取指定 goalType 的完整学习结果（含元数据，调试/监控用）
   */
  async getLearnedWeightsDetail(
    goalType: GoalType,
  ): Promise<LearnedWeights | null> {
    return this.redis.get<LearnedWeights>(REDIS_PREFIX + goalType);
  }

  /**
   * V6.8 + P3-2.6: 获取用户级学习后权重（四层加权融合）
   *
   * 融合公式：
   *   final = base + α·user_offsets + β·region_offsets + γ·global_offsets
   *   缺失层时其权重重新分配到剩余层（保证总权重和为 1）
   *
   * 参数：
   * - userId     用户 ID
   * - goalType   目标类型
   * - base       基线权重数组（通常是 SCORE_WEIGHTS[goalType]）
   * - regionCode 用户区域码（如 'US-CA'），用于读取区域级偏移；缺省则跳过 region 层
   *
   * @returns 最终权重数组（12 维，已归一化）
   */
  async getUserWeights(
    userId: string,
    goalType: string,
    base: number[],
    regionCode?: string | null,
  ): Promise<number[] | null> {
    const userOffsets = await this.readOffsets(
      `${USER_REDIS_PREFIX}${userId}:${goalType}`,
      base.length,
    );
    const regionOffsets = await this.readRegionOffsets(
      regionCode,
      goalType,
      undefined,
      base.length,
    );
    const globalOffsets = await this.readGlobalOffsets(goalType, base.length);

    if (!userOffsets && !regionOffsets && !globalOffsets) return null;

    const fused = this.fuseOffsets(base, [
      { offsets: userOffsets, weight: FUSION_USER_WEIGHT },
      { offsets: regionOffsets, weight: FUSION_REGION_WEIGHT },
      { offsets: globalOffsets, weight: FUSION_GLOBAL_WEIGHT },
    ]);
    return fused;
  }

  /**
   * V6.8 Phase 3-E + P3-2.6: 获取用户×餐次级学习后权重（四层融合）
   *
   * 融合公式：
   *   final = base + α·(user×meal_offsets ?? user_offsets)
   *               + β·(region×meal_offsets ?? region_offsets)
   *               + γ·global_offsets
   * 餐次级缺失时回退到通用层（与历史"用户×餐次回退到用户级"语义一致）。
   */
  async getUserMealWeights(
    userId: string,
    goalType: string,
    mealType: string,
    base: number[],
    regionCode?: string | null,
  ): Promise<number[] | null> {
    // user×meal 优先，回退到 user
    const userMealOffsets =
      (await this.readOffsets(
        `${USER_MEAL_REDIS_PREFIX}${userId}:${goalType}:${mealType}`,
        base.length,
      )) ??
      (await this.readOffsets(
        `${USER_REDIS_PREFIX}${userId}:${goalType}`,
        base.length,
      ));
    // region×meal 优先，回退到 region
    const regionMealOffsets =
      (await this.readRegionOffsets(
        regionCode,
        goalType,
        mealType,
        base.length,
      )) ??
      (await this.readRegionOffsets(
        regionCode,
        goalType,
        undefined,
        base.length,
      ));
    const globalOffsets = await this.readGlobalOffsets(goalType, base.length);

    if (!userMealOffsets && !regionMealOffsets && !globalOffsets) return null;

    return this.fuseOffsets(base, [
      { offsets: userMealOffsets, weight: FUSION_USER_WEIGHT },
      { offsets: regionMealOffsets, weight: FUSION_REGION_WEIGHT },
      { offsets: globalOffsets, weight: FUSION_GLOBAL_WEIGHT },
    ]);
  }

  // ─────────────── P3-2.6: 四层融合内部辅助 ───────────────

  /** 读取 Redis 中的 offsets；不存在或维度不匹配返回 null */
  private async readOffsets(
    key: string,
    expectedLen: number,
  ): Promise<number[] | null> {
    const cached = await this.redis.get<{ offsets: number[] }>(key);
    if (cached?.offsets && cached.offsets.length === expectedLen) {
      return cached.offsets;
    }
    return null;
  }

  /** 读取区域级 offsets：weight_learner:region:{regionCode}:{goalType}[:{mealType}] */
  private async readRegionOffsets(
    regionCode: string | null | undefined,
    goalType: string,
    mealType: string | undefined,
    expectedLen: number,
  ): Promise<number[] | null> {
    if (!regionCode) return null;
    const country = regionCode.split('-')[0]?.toUpperCase();
    if (!country) return null;
    const suffix = mealType ? `:${mealType}` : '';
    const key = `${REGION_REDIS_PREFIX}${country}:${goalType}${suffix}`;
    return this.readOffsets(key, expectedLen);
  }

  /** 读取全局 goalType offsets（从历史 LearnedWeights 数据中取） */
  private async readGlobalOffsets(
    goalType: string,
    expectedLen: number,
  ): Promise<number[] | null> {
    const cached = await this.redis.get<LearnedWeights>(
      REDIS_PREFIX + goalType,
    );
    if (cached?.offsets && cached.offsets.length === expectedLen) {
      return cached.offsets;
    }
    return null;
  }

  /**
   * 加权融合多层 offsets 到 base：
   *   final = base + Σ (effectiveWeight_i * offsets_i)
   *   缺失层（offsets=null）的权重按比例重分配到剩余层
   *   全部层缺失时直接返回归一化的 base
   */
  private fuseOffsets(
    base: number[],
    layers: Array<{ offsets: number[] | null; weight: number }>,
  ): number[] {
    const present = layers.filter((l) => l.offsets !== null);
    if (present.length === 0) {
      // 无任何学习数据，返回归一化基线
      const sum = base.reduce((s, w) => s + w, 0) || 1;
      return base.map((w) => w / sum);
    }
    const totalPresentWeight = present.reduce((s, l) => s + l.weight, 0) || 1;
    const adjusted = base.map((b, i) => {
      let val = b;
      for (const layer of present) {
        const effectiveW = layer.weight / totalPresentWeight;
        val += effectiveW * (layer.offsets![i] ?? 0);
      }
      return Math.max(0.01, val);
    });
    const sum = adjusted.reduce((s, w) => s + w, 0);
    return adjusted.map((w) => w / sum);
  }

  /**
   * V6.8: 执行一轮权重学习（全局 + 用户级）
   *
   * 1. 用 raw SQL LEFT JOIN recommendation_traces 获取 dimensionScores
   * 2. 按 goalType 聚合 → 全局偏移
   * 3. 按 userId+goalType 聚合 → 用户级偏移
   *
   * @returns 按 goalType 的全局学习结果摘要
   */
  // P3-PR1: 每日 06:30 执行（避开 learned-ranking 的周一 06:00）
  // P1-R1: 多副本部署下用 Redis 分布式锁防重复执行（TTL 1h，足够单次任务跑完）
  @Cron('30 6 * * *', { name: 'weight-learner-daily' })
  async runDailyCronTick(): Promise<void> {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.runDailyCron();
  }

  async runDailyCron(): Promise<void> {
    await this.redis.runWithLock(
      'weight-learner-daily',
      60 * 60 * 1000,
      async () => {
        await this.learn();
      },
    );
  }

  /**
   * 真正执行学习的方法（被 cron 与单测共用）。
   */
  async learn(): Promise<
    Record<
      string,
      { sampleCount: number; offsets: number[]; targetedRatio: number }
    >
  > {
    const feedbacks = await this.fetchFeedbacksWithScores();

    if (feedbacks.length === 0) {
      this.logger.debug('No feedback data in window, skipping weight learning');
      return {};
    }

    // ── 全局学习（按 goalType 分组）──
    // C2-fix: 三路学习（global / region / user）共用同一 feedbacks 引用，
    //         内部 Map.push() 操作不会相互影响（每路建立独立 Map），
    //         但将来若任一路对元素做原地修改将产生隐性耦合。
    //         此处为每一路传入独立浅拷贝，彻底切断共享引用。
    //
    // 三路样本集的语义边界：
    //   global  = 全量 feedbacks（跨所有 userId/region，代表全局分布）
    //   region  = 全量 feedbacks（learnRegionWeights 内部自行按 region 分组过滤）
    //   user    = 全量 feedbacks（learnUserWeights 内部自行按 userId 分组过滤）
    // 三路使用独立浅拷贝，防止任一路对数组/元素的原地修改影响其他路。
    const globalFeedbacks = feedbacks.slice();
    const regionFeedbacks = feedbacks.slice();
    const userFeedbacks = feedbacks.slice();

    const globalGrouped = new Map<string, FeedbackWithScores[]>();
    for (const fb of globalFeedbacks) {
      const group = globalGrouped.get(fb.goalType) || [];
      group.push(fb);
      globalGrouped.set(fb.goalType, group);
    }

    const results: Record<
      string,
      { sampleCount: number; offsets: number[]; targetedRatio: number }
    > = {};

    for (const [goalType, group] of globalGrouped) {
      if (group.length < MIN_FEEDBACK_COUNT) {
        this.logger.debug(
          `Skipping global weight learning for ${goalType}: only ${group.length} feedbacks (min: ${MIN_FEEDBACK_COUNT})`,
        );
        continue;
      }

      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const { offsets, targetedCount } = this.computeMixedGradient(
        group,
        baseline,
      );
      const weights = this.applyOffsets(baseline, offsets);
      const targetedRatio = targetedCount / group.length;

      const learned: LearnedWeights = {
        weights,
        offsets,
        sampleCount: group.length,
        learnedAt: Date.now(),
        targetedRatio,
      };

      await this.redis.set(REDIS_PREFIX + goalType, learned, LEARNED_TTL);

      results[goalType] = {
        sampleCount: group.length,
        offsets,
        targetedRatio,
      };
      this.logger.log(
        `Global weight learning for ${goalType}: ${group.length} feedbacks ` +
          `(${(targetedRatio * 100).toFixed(0)}% targeted), ` +
          `offsets=[${offsets.map((o) => o.toFixed(4)).join(', ')}]`,
      );
    }

    // ── 用户级学习（按 userId+goalType 分组）──
    await this.learnUserWeights(userFeedbacks);

    // ── P3-2.6: 区域级学习（按 region+goalType 分组）──
    await this.learnRegionWeights(regionFeedbacks);

    return results;
  }

  /**
   * 清除指定 goalType 的全局学习数据（回退到基线）
   */
  async resetWeights(goalType: GoalType): Promise<void> {
    await this.redis.del(REDIS_PREFIX + goalType);
    this.logger.log(`Learned weights reset for ${goalType}`);
  }

  /**
   * 清除所有学习数据（全局 + 用户级）
   */
  async resetAll(): Promise<void> {
    await this.redis.delByPrefix(REDIS_PREFIX);
    await this.redis.delByPrefix(USER_REDIS_PREFIX);
    await this.redis.delByPrefix(REGION_REDIS_PREFIX);
    this.logger.log(
      'All learned weights reset (global + user-level + region-level)',
    );
  }

  // ─────────────────── 内部方法 ───────────────────

  /**
   * V6.8: 从 recommendation_feedbacks LEFT JOIN recommendation_traces
   * 获取带 dimensionScores 的反馈数据
   *
   * 联查逻辑：
   * - 按 user_id + food_id 匹配 trace
   * - 时间窗口: trace.created_at 在 feedback.created_at ± 1 小时内
   * - 从 trace.top_foods JSON 数组中提取匹配 food_id 的 dimensionScores
   */
  private async fetchFeedbacksWithScores(): Promise<FeedbackWithScores[]> {
    const since = new Date();
    since.setDate(since.getDate() - FEEDBACK_WINDOW_DAYS);

    try {
      // 使用 raw SQL 做 LEFT JOIN，从 trace 的 top_foods JSON 中提取 dimensionScores
      // P3-2.6: LEFT JOIN user_profiles 派生反馈发生时的用户 regionCode
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          userId: string;
          foodId: string | null;
          action: string;
          goalType: string;
          mealType: string;
          createdAt: Date;
          dimension_scores: Record<string, number> | null;
          region_code: string | null;
        }>
      >`
        SELECT
          f.id,
          f.user_id,
          f.food_id,
          f.action,
          f.goal_type,
          f.meal_type,
          f.created_at,
          -- 从 trace 的 top_foods JSON 数组中提取匹配 food_id 的 dimensionScores
          (
            SELECT elem->'dimensionScores'
            FROM recommendation_traces t,
                 jsonb_array_elements(t.top_foods::jsonb) AS elem
            WHERE t.user_id::text = f.user_id::text
              AND t.created_at >= f.created_at - INTERVAL '1 hour'
              AND t.created_at <= f.created_at + INTERVAL '1 hour'
              AND elem->>'foodId' = f.food_id
            ORDER BY t.created_at DESC
            LIMIT 1
          ) AS dimension_scores,
          -- P3-2.6: 派生反馈发生时用户的 regionCode（取国别前缀，如 'US-CA' → 'US'）
          UPPER(SPLIT_PART(up.region_code, '-', 1)) AS region_code
        FROM recommendation_feedbacks f
        LEFT JOIN user_profiles up ON up.user_id = f.user_id
        WHERE f.created_at >= ${since}
          AND f.goal_type IS NOT NULL
        ORDER BY f.created_at DESC
      `;

      return rows;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch feedbacks with trace scores, falling back to simple query: ${err}`,
      );
      // Fallback: 不联查 trace，dimension_scores 全部为 null
      return this.fetchFeedbacksSimple();
    }
  }

  /**
   * Fallback: 简单查询反馈（不联查 trace），dimension_scores 全部为 null
   */
  private async fetchFeedbacksSimple(): Promise<FeedbackWithScores[]> {
    const since = new Date();
    since.setDate(since.getDate() - FEEDBACK_WINDOW_DAYS);

    const rows = await this.prisma.recommendationFeedbacks.findMany({
      where: {
        createdAt: { gte: since },
        goalType: { not: null },
      },
      select: {
        id: true,
        userId: true,
        foodId: true,
        action: true,
        goalType: true,
        mealType: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      foodId: r.foodId,
      action: r.action,
      goalType: r.goalType!,
      mealType: r.mealType,
      createdAt: r.createdAt,
      dimension_scores: null,
      region_code: null,
    }));
  }

  /**
   * V6.8: 混合梯度计算 — 有 dimensionScores 时用精准梯度，否则 fallback 均匀梯度
   *
   * @returns offsets 数组 + 有多少条使用了精准梯度
   */
  private computeMixedGradient(
    feedbacks: FeedbackWithScores[],
    baseline: number[],
  ): { offsets: WeightOffset; targetedCount: number } {
    const dimCount = SCORE_DIMENSIONS.length;
    const accumulatedGradient = new Array(dimCount).fill(0);
    let targetedCount = 0;
    let totalWeight = 0;

    for (const fb of feedbacks) {
      // V6.8: 时间衰减
      const daysAgo =
        (Date.now() - new Date(fb.createdAt).getTime()) / 86400000;
      const decay = Math.exp(-daysAgo / DECAY_HALF_LIFE_DAYS);

      let gradient: number[];

      if (fb.dimension_scores && this.hasValidDimScores(fb.dimension_scores)) {
        // V6.8: 精准梯度 — 使用 trace 中的 dimensionScores
        gradient = this.computeTargetedGradient(fb, baseline);
        targetedCount++;
      } else {
        // Fallback: 均匀梯度（V6.7 行为）
        gradient = this.computeUniformGradient(fb, baseline);
      }

      // 按时间衰减加权累加
      for (let i = 0; i < dimCount; i++) {
        accumulatedGradient[i] += gradient[i] * decay;
      }
      totalWeight += decay;
    }

    // 按加权总数归一化
    const offsets =
      totalWeight > 0
        ? accumulatedGradient.map((g) => g / totalWeight)
        : new Array(dimCount).fill(0);

    // Clamp: 限制在 ±20% 基线范围内
    for (let i = 0; i < dimCount; i++) {
      const maxDelta = baseline[i] * MAX_OFFSET_RATIO;
      offsets[i] = Math.max(-maxDelta, Math.min(maxDelta, offsets[i]));
    }

    return { offsets, targetedCount };
  }

  /**
   * V6.8: 精准梯度计算 — 基于 trace dimensionScores
   * V6.9: 新增 executionRate 参数 — 执行率加权梯度
   *
   * - accepted: 高分维度正向强化（该维度做出了正确贡献）
   * - rejected: 高分维度抑制（它可能导致了不匹配推荐）
   *
   * V6.9: 如果推荐被接受但用户实际执行率低，说明推荐可能"看起来好但不实际"，
   * 降低梯度权重，避免过度强化不可执行的推荐。
   * execFactor = 0.3 + 0.7 * executionRate（执行率 0 → 0.3, 1 → 1.0）
   */
  private computeTargetedGradient(
    feedback: FeedbackWithScores,
    _baseline: number[],
    executionRate?: number,
  ): number[] {
    const dimCount = SCORE_DIMENSIONS.length;
    const gradient = new Array(dimCount).fill(0);
    const dimScores = feedback.dimension_scores!;

    const sign = feedback.action === 'accepted' ? 1 : -1;

    for (let i = 0; i < dimCount; i++) {
      const dimName = SCORE_DIMENSIONS[i];
      const dimScore = dimScores[dimName] ?? 0;
      // 精准方向: 维度得分越高，梯度信号越强
      gradient[i] = sign * LEARNING_RATE * dimScore;
    }

    // V6.9: 执行率加权 — 仅对 accepted 反馈生效
    if (executionRate !== undefined && feedback.action === 'accepted') {
      const execFactor = 0.3 + 0.7 * executionRate;
      for (let i = 0; i < dimCount; i++) {
        gradient[i] *= execFactor;
      }
    }

    return gradient;
  }

  /**
   * V6.7 均匀梯度计算（fallback）
   *
   * - accepted: 按基线权重比例正向强化
   * - rejected: 偏离均值越多的维度，调整幅度越大（促进多样性）
   */
  private computeUniformGradient(
    feedback: FeedbackWithScores,
    baseline: number[],
  ): number[] {
    const dimCount = SCORE_DIMENSIONS.length;
    const gradient = new Array(dimCount).fill(0);

    if (feedback.action === 'accepted') {
      for (let i = 0; i < dimCount; i++) {
        gradient[i] = LEARNING_RATE * baseline[i];
      }
    } else {
      const mean = baseline.reduce((s, w) => s + w, 0) / dimCount;
      for (let i = 0; i < dimCount; i++) {
        const deviation = baseline[i] - mean;
        gradient[i] = -LEARNING_RATE * deviation;
      }
    }

    return gradient;
  }

  /**
   * V6.8: 用户级权重学习 + Phase 3-E 餐次分维学习
   *
   * 按 userId+goalType 分组，每组独立计算偏移，存入 Redis
   * Phase 3-E: 额外按 userId+goalType+mealType 分组，计算餐次级偏移
   */
  private async learnUserWeights(
    feedbacks: FeedbackWithScores[],
  ): Promise<void> {
    // ── 用户级（userId:goalType）──
    const userGrouped = new Map<string, FeedbackWithScores[]>();
    // ── 用户×餐次级（userId:goalType:mealType）── Phase 3-E
    const userMealGrouped = new Map<string, FeedbackWithScores[]>();

    for (const fb of feedbacks) {
      const userKey = `${fb.userId}:${fb.goalType}`;
      const userGroup = userGrouped.get(userKey) || [];
      userGroup.push(fb);
      userGrouped.set(userKey, userGroup);

      // Phase 3-E: 餐次级分组（仅有 mealType 的反馈参与）
      if (fb.mealType) {
        const mealKey = `${fb.userId}:${fb.goalType}:${fb.mealType}`;
        const mealGroup = userMealGrouped.get(mealKey) || [];
        mealGroup.push(fb);
        userMealGrouped.set(mealKey, mealGroup);
      }
    }

    let savedCount = 0;

    // ── 保存用户级偏移 ──
    for (const [, group] of userGrouped) {
      if (group.length < MIN_USER_FEEDBACK_COUNT) continue;

      const goalType = group[0].goalType;
      const userId = group[0].userId;
      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const { offsets } = this.computeMixedGradient(group, baseline);

      const redisKey = `${USER_REDIS_PREFIX}${userId}:${goalType}`;
      await this.redis.set(
        redisKey,
        { offsets, sampleCount: group.length, learnedAt: Date.now() },
        USER_LEARNED_TTL,
      );
      savedCount++;
    }

    // ── Phase 3-E: 保存用户×餐次级偏移 ──
    let mealSavedCount = 0;

    for (const [, group] of userMealGrouped) {
      if (group.length < MIN_USER_FEEDBACK_COUNT) continue;

      const goalType = group[0].goalType;
      const userId = group[0].userId;
      const mealType = group[0].mealType;
      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const { offsets } = this.computeMixedGradient(group, baseline);

      const redisKey = `${USER_MEAL_REDIS_PREFIX}${userId}:${goalType}:${mealType}`;
      await this.redis.set(
        redisKey,
        { offsets, sampleCount: group.length, learnedAt: Date.now() },
        USER_LEARNED_TTL,
      );
      mealSavedCount++;
    }

    if (savedCount > 0 || mealSavedCount > 0) {
      this.logger.log(
        `User-level weight learning: saved ${savedCount} user-goal + ${mealSavedCount} user-goal-meal combinations`,
      );
    }
  }

  /**
   * P3-2.6: 区域级权重学习
   *
   * 按 (country, goalType) 与 (country, goalType, mealType) 分组，
   * 仅当样本数 ≥ MIN_REGION_FEEDBACK_COUNT(30) 时写入：
   *   weight_learner:region:{country}:{goalType}
   *   weight_learner:region:{country}:{goalType}:{mealType}
   *
   * 使用 country 而非完整 regionCode，避免低样本子区域噪声放大。
   */
  private async learnRegionWeights(
    feedbacks: FeedbackWithScores[],
  ): Promise<void> {
    const regionGoalGrouped = new Map<string, FeedbackWithScores[]>();
    const regionGoalMealGrouped = new Map<string, FeedbackWithScores[]>();

    for (const fb of feedbacks) {
      const country = fb.region_code; // 已是大写国别码
      if (!country) continue;

      const goalKey = `${country}:${fb.goalType}`;
      const goalGroup = regionGoalGrouped.get(goalKey) || [];
      goalGroup.push(fb);
      regionGoalGrouped.set(goalKey, goalGroup);

      if (fb.mealType) {
        const mealKey = `${country}:${fb.goalType}:${fb.mealType}`;
        const mealGroup = regionGoalMealGrouped.get(mealKey) || [];
        mealGroup.push(fb);
        regionGoalMealGrouped.set(mealKey, mealGroup);
      }
    }

    let regionGoalCount = 0;
    for (const [combinedKey, group] of regionGoalGrouped) {
      if (group.length < MIN_REGION_FEEDBACK_COUNT) continue;
      const goalType = group[0].goalType;
      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const { offsets } = this.computeMixedGradient(group, baseline);
      const redisKey = `${REGION_REDIS_PREFIX}${combinedKey}`;
      await this.redis.set(
        redisKey,
        { offsets, sampleCount: group.length, learnedAt: Date.now() },
        REGION_LEARNED_TTL,
      );
      regionGoalCount++;
    }

    let regionMealCount = 0;
    for (const [combinedKey, group] of regionGoalMealGrouped) {
      if (group.length < MIN_REGION_FEEDBACK_COUNT) continue;
      const goalType = group[0].goalType;
      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const { offsets } = this.computeMixedGradient(group, baseline);
      const redisKey = `${REGION_REDIS_PREFIX}${combinedKey}`;
      await this.redis.set(
        redisKey,
        { offsets, sampleCount: group.length, learnedAt: Date.now() },
        REGION_LEARNED_TTL,
      );
      regionMealCount++;
    }

    if (regionGoalCount > 0 || regionMealCount > 0) {
      this.logger.log(
        `Region-level weight learning: saved ${regionGoalCount} region-goal + ${regionMealCount} region-goal-meal combinations`,
      );
    }
  }

  /**
   * 将偏移应用到基线权重，并重新归一化使和=1.0
   */
  private applyOffsets(baseline: number[], offsets: WeightOffset): number[] {
    // P2-R7: offsets length 校验 — 长度不匹配时降级用 0 兜底，避免 NaN 污染权重
    if (offsets.length !== baseline.length) {
      this.logger.warn(
        `[WeightLearner] offsets length mismatch: expected ${baseline.length}, got ${offsets.length}; falling back to baseline-only`,
      );
    }
    const adjusted = baseline.map((w, i) =>
      Math.max(0.01, w + (offsets[i] ?? 0)),
    );
    // 归一化
    const sum = adjusted.reduce((s, w) => s + w, 0);
    return adjusted.map((w) => w / sum);
  }

  /**
   * V6.8: 验证 dimensionScores 是否有效
   * 至少需要有 3 个维度有值（避免稀疏数据导致偏差）
   */
  private hasValidDimScores(scores: Record<string, number>): boolean {
    let count = 0;
    for (const dim of SCORE_DIMENSIONS) {
      if (typeof scores[dim] === 'number' && scores[dim] > 0) {
        count++;
      }
    }
    return count >= 3;
  }
}
