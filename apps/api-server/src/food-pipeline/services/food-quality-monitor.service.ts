import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface QualityReport {
  timestamp: Date;
  totalFoods: number;
  byStatus: Record<string, number>;
  byCategory: Array<{ category: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  completeness: {
    total: number;
    withProtein: number;
    withMicronutrients: number;
    withGI: number;
    withAllergens: number;
    withCompatibility: number;
    withTags: number;
    withImage: number;
  };
  quality: {
    verified: number;
    unverified: number;
    avgConfidence: number;
    lowConfidence: number; // confidence < 0.6
    macroInconsistent: number; // 宏量营养素不一致
  };
  conflicts: {
    total: number;
    pending: number;
    resolved: number;
    needsReview: number;
  };
  translations: {
    total: number;
    locales: Array<{ locale: string; count: number }>;
    foodsWithTranslation: number;
    foodsWithoutTranslation: number;
  };
  recentChanges: number; // 最近7天变更数
  /** V7.9: AI 补全统计 */
  enrichment: {
    /** 直接入库的补全次数 */
    directApplied: number;
    /** 暂存待审核次数 */
    staged: number;
    /** 已审核通过次数 */
    approved: number;
    /** 已审核拒绝次数 */
    rejected: number;
    /** 核心营养素覆盖率(%) */
    coreCoverage: number;
    /** 微量营养素覆盖率(%) */
    microCoverage: number;
  };
  /** V8.0: 字段级完整度统计 */
  fieldCompleteness: Array<{
    field: string;
    filledCount: number;
    totalCount: number;
    percentage: number;
  }>;
  /** V8.0: 补全覆盖率趋势（近30天，按天聚合） */
  enrichmentTrend: Array<{
    date: string;
    enrichedCount: number;
    approvedCount: number;
    rejectedCount: number;
  }>;
}

/**
 * 食物数据质量监控服务 (Phase 3)
 */
@Injectable()
export class FoodQualityMonitorService {
  private readonly logger = new Logger(FoodQualityMonitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成完整质量报告
   */
  async generateReport(): Promise<QualityReport> {
    const [
      totalFoods,
      byStatus,
      byCategory,
      bySource,
      completeness,
      quality,
      conflicts,
      translations,
      recentChanges,
      enrichment,
      fieldCompleteness,
      enrichmentTrend,
    ] = await Promise.all([
      this.prisma.foods.count(),
      this.getByStatus(),
      this.getByCategory(),
      this.getBySource(),
      this.getCompleteness(),
      this.getQuality(),
      this.getConflicts(),
      this.getTranslations(),
      this.getRecentChanges(),
      this.getEnrichmentStats(),
      this.getFieldCompleteness(),
      this.getEnrichmentTrend(),
    ]);

    return {
      timestamp: new Date(),
      totalFoods,
      byStatus,
      byCategory,
      bySource,
      completeness,
      quality,
      conflicts,
      translations,
      recentChanges,
      enrichment,
      fieldCompleteness,
      enrichmentTrend,
    };
  }

  private async getByStatus(): Promise<Record<string, number>> {
    const result = await this.prisma.$queryRaw<
      Array<{ status: string; count: number }>
    >(
      Prisma.sql`SELECT status, COUNT(*)::int as count FROM foods GROUP BY status`,
    );
    return Object.fromEntries(result.map((r) => [r.status, r.count]));
  }

  private async getByCategory() {
    const result = await this.prisma.$queryRaw<
      Array<{ category: string; count: number }>
    >(
      Prisma.sql`SELECT category, COUNT(*)::int as count FROM foods GROUP BY category`,
    );
    return result.map((x) => ({ category: x.category, count: x.count }));
  }

  private async getBySource() {
    const result = await this.prisma.$queryRaw<
      Array<{ source: string; count: number }>
    >(
      Prisma.sql`SELECT primary_source as source, COUNT(*)::int as count FROM foods GROUP BY primary_source`,
    );
    return result.map((x) => ({ source: x.source, count: x.count }));
  }

  private async getCompleteness() {
    const total = await this.prisma.foods.count();

    const [
      withProtein,
      withMicro,
      withGI,
      withAllergens,
      withCompat,
      withTags,
      withImage,
    ] = await Promise.all([
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE protein IS NOT NULL`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE vitamin_a IS NOT NULL OR vitamin_c IS NOT NULL OR calcium IS NOT NULL`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE glycemic_index IS NOT NULL`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE allergens IS NOT NULL AND allergens != '[]'::jsonb`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE compatibility IS NOT NULL AND compatibility != '{}'::jsonb`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE tags IS NOT NULL AND tags != '[]'::jsonb AND jsonb_array_length(tags) > 0`)
        .then((r) => r[0].count),
      this.prisma
        .$queryRaw<
          [{ count: number }]
        >(Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE image_url IS NOT NULL`)
        .then((r) => r[0].count),
    ]);

    return {
      total,
      withProtein,
      withMicronutrients: withMicro,
      withGI,
      withAllergens,
      withCompatibility: withCompat,
      withTags,
      withImage,
    };
  }

  private async getQuality() {
    const [verified, unverified] = await Promise.all([
      this.prisma.foods.count({ where: { is_verified: true } }),
      this.prisma.foods.count({ where: { is_verified: false } }),
    ]);

    const avgConf = await this.prisma.$queryRaw<[{ avg: number | null }]>(
      Prisma.sql`SELECT AVG(confidence) as avg FROM foods`,
    );

    const lowConfResult = await this.prisma.$queryRaw<[{ count: number }]>(
      Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE confidence < 0.6`,
    );

    // 宏量营养素不一致检查
    const macroResult = await this.prisma.$queryRaw<[{ count: number }]>(
      Prisma.sql`SELECT COUNT(*)::int as count FROM foods WHERE protein IS NOT NULL AND fat IS NOT NULL AND carbs IS NOT NULL AND ABS(calories - (protein * 4 + carbs * 4 + fat * 9)) / NULLIF(calories, 0) > 0.15`,
    );

    return {
      verified,
      unverified,
      avgConfidence: Math.round((avgConf[0]?.avg || 0) * 100) / 100,
      lowConfidence: lowConfResult[0].count,
      macroInconsistent: macroResult[0].count,
    };
  }

  private async getConflicts() {
    const [total, pending, resolved, needsReview] = await Promise.all([
      this.prisma.food_conflicts.count(),
      this.prisma.food_conflicts.count({ where: { resolution: null } }),
      this.prisma.food_conflicts.count({
        where: { resolution: { not: null } },
      }),
      this.prisma.food_conflicts.count({
        where: { resolution: 'needs_review' },
      }),
    ]);
    return { total, pending, resolved, needsReview };
  }

  private async getTranslations() {
    const total = await this.prisma.food_translations.count();

    const locales = await this.prisma.$queryRaw<
      Array<{ locale: string; count: number }>
    >(
      Prisma.sql`SELECT locale, COUNT(*)::int as count FROM food_translations GROUP BY locale`,
    );

    const withTranslation = await this.prisma.$queryRaw<[{ count: number }]>(
      Prisma.sql`SELECT COUNT(DISTINCT food_id)::int as count FROM food_translations`,
    );

    const totalFoods = await this.prisma.foods.count();
    const foodsWithTranslation = withTranslation[0]?.count || 0;

    return {
      total,
      locales: locales.map((x) => ({ locale: x.locale, count: x.count })),
      foodsWithTranslation,
      foodsWithoutTranslation: totalFoods - foodsWithTranslation,
    };
  }

  private async getRecentChanges() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return this.prisma.food_change_logs.count({
      where: {
        created_at: { gte: sevenDaysAgo },
      },
    });
  }

  // ─── V7.9: AI 补全统计 ────────────────────────────────────────────────

  private async getEnrichmentStats(): Promise<QualityReport['enrichment']> {
    // 按 action 统计补全操作次数
    const actionCounts = await this.prisma.$queryRaw<
      Array<{ action: string; count: number }>
    >(
      Prisma.sql`SELECT action, COUNT(*)::int AS count
                 FROM food_change_logs
                 WHERE action IN ('ai_enrichment', 'ai_enrichment_staged', 'ai_enrichment_approved', 'ai_enrichment_rejected')
                 GROUP BY action`,
    );

    let directApplied = 0;
    let staged = 0;
    let approved = 0;
    let rejected = 0;
    for (const row of actionCounts) {
      if (row.action === 'ai_enrichment') directApplied = row.count;
      else if (row.action === 'ai_enrichment_staged') staged = row.count;
      else if (row.action === 'ai_enrichment_approved') approved = row.count;
      else if (row.action === 'ai_enrichment_rejected') rejected = row.count;
    }

    // 核心营养素覆盖率（6 个字段全部非 NULL 的食物占比）
    const totalFoods = await this.prisma.foods.count();
    const coreResult = await this.prisma.$queryRaw<[{ count: number }]>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM foods
                 WHERE protein IS NOT NULL AND fat IS NOT NULL AND carbs IS NOT NULL
                   AND fiber IS NOT NULL AND sugar IS NOT NULL AND sodium IS NOT NULL`,
    );
    const coreCoverage =
      totalFoods > 0 ? Math.round((coreResult[0].count / totalFoods) * 100) : 0;

    // 微量营养素覆盖率（至少 10 个微量元素非 NULL 的食物占比）
    const microResult = await this.prisma.$queryRaw<[{ count: number }]>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM foods
                 WHERE (
                   CASE WHEN calcium IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN iron IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN potassium IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN vitamin_a IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN vitamin_c IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN vitamin_d IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN vitamin_e IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN vitamin_b12 IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN folate IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN zinc IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN magnesium IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN phosphorus IS NOT NULL THEN 1 ELSE 0 END
                 ) >= 10`,
    );
    const microCoverage =
      totalFoods > 0
        ? Math.round((microResult[0].count / totalFoods) * 100)
        : 0;

    return {
      directApplied,
      staged,
      approved,
      rejected,
      coreCoverage,
      microCoverage,
    };
  }

  // ─── V8.0 P3-B: 字段级完整度统计 ──────────────────────────────────────

  /**
   * 统计每个关键营养素字段的填充率
   * 返回各字段的 filledCount / totalCount / percentage
   */
  private async getFieldCompleteness(): Promise<
    QualityReport['fieldCompleteness']
  > {
    // 需要统计完整度的关键字段列表
    const fields = [
      'protein',
      'fat',
      'carbs',
      'fiber',
      'sugar',
      'sodium',
      'calcium',
      'iron',
      'potassium',
      'vitamin_a',
      'vitamin_c',
      'vitamin_d',
      'vitamin_e',
      'vitamin_b12',
      'folate',
      'zinc',
      'magnesium',
      'phosphorus',
      'glycemic_index',
      'glycemic_load',
      'saturated_fat',
      'trans_fat',
      'cholesterol',
    ];

    // 单条 SQL 聚合所有字段的非 NULL 计数
    const result = await this.prisma.$queryRaw<
      [Record<string, number>]
    >(Prisma.sql`SELECT
        COUNT(*)::int AS total,
        COUNT(protein)::int AS protein,
        COUNT(fat)::int AS fat,
        COUNT(carbs)::int AS carbs,
        COUNT(fiber)::int AS fiber,
        COUNT(sugar)::int AS sugar,
        COUNT(sodium)::int AS sodium,
        COUNT(calcium)::int AS calcium,
        COUNT(iron)::int AS iron,
        COUNT(potassium)::int AS potassium,
        COUNT(vitamin_a)::int AS vitamin_a,
        COUNT(vitamin_c)::int AS vitamin_c,
        COUNT(vitamin_d)::int AS vitamin_d,
        COUNT(vitamin_e)::int AS vitamin_e,
        COUNT(vitamin_b12)::int AS vitamin_b12,
        COUNT(folate)::int AS folate,
        COUNT(zinc)::int AS zinc,
        COUNT(magnesium)::int AS magnesium,
        COUNT(phosphorus)::int AS phosphorus,
        COUNT(glycemic_index)::int AS glycemic_index,
        COUNT(glycemic_load)::int AS glycemic_load,
        COUNT(saturated_fat)::int AS saturated_fat,
        COUNT(trans_fat)::int AS trans_fat,
        COUNT(cholesterol)::int AS cholesterol
      FROM foods`);

    const row = result[0];
    const total = row.total ?? 0;

    return fields.map((field) => {
      const filledCount = row[field] ?? 0;
      return {
        field,
        filledCount,
        totalCount: total,
        percentage:
          total > 0 ? Math.round((filledCount / total) * 10000) / 100 : 0,
      };
    });
  }

  // ─── V8.0 P3-B: 补全覆盖率趋势（近30天） ─────────────────────────────

  /**
   * 按天聚合近30天的补全操作数据，用于趋势图展示
   * 包含：每日补全入库数、审核通过数、审核拒绝数
   */
  private async getEnrichmentTrend(): Promise<
    QualityReport['enrichmentTrend']
  > {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.prisma.$queryRaw<
      Array<{
        date: string;
        enriched_count: number;
        approved_count: number;
        rejected_count: number;
      }>
    >(Prisma.sql`SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        COUNT(*) FILTER (WHERE action IN ('ai_enrichment', 'ai_enrichment_staged'))::int AS enriched_count,
        COUNT(*) FILTER (WHERE action = 'ai_enrichment_approved')::int AS approved_count,
        COUNT(*) FILTER (WHERE action = 'ai_enrichment_rejected')::int AS rejected_count
      FROM food_change_logs
      WHERE created_at >= ${thirtyDaysAgo}
        AND action IN ('ai_enrichment', 'ai_enrichment_staged', 'ai_enrichment_approved', 'ai_enrichment_rejected')
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date`);

    return result.map((r) => ({
      date: r.date,
      enrichedCount: r.enriched_count,
      approvedCount: r.approved_count,
      rejectedCount: r.rejected_count,
    }));
  }
}
