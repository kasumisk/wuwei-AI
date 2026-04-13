import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import {
  PipelineContext,
  ScoredFood,
  AcquisitionChannel,
} from '../types/recommendation.types';
import { ScoringExplanation } from '../types/scoring-explanation.interface';

/**
 * V6.4 Phase 3.5: 推荐归因追踪服务
 *
 * 每次推荐请求生成一条 trace 记录，保存:
 * - 推荐管道快照（权重、过滤器、boost 参数等）
 * - Top-N 食物列表及评分明细
 * - 评分统计（min/max/avg/std 各维度）
 * - 性能指标（候选池大小、过滤数量、耗时）
 *
 * trace_id 可用于:
 * 1. 反馈关联 — feedback 提交时回传 trace_id，实现精确归因
 * 2. A/B 实验 — 按 experiment_id + group_id 分析策略效果
 * 3. 推荐质量监控 — 统计评分分布、过滤率、多样性指标
 */

/** 推荐 Trace 输入参数 */
export interface TraceInput {
  /** 用户 ID */
  userId: string;
  /** 餐次类型 */
  mealType: string;
  /** 目标类型 */
  goalType: string;
  /** 获取渠道 */
  channel: AcquisitionChannel;
  /** 策略 ID */
  strategyId?: string;
  /** 策略版本 */
  strategyVersion?: string;
  /** A/B 实验 ID */
  experimentId?: string;
  /** A/B 实验分组 */
  groupId?: string;
  /** 推荐管道上下文快照 */
  pipelineContext: PipelineContext;
  /** 最终推荐的 Top-N 食物 */
  topFoods: ScoredFood[];
  /** 候选池大小（过滤前） */
  foodPoolSize: number;
  /** 应用的过滤器及过滤数量 */
  filtersApplied?: Record<string, number>;
  /** 计算耗时（毫秒） */
  durationMs: number;
}

/** 管道快照 — 只保留可序列化的关键参数 */
interface PipelineSnapshot {
  /** 权重（11维数组） */
  weights?: number[];
  /** 目标营养 */
  target: { calories: number; protein: number; fat: number; carbs: number };
  /** 用户偏好 */
  userPreferences?: { loves?: string[]; avoids?: string[] };
  /** 区域加分映射大小 */
  regionalBoostMapSize: number;
  /** 协同过滤评分数量 */
  cfScoresSize: number;
  /** 是否有短期画像 */
  hasShortTermProfile: boolean;
  /** 是否有上下文画像 */
  hasContextualProfile: boolean;
  /** 是否有分析画像 */
  hasAnalysisProfile: boolean;
  /** 渠道 */
  channel?: string;
}

/** Top-N 食物快照 — 只保留关键信息 */
interface TopFoodSnapshot {
  foodId: string;
  foodName: string;
  category: string;
  score: number;
  servingCalories: number;
  servingProtein: number;
  /** 部分评分解释（压缩版） */
  dimensionScores?: Record<string, number>;
}

/** 评分统计 */
interface ScoreStats {
  min: number;
  max: number;
  avg: number;
  std: number;
  count: number;
}

@Injectable()
export class RecommendationTraceService {
  private readonly logger = new Logger(RecommendationTraceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录推荐 Trace — 异步写入，不阻塞推荐响应
   *
   * @returns trace_id（UUID），用于客户端在反馈时回传
   */
  async recordTrace(input: TraceInput): Promise<string | null> {
    try {
      const pipelineSnapshot = this.buildPipelineSnapshot(
        input.pipelineContext,
      );
      const topFoodsSnapshot = this.buildTopFoodsSnapshot(input.topFoods);
      const scoreStats = this.calcScoreStats(input.topFoods);

      const trace = await this.prisma.recommendationTraces.create({
        data: {
          userId: input.userId,
          mealType: input.mealType,
          goalType: input.goalType,
          channel: input.channel || 'unknown',
          strategyId: input.strategyId ?? null,
          strategyVersion: input.strategyVersion ?? null,
          experimentId: input.experimentId ?? null,
          groupId: input.groupId ?? null,
          pipelineSnapshot: pipelineSnapshot as any,
          topFoods: topFoodsSnapshot as any,
          scoreStats: scoreStats as any,
          foodPoolSize: input.foodPoolSize,
          filtersApplied: input.filtersApplied
            ? (input.filtersApplied as any)
            : null,
          durationMs: input.durationMs,
        },
      });

      this.logger.debug(
        `Trace recorded: id=${trace.id}, user=${input.userId}, ` +
          `meal=${input.mealType}, foods=${topFoodsSnapshot.length}, ` +
          `duration=${input.durationMs}ms`,
      );

      return trace.id;
    } catch (err) {
      this.logger.error(`Failed to record trace: ${err}`);
      return null;
    }
  }

  /**
   * 将 trace_id 关联到反馈记录
   * 在反馈提交时调用，更新 recommendation_feedbacks.trace_id
   */
  async linkFeedbackToTrace(
    feedbackId: string,
    traceId: string,
  ): Promise<void> {
    try {
      await this.prisma.recommendationFeedbacks.update({
        where: { id: feedbackId },
        data: { traceId: traceId },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to link feedback ${feedbackId} to trace ${traceId}: ${err}`,
      );
    }
  }

  /**
   * 批量关联反馈到 trace — 按用户+餐次+时间窗口匹配
   * 用于反馈提交时无 trace_id 的兜底方案（基于最近的 trace 匹配）
   */
  async linkRecentFeedbacksToTrace(
    userId: string,
    mealType: string,
    traceId: string,
    windowMinutes = 30,
  ): Promise<number> {
    try {
      const since = new Date(Date.now() - windowMinutes * 60 * 1000);
      const result = await this.prisma.recommendationFeedbacks.updateMany({
        where: {
          userId: userId,
          mealType: mealType,
          traceId: null,
          createdAt: { gte: since },
        },
        data: { traceId: traceId },
      });
      return result.count;
    } catch (err) {
      this.logger.warn(
        `Failed to link recent feedbacks to trace ${traceId}: ${err}`,
      );
      return 0;
    }
  }

  /**
   * 查询用户最近的 trace 记录（用于调试和分析）
   */
  async getRecentTraces(
    userId: string,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      mealType: string;
      goalType: string;
      channel: string;
      foodPoolSize: number | null;
      durationMs: number | null;
      createdAt: Date;
      topFoodsCount: number;
    }>
  > {
    const traces = await this.prisma.recommendationTraces.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        mealType: true,
        goalType: true,
        channel: true,
        foodPoolSize: true,
        durationMs: true,
        createdAt: true,
        topFoods: true,
      },
    });

    return traces.map((t) => ({
      id: t.id,
      mealType: t.mealType,
      goalType: t.goalType,
      channel: t.channel,
      foodPoolSize: t.foodPoolSize,
      durationMs: t.durationMs,
      createdAt: t.createdAt,
      topFoodsCount: Array.isArray(t.topFoods)
        ? (t.topFoods as unknown[]).length
        : 0,
    }));
  }

  // ─── 内部方法 ───

  /** 构建管道快照 — 只保留可序列化的关键参数 */
  private buildPipelineSnapshot(ctx: PipelineContext): PipelineSnapshot {
    return {
      target: {
        calories: ctx.target.calories,
        protein: ctx.target.protein,
        fat: ctx.target.fat,
        carbs: ctx.target.carbs,
      },
      userPreferences: ctx.userPreferences,
      regionalBoostMapSize: ctx.regionalBoostMap
        ? Object.keys(ctx.regionalBoostMap).length
        : 0,
      cfScoresSize: ctx.cfScores ? Object.keys(ctx.cfScores).length : 0,
      hasShortTermProfile: !!ctx.shortTermProfile,
      hasContextualProfile: !!ctx.contextualProfile,
      hasAnalysisProfile: !!ctx.analysisProfile,
      channel: ctx.channel,
    };
  }

  /** 构建 Top-N 食物快照 — 压缩评分信息 */
  private buildTopFoodsSnapshot(topFoods: ScoredFood[]): TopFoodSnapshot[] {
    return topFoods.map((sf) => {
      const snapshot: TopFoodSnapshot = {
        foodId: sf.food.id,
        foodName: sf.food.name,
        category: sf.food.category,
        score: Math.round(sf.score * 1000) / 1000,
        servingCalories: sf.servingCalories,
        servingProtein: sf.servingProtein,
      };

      // 压缩评分解释 — 只保留各维度的 raw 分数
      if (sf.explanation) {
        snapshot.dimensionScores = this.compressDimensions(sf.explanation);
      }

      return snapshot;
    });
  }

  /** 压缩评分维度为简洁的 key→value 映射 */
  private compressDimensions(
    explanation: ScoringExplanation,
  ): Record<string, number> {
    const dims = explanation.dimensions;
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(dims)) {
      result[key] = Math.round(val.raw * 1000) / 1000;
    }
    return result;
  }

  /** 计算 Top-N 食物的评分统计 */
  private calcScoreStats(topFoods: ScoredFood[]): ScoreStats {
    if (topFoods.length === 0) {
      return { min: 0, max: 0, avg: 0, std: 0, count: 0 };
    }

    const scores = topFoods.map((sf) => sf.score);
    const count = scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((sum, s) => sum + s, 0) / count;
    const variance = scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / count;
    const std = Math.sqrt(variance);

    return {
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      avg: Math.round(avg * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      count,
    };
  }
}
