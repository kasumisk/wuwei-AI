import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { GoalType } from '../nutrition-score.service';
import { SCORE_DIMENSIONS, SCORE_WEIGHTS } from './recommendation.types';

// ==================== V5 4.7: 在线权重学习 ====================

/** Redis key 前缀: 存储每个 goalType 的学习权重偏移 */
const REDIS_PREFIX = 'weight_learned:';

/** 学习率 — 每次反馈事件的权重调整步幅 */
const LEARNING_RATE = 0.01;

/** 权重偏移上限 — 相对于基线的最大变化幅度 (±20%) */
const MAX_OFFSET_RATIO = 0.2;

/** 最少反馈量 — 低于此数量不触发学习（防止冷启动噪声） */
const MIN_FEEDBACK_COUNT = 20;

/** 学习结果的 Redis TTL: 7 天 */
const LEARNED_TTL = 7 * 24 * 60 * 60 * 1000;

/** 每次批量处理的反馈天数 */
const FEEDBACK_WINDOW_DAYS = 14;

/**
 * 权重偏移数组 — 10 维，每个维度存储相对于基线的 delta
 * 正值 = 该维度权重增加，负值 = 该维度权重减少
 */
type WeightOffset = number[];

/**
 * 学习结果
 */
export interface LearnedWeights {
  /** 学习后的完整权重数组 (10 维) */
  weights: number[];
  /** 相对于基线的偏移量 */
  offsets: WeightOffset;
  /** 使用的反馈样本数 */
  sampleCount: number;
  /** 上次学习时间 */
  learnedAt: number;
}

/**
 * V5 4.7: 在线权重学习服务
 *
 * 基于用户反馈（接受/拒绝推荐食物）的梯度更新，
 * 周期性调整各 goalType 的评分维度基础权重。
 *
 * 核心逻辑:
 * 1. 收集近 N 天的反馈数据
 * 2. 对每条反馈，计算信号方向:
 *    - accepted: 正信号 → 当前权重是好的（微弱正向强化）
 *    - rejected/skipped: 负信号 → 降低高权重维度（推荐了用户不想要的）
 * 3. 按 goalType 聚合梯度，应用学习率，得到权重偏移
 * 4. 偏移量 clamp 到 ±20% 防止过拟合
 * 5. 结果存入 Redis，供 computeWeights() 使用
 *
 * 安全措施:
 * - 最少 20 条反馈才触发学习（防冷启动噪声）
 * - 权重偏移 ±20% 硬限制
 * - 7 天 TTL 自动衰减（长期不更新则回退到基线）
 * - 全部异步，不阻塞推荐请求
 */
@Injectable()
export class WeightLearnerService {
  private readonly logger = new Logger(WeightLearnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 获取指定 goalType 的学习后权重
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
   * 执行一轮权重学习
   * 收集近 FEEDBACK_WINDOW_DAYS 天的反馈，按 goalType 聚合梯度更新
   *
   * @returns 按 goalType 的学习结果摘要
   */
  async learn(): Promise<
    Record<string, { sampleCount: number; offsets: number[] }>
  > {
    const since = new Date();
    since.setDate(since.getDate() - FEEDBACK_WINDOW_DAYS);

    // 获取近 N 天反馈
    const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        created_at: { gte: since },
        goal_type: { not: null },
      },
      select: {
        action: true,
        goal_type: true,
        meal_type: true,
        food_id: true,
      },
    });

    if (feedbacks.length === 0) {
      this.logger.debug('No feedback data in window, skipping weight learning');
      return {};
    }

    // 按 goalType 分组
    const grouped = new Map<string, typeof feedbacks>();
    for (const fb of feedbacks) {
      const goalType = fb.goal_type!;
      const group = grouped.get(goalType) || [];
      group.push(fb);
      grouped.set(goalType, group);
    }

    const results: Record<string, { sampleCount: number; offsets: number[] }> =
      {};

    for (const [goalType, group] of grouped) {
      if (group.length < MIN_FEEDBACK_COUNT) {
        this.logger.debug(
          `Skipping weight learning for ${goalType}: only ${group.length} feedbacks (min: ${MIN_FEEDBACK_COUNT})`,
        );
        continue;
      }

      const baseline = SCORE_WEIGHTS[goalType as GoalType];
      if (!baseline) continue;

      const offsets = this.computeGradient(group, baseline);
      const weights = this.applyOffsets(baseline, offsets);

      const learned: LearnedWeights = {
        weights,
        offsets,
        sampleCount: group.length,
        learnedAt: Date.now(),
      };

      await this.redis.set(REDIS_PREFIX + goalType, learned, LEARNED_TTL);

      results[goalType] = { sampleCount: group.length, offsets };
      this.logger.log(
        `Weight learning completed for ${goalType}: ${group.length} feedbacks, offsets=[${offsets.map((o) => o.toFixed(4)).join(', ')}]`,
      );
    }

    return results;
  }

  /**
   * 计算梯度偏移
   *
   * 思路:
   * - accepted: 正信号，当前权重方向正确 → 微弱正向强化（偏移 +lr）
   * - replaced/skipped: 负信号 → 反向调整（偏移 -lr）
   *
   * 使用均匀梯度（每个维度等量调整），
   * 因为我们没有具体的各维度 raw score（那需要在推荐时持久化）。
   * 这是一个保守但稳定的策略。
   */
  private computeGradient(
    feedbacks: Array<{
      action: string;
      goal_type: string | null;
      meal_type: string;
      food_id: string | null;
    }>,
    baseline: number[],
  ): WeightOffset {
    const dimCount = SCORE_DIMENSIONS.length;
    const accumulatedGradient = new Array(dimCount).fill(0);

    let acceptCount = 0;
    let rejectCount = 0;

    for (const fb of feedbacks) {
      if (fb.action === 'accepted') {
        acceptCount++;
        // 正信号: 当前权重分配合理，微弱强化高权重维度
        for (let i = 0; i < dimCount; i++) {
          // 按基线权重比例分配正向梯度（高权重维度得到更多强化）
          accumulatedGradient[i] += LEARNING_RATE * baseline[i];
        }
      } else {
        rejectCount++;
        // 负信号: 推荐被拒，需要探索其他方向
        // 降低当前高权重维度，提升低权重维度（促进多样性）
        const mean = baseline.reduce((s, w) => s + w, 0) / dimCount;
        for (let i = 0; i < dimCount; i++) {
          // 偏离均值越多的维度，调整幅度越大
          const deviation = baseline[i] - mean;
          accumulatedGradient[i] -= LEARNING_RATE * deviation;
        }
      }
    }

    // 归一化: 除以总反馈数，得到平均偏移
    const total = feedbacks.length;
    const offsets = accumulatedGradient.map((g) => g / total);

    // Clamp: 限制在 ±20% 基线范围内
    for (let i = 0; i < dimCount; i++) {
      const maxDelta = baseline[i] * MAX_OFFSET_RATIO;
      offsets[i] = Math.max(-maxDelta, Math.min(maxDelta, offsets[i]));
    }

    this.logger.debug(
      `Gradient computed: ${acceptCount} accepted, ${rejectCount} rejected, acceptance rate: ${((acceptCount / total) * 100).toFixed(1)}%`,
    );

    return offsets;
  }

  /**
   * 将偏移应用到基线权重，并重新归一化使和=1.0
   */
  private applyOffsets(baseline: number[], offsets: WeightOffset): number[] {
    const adjusted = baseline.map((w, i) => Math.max(0.01, w + offsets[i]));
    // 归一化
    const sum = adjusted.reduce((s, w) => s + w, 0);
    return adjusted.map((w) => w / sum);
  }

  /**
   * 清除指定 goalType 的学习数据（回退到基线）
   */
  async resetWeights(goalType: GoalType): Promise<void> {
    await this.redis.del(REDIS_PREFIX + goalType);
    this.logger.log(`Learned weights reset for ${goalType}`);
  }

  /**
   * 清除所有学习数据
   */
  async resetAll(): Promise<void> {
    await this.redis.delByPrefix(REDIS_PREFIX);
    this.logger.log('All learned weights reset');
  }
}
