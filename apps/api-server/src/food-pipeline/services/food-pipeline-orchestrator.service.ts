import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../modules/food/entities/food-library.entity';
import { FoodTranslation } from '../../modules/food/entities/food-translation.entity';
import { FoodSource } from '../../modules/food/entities/food-source.entity';
import { FoodChangeLog } from '../../modules/food/entities/food-change-log.entity';
import { UsdaFetcherService, NormalizedFoodData } from './usda-fetcher.service';
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
    // 去重检查
    const dup = await this.dedup.findDuplicate(food);

    if (dup) {
      if (dup.matchType === 'source_id') {
        // 同来源更新: 合并数据
        const mergedFields = this.dedup.mergeFood(dup.existingFood, food, 50);
        const scores = this.ruleEngine.applyAllRules({
          ...dup.existingFood,
          ...mergedFields,
        });
        await this.foodRepo.update(dup.existingFood.id, {
          ...mergedFields,
          ...scores,
          dataVersion: dup.existingFood.dataVersion + 1,
        });

        // 记录来源
        await this.saveSource(dup.existingFood.id, food);

        // 检测冲突
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
          'pipeline',
        );
        result.updated++;
      } else {
        result.skipped++;
        result.details.push(
          `Skipped duplicate: ${food.name} (${dup.matchType}, similarity=${dup.similarity})`,
        );
      }
    } else {
      // 新增
      const scores = this.ruleEngine.applyAllRules(food);
      const code = await this.generateCode();

      const newFood = this.foodRepo.create({
        code,
        name: food.name,
        category: (food.category || 'composite') as any,
        status: 'draft' as any,
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
        barcode: food.rawPayload?.code || undefined,
        primarySource: food.primarySource,
        primarySourceId: food.primarySourceId,
        confidence: food.confidence,
        dataVersion: 1,
        isVerified: false,
        ...scores,
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
        'pipeline',
      );

      result.created++;
    }
  }

  private async saveSource(foodId: string, food: CleanedFoodData) {
    await this.sourceRepo.save(
      this.sourceRepo.create({
        foodId,
        sourceType: food.primarySource,
        sourceId: food.primarySourceId,
        sourceUrl: food.sourceUrl || undefined,
        rawData: food.rawPayload || {},
        confidence: food.confidence,
        isPrimary: true,
        priority: food.primarySource === 'usda' ? 100 : 50,
        fetchedAt: food.fetchedAt || new Date(),
      }),
    );
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
}
