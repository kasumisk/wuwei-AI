import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  UsdaFetcherService,
  NormalizedFoodData,
  ImportMetadata,
} from './usda-fetcher.service';
import { OpenFoodFactsService } from './openfoodfacts.service';
import {
  FoodDataCleanerService,
  CleanedFoodData,
} from './food-data-cleaner.service';
import { FoodRuleEngineService } from './food-rule-engine.service';
import { FoodAiLabelService } from './food-ai-label.service';
import { FoodAiTranslateService } from './food-ai-translate.service';
import { FoodDedupService } from './food-dedup.service';
import { FoodConflictResolverService } from './food-conflict-resolver.service';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: string[];
}

/**
 * 食物数据管道编排服务
 * 串联: 采集 → 清洗 → 标准化 → 去重 → AI标注 → 规则计算 → 校验 → 入库 → 翻译
 */
@Injectable()
export class FoodPipelineOrchestratorService {
  private readonly logger = new Logger(FoodPipelineOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usdaFetcher: UsdaFetcherService,
    private readonly offService: OpenFoodFactsService,
    private readonly cleaner: FoodDataCleanerService,
    private readonly ruleEngine: FoodRuleEngineService,
    private readonly aiLabel: FoodAiLabelService,
    private readonly aiTranslate: FoodAiTranslateService,
    private readonly dedup: FoodDedupService,
    private readonly conflictResolver: FoodConflictResolverService,
  ) {}

  // ==================== USDA 批量导入 ====================

  async importFromUsda(query: string, maxItems = 100): Promise<ImportResult> {
    this.logger.log(`Starting USDA import: query="${query}", max=${maxItems}`);
    const result: ImportResult = {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    try {
      const pageSize = Math.min(maxItems, 200);
      const searchResult = await this.usdaFetcher.search(query, pageSize);
      const rawFoods = searchResult.foods.slice(0, maxItems);

      result.total = rawFoods.length;
      this.logger.log(`Fetched ${rawFoods.length} foods from USDA`);

      // 清洗
      const { cleaned, discarded } = this.cleaner.cleanBatch(rawFoods);
      result.skipped += discarded;
      result.details.push(
        `Cleaned: ${cleaned.length}, discarded: ${discarded}`,
      );

      // 逐条入库
      for (const food of cleaned) {
        try {
          await this.persistSingleFood(food, result);
        } catch (e) {
          result.errors++;
          result.details.push(`Error: ${food.name} - ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`USDA import failed: ${e.message}`);
      result.details.push(`Import error: ${e.message}`);
    }

    this.logger.log(
      `USDA import done: created=${result.created}, updated=${result.updated}, errors=${result.errors}`,
    );
    return result;
  }

  // ==================== 条形码查询导入 ====================

  async importByBarcode(barcode: string) {
    const normalized = await this.offService.getByBarcode(barcode);
    if (!normalized) return null;

    const cleaned = this.cleaner.clean(normalized);
    if (!cleaned) return null;

    const result: ImportResult = {
      total: 1,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };
    await this.persistSingleFood(cleaned, result);

    if (result.created > 0 || result.updated > 0) {
      return this.prisma.foods.findFirst({ where: { barcode } });
    }
    return null;
  }

  async importNormalizedFoods(
    normalizedFoods: NormalizedFoodData[],
    sourceLabel = 'custom',
  ): Promise<ImportResult> {
    this.logger.log(
      `Starting normalized import: source=${sourceLabel}, total=${normalizedFoods.length}`,
    );

    const result: ImportResult = {
      total: normalizedFoods.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    const { cleaned, discarded } = this.cleaner.cleanBatch(normalizedFoods);
    result.skipped += discarded;
    result.details.push(
      `Cleaned: ${cleaned.length}, discarded: ${discarded}, source=${sourceLabel}`,
    );

    for (const food of cleaned) {
      try {
        await this.persistSingleFood(food, result);
      } catch (e) {
        result.errors++;
        result.details.push(`Error: ${food.name} - ${e.message}`);
      }
    }

    this.logger.log(
      `Normalized import done: source=${sourceLabel}, created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}`,
    );

    return result;
  }

  // ==================== 批量 AI 标注 ====================

  async batchAiLabel(
    options: { category?: string; unlabeled?: boolean; limit?: number } = {},
  ): Promise<{
    labeled: number;
    failed: number;
  }> {
    const where: Prisma.foodsWhereInput = {};

    if (options.category) {
      where.category = options.category;
    }
    if (options.unlabeled) {
      where.OR = [
        { tags: { equals: Prisma.DbNull } },
        { tags: { equals: [] } },
      ];
    }

    const foods = await this.prisma.foods.findMany({
      where,
      take: options.limit || 100,
    });
    this.logger.log(`AI labeling ${foods.length} foods`);

    const labelResults = await this.aiLabel.labelBatch(foods as any);
    let labeled = 0;
    let failed = 0;

    for (const [idx, labelResult] of labelResults) {
      const food = foods[idx];
      if (!food) continue;

      try {
        const update: Record<string, any> = {};
        if (!food.category && labelResult.category)
          update.category = labelResult.category;
        if (!food.sub_category) update.sub_category = labelResult.subCategory;
        if (!food.food_group) update.food_group = labelResult.foodGroup;
        if (!food.main_ingredient)
          update.main_ingredient = labelResult.mainIngredient;
        if (!food.processing_level)
          update.processing_level = labelResult.processingLevel;
        if (!(food.meal_types as any[])?.length)
          update.meal_types = labelResult.mealTypes;
        if (!(food.allergens as any[])?.length)
          update.allergens = labelResult.allergens;
        if (
          !food.compatibility ||
          !Object.keys(food.compatibility as object).length
        ) {
          update.compatibility = labelResult.compatibility;
        }

        // 合并标签
        const existingTags = (food.tags as any[]) || [];
        update.tags = [...new Set([...existingTags, ...labelResult.tags])];

        if (Object.keys(update).length > 0) {
          await this.prisma.foods.update({
            where: { id: food.id },
            data: update,
          });
          await this.logChange(
            food.id,
            food.data_version,
            'update',
            update,
            'ai_label',
          );
          labeled++;
        }
      } catch (e) {
        failed++;
      }
    }

    // 利用标注结果重新计算分数
    for (const food of foods) {
      const updated = await this.prisma.foods.findUnique({
        where: { id: food.id },
      });
      if (updated) {
        const scores = this.ruleEngine.applyAllRules(updated as any);
        await this.prisma.foods.update({
          where: { id: food.id },
          data: {
            quality_score: scores.qualityScore,
            satiety_score: scores.satietyScore,
            nutrient_density: scores.nutrientDensity,
            tags: [
              ...new Set([...((updated.tags as any[]) || []), ...scores.tags]),
            ],
          },
        });
      }
    }

    return { labeled, failed };
  }

  // ==================== 批量 AI 翻译 ====================

  async batchAiTranslate(options: {
    targetLocale: string;
    limit?: number;
    untranslatedOnly?: boolean;
  }): Promise<{ translated: number; failed: number }> {
    let where: Prisma.foodsWhereInput = {};

    if (options.untranslatedOnly) {
      where = {
        food_translations: {
          none: { locale: options.targetLocale },
        },
      };
    }

    const foods = await this.prisma.foods.findMany({
      where,
      take: options.limit || 100,
    });
    this.logger.log(
      `AI translating ${foods.length} foods to ${options.targetLocale}`,
    );

    const results = await this.aiTranslate.translateBatch(
      foods as any,
      options.targetLocale,
    );
    let translated = 0;
    let failed = 0;

    for (const [idx, result] of results) {
      const food = foods[idx];
      if (!food || !result.name) {
        failed++;
        continue;
      }

      try {
        await this.prisma.food_translations.upsert({
          where: {
            food_id_locale: {
              food_id: food.id,
              locale: result.locale,
            },
          },
          create: {
            food_id: food.id,
            locale: result.locale,
            name: result.name,
            aliases: result.aliases,
            description: result.description,
            serving_desc: result.servingDesc,
          },
          update: {
            name: result.name,
            aliases: result.aliases,
            description: result.description,
            serving_desc: result.servingDesc,
          },
        });
        translated++;
      } catch (e) {
        failed++;
      }
    }

    return { translated, failed };
  }

  // ==================== 批量规则计算 ====================

  async batchApplyRules(
    options: { limit?: number; recalcAll?: boolean } = {},
  ): Promise<{ processed: number }> {
    let where: Prisma.foodsWhereInput = {};
    if (!options.recalcAll) {
      where = {
        OR: [{ quality_score: null }, { satiety_score: null }],
      };
    }

    const foods = await this.prisma.foods.findMany({
      where,
      take: options.limit || 500,
    });
    let processed = 0;

    for (const food of foods) {
      const scores = this.ruleEngine.applyAllRules(food as any);
      const existingTags = (food.tags as any[]) || [];
      await this.prisma.foods.update({
        where: { id: food.id },
        data: {
          quality_score: scores.qualityScore,
          satiety_score: scores.satietyScore,
          nutrient_density: scores.nutrientDensity,
          tags: [...new Set([...existingTags, ...scores.tags])],
        },
      });
      processed++;
    }

    return { processed };
  }

  // ==================== 冲突解决 ====================

  async resolveAllConflicts() {
    return this.conflictResolver.resolveAllPending();
  }

  // ==================== 内部方法 ====================

  private async persistSingleFood(food: CleanedFoodData, result: ImportResult) {
    const directives = this.resolveImportMetadata(food.importMetadata);

    // 去重检查
    const dup = await this.dedup.findDuplicate(food);

    if (dup) {
      const mergedFields = this.dedup.mergeFood(
        dup.existingFood,
        food,
        this.getSourcePriority(food.primarySource),
      );
      const combinedTags = [
        ...((dup.existingFood.tags as any[]) || []),
        ...(food.tags || []),
        ...directives.extraTags,
      ];
      const scores = this.ruleEngine.applyAllRules({
        ...dup.existingFood,
        ...mergedFields,
        tags: [...new Set(combinedTags)],
      });

      // Map camelCase mergedFields to snake_case for Prisma update
      const prismaData = this.mapToSnakeCase({
        ...mergedFields,
        dataVersion: dup.existingFood.data_version + 1,
        ...scores,
        tags: [
          ...new Set([
            ...((mergedFields as any).tags || []),
            ...combinedTags,
            ...(scores.tags || []),
          ]),
        ],
      });

      await this.prisma.foods.update({
        where: { id: dup.existingFood.id },
        data: prismaData,
      });

      await this.saveSource(dup.existingFood.id, food);
      await this.conflictResolver.detectConflicts(
        dup.existingFood.id,
        dup.existingFood,
        food,
        food.primarySource,
      );

      await this.logChange(
        dup.existingFood.id,
        dup.existingFood.data_version + 1,
        'update',
        mergedFields,
        directives.operator,
      );
      result.updated++;
    } else {
      // 新增
      const scores = this.ruleEngine.applyAllRules(food);
      const code = food.code || (await this.generateCode());
      const tags = [
        ...new Set([
          ...(food.tags || []),
          ...directives.extraTags,
          ...scores.tags,
        ]),
      ];

      const saved = await this.prisma.foods.create({
        data: {
          code,
          name: food.name,
          aliases: food.aliases,
          category: (food.category || 'composite') as any,
          sub_category: food.subCategory,
          food_group: food.foodGroup,
          status: directives.status as any,
          calories: food.calories,
          protein: food.protein,
          fat: food.fat,
          carbs: food.carbs,
          fiber: food.fiber,
          sugar: food.sugar,
          saturated_fat: food.saturatedFat,
          trans_fat: food.transFat,
          cholesterol: food.cholesterol,
          sodium: food.sodium,
          potassium: food.potassium,
          calcium: food.calcium,
          iron: food.iron,
          vitamin_a: food.vitaminA,
          vitamin_c: food.vitaminC,
          vitamin_d: food.vitaminD,
          vitamin_e: food.vitaminE,
          vitamin_b12: food.vitaminB12,
          folate: food.folate,
          zinc: food.zinc,
          magnesium: food.magnesium,
          phosphorus: food.phosphorus,
          glycemic_index: food.glycemicIndex,
          glycemic_load: food.glycemicLoad,
          is_processed: food.isProcessed ?? false,
          is_fried: food.isFried ?? false,
          processing_level: food.processingLevel ?? 1,
          allergens: food.allergens || [],
          meal_types: food.mealTypes || [],
          main_ingredient: food.mainIngredient,
          compatibility: food.compatibility || {},
          standard_serving_g: food.standardServingG ?? 100,
          standard_serving_desc: food.standardServingDesc,
          common_portions: food.commonPortions || [],
          search_weight: food.searchWeight ?? directives.searchWeight,
          barcode: food.barcode || food.rawPayload?.code || undefined,
          primary_source: food.primarySource,
          primary_source_id: food.primarySourceId,
          confidence: food.confidence,
          data_version: 1,
          is_verified: directives.isVerified,
          verified_by: directives.isVerified
            ? directives.verifiedBy
            : undefined,
          verified_at: directives.isVerified ? new Date() : undefined,
          quality_score: scores.qualityScore,
          satiety_score: scores.satietyScore,
          nutrient_density: scores.nutrientDensity,
          tags,
        },
      });

      // 记录来源
      await this.saveSource(saved.id, food);

      // 记录变更日志
      await this.logChange(
        saved.id,
        1,
        'create',
        { name: food.name },
        directives.operator,
      );

      result.created++;
    }
  }

  private async saveSource(foodId: string, food: CleanedFoodData) {
    const existing = await this.prisma.food_sources.findFirst({
      where: {
        food_id: foodId,
        source_type: food.primarySource,
        source_id: food.primarySourceId,
      },
    });

    const payload = {
      food_id: foodId,
      source_type: food.primarySource,
      source_id: food.primarySourceId,
      source_url: food.sourceUrl || undefined,
      raw_data: food.rawPayload || {},
      mapped_data: food.mappedData,
      confidence: food.confidence,
      is_primary: true,
      priority: this.getSourcePriority(food.primarySource),
      fetched_at: food.fetchedAt || new Date(),
    };

    if (existing) {
      await this.prisma.food_sources.update({
        where: { id: existing.id },
        data: payload,
      });
      return;
    }

    await this.prisma.food_sources.create({ data: payload });
  }

  private async logChange(
    foodId: string,
    version: number,
    action: string,
    changes: Record<string, any>,
    operator: string,
  ) {
    await this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version,
        action,
        changes,
        operator,
      },
    });
  }

  private async generateCode(): Promise<string> {
    const count = await this.prisma.foods.count();
    return `FOOD_G_${String(count + 1).padStart(5, '0')}`;
  }

  private resolveImportMetadata(importMetadata?: ImportMetadata): {
    status: 'draft' | 'active';
    isVerified: boolean;
    verifiedBy?: string;
    searchWeight: number;
    extraTags: string[];
    operator: string;
  } {
    return {
      status: importMetadata?.desiredStatus || 'draft',
      isVerified: importMetadata?.desiredVerified ?? false,
      verifiedBy: importMetadata?.desiredVerifiedBy,
      searchWeight: importMetadata?.desiredSearchWeight ?? 100,
      extraTags: importMetadata?.extraTags || [],
      operator: importMetadata?.operator || 'pipeline',
    };
  }

  private getSourcePriority(sourceType: string): number {
    const priorities: Record<string, number> = {
      usda: 100,
      cn_food_composition: 95,
      openfoodfacts: 80,
      manual: 70,
      ai: 40,
      crawl: 30,
    };

    return priorities[sourceType] || 50;
  }

  /**
   * Map camelCase keys from mergedFields/scores to Prisma snake_case field names.
   */
  private mapToSnakeCase(obj: Record<string, any>): Record<string, any> {
    const mapping: Record<string, string> = {
      qualityScore: 'quality_score',
      satietyScore: 'satiety_score',
      nutrientDensity: 'nutrient_density',
      dataVersion: 'data_version',
      primarySource: 'primary_source',
      primarySourceId: 'primary_source_id',
      subCategory: 'sub_category',
      foodGroup: 'food_group',
      mainIngredient: 'main_ingredient',
      processingLevel: 'processing_level',
      mealTypes: 'meal_types',
      standardServingG: 'standard_serving_g',
      standardServingDesc: 'standard_serving_desc',
      commonPortions: 'common_portions',
      searchWeight: 'search_weight',
      isProcessed: 'is_processed',
      isFried: 'is_fried',
      isVerified: 'is_verified',
      verifiedBy: 'verified_by',
      verifiedAt: 'verified_at',
      imageUrl: 'image_url',
      thumbnailUrl: 'thumbnail_url',
      saturatedFat: 'saturated_fat',
      transFat: 'trans_fat',
      glycemicIndex: 'glycemic_index',
      glycemicLoad: 'glycemic_load',
      vitaminA: 'vitamin_a',
      vitaminC: 'vitamin_c',
      vitaminD: 'vitamin_d',
      vitaminE: 'vitamin_e',
      vitaminB12: 'vitamin_b12',
    };

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const mappedKey = mapping[key] || key;
      result[mappedKey] = value;
    }
    return result;
  }

  // ==================== 批量回填营养密度分数 ====================

  /**
   * 批量回填 nutrientDensity / qualityScore / satietyScore / tags
   * 对 nutrientDensity 为 null 或 0 的记录，使用 FoodRuleEngineService 重新计算
   * 同时更新 qualityScore / satietyScore 确保一致性
   *
   * @param batchSize 每批处理条数，默认 200
   * @returns 更新总数
   */
  async backfillNutrientScores(batchSize = 200): Promise<{
    total: number;
    updated: number;
    errors: number;
  }> {
    this.logger.log('开始批量回填营养密度分数...');

    const total = await this.prisma.foods.count({
      where: {
        OR: [{ nutrient_density: null }, { nutrient_density: 0 }],
      },
    });

    if (total === 0) {
      this.logger.log('所有食物记录已有 nutrientDensity，无需回填');
      return { total: 0, updated: 0, errors: 0 };
    }

    this.logger.log(`发现 ${total} 条需要回填的记录`);

    let updated = 0;
    let errors = 0;
    let offset = 0;

    while (offset < total) {
      const foods = await this.prisma.foods.findMany({
        where: {
          OR: [{ nutrient_density: null }, { nutrient_density: 0 }],
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (foods.length === 0) break;

      for (const food of foods) {
        try {
          const scores = this.ruleEngine.applyAllRules(food as any);
          await this.prisma.foods.update({
            where: { id: food.id },
            data: {
              nutrient_density: scores.nutrientDensity,
              quality_score: scores.qualityScore,
              satiety_score: scores.satietyScore,
              tags: [
                ...new Set([...((food.tags as any[]) || []), ...scores.tags]),
              ],
            },
          });
          updated++;
        } catch (err) {
          errors++;
          this.logger.warn(`回填失败 [${food.id}] ${food.name}: ${err}`);
        }
      }

      offset += foods.length;
      this.logger.log(`进度: ${Math.min(offset, total)}/${total}`);
    }

    this.logger.log(
      `批量回填完成: 总计=${total}, 更新=${updated}, 错误=${errors}`,
    );
    return { total, updated, errors };
  }
}
