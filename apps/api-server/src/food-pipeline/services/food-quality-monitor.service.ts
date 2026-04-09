import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { FoodLibrary } from '../../modules/food/entities/food-library.entity';
import { FoodConflict } from '../../modules/food/entities/food-conflict.entity';
import { FoodChangeLog } from '../../modules/food/entities/food-change-log.entity';
import { FoodTranslation } from '../../modules/food/entities/food-translation.entity';
import { FoodSource } from '../../modules/food/entities/food-source.entity';

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

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodConflict)
    private readonly conflictRepo: Repository<FoodConflict>,
    @InjectRepository(FoodChangeLog)
    private readonly changeLogRepo: Repository<FoodChangeLog>,
    @InjectRepository(FoodTranslation)
    private readonly translationRepo: Repository<FoodTranslation>,
    @InjectRepository(FoodSource)
    private readonly sourceRepo: Repository<FoodSource>,
  ) {}

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
      this.foodRepo.count(),
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
    const result = await this.foodRepo
      .createQueryBuilder('f')
      .select('f.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.status')
      .getRawMany();
    return Object.fromEntries(result.map((r) => [r.status, Number(r.count)]));
  }

  private async getByCategory() {
    return this.foodRepo
      .createQueryBuilder('f')
      .select('f.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.category')
      .getRawMany()
      .then((r) =>
        r.map((x) => ({ category: x.category, count: Number(x.count) })),
      );
  }

  private async getBySource() {
    return this.foodRepo
      .createQueryBuilder('f')
      .select('f.primarySource', 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.primarySource')
      .getRawMany()
      .then((r) =>
        r.map((x) => ({ source: x.source, count: Number(x.count) })),
      );
  }

  private async getCompleteness() {
    const total = await this.foodRepo.count();
    const [
      withProtein,
      withMicro,
      withGI,
      withAllergens,
      withCompat,
      withTags,
      withImage,
    ] = await Promise.all([
      this.foodRepo
        .createQueryBuilder('f')
        .where('f.protein IS NOT NULL')
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where(
          'f.vitaminA IS NOT NULL OR f.vitaminC IS NOT NULL OR f.calcium IS NOT NULL',
        )
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where('f.glycemicIndex IS NOT NULL')
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where("f.allergens IS NOT NULL AND f.allergens != '[]'::jsonb")
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where("f.compatibility IS NOT NULL AND f.compatibility != '{}'::jsonb")
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where(
          "f.tags IS NOT NULL AND f.tags != '[]'::jsonb AND jsonb_array_length(f.tags) > 0",
        )
        .getCount(),
      this.foodRepo
        .createQueryBuilder('f')
        .where('f.imageUrl IS NOT NULL')
        .getCount(),
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
      this.foodRepo.count({ where: { isVerified: true } }),
      this.foodRepo.count({ where: { isVerified: false } }),
    ]);

    const avgConf = await this.foodRepo
      .createQueryBuilder('f')
      .select('AVG(f.confidence)', 'avg')
      .getRawOne();

    const lowConfidence = await this.foodRepo
      .createQueryBuilder('f')
      .where('f.confidence < 0.6')
      .getCount();

    // 宏量营养素不一致检查
    const macroInconsistent = await this.foodRepo
      .createQueryBuilder('f')
      .where(
        'f.protein IS NOT NULL AND f.fat IS NOT NULL AND f.carbs IS NOT NULL',
      )
      .andWhere(
        `ABS(f.calories - (f.protein * 4 + f.carbs * 4 + f.fat * 9)) / NULLIF(f.calories, 0) > 0.15`,
      )
      .getCount();

    return {
      verified,
      unverified,
      avgConfidence: Math.round((avgConf?.avg || 0) * 100) / 100,
      lowConfidence,
      macroInconsistent,
    };
  }

  private async getConflicts() {
    const [total, pending, resolved, needsReview] = await Promise.all([
      this.conflictRepo.count(),
      this.conflictRepo.count({ where: { resolution: IsNull() } }),
      this.conflictRepo.count({ where: { resolution: Not(IsNull()) } }),
      this.conflictRepo.count({ where: { resolution: 'needs_review' } }),
    ]);
    return { total, pending, resolved, needsReview };
  }

  private async getTranslations() {
    const total = await this.translationRepo.count();

    const locales = await this.translationRepo
      .createQueryBuilder('t')
      .select('t.locale', 'locale')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.locale')
      .getRawMany()
      .then((r) =>
        r.map((x) => ({ locale: x.locale, count: Number(x.count) })),
      );

    const withTranslation = await this.translationRepo
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.foodId)', 'count')
      .getRawOne();

    const totalFoods = await this.foodRepo.count();
    const foodsWithTranslation = Number(withTranslation?.count || 0);

    return {
      total,
      locales,
      foodsWithTranslation,
      foodsWithoutTranslation: totalFoods - foodsWithTranslation,
    };
  }

  private async getRecentChanges() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return this.changeLogRepo
      .createQueryBuilder('cl')
      .where('cl.createdAt >= :since', { since: sevenDaysAgo })
      .getCount();
  }
}
