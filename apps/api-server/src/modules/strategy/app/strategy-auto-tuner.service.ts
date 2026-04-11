/**
 * V6.5 Phase 2F — 策略自动调优服务
 *
 * 每周一凌晨 04:00 执行：
 *   1. 分析过去 7 天各 segment 在各策略下的接受率
 *   2. 找出每个 segment 表现最佳的策略
 *   3. 与当前 SEGMENT_STRATEGY_MAP 对比，生成调优建议
 *   4. 高置信度（提升 > 50%）：自动应用；低置信度：仅记录日志
 *
 * 同时提供 calcAdaptiveExplorationRate() 供推荐引擎动态调整探索率。
 *
 * 依赖:
 *   - PrismaService: 查询 traces/feedbacks/user_profiles_extended
 *   - StrategySelectorService: 获取当前映射、执行策略重分配
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';

// ==================== 类型 ====================

/** 单个 segment 在某策略下的效果统计 */
interface SegmentStrategyStats {
  segmentName: string;
  strategyId: string;
  strategyName: string;
  totalFeedbacks: number;
  acceptedCount: number;
  acceptanceRate: number;
}

/** 调优建议 */
export interface TuningSuggestion {
  segment: string;
  currentStrategy: string;
  suggestedStrategy: string;
  currentRate: number;
  suggestedRate: number;
  improvement: number;
}

/** 自动调优执行结果摘要 */
export interface AutoTuneResult {
  analyzedSegments: number;
  suggestions: TuningSuggestion[];
  appliedCount: number;
  skippedCount: number;
}

// ==================== 当前映射（与 StrategySelectorService 保持一致） ====================

/**
 * 运行时可变的 segment → strategy 映射。
 * 初始值与 StrategySelectorService.SEGMENT_STRATEGY_MAP 保持一致。
 * 自动调优时直接修改此映射。
 *
 * V6.6 Phase 1-C: 启动时从 strategy_tuning_log 恢复最新的自动应用记录，
 * 重启后不再回退到硬编码默认值。
 */
const SEGMENT_STRATEGY_MAP: Record<string, string> = {
  new_user: 'warm_start',
  returning_user: 're_engage',
  disciplined_loser: 'precision',
  muscle_builder: 'precision',
  active_maintainer: 'discovery',
  casual_maintainer: 'discovery',
  binge_risk: 'precision',
};

@Injectable()
export class StrategyAutoTuner implements OnModuleInit {
  private readonly logger = new Logger(StrategyAutoTuner.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 启动恢复 ====================

  /**
   * V6.6 Phase 1-C: 从 strategy_tuning_log 恢复最新的自动应用记录
   *
   * 每个 segment 只取最近一次 auto_applied=true 的记录，
   * 将 new_strategy 写入内存映射，恢复上次调优结果。
   */
  async onModuleInit(): Promise<void> {
    try {
      // 取所有 auto_applied=true 的记录，按时间倒序
      const allApplied = await this.prisma.strategy_tuning_log.findMany({
        where: { auto_applied: true },
        orderBy: { created_at: 'desc' },
        select: { segment_name: true, new_strategy: true, created_at: true },
      });

      // 每个 segment 只取最新一条（findMany 已按 desc 排序）
      const recovered = new Set<string>();
      for (const log of allApplied) {
        if (!recovered.has(log.segment_name)) {
          SEGMENT_STRATEGY_MAP[log.segment_name] = log.new_strategy;
          recovered.add(log.segment_name);
        }
      }

      if (recovered.size > 0) {
        this.logger.log(
          `StrategyAutoTuner: 从 DB 恢复了 ${recovered.size} 个分群的策略映射: ` +
            `[${Array.from(recovered).join(', ')}]`,
        );
      } else {
        this.logger.log(
          'StrategyAutoTuner: 无历史调优记录，使用硬编码默认映射',
        );
      }
    } catch (err) {
      // 恢复失败不阻塞启动，使用默认映射继续运行
      this.logger.warn(
        `StrategyAutoTuner: 启动恢复失败，使用默认映射: ${(err as Error).message}`,
      );
    }
  }

  // ==================== 定时任务入口 ====================

  /**
   * 每周一 04:00 执行策略自动调优
   * 分析过去 7 天的效果矩阵，调整 segment→strategy 映射
   */
  @Cron('0 4 * * 1')
  async autoTune(): Promise<AutoTuneResult> {
    this.logger.log('开始策略自动调优...');

    const endDate = new Date();
    const startDate = new Date(Date.now() - 7 * 86400_000);

    // 1. 查询各 segment × strategy 的效果统计
    const stats = await this.querySegmentStrategyStats(startDate, endDate);

    if (stats.length === 0) {
      this.logger.log('效果数据不足，跳过自动调优');
      return {
        analyzedSegments: 0,
        suggestions: [],
        appliedCount: 0,
        skippedCount: 0,
      };
    }

    // 2. 找出每个 segment 的最佳策略
    const segmentBest = new Map<
      string,
      { strategyName: string; rate: number; feedbacks: number }
    >();

    for (const row of stats) {
      // 需要足够样本量（至少 5 条反馈）
      if (row.totalFeedbacks < 5) continue;

      const current = segmentBest.get(row.segmentName);
      if (!current || row.acceptanceRate > current.rate) {
        segmentBest.set(row.segmentName, {
          strategyName: row.strategyName,
          rate: row.acceptanceRate,
          feedbacks: row.totalFeedbacks,
        });
      }
    }

    // 3. 对比当前映射，生成调整建议
    const suggestions: TuningSuggestion[] = [];
    for (const [segment, best] of segmentBest) {
      const currentStrategy = this.getCurrentMapping(segment);
      if (!currentStrategy) continue;

      if (currentStrategy !== best.strategyName && best.rate > 0.3) {
        // 查找当前策略在同一 segment 的接受率
        const currentRate = this.getStatsRate(stats, segment, currentStrategy);

        // 仅在新策略接受率比当前高 20%+ 时建议切换
        if (best.rate > currentRate * 1.2) {
          suggestions.push({
            segment,
            currentStrategy,
            suggestedStrategy: best.strategyName,
            currentRate,
            suggestedRate: best.rate,
            improvement: best.rate - currentRate,
          });
        }
      }
    }

    // 4. 自动应用高置信度调整，低置信度仅记录
    let appliedCount = 0;
    let skippedCount = 0;

    for (const suggestion of suggestions) {
      const isHighConfidence =
        suggestion.improvement > 0.5 * (suggestion.currentRate || 0.01);

      // 记录调优日志到 DB
      await this.logTuningDecision(suggestion, isHighConfidence);

      if (isHighConfidence) {
        this.applyStrategySwitch(suggestion);
        appliedCount++;
        this.logger.log(
          `自动策略切换: ${suggestion.segment} ` +
            `${suggestion.currentStrategy} → ${suggestion.suggestedStrategy} ` +
            `(${(suggestion.currentRate * 100).toFixed(1)}% → ${(suggestion.suggestedRate * 100).toFixed(1)}%)`,
        );
      } else {
        skippedCount++;
        this.logger.log(
          `策略调优建议（未自动应用）: ${JSON.stringify(suggestion)}`,
        );
      }
    }

    const result: AutoTuneResult = {
      analyzedSegments: segmentBest.size,
      suggestions,
      appliedCount,
      skippedCount,
    };

    this.logger.log(
      `策略自动调优完成: 分析 ${result.analyzedSegments} 个分群, ` +
        `${result.suggestions.length} 条建议, ` +
        `${result.appliedCount} 条自动应用, ${result.skippedCount} 条跳过`,
    );

    return result;
  }

  // ==================== 自适应探索率 ====================

  /**
   * 自适应 exploration rate
   * 根据用户交互量和 Thompson Sampling 收敛程度调整
   *
   * @param totalInteractions 用户累计交互次数
   * @param tsConvergence 0-1，1=完全收敛（TS alpha/(alpha+beta) 的方差趋近于 0）
   * @returns 0.02 ~ baseRate 之间的探索率
   */
  calcAdaptiveExplorationRate(
    totalInteractions: number,
    tsConvergence: number,
  ): number {
    const baseRate = 0.15;

    // 交互量衰减：交互越多，探索越少
    const interactionDecay = Math.exp(-totalInteractions / 100);

    // 收敛衰减：TS 越收敛，探索越少
    const convergenceDecay = 1 - tsConvergence * 0.8;

    return Math.max(0.02, baseRate * interactionDecay * convergenceDecay);
  }

  // ==================== 查询分析 ====================

  /**
   * 获取当前 segment → strategy 映射
   */
  getCurrentMapping(segment: string): string | undefined {
    return SEGMENT_STRATEGY_MAP[segment];
  }

  /**
   * 获取当前所有映射（供 Admin API 展示）
   */
  getAllMappings(): Record<string, string> {
    return { ...SEGMENT_STRATEGY_MAP };
  }

  /**
   * 查询过去 N 天各 segment × strategy 的效果统计
   *
   * 通过 JOIN：
   *   recommendation_traces (strategy_id) →
   *   recommendation_feedbacks (trace_id) →
   *   user_profiles_extended (user_segment)
   */
  private async querySegmentStrategyStats(
    startDate: Date,
    endDate: Date,
  ): Promise<SegmentStrategyStats[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        segment_name: string;
        strategy_id: string;
        strategy_name: string;
        total_feedbacks: bigint;
        accepted_count: bigint;
      }>
    >`
      SELECT
        uip.user_segment AS segment_name,
        t.strategy_id,
        COALESCE(s.name, 'unknown') AS strategy_name,
        COUNT(f.id) AS total_feedbacks,
        COUNT(CASE WHEN f.action = 'accepted' THEN 1 END) AS accepted_count
      FROM recommendation_traces t
      JOIN recommendation_feedbacks f ON f.trace_id = t.id
      JOIN user_inferred_profiles uip ON uip.user_id = t.user_id
      LEFT JOIN strategy s ON s.id = t.strategy_id
      WHERE t.created_at >= ${startDate}
        AND t.created_at < ${endDate}
        AND uip.user_segment IS NOT NULL
        AND t.strategy_id IS NOT NULL
      GROUP BY uip.user_segment, t.strategy_id, s.name
      HAVING COUNT(f.id) >= 3
      ORDER BY uip.user_segment, COUNT(f.id) DESC
    `;

    return rows.map((r) => {
      const total = Number(r.total_feedbacks);
      const accepted = Number(r.accepted_count);
      return {
        segmentName: r.segment_name,
        strategyId: r.strategy_id,
        strategyName: r.strategy_name,
        totalFeedbacks: total,
        acceptedCount: accepted,
        acceptanceRate: total > 0 ? accepted / total : 0,
      };
    });
  }

  /**
   * 从已查询的统计中获取指定 segment+strategy 的接受率
   */
  private getStatsRate(
    stats: SegmentStrategyStats[],
    segment: string,
    strategyName: string,
  ): number {
    const match = stats.find(
      (s) => s.segmentName === segment && s.strategyName === strategyName,
    );
    return match?.acceptanceRate ?? 0;
  }

  /**
   * 应用策略切换（内存级别）
   */
  private applyStrategySwitch(suggestion: TuningSuggestion): void {
    SEGMENT_STRATEGY_MAP[suggestion.segment] = suggestion.suggestedStrategy;
  }

  /**
   * 记录调优决策到 strategy_tuning_log 表
   */
  private async logTuningDecision(
    suggestion: TuningSuggestion,
    autoApplied: boolean,
  ): Promise<void> {
    try {
      await this.prisma.strategy_tuning_log.create({
        data: {
          segment_name: suggestion.segment,
          previous_strategy: suggestion.currentStrategy,
          new_strategy: suggestion.suggestedStrategy,
          previous_rate: suggestion.currentRate,
          new_rate: suggestion.suggestedRate,
          improvement: suggestion.improvement,
          auto_applied: autoApplied,
        },
      });
    } catch (err) {
      this.logger.error(`记录调优日志失败: ${(err as Error).message}`);
    }
  }
}
