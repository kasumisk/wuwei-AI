/**
 * V6.5 Phase 3I: Thompson Sampling 收敛可视化服务
 *
 * 提供 TS 分布参数的聚合查询和收敛度分析：
 * - 单用户所有食物的 alpha/beta 分布
 * - 全局 TS 收敛度统计
 * - 食物级收敛排行（最收敛/最不确定）
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/** 单个食物的 Beta 分布参数 + 派生指标 */
export interface FoodBetaDistribution {
  foodName: string;
  /** 原始 accepted 数 */
  accepted: number;
  /** 原始 rejected 数 */
  rejected: number;
  /** Beta 分布 α = accepted + 1 */
  alpha: number;
  /** Beta 分布 β = rejected + 1 */
  beta: number;
  /** 期望值 E[X] = α / (α + β) */
  mean: number;
  /** Beta 方差 = αβ / ((α+β)²(α+β+1)) */
  variance: number;
  /** 收敛度 = 1 - variance/maxVariance (0 = 完全不收敛, 1 = 完全收敛) */
  convergence: number;
  /** 总交互数 */
  totalInteractions: number;
}

/** 用户 TS 收敛概览 */
export interface UserConvergenceOverview {
  userId: string;
  /** 有反馈的食物数 */
  foodCount: number;
  /** 所有食物的平均收敛度 */
  avgConvergence: number;
  /** 总交互数 */
  totalInteractions: number;
  /** 收敛阶段: exploring(低) / converging(中) / converged(高) */
  phase: 'exploring' | 'converging' | 'converged';
  /** 每个食物的 Beta 分布 */
  distributions: FoodBetaDistribution[];
}

/** 全局 TS 收敛统计 */
export interface GlobalConvergenceStats {
  /** 有反馈数据的用户数 */
  activeUserCount: number;
  /** 全局平均收敛度 */
  avgConvergence: number;
  /** 各阶段用户分布 */
  phaseDistribution: {
    exploring: number;
    converging: number;
    converged: number;
  };
  /** 收敛最高的 Top N 食物 */
  mostConverged: FoodBetaDistribution[];
  /** 最不确定（方差最大）的 Top N 食物 */
  leastConverged: FoodBetaDistribution[];
}

/** Beta(1,1) 的理论最大方差 = 1/12 ≈ 0.0833 */
const MAX_VARIANCE = 1 / 12;

@Injectable()
export class ThompsonSamplingService {
  private readonly logger = new Logger(ThompsonSamplingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取指定用户的 TS 收敛详情
   *
   * @param userId 用户 ID
   * @param days   统计窗口（天），默认 30
   */
  async getUserConvergence(
    userId: string,
    days = 30,
  ): Promise<UserConvergenceOverview> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.prisma.$queryRawUnsafe<
      { foodName: string; accepted: string; rejected: string }[]
    >(
      `SELECT f.food_name AS "foodName",
              SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END)::text AS "accepted",
              SUM(CASE WHEN f.action != 'accepted' THEN 1 ELSE 0 END)::text AS "rejected"
       FROM recommendation_feedbacks f
       WHERE f.user_id = $1::uuid
         AND f.created_at >= $2
       GROUP BY f.food_name
       ORDER BY SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END) +
                SUM(CASE WHEN f.action != 'accepted' THEN 1 ELSE 0 END) DESC`,
      userId,
      since,
    );

    const distributions = rows.map((r) => this.toBetaDistribution(r));
    const totalInteractions = distributions.reduce(
      (s, d) => s + d.totalInteractions,
      0,
    );
    const avgConvergence =
      distributions.length > 0
        ? distributions.reduce((s, d) => s + d.convergence, 0) /
          distributions.length
        : 0;

    return {
      userId,
      foodCount: distributions.length,
      avgConvergence: round4(avgConvergence),
      totalInteractions,
      phase: this.classifyPhase(avgConvergence),
      distributions,
    };
  }

  /**
   * 获取全局 TS 收敛统计
   *
   * @param days 统计窗口（天），默认 30
   * @param topN 收敛最高/最低展示数量，默认 10
   */
  async getGlobalConvergence(
    days = 30,
    topN = 10,
  ): Promise<GlobalConvergenceStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 1. 按用户聚合收敛度
    const userRows = await this.prisma.$queryRawUnsafe<
      {
        userId: string;
        foodCount: string;
        totalInteractions: string;
        avgVariance: string;
      }[]
    >(
      `WITH food_stats AS (
         SELECT f.user_id,
                f.food_name,
                SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN f.action != 'accepted' THEN 1 ELSE 0 END) AS rejected
         FROM recommendation_feedbacks f
         WHERE f.created_at >= $1
         GROUP BY f.user_id, f.food_name
       )
       SELECT user_id AS "userId",
              COUNT(*)::text AS "foodCount",
              SUM(accepted + rejected)::text AS "totalInteractions",
              AVG(
                ((accepted + 1.0) * (rejected + 1.0)) /
                (POWER(accepted + rejected + 2.0, 2) * (accepted + rejected + 3.0))
              )::text AS "avgVariance"
       FROM food_stats
       GROUP BY user_id`,
      since,
    );

    // 分类阶段
    const phaseDistribution = { exploring: 0, converging: 0, converged: 0 };
    let totalConvergence = 0;

    for (const row of userRows) {
      const avgVariance = parseFloat(row.avgVariance);
      const convergence = Math.max(
        0,
        Math.min(1, 1 - avgVariance / MAX_VARIANCE),
      );
      totalConvergence += convergence;
      const phase = this.classifyPhase(convergence);
      phaseDistribution[phase]++;
    }

    const avgConvergence =
      userRows.length > 0 ? totalConvergence / userRows.length : 0;

    // 2. 全局食物级聚合 — 跨所有用户
    const foodRows = await this.prisma.$queryRawUnsafe<
      { foodName: string; accepted: string; rejected: string }[]
    >(
      `SELECT f.food_name AS "foodName",
              SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END)::text AS "accepted",
              SUM(CASE WHEN f.action != 'accepted' THEN 1 ELSE 0 END)::text AS "rejected"
       FROM recommendation_feedbacks f
       WHERE f.created_at >= $1
       GROUP BY f.food_name
       HAVING SUM(1) >= 3`,
      since,
    );

    const allDistributions = foodRows
      .map((r) => this.toBetaDistribution(r))
      .sort((a, b) => b.convergence - a.convergence);

    const mostConverged = allDistributions.slice(0, topN);
    const leastConverged = allDistributions
      .slice()
      .sort((a, b) => a.convergence - b.convergence)
      .slice(0, topN);

    return {
      activeUserCount: userRows.length,
      avgConvergence: round4(avgConvergence),
      phaseDistribution,
      mostConverged,
      leastConverged,
    };
  }

  // ─── 内部工具方法 ───

  private toBetaDistribution(row: {
    foodName: string;
    accepted: string;
    rejected: string;
  }): FoodBetaDistribution {
    const accepted = Number(row.accepted);
    const rejected = Number(row.rejected);
    const alpha = accepted + 1;
    const beta = rejected + 1;
    const sum = alpha + beta;
    const mean = alpha / sum;
    const variance = (alpha * beta) / (sum * sum * (sum + 1));
    const convergence = Math.max(0, Math.min(1, 1 - variance / MAX_VARIANCE));

    return {
      foodName: row.foodName,
      accepted,
      rejected,
      alpha,
      beta,
      mean: round4(mean),
      variance: round4(variance),
      convergence: round4(convergence),
      totalInteractions: accepted + rejected,
    };
  }

  private classifyPhase(
    convergence: number,
  ): 'exploring' | 'converging' | 'converged' {
    if (convergence < 0.3) return 'exploring';
    if (convergence < 0.7) return 'converging';
    return 'converged';
  }
}

/** 四位小数精度 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
