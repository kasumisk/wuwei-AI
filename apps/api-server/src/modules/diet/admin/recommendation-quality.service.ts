import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyPlan } from '../entities/daily-plan.entity';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';

/**
 * 推荐质量分析服务 (V4 Phase 3.6)
 *
 * 设计动机:
 * - Phase 2.3 为每个推荐食物生成了 ScoringExplanation，但从未被汇总分析
 * - 本服务从 DailyPlan 和 RecommendationFeedback 中提取质量指标
 * - 供管理后台/仪表盘展示推荐系统的运行质量
 *
 * 核心指标:
 * 1. 接受率 (acceptance rate) — accepted / total feedbacks
 * 2. 替换率 (replacement rate) — replaced / total feedbacks
 * 3. 跳过率 (skip rate) — skipped / total feedbacks
 * 4. 按目标类型/餐次的接受率分布
 * 5. 按日期的趋势
 */

/** 推荐质量概览 */
export interface QualityOverview {
  /** 时间范围 */
  dateRange: { from: string; to: string };
  /** 总反馈数 */
  totalFeedbacks: number;
  /** 接受率 (0-1) */
  acceptanceRate: number;
  /** 替换率 (0-1) */
  replacementRate: number;
  /** 跳过率 (0-1) */
  skipRate: number;
  /** 活跃用户数（有反馈的） */
  activeUsers: number;
  /** 日均反馈数 */
  avgDailyFeedbacks: number;
}

/** 按维度分组的接受率 */
export interface AcceptanceByDimension {
  dimension: string;
  total: number;
  accepted: number;
  rate: number;
}

/** 日趋势数据点 */
export interface DailyTrend {
  date: string;
  total: number;
  accepted: number;
  replaced: number;
  skipped: number;
  acceptanceRate: number;
}

/** 计划覆盖统计 */
export interface PlanCoverage {
  /** 时间范围 */
  dateRange: { from: string; to: string };
  /** 生成的计划总数 */
  totalPlans: number;
  /** 有调整的计划数 */
  adjustedPlans: number;
  /** 平均计划总热量 */
  avgPlanCalories: number;
  /** 唯一用户数 */
  uniqueUsers: number;
}

@Injectable()
export class RecommendationQualityService {
  private readonly logger = new Logger(RecommendationQualityService.name);

  constructor(
    @InjectRepository(DailyPlan)
    private readonly planRepo: Repository<DailyPlan>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
  ) {}

  /**
   * 获取推荐质量概览
   * @param days 回溯天数 (默认 30)
   */
  async getQualityOverview(days = 30): Promise<QualityOverview> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const now = new Date();

    try {
      // 使用 SQL 聚合在数据库端完成统计，避免将全部实体加载到内存
      const rows: Array<{
        total: string;
        accepted: string;
        replaced: string;
        skipped: string;
        activeUsers: string;
      }> = await this.feedbackRepo
        .createQueryBuilder('f')
        .select('COUNT(*)', 'total')
        .addSelect(
          "SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END)",
          'accepted',
        )
        .addSelect(
          "SUM(CASE WHEN f.action = 'replaced' THEN 1 ELSE 0 END)",
          'replaced',
        )
        .addSelect(
          "SUM(CASE WHEN f.action = 'skipped' THEN 1 ELSE 0 END)",
          'skipped',
        )
        .addSelect('COUNT(DISTINCT f.user_id)', 'activeUsers')
        .where('f.created_at >= :since', { since })
        .getRawMany();

      const row = rows[0];
      const total = Number(row?.total ?? 0);
      const accepted = Number(row?.accepted ?? 0);
      const replaced = Number(row?.replaced ?? 0);
      const skipped = Number(row?.skipped ?? 0);

      return {
        dateRange: {
          from: since.toISOString().split('T')[0],
          to: now.toISOString().split('T')[0],
        },
        totalFeedbacks: total,
        acceptanceRate: total > 0 ? accepted / total : 0,
        replacementRate: total > 0 ? replaced / total : 0,
        skipRate: total > 0 ? skipped / total : 0,
        activeUsers: Number(row?.activeUsers ?? 0),
        avgDailyFeedbacks: total > 0 ? total / days : 0,
      };
    } catch (err) {
      this.logger.error(`获取质量概览失败: ${err}`);
      return {
        dateRange: {
          from: since.toISOString().split('T')[0],
          to: now.toISOString().split('T')[0],
        },
        totalFeedbacks: 0,
        acceptanceRate: 0,
        replacementRate: 0,
        skipRate: 0,
        activeUsers: 0,
        avgDailyFeedbacks: 0,
      };
    }
  }

  /**
   * 按目标类型的接受率分布
   */
  async getAcceptanceByGoalType(days = 30): Promise<AcceptanceByDimension[]> {
    return this.getAcceptanceByField('goalType', days);
  }

  /**
   * 按餐次的接受率分布
   */
  async getAcceptanceByMealType(days = 30): Promise<AcceptanceByDimension[]> {
    return this.getAcceptanceByField('mealType', days);
  }

  /**
   * 获取日趋势数据
   */
  async getDailyTrend(days = 30): Promise<DailyTrend[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
      const rows: Array<{
        date: string;
        total: string;
        accepted: string;
        replaced: string;
        skipped: string;
      }> = await this.feedbackRepo.query(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE action = 'accepted') as accepted,
           COUNT(*) FILTER (WHERE action = 'replaced') as replaced,
           COUNT(*) FILTER (WHERE action = 'skipped') as skipped
         FROM recommendation_feedbacks
         WHERE created_at >= $1
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [since],
      );

      return rows.map((r) => {
        const total = parseInt(r.total, 10);
        const accepted = parseInt(r.accepted, 10);
        return {
          date: r.date,
          total,
          accepted,
          replaced: parseInt(r.replaced, 10),
          skipped: parseInt(r.skipped, 10),
          acceptanceRate: total > 0 ? accepted / total : 0,
        };
      });
    } catch (err) {
      this.logger.error(`获取日趋势失败: ${err}`);
      return [];
    }
  }

  /**
   * 获取计划覆盖统计
   */
  async getPlanCoverage(days = 30): Promise<PlanCoverage> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const now = new Date();
    const sinceDate = since.toISOString().split('T')[0];
    const toDate = now.toISOString().split('T')[0];

    try {
      // 使用 SQL 聚合在数据库端完成统计，避免将全部计划实体加载到内存
      const rows: Array<{
        totalPlans: string;
        adjustedPlans: string;
        avgCalories: string | null;
        uniqueUsers: string;
      }> = await this.planRepo
        .createQueryBuilder('p')
        .select('COUNT(*)', 'totalPlans')
        .addSelect(
          'SUM(CASE WHEN jsonb_array_length(p.adjustments) > 0 THEN 1 ELSE 0 END)',
          'adjustedPlans',
        )
        .addSelect('AVG(p.total_budget)', 'avgCalories')
        .addSelect('COUNT(DISTINCT p.user_id)', 'uniqueUsers')
        .where('p.date >= :since', { since: sinceDate })
        .andWhere('p.date <= :to', { to: toDate })
        .getRawMany();

      const row = rows[0];
      return {
        dateRange: { from: sinceDate, to: toDate },
        totalPlans: Number(row?.totalPlans ?? 0),
        adjustedPlans: Number(row?.adjustedPlans ?? 0),
        avgPlanCalories: Number(row?.avgCalories) || 0,
        uniqueUsers: Number(row?.uniqueUsers ?? 0),
      };
    } catch (err) {
      this.logger.error(`获取计划覆盖统计失败: ${err}`);
      return {
        dateRange: { from: sinceDate, to: toDate },
        totalPlans: 0,
        adjustedPlans: 0,
        avgPlanCalories: 0,
        uniqueUsers: 0,
      };
    }
  }

  /**
   * 通用: 按指定字段分组计算接受率
   */
  private async getAcceptanceByField(
    field: 'goalType' | 'mealType',
    days: number,
  ): Promise<AcceptanceByDimension[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const columnMap = {
      goalType: 'goal_type',
      mealType: 'meal_type',
    };
    const column = columnMap[field];

    try {
      const rows: Array<{
        dimension: string;
        total: string;
        accepted: string;
      }> = await this.feedbackRepo.query(
        `SELECT
           ${column} as dimension,
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE action = 'accepted') as accepted
         FROM recommendation_feedbacks
         WHERE created_at >= $1
           AND ${column} IS NOT NULL
         GROUP BY ${column}
         ORDER BY total DESC`,
        [since],
      );

      return rows.map((r) => {
        const total = parseInt(r.total, 10);
        const accepted = parseInt(r.accepted, 10);
        return {
          dimension: r.dimension,
          total,
          accepted,
          rate: total > 0 ? accepted / total : 0,
        };
      });
    } catch (err) {
      this.logger.error(`获取 ${field} 接受率分布失败: ${err}`);
      return [];
    }
  }
}
