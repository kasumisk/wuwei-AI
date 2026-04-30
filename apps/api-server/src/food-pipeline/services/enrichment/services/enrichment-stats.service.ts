/**
 * EnrichmentStatsService
 *
 * 拆分自 food-enrichment.service.ts，负责补全统计与报表：
 *  - getEnrichmentStatistics    — AI 补全运维统计（含阶段覆盖率）
 *  - getStageStats              — 按阶段字段填充覆盖率（private）
 *  - getTaskOverview            — 全局任务总览（Dashboard 一屏）
 *  - getDashboardPoll           — 聚合轮询端点
 *  - getHistoryLogDiff          — 历史 change_log 字段级对比
 *  - getReviewStats             — 审核统计细粒度报表
 *  - validateCategoryConsistency — IQR 同类食物离群值检测
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

import {
  snakeToCamel,
  camelToSnake,
  JSON_ARRAY_FIELDS,
} from '../constants/enrichable-fields';
import { ENRICHMENT_STAGES } from '../constants/enrichment-stages';
import { NUTRIENT_RANGES } from '../constants/nutrient-ranges';
import {
  getFieldSqlRef,
  getFoodSplitFromSql,
  buildPresentFieldSqlCondition,
} from '../helpers/enrichment-sql.helper';
import { EnrichmentCompletenessService } from './enrichment-completeness.service';

@Injectable()
export class EnrichmentStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completenessService: EnrichmentCompletenessService,
  ) {}

  private getFieldSqlRef(field: string): string {
    return getFieldSqlRef(field);
  }

  private getFoodSplitFromSql(): string {
    return getFoodSplitFromSql();
  }

  private buildPresentFieldSqlCondition(field: string): string {
    return buildPresentFieldSqlCondition(field);
  }

  /**
   * 获取 AI 补全操作的运维统计数据
   */
  async getEnrichmentStatistics(): Promise<{
    total: number;
    directApplied: number;
    staged: number;
    approved: number;
    rejected: number;
    approvalRate: number;
    avgConfidence: number;
    dailyStats: Array<{
      date: string;
      count: number;
      action: string;
    }>;
    stageStats: Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
    }>;
  }> {
    const actions = [
      'ai_enrichment',
      'ai_enrichment_staged',
      'ai_enrichment_approved',
      'ai_enrichment_rejected',
    ];

    const countResult = await this.prisma.$queryRaw<
      Array<{ action: string; count: string }>
    >(
      Prisma.sql`SELECT action, COUNT(*)::text AS count
       FROM food_change_logs
       WHERE action = ANY(${actions})
       GROUP BY action`,
    );

    let directApplied = 0;
    let staged = 0;
    let approved = 0;
    let rejected = 0;

    for (const row of countResult) {
      const c = parseInt(row.count, 10);
      if (row.action === 'ai_enrichment') directApplied = c;
      else if (row.action === 'ai_enrichment_staged') staged = c;
      else if (row.action === 'ai_enrichment_approved') approved = c;
      else if (row.action === 'ai_enrichment_rejected') rejected = c;
    }

    const reviewedTotal = approved + rejected;
    const approvalRate =
      reviewedTotal > 0
        ? Math.round((approved / reviewedTotal) * 10000) / 100
        : 0;

    const avgConfResult = await this.prisma.$queryRaw<
      Array<{ avg_conf: string | null }>
    >(
      Prisma.sql`SELECT AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment', 'ai_enrichment_approved')
         AND changes->>'confidence' IS NOT NULL`,
    );
    const avgConfidence = avgConfResult[0]?.avg_conf
      ? Math.round(parseFloat(avgConfResult[0].avg_conf) * 100) / 100
      : 0;

    const dailyResult = await this.prisma.$queryRaw<
      Array<{ date: string; count: string; action: string }>
    >(
      Prisma.sql`SELECT
         TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
         action,
         COUNT(*)::text AS count
       FROM food_change_logs
       WHERE action = ANY(${actions})
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC, 2`,
    );

    const dailyStats = dailyResult.map((row) => ({
      date: row.date,
      count: parseInt(row.count, 10),
      action: row.action,
    }));

    return {
      total: directApplied + staged + approved + rejected,
      directApplied,
      staged,
      approved,
      rejected,
      approvalRate,
      avgConfidence,
      dailyStats,
      stageStats: await this.getStageStats(),
    };
  }

  /**
   * V8.1: 获取按阶段的补全成功率统计
   */
  private async getStageStats(): Promise<
    Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
    }>
  > {
    const totalFoods = await this.prisma.food.count();
    if (totalFoods === 0) {
      return ENRICHMENT_STAGES.map((stage) => ({
        stage: stage.stage,
        stageName: stage.name,
        totalFields: stage.fields.length,
        avgSuccessRate: 0,
      }));
    }

    const result: Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
    }> = [];

    for (const stage of ENRICHMENT_STAGES) {
      const conditions = stage.fields.map((f) =>
        (JSON_ARRAY_FIELDS as readonly string[]).includes(f)
          ? `AVG(CASE WHEN ${this.getFieldSqlRef(f)} IS NOT NULL AND ${this.getFieldSqlRef(f)}::text != '[]' THEN 1.0 ELSE 0.0 END)`
          : `AVG(CASE WHEN ${this.getFieldSqlRef(f)} IS NOT NULL THEN 1.0 ELSE 0.0 END)`,
      );
      const avgExpr = `(${conditions.join(' + ')}) / ${stage.fields.length}`;

      const row = await this.prisma.$queryRaw<[{ rate: string }]>(
        Prisma.sql`SELECT (${Prisma.raw(avgExpr)})::text AS rate
                   FROM foods
                   LEFT JOIN food_nutrition_details nd ON nd.food_id = foods.id
                   LEFT JOIN food_health_assessments ha ON ha.food_id = foods.id
                   LEFT JOIN food_taxonomies tx ON tx.food_id = foods.id
                   LEFT JOIN food_portion_guides pg ON pg.food_id = foods.id`,
      );

      const avgSuccessRate = row[0]?.rate
        ? Math.round(parseFloat(row[0].rate) * 10000) / 100
        : 0;

      result.push({
        stage: stage.stage,
        stageName: stage.name,
        totalFields: stage.fields.length,
        avgSuccessRate,
      });
    }

    return result;
  }

  /**
   * 获取全局补全任务视图
   */
  async getTaskOverview(): Promise<{
    pendingReview: number;
    totalFoods: number;
    completenessDistribution: {
      high: number;
      medium: number;
      low: number;
    };
    enrichmentStatusDistribution: Record<string, number>;
    topFailedFields: Array<{ field: string; count: number }>;
    recentTrend: Array<{ date: string; enriched: number; failed: number }>;
  }> {
    const pendingReview = await this.prisma.foodChangeLogs.count({
      where: { action: 'ai_enrichment_staged' },
    });

    const totalFoods = await this.prisma.food.count();

    const compDist = await this.prisma.$queryRaw<
      Array<{ bucket: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) >= 80 THEN 'high'
          WHEN COALESCE(data_completeness, 0) >= 40 THEN 'medium'
          ELSE 'low'
        END AS bucket,
        COUNT(*)::text AS cnt
      FROM foods GROUP BY 1`,
    );

    const completenessDistribution = { high: 0, medium: 0, low: 0 };
    for (const row of compDist) {
      const c = parseInt(row.cnt, 10);
      if (row.bucket === 'high') completenessDistribution.high = c;
      else if (row.bucket === 'medium') completenessDistribution.medium = c;
      else completenessDistribution.low = c;
    }

    const statusDist = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'none') AS status, COUNT(*)::text AS cnt
       FROM foods GROUP BY 1`,
    );

    const enrichmentStatusDistribution: Record<string, number> = {};
    for (const row of statusDist) {
      enrichmentStatusDistribution[row.status] = parseInt(row.cnt, 10);
    }

    const topFailedResult = await this.prisma.$queryRaw<
      Array<{ field: string; cnt: string }>
    >(
      Prisma.sql`SELECT field_name AS field, COUNT(DISTINCT food_id)::text AS cnt
       FROM food_field_provenance
       WHERE status = 'failed'
       GROUP BY field_name
       ORDER BY COUNT(DISTINCT food_id) DESC
       LIMIT 10`,
    );

    const topFailedFields = topFailedResult.map((row) => ({
      field: row.field,
      count: parseInt(row.cnt, 10),
    }));

    const trendResult = await this.prisma.$queryRaw<
      Array<{ date: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        CASE
          WHEN action IN ('ai_enrichment', 'ai_enrichment_approved', 'ai_enrichment_now') THEN 'enriched'
          ELSE 'failed'
        END AS action,
        COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment', 'ai_enrichment_approved', 'ai_enrichment_now', 'ai_enrichment_rejected')
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC`,
    );

    const trendMap: Record<string, { enriched: number; failed: number }> = {};
    for (const row of trendResult) {
      if (!trendMap[row.date]) trendMap[row.date] = { enriched: 0, failed: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'enriched') trendMap[row.date].enriched = c;
      else trendMap[row.date].failed = c;
    }

    const recentTrend = Object.entries(trendMap).map(([date, v]) => ({
      date,
      ...v,
    }));

    return {
      pendingReview,
      totalFoods,
      completenessDistribution,
      enrichmentStatusDistribution,
      topFailedFields,
      recentTrend,
    };
  }

  /**
   * getDashboardPoll
   * 聚合返回：历史统计 + 进度分布 + 最近10条任务 + 最近10条 change_log
   */
  async getDashboardPoll(queueSnapshot: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }): Promise<{
    queue: typeof queueSnapshot;
    historical: Awaited<
      ReturnType<EnrichmentCompletenessService['getEnrichmentHistoricalStats']>
    >;
    recentLogs: Array<{
      id: string;
      foodId: string;
      foodName: string | undefined;
      action: string;
      enrichedFields: string[];
      confidence: number | null;
      createdAt: Date;
    }>;
    pendingReview: number;
    avgCompleteness: number;
    byStatus: Record<string, number>;
  }> {
    const [historical, recentRaw, pendingReview] = await Promise.all([
      this.completenessService.getEnrichmentHistoricalStats(),
      this.prisma.foodChangeLogs.findMany({
        where: {
          action: {
            in: [
              'ai_enrichment',
              'ai_enrichment_staged',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({
        where: { action: 'ai_enrichment_staged' },
      }),
    ]);

    const recentLogs = recentRaw.map((log) => {
      const changes = log.changes as Record<string, any>;
      return {
        id: log.id,
        foodId: log.foodId,
        foodName: (log as any).foods?.name as string | undefined,
        action: log.action,
        enrichedFields: (changes.enrichedFields ?? []) as string[],
        confidence:
          changes.confidence != null ? Number(changes.confidence) : null,
        createdAt: log.createdAt,
      };
    });

    const statusRows = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS cnt FROM foods GROUP BY 1`,
    );
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) {
      byStatus[r.status] = parseInt(r.cnt, 10);
    }

    return {
      queue: queueSnapshot,
      historical,
      recentLogs,
      pendingReview,
      avgCompleteness: historical.avgCompleteness,
      byStatus,
    };
  }

  /**
   * getHistoryLogDiff
   * 对 action=ai_enrichment 的 change_log，返回"补全前 vs 补全后"字段级对比。
   */
  async getHistoryLogDiff(logId: string): Promise<{
    logId: string;
    foodId: string;
    foodName: string;
    action: string;
    operator: string | null;
    createdAt: Date;
    confidence: number | null;
    diff: Array<{
      field: string;
      enrichedValue: any;
      currentValue: any;
      isCurrent: boolean;
      fieldConfidence: number | null;
    }>;
    enrichedFields: string[];
    reasoning: string | null;
  }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
      include: { foods: { select: { id: true, name: true } } },
    });
    if (!log) throw new Error(`日志 ${logId} 不存在`);
    if (!['ai_enrichment', 'ai_enrichment_approved'].includes(log.action)) {
      throw new Error(
        `日志 ${log.action} 类型不支持对比（仅支持 ai_enrichment / ai_enrichment_approved）`,
      );
    }

    const changes = log.changes as Record<string, any>;
    const enrichedFields: string[] = changes.enrichedFields ?? [];
    const values: Record<string, any> = changes.values ?? {};
    const fieldConf: Record<string, number> = changes.fieldConfidence ?? {};
    const reasoning: string | null = changes.reasoning ?? null;
    const confidence =
      changes.confidence != null ? Number(changes.confidence) : null;

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
    });

    const diff = enrichedFields.map((field) => {
      const enrichedValue = values[field] ?? null;
      const currentValue = food
        ? ((food as any)[snakeToCamel(field)] ?? null)
        : null;
      const isCurrent =
        JSON.stringify(enrichedValue) === JSON.stringify(currentValue);
      return {
        field,
        enrichedValue,
        currentValue,
        isCurrent,
        fieldConfidence:
          fieldConf[field] != null ? Number(fieldConf[field]) : null,
      };
    });

    return {
      logId,
      foodId: log.foodId,
      foodName: (log as any).foods?.name ?? log.foodId,
      action: log.action,
      operator: log.operator,
      createdAt: log.createdAt,
      confidence,
      diff,
      enrichedFields,
      reasoning,
    };
  }

  /**
   * getReviewStats
   * 专注于"暂存审核"流程的细粒度报表
   */
  async getReviewStats(): Promise<{
    pendingReview: number;
    approved: number;
    rejected: number;
    reviewed: number;
    approvalRate: number;
    rejectionRate: number;
    avgConfidenceAll: number;
    avgConfidenceApproved: number;
    avgConfidenceRejected: number;
    confidenceBuckets: Array<{
      bucket: string;
      approved: number;
      rejected: number;
    }>;
    dailyTrend: Array<{
      date: string;
      approved: number;
      rejected: number;
    }>;
    pendingList: Array<{
      logId: string;
      foodId: string;
      foodName: string;
      enrichedFields: string[];
      confidence: number | null;
      createdAt: Date;
    }>;
  }> {
    const pendingReview = await this.prisma.foodChangeLogs.count({
      where: { action: 'ai_enrichment_staged' },
    });

    const countResult = await this.prisma.$queryRaw<
      Array<{ action: string; cnt: string }>
    >(
      Prisma.sql`SELECT action, COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
       GROUP BY action`,
    );

    let approved = 0;
    let rejected = 0;
    for (const row of countResult) {
      if (row.action === 'ai_enrichment_approved')
        approved = parseInt(row.cnt, 10);
      else if (row.action === 'ai_enrichment_rejected')
        rejected = parseInt(row.cnt, 10);
    }
    const reviewed = approved + rejected;
    const approvalRate =
      reviewed > 0 ? Math.round((approved / reviewed) * 10000) / 100 : 0;
    const rejectionRate =
      reviewed > 0 ? Math.round((rejected / reviewed) * 10000) / 100 : 0;

    const confResult = await this.prisma.$queryRaw<
      Array<{ action: string; avg_conf: string | null }>
    >(
      Prisma.sql`SELECT action, AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL
       GROUP BY action`,
    );

    let avgConfidenceApproved = 0;
    let avgConfidenceRejected = 0;
    for (const row of confResult) {
      const v = row.avg_conf
        ? Math.round(parseFloat(row.avg_conf) * 1000) / 1000
        : 0;
      if (row.action === 'ai_enrichment_approved') avgConfidenceApproved = v;
      else if (row.action === 'ai_enrichment_rejected')
        avgConfidenceRejected = v;
    }

    const allConfResult = await this.prisma.$queryRaw<
      Array<{ avg_conf: string | null }>
    >(
      Prisma.sql`SELECT AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL`,
    );
    const avgConfidenceAll = allConfResult[0]?.avg_conf
      ? Math.round(parseFloat(allConfResult[0].avg_conf) * 1000) / 1000
      : 0;

    const bucketResult = await this.prisma.$queryRaw<
      Array<{ bucket: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
         CASE
           WHEN (changes->>'confidence')::numeric < 0.2 THEN '0.0-0.2'
           WHEN (changes->>'confidence')::numeric < 0.4 THEN '0.2-0.4'
           WHEN (changes->>'confidence')::numeric < 0.6 THEN '0.4-0.6'
           WHEN (changes->>'confidence')::numeric < 0.8 THEN '0.6-0.8'
           ELSE '0.8-1.0'
         END AS bucket,
         action,
         COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 1`,
    );

    const bucketMap: Record<string, { approved: number; rejected: number }> = {
      '0.0-0.2': { approved: 0, rejected: 0 },
      '0.2-0.4': { approved: 0, rejected: 0 },
      '0.4-0.6': { approved: 0, rejected: 0 },
      '0.6-0.8': { approved: 0, rejected: 0 },
      '0.8-1.0': { approved: 0, rejected: 0 },
    };
    for (const row of bucketResult) {
      if (!bucketMap[row.bucket])
        bucketMap[row.bucket] = { approved: 0, rejected: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'ai_enrichment_approved')
        bucketMap[row.bucket].approved = c;
      else if (row.action === 'ai_enrichment_rejected')
        bucketMap[row.bucket].rejected = c;
    }
    const confidenceBuckets = Object.entries(bucketMap).map(([bucket, v]) => ({
      bucket,
      ...v,
    }));

    const trendResult = await this.prisma.$queryRaw<
      Array<{ date: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
         TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
         action,
         COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC`,
    );

    const trendMap: Record<string, { approved: number; rejected: number }> = {};
    for (const row of trendResult) {
      if (!trendMap[row.date])
        trendMap[row.date] = { approved: 0, rejected: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'ai_enrichment_approved')
        trendMap[row.date].approved = c;
      else trendMap[row.date].rejected = c;
    }
    const dailyTrend = Object.entries(trendMap).map(([date, v]) => ({
      date,
      ...v,
    }));

    const pendingRaw = await this.prisma.foodChangeLogs.findMany({
      where: { action: 'ai_enrichment_staged' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { foods: { select: { name: true } } },
    });

    const pendingList = pendingRaw.map((log) => {
      const changes = log.changes as Record<string, any>;
      return {
        logId: log.id,
        foodId: log.foodId,
        foodName: ((log as any).foods?.name ?? log.foodId) as string,
        enrichedFields: (changes.enrichedFields ?? []) as string[],
        confidence:
          changes.confidence != null ? Number(changes.confidence) : null,
        createdAt: log.createdAt,
      };
    });

    return {
      pendingReview,
      approved,
      rejected,
      reviewed,
      approvalRate,
      rejectionRate,
      avgConfidenceAll,
      avgConfidenceApproved,
      avgConfidenceRejected,
      confidenceBuckets,
      dailyTrend,
      pendingList,
    };
  }

  /**
   * validateCategoryConsistency
   * IQR 同类食物离群值检测
   */
  async validateCategoryConsistency(foodId: string): Promise<{
    foodId: string;
    foodName: string;
    category: string;
    outliers: Array<{
      field: string;
      value: number;
      q1: number;
      q3: number;
      iqr: number;
      lowerBound: number;
      upperBound: number;
      severity: 'warning' | 'critical';
    }>;
    peerCount: number;
  } | null> {
    const food = await this.prisma.food.findUnique({
      where: { id: foodId },
      include: {
        nutritionDetail: true,
        healthAssessment: true,
        portionGuide: true,
      },
    });
    if (!food || !food.category) return null;

    const countResult = await this.prisma.$queryRaw<[{ count: string }]>(
      Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE category = ${food.category} AND id != ${foodId}`,
    );
    const peerCount = parseInt(countResult[0]?.count ?? '0', 10);
    if (peerCount < 5) return null;

    const numericFields = Object.keys(NUTRIENT_RANGES).filter((f) => {
      const snakeField = camelToSnake(f);
      const fieldRef = this.getFieldSqlRef(snakeField);

      if (fieldRef.startsWith('nd.')) {
        return (food.nutritionDetail as any)?.[f] != null;
      }
      if (fieldRef.startsWith('ha.')) {
        return (food.healthAssessment as any)?.[f] != null;
      }
      if (fieldRef.startsWith('pg.')) {
        return (food.portionGuide as any)?.[f] != null;
      }
      return (food as any)[f] != null;
    });

    if (numericFields.length === 0)
      return {
        foodId,
        foodName: food.name,
        category: food.category,
        outliers: [],
        peerCount,
      };

    const selectParts = numericFields
      .map((f) => {
        const col = this.getFieldSqlRef(camelToSnake(f));
        return (
          `PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${col}) AS "${f}_q1", ` +
          `PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${col}) AS "${f}_q3"`
        );
      })
      .join(', ');

    const whereClause = numericFields
      .map((f) => this.buildPresentFieldSqlCondition(camelToSnake(f)))
      .join(' OR ');

    const iqrResult = await this.prisma.$queryRaw<Record<string, any>[]>(
      Prisma.sql`SELECT ${Prisma.raw(selectParts)} ${Prisma.raw(this.getFoodSplitFromSql())} WHERE foods.category = ${food.category} AND foods.id != ${foodId} AND (${Prisma.raw(whereClause)})`,
    );

    if (!iqrResult[0]) {
      return {
        foodId,
        foodName: food.name,
        category: food.category,
        outliers: [],
        peerCount,
      };
    }

    const outliers: Array<{
      field: string;
      value: number;
      q1: number;
      q3: number;
      iqr: number;
      lowerBound: number;
      upperBound: number;
      severity: 'warning' | 'critical';
    }> = [];

    for (const field of numericFields) {
      const snakeField = camelToSnake(field);
      const fieldRef = this.getFieldSqlRef(snakeField);
      const rawValue = fieldRef.startsWith('nd.')
        ? (food.nutritionDetail as any)?.[field]
        : fieldRef.startsWith('ha.')
          ? (food.healthAssessment as any)?.[field]
          : fieldRef.startsWith('pg.')
            ? (food.portionGuide as any)?.[field]
            : (food as any)[field];
      const value = parseFloat(rawValue);
      const q1 = parseFloat(iqrResult[0][`${field}_q1`]);
      const q3 = parseFloat(iqrResult[0][`${field}_q3`]);

      if (isNaN(q1) || isNaN(q3)) continue;

      const iqr = q3 - q1;
      if (iqr === 0) continue;

      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      if (value < lowerBound || value > upperBound) {
        const criticalLower = q1 - 3 * iqr;
        const criticalUpper = q3 + 3 * iqr;
        const severity =
          value < criticalLower || value > criticalUpper
            ? 'critical'
            : 'warning';

        outliers.push({
          field,
          value,
          q1: Math.round(q1 * 100) / 100,
          q3: Math.round(q3 * 100) / 100,
          iqr: Math.round(iqr * 100) / 100,
          lowerBound: Math.round(lowerBound * 100) / 100,
          upperBound: Math.round(upperBound * 100) / 100,
          severity,
        });
      }
    }

    return {
      foodId,
      foodName: food.name,
      category: food.category,
      outliers,
      peerCount,
    };
  }
}
