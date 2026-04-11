/**
 * V6.6 Phase 2-E: ExplanationABTrackerService
 *
 * 追踪解释风格（concise / coaching）与用户行为（接受/替换/跳过）的关联，
 * 每周 Cron 分析各用户分群的最优解释风格，并将结果写入 strategy.config.explain。
 *
 * 数据流：
 * 1. trackExplanationOutcome() — 由推荐引擎在生成 trace 时调用，
 *    将解释风格写入 recommendation_traces.pipeline_snapshot.explanationStyle
 * 2. analyzeExplanationEffectiveness() — 每周一 05:00 分析各分群最优风格，
 *    差异 > 10% 且样本 > 50 时自动更新全局策略的 explain.preferredStyle
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/** 解释风格枚举 */
export type ExplanationStyle = 'concise' | 'coaching';

/** 推荐行为结果 */
export type ExplanationOutcome = 'accepted' | 'replaced' | 'skipped';

@Injectable()
export class ExplanationABTrackerService {
  private readonly logger = new Logger(ExplanationABTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录解释风格与后续行为的关联。
   *
   * 实现：将 explanationStyle 写入 recommendation_traces.pipeline_snapshot
   * 的 explanationStyle 字段（JSONB patch 更新）。
   * outcome 已由 recommendation_feedbacks.action 字段记录，此处只需确保
   * trace_id 已在 feedback 中正确引用即可完成关联（无需额外写入）。
   *
   * @param userId          用户 ID
   * @param traceId         推荐追踪 ID
   * @param explanationStyle 解释风格
   * @param outcome         用户行为
   */
  async trackExplanationOutcome(
    userId: string,
    traceId: string,
    explanationStyle: ExplanationStyle,
    outcome: ExplanationOutcome,
  ): Promise<void> {
    try {
      // 使用 jsonb_set 将 explanationStyle + outcome 写入 pipeline_snapshot
      await this.prisma.$executeRawUnsafe(
        `UPDATE recommendation_traces
         SET pipeline_snapshot = jsonb_set(
           COALESCE(pipeline_snapshot, '{}'),
           '{explanationStyle}',
           $1::jsonb
         )
         WHERE id = $2 AND user_id = $3`,
        JSON.stringify(explanationStyle),
        traceId,
        userId,
      );
    } catch (err) {
      // 追踪失败不应影响推荐主流程
      this.logger.warn(
        `Failed to track explanation outcome for trace ${traceId}: ${err.message}`,
      );
    }
  }

  /**
   * 每周一 05:00: 分析各用户分群的最优解释风格
   *
   * 逻辑：
   * 1. 联表 recommendation_traces × recommendation_feedbacks，
   *    按 user_segment × explanation_style 分组计算接受率
   * 2. 差异 > 10% 且各组样本 >= 50 时，更新全局激活策略的
   *    config.explain.preferredStyle[segment] = 'concise'|'coaching'
   */
  @Cron('0 5 * * 1')
  async analyzeExplanationEffectiveness(): Promise<void> {
    this.logger.log('Starting weekly explanation effectiveness analysis...');

    try {
      // 查询最近 30 天各分群 × 解释风格的接受率
      const rows = await this.prisma.$queryRaw<
        {
          user_segment: string;
          explanation_style: string;
          total: bigint;
          accepted: bigint;
        }[]
      >`
        SELECT
          uip.user_segment,
          (rt.pipeline_snapshot->>'explanationStyle') AS explanation_style,
          COUNT(rf.id)                                AS total,
          COUNT(rf.id) FILTER (WHERE rf.action = 'accepted') AS accepted
        FROM recommendation_traces rt
        INNER JOIN recommendation_feedbacks rf
          ON rf.trace_id = rt.id
        INNER JOIN user_inferred_profiles uip
          ON uip.user_id = rt.user_id
        WHERE rt.created_at >= NOW() - INTERVAL '30 days'
          AND rt.pipeline_snapshot->>'explanationStyle' IS NOT NULL
          AND uip.user_segment IS NOT NULL
        GROUP BY uip.user_segment, explanation_style
        HAVING COUNT(rf.id) >= 50
      `;

      if (!rows.length) {
        this.logger.log(
          'Explanation analysis: insufficient data (< 50 samples per group)',
        );
        return;
      }

      // 按 segment 分组，找出接受率更高的风格
      const segmentMap = new Map<
        string,
        Record<string, { total: number; accepted: number }>
      >();
      for (const row of rows) {
        if (!segmentMap.has(row.user_segment)) {
          segmentMap.set(row.user_segment, {});
        }
        const seg = segmentMap.get(row.user_segment)!;
        seg[row.explanation_style] = {
          total: Number(row.total),
          accepted: Number(row.accepted),
        };
      }

      const updates: Record<string, ExplanationStyle> = {};
      for (const [segment, styles] of segmentMap) {
        const concise = styles['concise'];
        const coaching = styles['coaching'];
        if (!concise || !coaching) continue;

        const conciseRate = concise.accepted / concise.total;
        const coachingRate = coaching.accepted / coaching.total;
        const diff = Math.abs(conciseRate - coachingRate);

        if (diff > 0.1) {
          updates[segment] =
            conciseRate > coachingRate ? 'concise' : 'coaching';
          this.logger.log(
            `Segment [${segment}]: preferredStyle → ${updates[segment]} ` +
              `(concise=${(conciseRate * 100).toFixed(1)}%, coaching=${(coachingRate * 100).toFixed(1)}%)`,
          );
        }
      }

      if (Object.keys(updates).length === 0) {
        this.logger.log(
          'Explanation analysis: no significant style differences found',
        );
        return;
      }

      // 将最优风格写入全局激活策略的 explain 配置
      const activeStrategy = await this.prisma.strategy.findFirst({
        where: { status: 'active', scope: 'global' },
        select: { id: true, config: true },
      });

      if (!activeStrategy) {
        this.logger.warn('No active global strategy found, skipping update');
        return;
      }

      const config = (activeStrategy.config as any) ?? {};
      const explain = { ...(config.explain ?? {}) };
      const preferredStyle = { ...(explain.preferredStyle ?? {}) };

      for (const [segment, style] of Object.entries(updates)) {
        preferredStyle[segment] = style;
      }

      explain.preferredStyle = preferredStyle;
      config.explain = explain;

      await this.prisma.strategy.update({
        where: { id: activeStrategy.id },
        data: { config },
      });

      this.logger.log(
        `Updated explain.preferredStyle for ${Object.keys(updates).length} segments`,
      );
    } catch (err) {
      this.logger.error(
        `Explanation effectiveness analysis failed: ${err.message}`,
        err.stack,
      );
    }
  }
}
