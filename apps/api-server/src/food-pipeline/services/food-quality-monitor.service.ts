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
}
