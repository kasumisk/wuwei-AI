import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * V6.4 Phase 3.6: 策略效果分析服务
 *
 * 基于 recommendation_traces + recommendation_feedbacks 的关联数据，
 * 分析推荐策略的效果指标：
 *
 * 核心指标:
 * - 接受率 (acceptance_rate): accepted / total_feedbacks
 * - 替换率 (replacement_rate): replaced / total_feedbacks
 * - 跳过率 (skip_rate): skipped / total_feedbacks
 * - 平均评分 (avg_score): 推荐食物的平均评分
 * - 推荐多样性 (diversity): 不同食物类别数 / 推荐总数
 * - 渠道分布 (channel_distribution): 各获取渠道的推荐占比
 *
 * 支持:
 * - 按策略 ID 分析（strategy_id）
 * - 按 A/B 实验分组对比（experiment_id + group_id）
 * - 按渠道分析（channel）
 * - 按时间范围过滤
 */

/** 策略效果概览 */
export interface StrategyEffectivenessReport {
  /** 策略 ID */
  strategyId: string | null;
  /** 策略版本 */
  strategyVersion: string | null;
  /** 统计时间范围 */
  period: { from: Date; to: Date };
  /** 总推荐次数 */
  totalRecommendations: number;
  /** 总反馈数 */
  totalFeedbacks: number;
  /** 接受率 */
  acceptanceRate: number;
  /** 替换率 */
  replacementRate: number;
  /** 跳过率 */
  skipRate: number;
  /** 平均候选池大小 */
  avgPoolSize: number;
  /** 平均计算耗时 (ms) */
  avgDurationMs: number;
  /** 渠道分布 */
  channelDistribution: Record<string, number>;
  /** 目标类型分布 */
  goalTypeDistribution: Record<string, number>;
}

/** A/B 实验对比结果 */
export interface ExperimentComparisonResult {
  experimentId: string;
  groups: Array<{
    groupId: string;
    totalFeedbacks: number;
    acceptanceRate: number;
    replacementRate: number;
    skipRate: number;
    avgDurationMs: number;
  }>;
}

/** 渠道效果分析 */
export interface ChannelEffectivenessResult {
  channel: string;
  totalRecommendations: number;
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  avgPoolSize: number;
  avgDurationMs: number;
}

@Injectable()
export class StrategyEffectivenessService {
  private readonly logger = new Logger(StrategyEffectivenessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取策略效果概览报告
   *
   * @param strategyId 策略 ID（可选，不传则统计全局）
   * @param days 统计天数（默认 7 天）
   */
  async getEffectivenessReport(
    strategyId?: string,
    days = 7,
  ): Promise<StrategyEffectivenessReport> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const now = new Date();

    // 1. 查询 traces
    const traceWhere: Record<string, unknown> = {
      created_at: { gte: since },
    };
    if (strategyId) {
      traceWhere.strategy_id = strategyId;
    }

    const traces = await this.prisma.recommendation_traces.findMany({
      where: traceWhere,
      select: {
        id: true,
        channel: true,
        goal_type: true,
        food_pool_size: true,
        duration_ms: true,
        strategy_id: true,
        strategy_version: true,
      },
    });

    const totalRecommendations = traces.length;
    const traceIds = traces.map((t) => t.id);

    // 2. 查询关联的反馈
    const feedbacks =
      traceIds.length > 0
        ? await this.prisma.recommendation_feedbacks.findMany({
            where: {
              trace_id: { in: traceIds },
            },
            select: {
              action: true,
              trace_id: true,
            },
          })
        : [];

    const totalFeedbacks = feedbacks.length;
    const accepted = feedbacks.filter((f) => f.action === 'accepted').length;
    const replaced = feedbacks.filter((f) => f.action === 'replaced').length;
    const skipped = feedbacks.filter((f) => f.action === 'skipped').length;

    // 3. 计算统计
    const channelDist: Record<string, number> = {};
    const goalDist: Record<string, number> = {};
    let totalPoolSize = 0;
    let totalDuration = 0;
    let poolCount = 0;
    let durationCount = 0;

    for (const trace of traces) {
      channelDist[trace.channel] = (channelDist[trace.channel] || 0) + 1;
      goalDist[trace.goal_type] = (goalDist[trace.goal_type] || 0) + 1;
      if (trace.food_pool_size != null) {
        totalPoolSize += trace.food_pool_size;
        poolCount++;
      }
      if (trace.duration_ms != null) {
        totalDuration += trace.duration_ms;
        durationCount++;
      }
    }

    // 获取策略版本（取第一个非 null 的）
    const firstTrace = traces.find((t) => t.strategy_version);

    return {
      strategyId: strategyId ?? null,
      strategyVersion: firstTrace?.strategy_version ?? null,
      period: { from: since, to: now },
      totalRecommendations,
      totalFeedbacks,
      acceptanceRate:
        totalFeedbacks > 0
          ? Math.round((accepted / totalFeedbacks) * 1000) / 1000
          : 0,
      replacementRate:
        totalFeedbacks > 0
          ? Math.round((replaced / totalFeedbacks) * 1000) / 1000
          : 0,
      skipRate:
        totalFeedbacks > 0
          ? Math.round((skipped / totalFeedbacks) * 1000) / 1000
          : 0,
      avgPoolSize: poolCount > 0 ? Math.round(totalPoolSize / poolCount) : 0,
      avgDurationMs:
        durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      channelDistribution: channelDist,
      goalTypeDistribution: goalDist,
    };
  }

  /**
   * A/B 实验分组对比
   *
   * @param experimentId 实验 ID
   * @param days 统计天数
   */
  async compareExperimentGroups(
    experimentId: string,
    days = 7,
  ): Promise<ExperimentComparisonResult> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 查询该实验的所有 traces
    const traces = await this.prisma.recommendation_traces.findMany({
      where: {
        experiment_id: experimentId,
        created_at: { gte: since },
      },
      select: {
        id: true,
        group_id: true,
        duration_ms: true,
      },
    });

    const traceIds = traces.map((t) => t.id);

    // 查询关联反馈
    const feedbacks =
      traceIds.length > 0
        ? await this.prisma.recommendation_feedbacks.findMany({
            where: { trace_id: { in: traceIds } },
            select: {
              action: true,
              trace_id: true,
            },
          })
        : [];

    // 按 trace_id → group_id 映射
    const traceGroupMap = new Map<string, string>();
    const groupDurations = new Map<string, number[]>();
    for (const trace of traces) {
      const gid = trace.group_id ?? 'control';
      traceGroupMap.set(trace.id, gid);
      if (!groupDurations.has(gid)) groupDurations.set(gid, []);
      if (trace.duration_ms != null) {
        groupDurations.get(gid)!.push(trace.duration_ms);
      }
    }

    // 按分组统计反馈
    const groupStats = new Map<
      string,
      { total: number; accepted: number; replaced: number; skipped: number }
    >();

    for (const fb of feedbacks) {
      const gid = fb.trace_id
        ? (traceGroupMap.get(fb.trace_id) ?? 'unknown')
        : 'unknown';
      if (!groupStats.has(gid)) {
        groupStats.set(gid, {
          total: 0,
          accepted: 0,
          replaced: 0,
          skipped: 0,
        });
      }
      const stats = groupStats.get(gid)!;
      stats.total++;
      if (fb.action === 'accepted') stats.accepted++;
      else if (fb.action === 'replaced') stats.replaced++;
      else if (fb.action === 'skipped') stats.skipped++;
    }

    // 构建结果
    const groups: ExperimentComparisonResult['groups'] = [];
    const allGroupIds = new Set([
      ...groupStats.keys(),
      ...groupDurations.keys(),
    ]);

    for (const gid of allGroupIds) {
      const stats = groupStats.get(gid) ?? {
        total: 0,
        accepted: 0,
        replaced: 0,
        skipped: 0,
      };
      const durations = groupDurations.get(gid) ?? [];
      const avgDuration =
        durations.length > 0
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : 0;

      groups.push({
        groupId: gid,
        totalFeedbacks: stats.total,
        acceptanceRate:
          stats.total > 0
            ? Math.round((stats.accepted / stats.total) * 1000) / 1000
            : 0,
        replacementRate:
          stats.total > 0
            ? Math.round((stats.replaced / stats.total) * 1000) / 1000
            : 0,
        skipRate:
          stats.total > 0
            ? Math.round((stats.skipped / stats.total) * 1000) / 1000
            : 0,
        avgDurationMs: avgDuration,
      });
    }

    return { experimentId, groups };
  }

  /**
   * 按渠道分析推荐效果
   *
   * @param days 统计天数
   */
  async analyzeByChannel(days = 7): Promise<ChannelEffectivenessResult[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const traces = await this.prisma.recommendation_traces.findMany({
      where: { created_at: { gte: since } },
      select: {
        id: true,
        channel: true,
        food_pool_size: true,
        duration_ms: true,
      },
    });

    const traceIds = traces.map((t) => t.id);

    const feedbacks =
      traceIds.length > 0
        ? await this.prisma.recommendation_feedbacks.findMany({
            where: { trace_id: { in: traceIds } },
            select: { action: true, trace_id: true },
          })
        : [];

    // trace_id → channel
    const traceChannelMap = new Map<string, string>();
    const channelData = new Map<
      string,
      {
        totalRecs: number;
        poolSizes: number[];
        durations: number[];
        accepted: number;
        replaced: number;
        total: number;
      }
    >();

    for (const trace of traces) {
      traceChannelMap.set(trace.id, trace.channel);
      if (!channelData.has(trace.channel)) {
        channelData.set(trace.channel, {
          totalRecs: 0,
          poolSizes: [],
          durations: [],
          accepted: 0,
          replaced: 0,
          total: 0,
        });
      }
      const data = channelData.get(trace.channel)!;
      data.totalRecs++;
      if (trace.food_pool_size != null)
        data.poolSizes.push(trace.food_pool_size);
      if (trace.duration_ms != null) data.durations.push(trace.duration_ms);
    }

    for (const fb of feedbacks) {
      const ch = fb.trace_id
        ? (traceChannelMap.get(fb.trace_id) ?? 'unknown')
        : 'unknown';
      if (!channelData.has(ch)) continue;
      const data = channelData.get(ch)!;
      data.total++;
      if (fb.action === 'accepted') data.accepted++;
      else if (fb.action === 'replaced') data.replaced++;
    }

    const results: ChannelEffectivenessResult[] = [];
    for (const [channel, data] of channelData) {
      const avgPool =
        data.poolSizes.length > 0
          ? Math.round(
              data.poolSizes.reduce((s, p) => s + p, 0) / data.poolSizes.length,
            )
          : 0;
      const avgDur =
        data.durations.length > 0
          ? Math.round(
              data.durations.reduce((s, d) => s + d, 0) / data.durations.length,
            )
          : 0;

      results.push({
        channel,
        totalRecommendations: data.totalRecs,
        totalFeedbacks: data.total,
        acceptanceRate:
          data.total > 0
            ? Math.round((data.accepted / data.total) * 1000) / 1000
            : 0,
        replacementRate:
          data.total > 0
            ? Math.round((data.replaced / data.total) * 1000) / 1000
            : 0,
        avgPoolSize: avgPool,
        avgDurationMs: avgDur,
      });
    }

    return results.sort(
      (a, b) => b.totalRecommendations - a.totalRecommendations,
    );
  }
}
