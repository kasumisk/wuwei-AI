/**
 * V6.6 Phase 2-E → V6.7 Phase 3-B: ExplanationABTrackerService
 *
 * 追踪解释风格（concise / coaching）与用户行为（接受/替换/跳过）的关联，
 * 每周 Cron 分析各用户分群的最优解释风格，并将结果写入 strategy.config.explain。
 *
 * V6.7 升级：将简单 10% 差异阈值替换为 2×2 列联表卡方检验（α=0.05, df=1），
 * 避免在小样本下因随机波动而误判风格差异。
 *
 * 数据流：
 * 1. trackExplanationOutcome() — 由推荐引擎在生成 trace 时调用，
 *    将解释风格写入 recommendation_traces.pipeline_snapshot.explanationStyle
 * 2. analyzeExplanationEffectiveness() — 每周一 05:00 分析各分群最优风格，
 *    卡方检验显著且样本 >= 50 时自动更新全局策略的 explain.preferredStyle
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../../core/prisma/prisma.service';

/** 解释风格枚举 */
export type ExplanationStyle = 'concise' | 'coaching';

/** 推荐行为结果 */
export type ExplanationOutcome = 'accepted' | 'replaced' | 'skipped';

@Injectable()
export class ExplanationABTrackerService {
  private readonly logger = new Logger(ExplanationABTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * V6.7: 2x2 列联表卡方检验，替代简单 10% 阈值
   *
   * | Style   | Accepted | Not Accepted | Row Total |
   * |---------|----------|--------------|-----------|
   * | A       | a        | b            | a+b       |
   * | B       | c        | d            | c+d       |
   * | Col Tot | a+c      | b+d          | n         |
   *
   * @returns true 当差异在 alpha 水平上统计显著（df=1）
   */
  private isStatisticallySignificant(
    acceptedA: number,
    totalA: number,
    acceptedB: number,
    totalB: number,
    alpha: number = 0.05,
  ): boolean {
    const a = acceptedA; // style A accepted
    const b = totalA - acceptedA; // style A not accepted
    const c = acceptedB; // style B accepted
    const d = totalB - acceptedB; // style B not accepted
    const n = a + b + c + d;

    if (n < 30) return false; // 样本不足

    const expected_a = ((a + b) * (a + c)) / n;
    const expected_b = ((a + b) * (b + d)) / n;
    const expected_c = ((c + d) * (a + c)) / n;
    const expected_d = ((c + d) * (b + d)) / n;

    // 期望频数 < 5 时卡方近似不可靠
    if ([expected_a, expected_b, expected_c, expected_d].some((e) => e < 5))
      return false;

    const chi2 =
      Math.pow(a - expected_a, 2) / expected_a +
      Math.pow(b - expected_b, 2) / expected_b +
      Math.pow(c - expected_c, 2) / expected_c +
      Math.pow(d - expected_d, 2) / expected_d;

    // alpha=0.05, df=1 → 临界值 3.841
    const criticalValue = alpha === 0.05 ? 3.841 : 3.841; // df=1 only
    return chi2 > criticalValue;
  }

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
         WHERE id = $2 AND user_id = $3::uuid`,
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
          userSegment: string;
          explanation_style: string;
          total: bigint;
          accepted: bigint;
        }[]
      >`
        SELECT
          (up.inferred_data->>'userSegment') AS "userSegment",
          (rt.pipeline_snapshot->>'explanationStyle') AS explanation_style,
          COUNT(rf.id)                                AS total,
          COUNT(rf.id) FILTER (WHERE rf.action = 'accepted') AS accepted
        FROM recommendation_traces rt
        INNER JOIN recommendation_feedbacks rf
          ON rf.trace_id = rt.id
        INNER JOIN user_profiles up
          ON up.user_id = rt.user_id
        WHERE rt.created_at >= NOW() - INTERVAL '30 days'
          AND rt.pipeline_snapshot->>'explanationStyle' IS NOT NULL
          AND up.inferred_data->>'userSegment' IS NOT NULL
        GROUP BY (up.inferred_data->>'userSegment'), explanation_style
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
        if (!segmentMap.has(row.userSegment)) {
          segmentMap.set(row.userSegment, {});
        }
        const seg = segmentMap.get(row.userSegment)!;
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

        // V6.7: 使用卡方检验替代简单 10% 阈值
        const significant = this.isStatisticallySignificant(
          concise.accepted,
          concise.total,
          coaching.accepted,
          coaching.total,
        );

        if (significant) {
          updates[segment] =
            conciseRate > coachingRate ? 'concise' : 'coaching';
          this.logger.log(
            `Segment [${segment}]: preferredStyle → ${updates[segment]} ` +
              `(concise=${(conciseRate * 100).toFixed(1)}%, coaching=${(coachingRate * 100).toFixed(1)}%, χ² significant)`,
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
