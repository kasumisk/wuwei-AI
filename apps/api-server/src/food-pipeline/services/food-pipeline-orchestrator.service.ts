import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { upsertFoodSplitTables } from '../../modules/food/food-split.helper';
import {
  UsdaFetcherService,
  NormalizedFoodData,
  ImportMetadata,
} from './fetchers/usda-fetcher.service';
import { OpenFoodFactsService } from './fetchers/openfoodfacts.service';
import {
  FoodDataCleanerService,
  CleanedFoodData,
} from './processing/food-data-cleaner.service';
import { FoodRuleEngineService } from './processing/food-rule-engine.service';
import { FoodAiLabelService } from './ai/food-ai-label.service';
import { FoodAiTranslateService } from './ai/food-ai-translate.service';
import { FoodDedupService } from './processing/food-dedup.service';
import { FoodConflictResolverService } from './processing/food-conflict-resolver.service';
import {
  FoodEnrichmentService,
  ENRICHMENT_STAGES,
  EnrichmentResult,
} from './food-enrichment.service';

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
    private readonly enrichmentService: FoodEnrichmentService,
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
      return this.prisma.food.findFirst({ where: { barcode } });
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
    const where: Prisma.FoodWhereInput = {};

    if (options.category) {
      where.category = options.category;
    }
    // tags moved to food_taxonomies split table; unlabeled filter applied post-query
    const foods = await this.prisma.food.findMany({
      where,
      include: { taxonomy: true, healthAssessment: true, portionGuide: true },
      take: options.limit || 100,
    });
    // Filter unlabeled: foods whose taxonomy has no tags
    const filteredFoods = options.unlabeled
      ? foods.filter(
          (f) =>
            !f.taxonomy ||
            !(f.taxonomy.tags as any[])?.length,
        )
      : foods;
    this.logger.log(`AI labeling ${filteredFoods.length} foods`);

    const labelResults = await this.aiLabel.labelBatch(filteredFoods as any);
    let labeled = 0;
    let failed = 0;

    for (const [idx, labelResult] of labelResults) {
      const food = filteredFoods[idx];
      if (!food) continue;

      try {
        const mainUpdate: Record<string, any> = {};
        const splitUpdate: Record<string, any> = {};

        if (!food.category && labelResult.category)
          mainUpdate.category = labelResult.category;
        if (!food.subCategory) mainUpdate.subCategory = labelResult.subCategory;
        if (!food.foodGroup) mainUpdate.foodGroup = labelResult.foodGroup;
        if (!food.mainIngredient)
          mainUpdate.mainIngredient = labelResult.mainIngredient;

        // Split table fields (healthAssessment / taxonomy)
        if (!(food.healthAssessment as any)?.processingLevel)
          splitUpdate.processingLevel = labelResult.processingLevel;
        if (!(food.taxonomy?.mealTypes as any[])?.length)
          splitUpdate.mealTypes = labelResult.mealTypes;
        if (!(food.taxonomy?.allergens as any[])?.length)
          splitUpdate.allergens = labelResult.allergens;
        if (
          !food.taxonomy?.compatibility ||
          !Object.keys(food.taxonomy.compatibility as object).length
        ) {
          splitUpdate.compatibility = labelResult.compatibility;
        }

        // 合并标签（在 taxonomy 中）
        const existingTags = (food.taxonomy?.tags as any[]) || [];
        splitUpdate.tags = [...new Set([...existingTags, ...labelResult.tags])];

        if (Object.keys(mainUpdate).length > 0 || Object.keys(splitUpdate).length > 0) {
          if (Object.keys(mainUpdate).length > 0) {
            await this.prisma.food.update({
              where: { id: food.id },
              data: mainUpdate,
            });
          }
          await upsertFoodSplitTables(this.prisma, food.id, splitUpdate);
          await this.logChange(
            food.id,
            food.dataVersion,
            'update',
            { ...mainUpdate, ...splitUpdate },
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
      const updated = await this.prisma.food.findUnique({
        where: { id: food.id },
        include: { taxonomy: true },
      });
      if (updated) {
        const scores = this.ruleEngine.applyAllRules(updated as any);
        const existingTags = (updated.taxonomy?.tags as any[]) || [];
        await upsertFoodSplitTables(this.prisma, food.id, {
          qualityScore: scores.qualityScore,
          satietyScore: scores.satietyScore,
          nutrientDensity: scores.nutrientDensity,
          tags: [...new Set([...existingTags, ...scores.tags])],
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
    let where: Prisma.FoodWhereInput = {};

    if (options.untranslatedOnly) {
      where = {
        foodTranslations: {
          none: { locale: options.targetLocale },
        },
      };
    }

    const foods = await this.prisma.food.findMany({
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
        await this.prisma.foodTranslations.upsert({
          where: {
            foodId_locale: {
              foodId: food.id,
              locale: result.locale,
            },
          },
          create: {
            foodId: food.id,
            locale: result.locale,
            name: result.name,
            aliases: result.aliases,
            description: result.description,
            servingDesc: result.servingDesc,
          },
          update: {
            name: result.name,
            aliases: result.aliases,
            description: result.description,
            servingDesc: result.servingDesc,
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
    // qualityScore/satietyScore/nutrientDensity now live in food_health_assessments;
    // fetch all (or limited) foods and filter post-query when not recalcAll
    const foods = await this.prisma.food.findMany({
      include: { taxonomy: true, healthAssessment: true },
      take: options.limit || 500,
    });

    const toProcess = options.recalcAll
      ? foods
      : foods.filter(
          (f) =>
            f.healthAssessment?.qualityScore == null ||
            f.healthAssessment?.satietyScore == null,
        );

    let processed = 0;

    for (const food of toProcess) {
      const scores = this.ruleEngine.applyAllRules(food as any);
      const existingTags = (food.taxonomy?.tags as any[]) || [];
      const scoreData = {
        qualityScore: scores.qualityScore,
        satietyScore: scores.satietyScore,
        nutrientDensity: scores.nutrientDensity,
        tags: [...new Set([...existingTags, ...scores.tags])],
      };
      await upsertFoodSplitTables(this.prisma, food.id, scoreData);
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
        ...((dup.existingFood as any).taxonomy?.tags as any[] || []),
        ...(food.tags || []),
        ...directives.extraTags,
      ];
      const scores = this.ruleEngine.applyAllRules({
        ...dup.existingFood,
        ...mergedFields,
        tags: [...new Set(combinedTags)],
      });

      // Separate split-table fields from main-table fields in mergedFields
      const { tags: _t, qualityScore: _q, satietyScore: _s, nutrientDensity: _n,
              saturatedFat: _sf, transFat: _tf, cholesterol: _ch,
              vitaminA: _va, vitaminC: _vc, vitaminD: _vd, vitaminE: _ve, vitaminB12: _vb, folate: _fo,
              zinc: _zn, magnesium: _mg, phosphorus: _ph,
              glycemicIndex: _gi, glycemicLoad: _gl, isProcessed: _ip, isFried: _ifd,
              processingLevel: _pl, allergens: _al, mealTypes: _mt, compatibility: _co,
              standardServingG: _ssg, standardServingDesc: _ssd, commonPortions: _cp,
              omega3: _o3, omega6: _o6, solubleFiber: _slf, insolubleFiber: _ilf,
              ...mainMergedFields } = mergedFields as any;

      await this.prisma.food.update({
        where: { id: dup.existingFood.id },
        data: {
          ...mainMergedFields,
          dataVersion: dup.existingFood.dataVersion + 1,
        },
      });
      await upsertFoodSplitTables(this.prisma, dup.existingFood.id, {
        ...mergedFields,
        ...scores,
        tags: [
          ...new Set([
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
      const tags = [
        ...new Set([
          ...(food.tags || []),
          ...directives.extraTags,
          ...scores.tags,
        ]),
      ];

      const saved = await this.prisma.food.create({
        data: {
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
          mainIngredient: food.mainIngredient,
          searchWeight: food.searchWeight ?? directives.searchWeight,
          barcode: food.barcode || food.rawPayload?.code || undefined,
          primarySource: food.primarySource,
          primarySourceId: food.primarySourceId,
          confidence: food.confidence,
          dataVersion: 1,
          isVerified: directives.isVerified,
          verifiedBy: directives.isVerified ? directives.verifiedBy : undefined,
          verifiedAt: directives.isVerified ? new Date() : undefined,
          commonalityScore: (food as any).commonalityScore ?? 50,
        },
      });

      // 记录来源
      await this.saveSource(saved.id, food);

      // ARB-2026-04: 同步写入拆分表（包括 scores、tags 及所有迁移字段）
      await upsertFoodSplitTables(this.prisma, saved.id, {
        ...(food as any),
        ...scores,
        tags,
      });

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
    const existing = await this.prisma.foodSources.findFirst({
      where: {
        foodId: foodId,
        sourceType: food.primarySource,
        sourceId: food.primarySourceId,
      },
    });

    const payload = {
      foodId: foodId,
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
      await this.prisma.foodSources.update({
        where: { id: existing.id },
        data: payload,
      });
      return;
    }

    await this.prisma.foodSources.create({ data: payload });
  }

  private async logChange(
    foodId: string,
    version: number,
    action: string,
    changes: Record<string, any>,
    operator: string,
  ) {
    await this.prisma.foodChangeLogs.create({
      data: {
        foodId: foodId,
        version,
        action,
        changes,
        operator,
      },
    });
  }

  private async generateCode(): Promise<string> {
    const count = await this.prisma.food.count();
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

    // nutrientDensity now lives in food_health_assessments; count foods without a healthAssessment record
    const total = await this.prisma.food.count({
      where: { healthAssessment: { is: null } },
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
      const foods = await this.prisma.food.findMany({
        where: { healthAssessment: { is: null } },
        include: { taxonomy: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (foods.length === 0) break;

      for (const food of foods) {
        try {
          const scores = this.ruleEngine.applyAllRules(food as any);
          const existingTags = (food.taxonomy?.tags as any[]) || [];
          await upsertFoodSplitTables(this.prisma, food.id, {
            nutrientDensity: scores.nutrientDensity,
            qualityScore: scores.qualityScore,
            satietyScore: scores.satietyScore,
            tags: [...new Set([...existingTags, ...scores.tags])],
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

  // ==================== V7.9 Phase 2: 候选食品晋升流程 ====================

  /**
   * 将 food_candidates 表中满足条件的候选食品晋升为正式 foods 记录
   *
   * 晋升条件：
   * 1. status = 'approved' 或 confidence >= minConfidence
   * 2. 必须有 name 和 category
   * 3. 去重检查通过（不与现有 foods 重复）
   *
   * @param minConfidence 最低置信度阈值，默认 0.7
   * @param limit 单次晋升上限
   */
  async promoteCandidates(
    minConfidence = 0.7,
    limit = 50,
  ): Promise<{
    total: number;
    promoted: number;
    skipped: number;
    duplicates: number;
    errors: number;
    details: string[];
  }> {
    this.logger.log(
      `开始候选食品晋升: minConfidence=${minConfidence}, limit=${limit}`,
    );

    const result = {
      total: 0,
      promoted: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0,
      details: [] as string[],
    };

    // 查询满足晋升条件的候选食品
    const candidates = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        category: string;
        data: any;
        confidence: number;
        status: string;
        source: string;
      }>
    >(
      `SELECT id, name, category, data, confidence, status, source
       FROM food_candidates
       WHERE (status = 'approved' OR confidence >= $1)
         AND name IS NOT NULL
         AND category IS NOT NULL
         AND promoted_at IS NULL
       ORDER BY confidence DESC
       LIMIT $2`,
      minConfidence,
      limit,
    );

    result.total = candidates.length;

    if (candidates.length === 0) {
      this.logger.log('没有满足晋升条件的候选食品');
      return result;
    }

    for (const candidate of candidates) {
      try {
        // 去重检查：按名称精确匹配
        const existing = await this.prisma.food.findFirst({
          where: {
            OR: [
              { name: candidate.name },
              { aliases: { contains: candidate.name } },
            ],
          },
        });

        if (existing) {
          result.duplicates++;
          result.details.push(
            `重复跳过: "${candidate.name}" 与 foods.id=${existing.id} 重复`,
          );
          // 标记候选为已跳过
          await this.prisma.$executeRawUnsafe(
            `UPDATE food_candidates SET status = 'duplicate', updated_at = NOW() WHERE id = $1`,
            candidate.id,
          );
          continue;
        }

        // 解析候选数据并入库
        const candidateData =
          typeof candidate.data === 'string'
            ? JSON.parse(candidate.data)
            : candidate.data || {};

        const code = await this.generateCode();
        const scores = this.ruleEngine.applyAllRules({
          name: candidate.name,
          category: candidate.category,
          ...candidateData,
        });

        const candidateFields = this.extractCandidateFields(candidateData);

        // Strip split-table fields from candidateFields before writing to main table
        const {
          tags: _ct, qualityScore: _cq, satietyScore: _cs, nutrientDensity: _cn,
          saturatedFat: _csf, transFat: _ctf, cholesterol: _cch,
          vitaminA: _cva, vitaminC: _cvc, vitaminD: _cvd, vitaminE: _cve, vitaminB12: _cvb, folate: _cfo,
          zinc: _czn, magnesium: _cmg, phosphorus: _cph,
          glycemicIndex: _cgi, glycemicLoad: _cgl, isProcessed: _cip, isFried: _cifd,
          processingLevel: _cpl, allergens: _cal, mealTypes: _cmt, compatibility: _cco,
          standardServingG: _cssg, standardServingDesc: _cssd, commonPortions: _ccp,
          omega3: _co3, omega6: _co6, solubleFiber: _cslf, insolubleFiber: _cilf,
          ...mainCandidateFields
        } = candidateFields as any;

        const promoted = await this.prisma.food.create({
          data: {
            code,
            name: candidate.name,
            category: candidate.category as any,
            calories: (candidateFields.calories as number) ?? 0,
            status: 'draft' as any,
            primarySource: candidate.source || 'candidate',
            confidence: candidate.confidence,
            dataVersion: 1,
            isVerified: false,
            commonalityScore: (candidateFields as any).commonalityScore ?? 50,
            ...mainCandidateFields,
          },
        });

        // Write split-table fields (scores + migrated fields)
        await upsertFoodSplitTables(this.prisma, promoted.id, {
          ...candidateFields,
          ...scores,
          tags: scores.tags || [],
        });

        // 标记候选为已晋升
        await this.prisma.$executeRawUnsafe(
          `UPDATE food_candidates SET status = 'promoted', promoted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          candidate.id,
        );

        result.promoted++;
        result.details.push(`晋升成功: "${candidate.name}"`);
      } catch (e) {
        result.errors++;
        result.details.push(
          `晋升失败: "${candidate.name}" - ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `候选食品晋升完成: 总计=${result.total}, 晋升=${result.promoted}, ` +
        `重复=${result.duplicates}, 跳过=${result.skipped}, 错误=${result.errors}`,
    );

    return result;
  }

  /**
   * 从候选数据中提取可入库的字段（仅提取非空的有效字段）
   */
  private extractCandidateFields(
    data: Record<string, any>,
  ): Record<string, any> {
    const allowedFields = [
      'protein',
      'fat',
      'carbs',
      'fiber',
      'sugar',
      'sodium',
      'calories',
      'calcium',
      'iron',
      'potassium',
      'cholesterol',
      'vitamin_a',
      'vitamin_c',
      'vitamin_d',
      'vitamin_e',
      'vitamin_b12',
      'folate',
      'zinc',
      'magnesium',
      'saturated_fat',
      'trans_fat',
      'glycemic_index',
      'glycemic_load',
      'allergens',
      'meal_types',
      'tags',
      'common_portions',
      'sub_category',
      'food_group',
      'main_ingredient',
      'standard_serving_g',
      'standard_serving_desc',
      'barcode',
    ];

    const result: Record<string, any> = {};
    for (const field of allowedFields) {
      if (data[field] !== null && data[field] !== undefined) {
        result[field] = data[field];
      }
    }
    return result;
  }

  // ==================== V7.9 Phase 2: 批量分阶段补全 ====================

  /**
   * 对指定食物列表执行分阶段补全（直接调用，不走队列）
   * 适用于小批量即时补全场景
   */
  async batchEnrichByStage(
    options: {
      stages?: number[];
      limit?: number;
      category?: string;
    } = {},
  ): Promise<{
    processed: number;
    totalEnriched: number;
    totalFailed: number;
    details: Array<{
      foodId: string;
      foodName: string;
      enriched: number;
      failed: number;
    }>;
  }> {
    const stages = options.stages ?? ENRICHMENT_STAGES.map((s) => s.stage);
    const limit = options.limit ?? 10;

    const where: Prisma.FoodWhereInput = {};
    if (options.category) {
      where.category = options.category as any;
    }

    // 查找有缺失字段的食物
    const targetFields = ENRICHMENT_STAGES.filter((s) =>
      stages.includes(s.stage),
    ).flatMap((s) => s.fields);

    const foods = await this.enrichmentService.getFoodsNeedingEnrichment(
      targetFields as any,
      limit,
      0,
    );

    let processed = 0;
    let totalEnriched = 0;
    let totalFailed = 0;
    const details: Array<{
      foodId: string;
      foodName: string;
      enriched: number;
      failed: number;
    }> = [];

    for (const food of foods) {
      const result = await this.enrichmentService.enrichFoodByStage(
        food.id,
        stages,
      );
      if (!result) continue;

      // FIX: 将所有阶段结果合并后一次性写入，只产生一条 change_log
      // 与 enrichFoodNow 的 V8.4 逻辑保持一致，避免每阶段写一条导致历史记录重复
      const mergedFields: Record<string, any> = {};
      const mergedFieldConfidence: Record<string, number> = {};
      let anyStaged = false;
      let stagesTotalFailed = 0;

      for (const sr of result.stages) {
        if (!sr.result) {
          stagesTotalFailed += sr.failedFields.length;
          continue;
        }
        if (sr.result.confidence < 0.7) anyStaged = true;
        for (const [k, v] of Object.entries(sr.result)) {
          if (
            k === 'confidence' ||
            k === 'reasoning' ||
            k === 'fieldConfidence'
          )
            continue;
          if (v !== null && v !== undefined && !(k in mergedFields)) {
            mergedFields[k] = v;
          }
        }
        const fc = sr.result.fieldConfidence ?? {};
        for (const [k, v] of Object.entries(fc)) {
          if (!(k in mergedFieldConfidence))
            mergedFieldConfidence[k] = v as number;
        }
        stagesTotalFailed += sr.failedFields.length;
      }

      if (Object.keys(mergedFields).length > 0) {
        const mergedResult: EnrichmentResult = {
          ...mergedFields,
          confidence: result.overallConfidence,
          reasoning:
            result.stages
              .map((s) => s.result?.reasoning)
              .filter(Boolean)
              .join(' | ') || undefined,
          fieldConfidence:
            Object.keys(mergedFieldConfidence).length > 0
              ? mergedFieldConfidence
              : undefined,
        };
        if (anyStaged) {
          await this.enrichmentService.stageEnrichment(
            food.id,
            mergedResult,
            'foods',
            undefined,
            undefined,
            'batch_enrichment',
          );
        } else {
          await this.enrichmentService.applyEnrichment(
            food.id,
            mergedResult,
            'batch_enrichment',
          );
        }
      }

      processed++;
      totalEnriched += result.totalEnriched;
      totalFailed += result.totalFailed;
      details.push({
        foodId: food.id,
        foodName: result.foodName,
        enriched: result.totalEnriched,
        failed: result.totalFailed,
      });
    }

    return { processed, totalEnriched, totalFailed, details };
  }
}
