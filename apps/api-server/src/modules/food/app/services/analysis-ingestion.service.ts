/**
 * V6.1 Phase 3.2 — AnalysisIngestionService
 *
 * 分析完成后的入库编排服务。监听 ANALYSIS_COMPLETED 事件，
 * 根据数据质量分决定后续入库行为。
 *
 * 入库决策流程（设计文档 Section 4.3）:
 *
 *   analysis.completed
 *     → AnalysisIngestionService
 *       1. 校验结果完整度
 *       2. 计算 confidence / qualityScore（via DataQualityService）
 *       3. 与 FoodLibrary 做去重匹配
 *       4. 命中已有标准食物 → 建立 analysis_food_link
 *       5. 未命中但质量高 → 创建 food_candidate
 *       6. 未命中且质量低 → 只保留分析记录，不入食物候选
 *       7. 更新 food_analysis_records 的质量分和入库状态
 *
 * 架构决策:
 * - 异步监听 ANALYSIS_COMPLETED，不阻塞分析主流程
 * - 每个食物项独立处理，部分失败不影响整体
 * - 去重匹配采用名称层精确/ILIKE 匹配（Phase 3.3 再做语义层）
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DomainEvents,
  AnalysisCompletedEvent,
} from '../../../../core/events/domain-events';
import {
  PersistStatus,
  CandidateSourceType,
  MatchType,
} from '../../food.types';
import {
  DataQualityService,
  QualityTier,
  QualityScoreResult,
} from './data-quality.service';
import { CandidateAggregationService } from './candidate-aggregation.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../types/analysis-result.types';
import { SubscriptionTier } from '../../../subscription/subscription.types';
import { PrismaService } from '../../../../core/prisma/prisma.service';

// ==================== 内部类型 ====================

/**
 * 单个食物项的入库处理结果
 */
interface FoodItemIngestionResult {
  /** 食物名称 */
  foodName: string;
  /** 是否命中标准食物 */
  matchedLibrary: boolean;
  /** 命中的标准食物 ID */
  libraryFoodId?: string;
  /** 是否创建了候选 */
  candidateCreated: boolean;
  /** 候选食物 ID */
  candidateId?: string;
  /** 是否命中已有候选 */
  matchedCandidate: boolean;
  /** 匹配类型 */
  matchType: MatchType;
}

// ==================== 常量 ====================

/** 名称精确匹配的置信度分 */
const EXACT_MATCH_CONFIDENCE = 95;
/** 别名/ILIKE 匹配的置信度分 */
const ALIAS_MATCH_CONFIDENCE = 80;

@Injectable()
export class AnalysisIngestionService {
  private readonly logger = new Logger(AnalysisIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataQualityService: DataQualityService,
    private readonly candidateAggregationService: CandidateAggregationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ==================== 事件监听 ====================

  /**
   * 监听分析完成事件 → 执行入库编排
   *
   * 异步执行，不阻塞分析主流程。失败只记日志不影响用户体验。
   */
  @OnEvent(DomainEvents.ANALYSIS_COMPLETED, { async: true })
  async handleAnalysisCompleted(event: AnalysisCompletedEvent): Promise<void> {
    try {
      await this.ingest(event.analysisId, event.userId);
    } catch (err) {
      this.logger.error(
        `入库编排失败: analysisId=${event.analysisId}, ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // ==================== 公共 API ====================

  /**
   * 执行入库编排（也可手动调用，不仅限事件触发）
   *
   * @param analysisId 分析记录 ID
   * @param userId 用户 ID（用于日志上下文）
   */
  async ingest(analysisId: string, userId: string): Promise<void> {
    // 1. 加载分析记录
    const record = await this.prisma.food_analysis_records.findUnique({
      where: { id: analysisId },
    });
    if (!record) {
      this.logger.warn(`分析记录不存在: ${analysisId}`);
      return;
    }

    // 2. 跳过已处理的记录（幂等保护）
    if (record.persist_status !== PersistStatus.PENDING) {
      this.logger.debug(
        `分析记录已处理: ${analysisId}, status=${record.persist_status}`,
      );
      return;
    }

    // 3. 从 JSONB 恢复分析结果
    const analysisResult = this.reconstructResult(record);
    if (!analysisResult || analysisResult.foods.length === 0) {
      this.logger.debug(`分析结果为空，标记 IGNORED: ${analysisId}`);
      await this.updateRecordStatus(record.id, PersistStatus.IGNORED, null);
      return;
    }

    // 4. 批量查标准库食物（用于质量评分和匹配）
    const matchedLibraryFoods = await this.batchSearchLibrary(
      analysisResult.foods,
    );

    // 5. 计算数据质量分
    const qualityResult = await this.dataQualityService.score({
      result: analysisResult,
      userConfirmed: false, // 入库时尚未被用户确认
      matchedLibraryFoods,
    });

    this.logger.debug(
      `质量评分完成: analysisId=${analysisId}, score=${qualityResult.totalScore}, tier=${qualityResult.tier}`,
    );

    // 6. 根据质量等级执行入库
    if (qualityResult.tier === QualityTier.LOW_QUALITY) {
      // 低质量: 只保留记录，不创建关联和候选
      await this.updateRecordStatus(
        record.id,
        PersistStatus.IGNORED,
        qualityResult.totalScore,
      );
      this.logger.debug(`低质量记录，标记 IGNORED: ${analysisId}`);
      return;
    }

    // 7. 逐个食物项处理（创建 link + 可能创建候选）
    const itemResults = await this.processEachFood(
      analysisResult,
      matchedLibraryFoods,
      qualityResult,
    );

    // 8. 统计并更新分析记录
    const matchedCount = itemResults.filter((r) => r.matchedLibrary).length;
    const candidateCount = itemResults.filter((r) => r.candidateCreated).length;
    const hasLinked = matchedCount > 0;
    const hasCandidate = candidateCount > 0;

    // 决定最终入库状态
    let persistStatus: string;
    if (hasLinked && !hasCandidate) {
      persistStatus = PersistStatus.LINKED;
    } else if (hasCandidate) {
      persistStatus = PersistStatus.CANDIDATE_CREATED;
    } else {
      persistStatus = PersistStatus.IGNORED;
    }

    await this.prisma.food_analysis_records.update({
      where: { id: record.id },
      data: {
        matched_food_count: matchedCount,
        candidate_food_count: candidateCount,
        persist_status: persistStatus,
        quality_score: qualityResult.totalScore,
      },
    });

    this.logger.log(
      `入库编排完成: analysisId=${analysisId}, userId=${userId}, ` +
        `score=${qualityResult.totalScore}, tier=${qualityResult.tier}, ` +
        `matched=${matchedCount}, candidates=${candidateCount}`,
    );
  }

  // ==================== 内部方法 ====================

  /**
   * 从分析记录的 JSONB 字段恢复 FoodAnalysisResultV61
   *
   * 分析记录存储的是分段的 payload，需要组装回统一结构
   */
  private reconstructResult(record: any): FoodAnalysisResultV61 | null {
    const nutrition = record.nutrition_payload as Record<
      string,
      unknown
    > | null;
    const decision = record.decision_payload as Record<string, unknown> | null;
    const recognized = record.recognized_payload as Record<
      string,
      unknown
    > | null;

    // 最低要求: 至少有营养数据（包含 foods 列表）
    if (!nutrition) return null;

    // 尝试从 nutrition payload 中提取 foods
    const foods = (nutrition['foods'] as AnalyzedFoodItem[]) ?? [];
    if (foods.length === 0) return null;

    return {
      analysisId: record.id,
      inputType: record.input_type,
      inputSnapshot: {
        rawText: record.raw_text ?? undefined,
        imageUrl: record.image_url ?? undefined,
        mealType: record.meal_type as
          | 'breakfast'
          | 'lunch'
          | 'dinner'
          | 'snack'
          | undefined,
      },
      foods,
      totals: (nutrition['totals'] ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      }) as FoodAnalysisResultV61['totals'],
      score: (nutrition['score'] ?? {
        healthScore: 0,
        nutritionScore: 0,
        confidenceScore: record.confidence_score ?? 0,
      }) as FoodAnalysisResultV61['score'],
      decision: (decision ?? {
        recommendation: 'caution',
        shouldEat: true,
        reason: '',
        riskLevel: 'medium',
      }) as unknown as FoodAnalysisResultV61['decision'],
      alternatives: (decision?.['alternatives'] ??
        []) as FoodAnalysisResultV61['alternatives'],
      explanation: (decision?.['explanation'] ?? {
        summary: '',
      }) as FoodAnalysisResultV61['explanation'],
      entitlement: {
        tier: SubscriptionTier.FREE,
        fieldsHidden: [],
      },
    };
  }

  /**
   * 批量查标准库：精确名 + ILIKE 别名
   */
  private async batchSearchLibrary(foods: AnalyzedFoodItem[]): Promise<any[]> {
    if (foods.length === 0) return [];

    const names = new Set<string>();
    for (const food of foods) {
      if (food.name) names.add(food.name);
      if (food.normalizedName) names.add(food.normalizedName);
    }
    if (names.size === 0) return [];

    const nameArray = Array.from(names);
    const lowerNames = nameArray.map((n) => n.toLowerCase());

    // Build alias LIKE conditions
    const aliasConditions = nameArray
      .map((_, i) => `LOWER(aliases) LIKE $${lowerNames.length + i + 1}`)
      .join(' OR ');
    const aliasParams = nameArray.map((n) => `%${n.toLowerCase()}%`);

    // Build IN placeholders
    const inPlaceholders = lowerNames.map((_, i) => `$${i + 1}`).join(', ');

    return this.prisma.$queryRawUnsafe(
      `SELECT id, name, aliases, category FROM foods WHERE LOWER(name) IN (${inPlaceholders}) OR ${aliasConditions}`,
      ...lowerNames,
      ...aliasParams,
    );
  }

  /**
   * 逐个食物项处理: 匹配标准库 / 匹配已有候选 / 创建新候选
   */
  private async processEachFood(
    result: FoodAnalysisResultV61,
    matchedLibraryFoods: any[],
    qualityResult: QualityScoreResult,
  ): Promise<FoodItemIngestionResult[]> {
    // 建立标准库食物索引（名称 → food）
    const libraryByName = new Map<string, any>();
    for (const lib of matchedLibraryFoods) {
      libraryByName.set((lib.name as string).toLowerCase(), lib);
      // 也索引别名
      if (lib.aliases) {
        for (const alias of (lib.aliases as string).split(',')) {
          libraryByName.set(alias.trim().toLowerCase(), lib);
        }
      }
    }

    const results: FoodItemIngestionResult[] = [];

    for (const food of result.foods) {
      try {
        const itemResult = await this.processSingleFood(
          result.analysisId,
          result.inputType,
          food,
          libraryByName,
          qualityResult,
        );
        results.push(itemResult);
      } catch (err) {
        this.logger.warn(
          `食物入库处理失败: ${food.name}, ${(err as Error).message}`,
        );
        results.push({
          foodName: food.name,
          matchedLibrary: false,
          candidateCreated: false,
          matchedCandidate: false,
          matchType: MatchType.SEMANTIC,
        });
      }
    }

    return results;
  }

  /**
   * 处理单个食物项
   */
  private async processSingleFood(
    analysisId: string,
    inputType: 'text' | 'image',
    food: AnalyzedFoodItem,
    libraryByName: Map<string, any>,
    qualityResult: QualityScoreResult,
  ): Promise<FoodItemIngestionResult> {
    // Step 1: 尝试匹配标准食物库
    const matchResult = this.findLibraryMatch(food, libraryByName);

    if (matchResult) {
      // 命中标准食物 → 创建 analysis_food_link
      await this.createFoodLink(
        analysisId,
        food,
        matchResult.libraryFood.id,
        null,
        matchResult.matchType,
        matchResult.confidence,
      );

      return {
        foodName: food.name,
        matchedLibrary: true,
        libraryFoodId: matchResult.libraryFood.id,
        candidateCreated: false,
        matchedCandidate: false,
        matchType: matchResult.matchType,
      };
    }

    // Step 2: 未命中标准库 — 根据质量等级决定是否创建候选
    if (
      qualityResult.tier === QualityTier.AUTO_LINK ||
      qualityResult.tier === QualityTier.CREATE_CANDIDATE
    ) {
      // 质量足够高 → 尝试匹配已有候选或创建新候选
      const candidateResult = await this.findOrCreateCandidate(
        analysisId,
        inputType,
        food,
        qualityResult.totalScore,
      );

      // Phase 3.3: 候选聚合 — 去重合并 + 审核检查
      if (candidateResult.candidateId) {
        await this.postProcessCandidate(candidateResult.candidateId);
      }

      return {
        foodName: food.name,
        matchedLibrary: false,
        candidateCreated: candidateResult.created,
        candidateId: candidateResult.candidateId,
        matchedCandidate: candidateResult.matched,
        matchType:
          inputType === 'image' ? MatchType.VISION_GUESS : MatchType.SEMANTIC,
      };
    }

    // Step 3: 质量不够 → 仅保留分析记录
    return {
      foodName: food.name,
      matchedLibrary: false,
      candidateCreated: false,
      matchedCandidate: false,
      matchType: MatchType.SEMANTIC,
    };
  }

  /**
   * 在标准食物库中查找匹配
   */
  private findLibraryMatch(
    food: AnalyzedFoodItem,
    libraryByName: Map<string, any>,
  ): {
    libraryFood: any;
    matchType: MatchType;
    confidence: number;
  } | null {
    // 1. 精确名匹配
    const exactMatch = libraryByName.get(food.name.toLowerCase());
    if (exactMatch) {
      return {
        libraryFood: exactMatch,
        matchType: MatchType.EXACT,
        confidence: EXACT_MATCH_CONFIDENCE,
      };
    }

    // 2. 标准化名匹配
    if (food.normalizedName) {
      const normalizedMatch = libraryByName.get(
        food.normalizedName.toLowerCase(),
      );
      if (normalizedMatch) {
        return {
          libraryFood: normalizedMatch,
          matchType: MatchType.ALIAS,
          confidence: ALIAS_MATCH_CONFIDENCE,
        };
      }
    }

    // 3. 已有 foodLibraryId 的情况（AI 分析时已关联）
    if (food.foodLibraryId) {
      const preLinked = Array.from(libraryByName.values()).find(
        (f: any) => f.id === food.foodLibraryId,
      );
      if (preLinked) {
        return {
          libraryFood: preLinked,
          matchType: MatchType.EXACT,
          confidence: EXACT_MATCH_CONFIDENCE,
        };
      }
    }

    return null;
  }

  /**
   * 查找已有候选或创建新候选
   */
  private async findOrCreateCandidate(
    analysisId: string,
    inputType: 'text' | 'image',
    food: AnalyzedFoodItem,
    qualityScore: number,
  ): Promise<{ candidateId: string; created: boolean; matched: boolean }> {
    const canonicalName = (food.normalizedName ?? food.name).trim();

    // 1. 查找已有候选（精确名匹配）
    const existing = await this.prisma.food_candidate.findFirst({
      where: { canonical_name: canonicalName },
    });

    if (existing) {
      // 命中已有候选 → 递增命中计数、更新平均置信度
      const newSourceCount = (existing.source_count ?? 0) + 1;
      const newAvgConfidence = this.updateAvgConfidence(
        Number(existing.avg_confidence),
        newSourceCount,
        (food.confidence ?? 0) * 100,
      );
      const newQualityScore =
        qualityScore > Number(existing.quality_score)
          ? qualityScore
          : Number(existing.quality_score);

      await this.prisma.food_candidate.update({
        where: { id: existing.id },
        data: {
          source_count: newSourceCount,
          avg_confidence: newAvgConfidence,
          last_seen_at: new Date(),
          quality_score: newQualityScore,
        },
      });

      // 创建 link 关联到候选
      await this.createFoodLink(
        analysisId,
        food,
        null,
        existing.id,
        inputType === 'image' ? MatchType.VISION_GUESS : MatchType.SEMANTIC,
        (food.confidence ?? 0) * 100,
      );

      return { candidateId: existing.id, created: false, matched: true };
    }

    // 2. 创建新候选
    const saved = await this.prisma.food_candidate.create({
      data: {
        canonical_name: canonicalName,
        aliases:
          food.normalizedName && food.normalizedName !== food.name
            ? [food.name]
            : [],
        category: food.category ?? null,
        estimated_nutrition: {
          caloriesPer100g: food.estimatedWeightGrams
            ? Math.round((food.calories / food.estimatedWeightGrams) * 100)
            : undefined,
          proteinPer100g:
            food.estimatedWeightGrams && food.protein != null
              ? Math.round(
                  (food.protein / food.estimatedWeightGrams) * 100 * 10,
                ) / 10
              : undefined,
          fatPer100g:
            food.estimatedWeightGrams && food.fat != null
              ? Math.round((food.fat / food.estimatedWeightGrams) * 100 * 10) /
                10
              : undefined,
          carbsPer100g:
            food.estimatedWeightGrams && food.carbs != null
              ? Math.round(
                  (food.carbs / food.estimatedWeightGrams) * 100 * 10,
                ) / 10
              : undefined,
          fiberPer100g:
            food.estimatedWeightGrams && food.fiber != null
              ? Math.round(
                  (food.fiber / food.estimatedWeightGrams) * 100 * 10,
                ) / 10
              : undefined,
          sodiumPer100g:
            food.estimatedWeightGrams && food.sodium != null
              ? Math.round(
                  (food.sodium / food.estimatedWeightGrams) * 100 * 10,
                ) / 10
              : undefined,
        },
        source_type:
          inputType === 'image'
            ? CandidateSourceType.IMAGE_ANALYSIS
            : CandidateSourceType.TEXT_ANALYSIS,
        source_count: 1,
        avg_confidence: (food.confidence ?? 0) * 100,
        quality_score: qualityScore,
      },
    });

    // 创建 link 关联到新候选
    await this.createFoodLink(
      analysisId,
      food,
      null,
      saved.id,
      inputType === 'image' ? MatchType.VISION_GUESS : MatchType.SEMANTIC,
      (food.confidence ?? 0) * 100,
    );

    // V6.5 Phase 1L: CANDIDATE_CREATED 事件已删除（零 listener，属死代码）

    return { candidateId: saved.id, created: true, matched: false };
  }

  /**
   * 创建 analysis_food_link 记录
   */
  private async createFoodLink(
    analysisId: string,
    food: AnalyzedFoodItem,
    foodLibraryId: string | null,
    foodCandidateId: string | null,
    matchType: MatchType,
    confidence: number,
  ): Promise<void> {
    await this.prisma.analysis_food_link.create({
      data: {
        analysis_id: analysisId,
        food_name: food.name,
        food_library_id: foodLibraryId,
        food_candidate_id: foodCandidateId,
        match_type: matchType,
        confidence,
      },
    });
  }

  /**
   * 更新分析记录的入库状态和质量分
   */
  private async updateRecordStatus(
    recordId: string,
    status: string,
    qualityScore: number | null,
  ): Promise<void> {
    const data: any = { persist_status: status };
    if (qualityScore !== null) {
      data.quality_score = qualityScore;
    }
    await this.prisma.food_analysis_records.update({
      where: { id: recordId },
      data,
    });
  }

  /**
   * 增量更新平均置信度
   *
   * 新平均 = 旧平均 + (新值 - 旧平均) / 新总数
   */
  private updateAvgConfidence(
    currentAvg: number,
    newCount: number,
    newValue: number,
  ): number {
    const avg = Number(currentAvg);
    return Math.round((avg + (newValue - avg) / newCount) * 100) / 100;
  }

  /**
   * Phase 3.3: 候选后处理 — 去重合并 + 审核检查
   *
   * 失败只记日志，不影响入库主流程
   */
  private async postProcessCandidate(candidateId: string): Promise<void> {
    try {
      // 1. 去重合并检查
      const mergeResult =
        await this.candidateAggregationService.checkAndMerge(candidateId);
      if (mergeResult.merged) {
        this.logger.debug(
          `候选合并: ${mergeResult.removedCandidateId} → ${mergeResult.targetCandidateId}`,
        );
      }

      // 2. 审核资格检查（用合并后的最终 candidateId）
      const finalCandidateId = mergeResult.merged
        ? mergeResult.targetCandidateId!
        : candidateId;

      const reviewResult =
        await this.candidateAggregationService.checkReviewEligibility(
          finalCandidateId,
        );
      if (reviewResult.shouldReview) {
        this.logger.log(
          `候选达到审核条件: ${finalCandidateId}, ${reviewResult.reason}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `候选后处理失败: ${candidateId}, ${(err as Error).message}`,
      );
    }
  }
}
