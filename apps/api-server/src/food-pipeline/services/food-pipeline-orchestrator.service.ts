import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../modules/food/entities/food-library.entity';
import { FoodTranslation } from '../../modules/food/entities/food-translation.entity';
import { FoodSource } from '../../modules/food/entities/food-source.entity';
import { FoodChangeLog } from '../../modules/food/entities/food-change-log.entity';
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
    @InjectRepository(FoodLibrary)
    private readonly foodRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodTranslation)
    private readonly translationRepo: Repository<FoodTranslation>,
    @InjectRepository(FoodSource)
    private readonly sourceRepo: Repository<FoodSource>,
    @InjectRepository(FoodChangeLog)
    private readonly changeLogRepo: Repository<FoodChangeLog>,
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

  async importByBarcode(barcode: string): Promise<FoodLibrary | null> {
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
      return this.foodRepo.findOne({ where: { barcode } });
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
    const qb = this.foodRepo.createQueryBuilder('f');

    if (options.category) {
      qb.andWhere('f.category = :cat', { cat: options.category });
    }
    if (options.unlabeled) {
      qb.andWhere("(f.tags IS NULL OR f.tags = '[]'::jsonb)");
    }
    qb.take(options.limit || 100);

    const foods = await qb.getMany();
    this.logger.log(`AI labeling ${foods.length} foods`);

    const labelResults = await this.aiLabel.labelBatch(foods);
    let labeled = 0;
    let failed = 0;

    for (const [idx, labelResult] of labelResults) {
      const food = foods[idx];
      if (!food) continue;

      try {
        const update: Partial<FoodLibrary> = {};
        if (!food.category && labelResult.category)
          update.category = labelResult.category as any;
        if (!food.subCategory) update.subCategory = labelResult.subCategory;
        if (!food.foodGroup) update.foodGroup = labelResult.foodGroup;
        if (!food.mainIngredient)
          update.mainIngredient = labelResult.mainIngredient;
        if (!food.processingLevel)
          update.processingLevel = labelResult.processingLevel;
        if (!food.mealTypes?.length) update.mealTypes = labelResult.mealTypes;
        if (!food.allergens?.length) update.allergens = labelResult.allergens;
        if (!food.compatibility || !Object.keys(food.compatibility).length) {
          update.compatibility = labelResult.compatibility;
        }

        // 合并标签
        const existingTags = food.tags || [];
        update.tags = [...new Set([...existingTags, ...labelResult.tags])];

        if (Object.keys(update).length > 0) {
          await this.foodRepo.update(food.id, update);
          await this.logChange(
            food.id,
            food.dataVersion,
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
      const updated = await this.foodRepo.findOne({ where: { id: food.id } });
      if (updated) {
        const scores = this.ruleEngine.applyAllRules(updated);
        await this.foodRepo.update(food.id, {
          qualityScore: scores.qualityScore,
          satietyScore: scores.satietyScore,
          nutrientDensity: scores.nutrientDensity,
          tags: [...new Set([...(updated.tags || []), ...scores.tags])],
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
    let qb = this.foodRepo.createQueryBuilder('f');

    if (options.untranslatedOnly) {
      qb = qb
        .leftJoin('f.translations', 't', 't.locale = :locale', {
          locale: options.targetLocale,
        })
        .where('t.id IS NULL');
    }
    qb.take(options.limit || 100);

    const foods = await qb.getMany();
    this.logger.log(
      `AI translating ${foods.length} foods to ${options.targetLocale}`,
    );

    const results = await this.aiTranslate.translateBatch(
      foods,
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
        await this.translationRepo.upsert(
          {
            foodId: food.id,
            locale: result.locale,
            name: result.name,
            aliases: result.aliases,
            description: result.description,
            servingDesc: result.servingDesc,
          },
          ['foodId', 'locale'],
        );
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
    const qb = this.foodRepo.createQueryBuilder('f');
    if (!options.recalcAll) {
      qb.where('f.qualityScore IS NULL OR f.satietyScore IS NULL');
    }
    qb.take(options.limit || 500);

    const foods = await qb.getMany();
    let processed = 0;

    for (const food of foods) {
      const scores = this.ruleEngine.applyAllRules(food);
      const existingTags = food.tags || [];
      await this.foodRepo.update(food.id, {
        qualityScore: scores.qualityScore,
        satietyScore: scores.satietyScore,
        nutrientDensity: scores.nutrientDensity,
        tags: [...new Set([...existingTags, ...scores.tags])],
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
        ...(dup.existingFood.tags || []),
        ...(food.tags || []),
        ...directives.extraTags,
      ];
      const scores = this.ruleEngine.applyAllRules({
        ...dup.existingFood,
        ...mergedFields,
        tags: [...new Set(combinedTags)],
      });

      await this.foodRepo.update(dup.existingFood.id, {
        ...mergedFields,
        dataVersion: dup.existingFood.dataVersion + 1,
        ...scores,
        tags: [
          ...new Set([
            ...(mergedFields.tags || []),
            ...combinedTags,
            ...(scores.tags || []),
          ]),
        ],
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
        dup.existingFood.dataVersion + 1,
        'update',
        mergedFields,
        directives.operator,
      );
      result.updated++;
    } else {
      // 新增
      const scores = this.ruleEngine.applyAllRules(food);
      const code = food.code || (await this.generateCode());
      const tags = [...new Set([...(food.tags || []), ...directives.extraTags, ...scores.tags])];

      const newFood = this.foodRepo.create({
        code,
        name: food.name,
        aliases: food.aliases,
        category: (food.category || 'composite') as any,
        subCategory: food.subCategory,
        foodGroup: food.foodGroup,
        status: directives.status as any,
        calories: food.calories,
        protein: food.protein,
        fat: food.fat,
        carbs: food.carbs,
        fiber: food.fiber,
        sugar: food.sugar,
        saturatedFat: food.saturatedFat,
        transFat: food.transFat,
        cholesterol: food.cholesterol,
        sodium: food.sodium,
        potassium: food.potassium,
        calcium: food.calcium,
        iron: food.iron,
        vitaminA: food.vitaminA,
        vitaminC: food.vitaminC,
        vitaminD: food.vitaminD,
        vitaminE: food.vitaminE,
        vitaminB12: food.vitaminB12,
        folate: food.folate,
        zinc: food.zinc,
        magnesium: food.magnesium,
        phosphorus: food.phosphorus,
        glycemicIndex: food.glycemicIndex,
        glycemicLoad: food.glycemicLoad,
        isProcessed: food.isProcessed ?? false,
        isFried: food.isFried ?? false,
        processingLevel: food.processingLevel ?? 1,
        allergens: food.allergens || [],
        mealTypes: food.mealTypes || [],
        mainIngredient: food.mainIngredient,
        compatibility: food.compatibility || {},
        standardServingG: food.standardServingG ?? 100,
        standardServingDesc: food.standardServingDesc,
        commonPortions: food.commonPortions || [],
        searchWeight: food.searchWeight ?? directives.searchWeight,
        barcode: food.barcode || food.rawPayload?.code || undefined,
        primarySource: food.primarySource,
        primarySourceId: food.primarySourceId,
        confidence: food.confidence,
        dataVersion: 1,
        isVerified: directives.isVerified,
        verifiedBy: directives.isVerified ? directives.verifiedBy : undefined,
        verifiedAt: directives.isVerified ? new Date() : undefined,
        ...scores,
        tags,
      });

      const saved = await this.foodRepo.save(newFood);

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
    const existing = await this.sourceRepo.findOne({
      where: {
        foodId,
        sourceType: food.primarySource,
        sourceId: food.primarySourceId,
      },
    });

    const payload = {
      foodId,
      sourceType: food.primarySource,
      sourceId: food.primarySourceId,
      sourceUrl: food.sourceUrl || undefined,
      rawData: food.rawPayload || {},
      mappedData: food.mappedData,
      confidence: food.confidence,
      isPrimary: true,
      priority: this.getSourcePriority(food.primarySource),
      fetchedAt: food.fetchedAt || new Date(),
    };

    if (existing) {
      await this.sourceRepo.update(existing.id, payload);
      return;
    }

    await this.sourceRepo.save(this.sourceRepo.create(payload));
  }

  private async logChange(
    foodId: string,
    version: number,
    action: string,
    changes: Record<string, any>,
    operator: string,
  ) {
    await this.changeLogRepo.save(
      this.changeLogRepo.create({
        foodId,
        version,
        action,
        changes,
        operator,
      }),
    );
  }

  private async generateCode(): Promise<string> {
    const count = await this.foodRepo.count();
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

    const total = await this.foodRepo
      .createQueryBuilder('f')
      .where('f.nutrientDensity IS NULL OR f.nutrientDensity = 0')
      .getCount();

    if (total === 0) {
      this.logger.log('所有食物记录已有 nutrientDensity，无需回填');
      return { total: 0, updated: 0, errors: 0 };
    }

    this.logger.log(`发现 ${total} 条需要回填的记录`);

    let updated = 0;
    let errors = 0;
    let offset = 0;

    while (offset < total) {
      const foods = await this.foodRepo
        .createQueryBuilder('f')
        .where('f.nutrientDensity IS NULL OR f.nutrientDensity = 0')
        .orderBy('f.id', 'ASC')
        .take(batchSize)
        .getMany();

      if (foods.length === 0) break;

      for (const food of foods) {
        try {
          const scores = this.ruleEngine.applyAllRules(food);
          await this.foodRepo.update(food.id, {
            nutrientDensity: scores.nutrientDensity,
            qualityScore: scores.qualityScore,
            satietyScore: scores.satietyScore,
            tags: [...new Set([...(food.tags || []), ...scores.tags])],
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
