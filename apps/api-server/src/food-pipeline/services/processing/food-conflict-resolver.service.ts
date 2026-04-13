import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * 食物数据冲突自动解决服务
 * 规则:
 *   - 热量差异 < 5% → 取高优先级来源值
 *   - 热量差异 5-15% → 取加权平均
 *   - 热量差异 > 15% → 标记人工审核
 *   - 分类不一致 → 取高优先级来源
 *   - 过敏原差异 → 取并集（安全优先）
 */
@Injectable()
export class FoodConflictResolverService {
  private readonly logger = new Logger(FoodConflictResolverService.name);

  // 来源优先级 (值越大优先级越高)
  private readonly SOURCE_PRIORITY: Record<string, number> = {
    usda: 100,
    manual: 90,
    openfoodfacts: 70,
    ai: 50,
    crawl: 30,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检测并记录冲突
   */
  async detectConflicts(
    foodId: string,
    existingValues: Record<string, any>,
    incomingValues: Record<string, any>,
    incomingSource: string,
  ): Promise<any[]> {
    const conflicts: any[] = [];

    const numericFields = [
      'calories',
      'protein',
      'fat',
      'carbs',
      'fiber',
      'sugar',
      'sodium',
      'potassium',
      'calcium',
      'iron',
      'glycemicIndex',
      'processingLevel',
    ];

    for (const field of numericFields) {
      const oldVal = existingValues[field];
      const newVal = incomingValues[field];
      if (oldVal == null || newVal == null) continue;
      if (oldVal === newVal) continue;

      const diff = oldVal > 0 ? Math.abs(oldVal - newVal) / oldVal : 1;
      if (diff < 0.05) continue; // 差异小于5%忽略

      const existing = await this.prisma.foodConflicts.findFirst({
        where: { foodId: foodId, field, resolution: null },
      });
      if (existing) continue; // 已有未解决的冲突

      const conflict = await this.prisma.foodConflicts.create({
        data: {
          foodId: foodId,
          field,
          sources: [
            {
              source:
                existingValues.primarySource ||
                existingValues.primarySource ||
                'existing',
              value: oldVal,
            },
            { source: incomingSource, value: newVal },
          ],
        },
      });
      conflicts.push(conflict);
    }

    // 分类冲突
    if (
      existingValues.category &&
      incomingValues.category &&
      existingValues.category !== incomingValues.category
    ) {
      const existing = await this.prisma.foodConflicts.findFirst({
        where: { foodId: foodId, field: 'category', resolution: null },
      });
      if (!existing) {
        const conflict = await this.prisma.foodConflicts.create({
          data: {
            foodId: foodId,
            field: 'category',
            sources: [
              {
                source:
                  existingValues.primarySource ||
                  existingValues.primarySource ||
                  'existing',
                value: existingValues.category,
              },
              { source: incomingSource, value: incomingValues.category },
            ],
          },
        });
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  /**
   * 自动解决待处理冲突
   */
  async resolveAllPending(): Promise<{
    resolved: number;
    needsReview: number;
  }> {
    const pendingConflicts = await this.prisma.foodConflicts.findMany({
      where: { resolution: null },
      include: { foods: true },
    });

    let resolved = 0;
    let needsReview = 0;

    for (const conflict of pendingConflicts) {
      const result = this.autoResolve(conflict);
      if (result) {
        await this.prisma.foodConflicts.update({
          where: { id: conflict.id },
          data: {
            resolution: result.resolution,
            resolvedValue: result.resolvedValue,
            resolvedBy: 'auto_pipeline',
            resolvedAt: new Date(),
          },
        });

        // 更新食物数据
        if (result.resolution !== 'needs_review') {
          // Use raw SQL for dynamic field update since field names may be camelCase or snake_case
          const snakeField = this.toSnakeCase(conflict.field);
          await this.prisma.$executeRawUnsafe(
            `UPDATE foods SET "${snakeField}" = $1 WHERE id = $2::uuid`,
            result.resolvedValue,
            conflict.foodId,
          );
          resolved++;
        } else {
          needsReview++;
        }
      }
    }

    this.logger.log(
      `Conflict resolution: ${resolved} resolved, ${needsReview} need review`,
    );
    return { resolved, needsReview };
  }

  /**
   * Convert camelCase field name to snake_case for DB column.
   */
  private toSnakeCase(field: string): string {
    const mapping: Record<string, string> = {
      glycemicIndex: 'glycemic_index',
      glycemicLoad: 'glycemic_load',
      processingLevel: 'processing_level',
      saturatedFat: 'saturated_fat',
      transFat: 'trans_fat',
      vitaminA: 'vitamin_a',
      vitaminC: 'vitamin_c',
      vitaminD: 'vitamin_d',
      vitaminE: 'vitamin_e',
      vitaminB12: 'vitamin_b12',
      mainIngredient: 'main_ingredient',
      subCategory: 'sub_category',
      foodGroup: 'food_group',
      qualityScore: 'quality_score',
      satietyScore: 'satiety_score',
      nutrientDensity: 'nutrient_density',
      isProcessed: 'is_processed',
      isFried: 'is_fried',
      mealTypes: 'meal_types',
      imageUrl: 'image_url',
      thumbnailUrl: 'thumbnail_url',
      primarySource: 'primary_source',
      primarySourceId: 'primary_source_id',
      dataVersion: 'data_version',
      searchWeight: 'search_weight',
      standardServingG: 'standard_serving_g',
      standardServingDesc: 'standard_serving_desc',
      commonPortions: 'common_portions',
      isVerified: 'is_verified',
      verifiedBy: 'verified_by',
      verifiedAt: 'verified_at',
    };
    return mapping[field] || field;
  }

  /**
   * 单条自动解决逻辑
   */
  private autoResolve(conflict: any): {
    resolution: string;
    resolvedValue: string;
  } | null {
    const sources = conflict.sources as Array<{ source: string; value: any }>;
    if (!sources || sources.length < 2) return null;

    // 获取各来源优先级
    const sorted = [...sources].sort(
      (a, b) =>
        (this.SOURCE_PRIORITY[b.source] || 0) -
        (this.SOURCE_PRIORITY[a.source] || 0),
    );

    const highPriorityValue = sorted[0].value;
    const lowPriorityValue = sorted[sources.length - 1].value;

    // 过敏原特殊处理: 取并集
    if (conflict.field === 'allergens') {
      const union = [
        ...new Set(
          sources.flatMap((s) => (Array.isArray(s.value) ? s.value : [])),
        ),
      ];
      return {
        resolution: 'union_safety',
        resolvedValue: JSON.stringify(union),
      };
    }

    // 分类冲突: 取高优先级
    if (conflict.field === 'category') {
      return {
        resolution: 'highest_priority',
        resolvedValue: String(highPriorityValue),
      };
    }

    // 数值冲突
    if (
      typeof highPriorityValue === 'number' &&
      typeof lowPriorityValue === 'number'
    ) {
      const diff =
        highPriorityValue > 0
          ? Math.abs(highPriorityValue - lowPriorityValue) / highPriorityValue
          : 1;

      if (diff < 0.05) {
        // < 5%: 取高优先级
        return {
          resolution: 'highest_priority',
          resolvedValue: String(highPriorityValue),
        };
      } else if (diff <= 0.15) {
        // 5-15%: 加权平均
        const weights = sources.map(
          (s) => this.SOURCE_PRIORITY[s.source] || 50,
        );
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const weighted =
          sources.reduce(
            (sum, s, i) => sum + (Number(s.value) || 0) * weights[i],
            0,
          ) / totalWeight;
        return {
          resolution: 'weighted_average',
          resolvedValue: String(Math.round(weighted * 10) / 10),
        };
      } else {
        // > 15%: 需人工审核
        return {
          resolution: 'needs_review',
          resolvedValue: String(highPriorityValue),
        };
      }
    }

    return {
      resolution: 'highest_priority',
      resolvedValue: String(highPriorityValue),
    };
  }
}
