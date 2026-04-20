/**
 * V6.1 Phase 2.3 — 图片食物分析服务
 *
 * 从 AnalyzeService 中拆分出的核心图片分析逻辑。
 * 负责: 图片识别 → 多食物拆解 → 营养估算 → 目标导向决策 → 组装统一结果结构。
 *
 * 职责边界:
 * - AnalyzeService: 队列管理 + 缓存 + 异步调度（不变）
 * - ImageFoodAnalysisService: AI 调用 + 数据加工 + 结果组装（本服务）
 *
 * 输出:
 * - 旧格式 AnalysisResult（向后兼容，供 AnalyzeService 缓存）
 * - 新格式 FoodAnalysisResultV61（统一结构，供订阅裁剪 + 入库管道）
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BehaviorService } from '../../../diet/app/services/behavior.service';
import { UserContextBuilderService } from '../../../decision/analyze/user-context-builder.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../../../decision/types/analysis-result.types';
import { AnalysisResult } from './analyze.service';
import { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { FoodScoringService } from '../../../decision/score/food-scoring.service';
import { buildTonePrompt } from '../../../coach/app/config/coach-tone.config';
import { AnalysisPipelineService } from '../../../decision/analyze/analysis-pipeline.service';
import { AnalysisPersistenceService } from '../../../decision/analyze/analysis-persistence.service';
import { validateAndCorrectFoods } from '../../../decision/analyze/nutrition-sanity-validator';
import { FoodLibraryService } from './food-library.service';
import {
  buildBasePrompt,
  getGoalFocusBlock,
  buildGoalAwarePrompt as _buildGoalAwarePrompt,
  buildUserContextPrompt,
  getUserMessage,
} from './analysis-prompt-schema';

// ==================== Prompt 常量（V4.7: 委托 analysis-prompt-schema.ts） ====================

// V2.0: PERSONA_PROMPTS 已移除，统一使用 coach-tone.config.ts 的 buildTonePrompt()

/**
 * V4.7: BASE_PROMPT / GOAL_FOCUS_BLOCK / getLocaleInstruction / buildGoalAwarePrompt / buildDecisionContextBlock
 * 已提取到 analysis-prompt-schema.ts，本文件直接消费共享模块。
 */

/** 评分覆盖：AI decision 仅参考，引擎为准 */
function resolveDecision(
  aiDecision: string,
  engineDecision: string,
): 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' {
  const rank: Record<string, number> = { SAFE: 0, OK: 1, LIMIT: 2, AVOID: 3 };
  const aiRank = rank[aiDecision] ?? 1;
  const engineRank = rank[engineDecision] ?? 1;
  const decisions: Array<'SAFE' | 'OK' | 'LIMIT' | 'AVOID'> = [
    'SAFE',
    'OK',
    'LIMIT',
    'AVOID',
  ];
  if (Math.abs(aiRank - engineRank) > 1) {
    return decisions[Math.max(aiRank, engineRank)];
  }
  return decisions[engineRank];
}

/** AI 容错：未返回营养数据时的粗估 */
function estimateNutrition(
  totalCalories: number,
  category?: string,
): {
  protein: number;
  fat: number;
  carbs: number;
  qualityScore: number;
  satietyScore: number;
} {
  const CATEGORY_DEFAULTS: Record<
    string,
    { qualityScore: number; satietyScore: number }
  > = {
    protein: { qualityScore: 7, satietyScore: 8 },
    veggie: { qualityScore: 8, satietyScore: 6 },
    grain: { qualityScore: 5, satietyScore: 6 },
    snack: { qualityScore: 3, satietyScore: 3 },
    beverage: { qualityScore: 4, satietyScore: 2 },
    fruit: { qualityScore: 7, satietyScore: 5 },
    soup: { qualityScore: 6, satietyScore: 5 },
    // V4.8: composite/condiment/dairy/fat 补全
    composite: { qualityScore: 5, satietyScore: 6 },
    condiment: { qualityScore: 4, satietyScore: 2 },
    dairy: { qualityScore: 6, satietyScore: 6 },
    fat: { qualityScore: 4, satietyScore: 3 },
  };
  const defaults = CATEGORY_DEFAULTS[category || ''] || {
    qualityScore: 5,
    satietyScore: 5,
  };
  return {
    protein: Math.round((totalCalories * 0.15) / 4),
    fat: Math.round((totalCalories * 0.3) / 9),
    carbs: Math.round((totalCalories * 0.55) / 4),
    ...defaults,
  };
}

/** V6.1 三档决策映射 */
function mapToRecommendation(
  decision: string,
): 'recommend' | 'caution' | 'avoid' {
  switch (decision) {
    case 'SAFE':
      return 'recommend';
    case 'OK':
      return 'recommend';
    case 'LIMIT':
      return 'caution';
    case 'AVOID':
      return 'avoid';
    default:
      return 'caution';
  }
}

/** 风险等级映射 */
function mapRiskLevel(riskLevel: string): 'low' | 'medium' | 'high' {
  if (riskLevel.includes('🟢')) return 'low';
  if (riskLevel.includes('🟡') || riskLevel.includes('🟠')) return 'medium';
  if (riskLevel.includes('🔴')) return 'high';
  return 'low';
}

@Injectable()
export class ImageFoodAnalysisService {
  private readonly logger = new Logger(ImageFoodAnalysisService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly behaviorService: BehaviorService,
    // V1.6: 评分门面服务
    private readonly foodScoringService: FoodScoringService,
    // V1.9: 统一用户上下文构建
    private readonly userContextBuilder: UserContextBuilderService,
    // V2.1: 统一分析管道（替代手工编排 Steps 2-8）
    private readonly analysisPipeline: AnalysisPipelineService,
    // V2.1: 持久化服务（供 persistAnalysisRecord 使用）
    private readonly persistence: AnalysisPersistenceService,
    // V5.0 P2.5: 食物库服务（图片链路 post-analysis 匹配）
    private readonly foodLibraryService: FoodLibraryService,
  ) {
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.model =
      this.configService.get<string>('VISION_MODEL') ||
      'baidu/ernie-4.5-vl-28b-a3b';
  }

  // ==================== 公共方法 ====================

  /**
   * 执行图片食物分析，返回旧格式（向后兼容 AnalyzeService.processAnalysis）
   */
  async executeAnalysis(
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<AnalysisResult> {
    const userHint = mealType ? `User hint: this is ${mealType}. ` : '';
    const {
      context: userContext,
      goalType,
      profile,
      healthConditions,
      nutritionPriority,
      budgetStatus,
    } = await this.buildUserContext(userId);

    // 行为画像上下文
    let behaviorContext = '';
    if (userId) {
      behaviorContext = await this.behaviorService
        .getBehaviorContext(userId)
        .catch(() => '');
    }

    // AI 人格 (V2.0: 使用统一的 coach-tone.config)
    let personaPrompt = '';
    if (userId) {
      const behaviorProfile = await this.behaviorService
        .getProfile(userId)
        .catch(() => null);
      const style = behaviorProfile?.coachStyle || 'friendly';
      personaPrompt = buildTonePrompt(style, goalType);
    }

    // V5.0: 统一用户上下文 prompt 块（合并 context + precision）
    const userContextBlock = buildUserContextPrompt({
      goalType,
      nutritionPriority,
      healthConditions,
      budgetStatus,
    });
    const fullContext = [
      personaPrompt,
      userContext,
      behaviorContext,
      userContextBlock,
    ]
      .filter(Boolean)
      .join('\n\n');
    const systemPrompt = _buildGoalAwarePrompt(goalType, fullContext);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://uway.dev-net.uk',
          'X-Title': 'Wuwei Health',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: getUserMessage('image', userHint),
                },
                {
                  type: 'image_url',
                  // V3.4 P1.2: 'auto' 让模型根据图片自适应选择细节级别，提升多菜品识别率
                  imageUrl: { url: imageUrl, detail: 'auto' },
                },
              ],
            },
          ],
          max_tokens: 1500, // V3.4 P1.2: 1000→1500，防止多食物 JSON 被截断
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`OpenRouter API error: ${response.status} ${err}`);
        throw new BadRequestException('AI analysis failed, please try again later');
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      this.logger.debug(
        `AI image analysis completed: model=${data.model}, tokens=${data.usage?.total_tokens || 'N/A'}`,
      );

      // 解析 AI 返回
      const result = this.parseAnalysisResult(content);
      result.imageUrl = imageUrl;

      // 评分引擎覆盖
      if (userId && profile) {
        await this.applyScoreEngine(result, userId, goalType, profile);
      }

      return result;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI image analysis error: ${(err as Error).message}`);
      throw new BadRequestException('AI analysis timed out, please retry');
    }
  }

  /**
   * V5.0: 执行图片分析并返回统一结构 FoodAnalysisResultV61
   *
   * 完整流程: AI 识别 → 直接解析为 AnalyzedFoodItem[] → 统一管道处理
   * 消除 legacy AnalysisResult 中间层。
   */
  async analyzeToV61(
    imageUrl: string,
    mealType: string | undefined,
    userId: string,
  ): Promise<FoodAnalysisResultV61> {
    // 1. 构建 prompt 并调用 AI（直接解析为 AnalyzedFoodItem[]）
    const foods = await this.analyzeImageToFoods(imageUrl, mealType, userId);

    // V5.0 P2.5: Post-analysis library matching — enrich with foodLibraryId + calibrated data
    await this.matchFoodsToLibrary(foods);

    // 2. 委托统一管道（评分 → 决策 → 组装 → 持久化 → 事件）
    return this.analysisPipeline.execute({
      inputType: 'image',
      imageUrl,
      mealType,
      userId,
      foods,
      // V5.0: 不传 precomputedScore/precomputedTotals，由 pipeline 统一计算
    });
  }

  /**
   * V5.0: 图片 AI 识别 → 直接解析为 AnalyzedFoodItem[]
   *
   * 复用 executeAnalysis 的 prompt 构建逻辑，但跳过 legacy AnalysisResult 转换。
   */
  private async analyzeImageToFoods(
    imageUrl: string,
    mealType: string | undefined,
    userId: string,
  ): Promise<AnalyzedFoodItem[]> {
    const userHint = mealType ? `User hint: this is ${mealType}. ` : '';
    const {
      context: userContext,
      goalType,
      healthConditions,
      nutritionPriority,
      budgetStatus,
    } = await this.buildUserContext(userId);

    // 行为画像上下文
    let behaviorContext = '';
    if (userId) {
      behaviorContext = await this.behaviorService
        .getBehaviorContext(userId)
        .catch(() => '');
    }

    // AI 人格
    let personaPrompt = '';
    if (userId) {
      const behaviorProfile = await this.behaviorService
        .getProfile(userId)
        .catch(() => null);
      const style = behaviorProfile?.coachStyle || 'friendly';
      personaPrompt = buildTonePrompt(style, goalType);
    }

    // V5.0: 统一用户上下文 prompt 块
    const userContextBlock = buildUserContextPrompt({
      goalType,
      nutritionPriority,
      healthConditions,
      budgetStatus,
    });
    const fullContext = [
      personaPrompt,
      userContext,
      behaviorContext,
      userContextBlock,
    ]
      .filter(Boolean)
      .join('\n\n');
    const systemPrompt = _buildGoalAwarePrompt(goalType, fullContext);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://uway.dev-net.uk',
          'X-Title': 'Wuwei Health',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: getUserMessage('image', userHint),
                },
                {
                  type: 'image_url',
                  imageUrl: { url: imageUrl, detail: 'auto' },
                },
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`OpenRouter API error: ${response.status} ${err}`);
        throw new BadRequestException('AI analysis failed, please try again later');
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      this.logger.debug(
        `AI image analysis completed: model=${data.model}, tokens=${data.usage?.total_tokens || 'N/A'}`,
      );

      return this.parseToAnalyzedFoods(content);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI image analysis error: ${(err as Error).message}`);
      throw new BadRequestException('AI analysis timed out, please retry');
    }
  }

  /**
   * V5.0: 直接将 AI JSON 响应解析为 AnalyzedFoodItem[]
   *
   * 消除 legacy AnalysisResult 中间格式。
   */
  private parseToAnalyzedFoods(content: string): AnalyzedFoodItem[] {
    try {
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      const rawFoods = Array.isArray(parsed.foods) ? parsed.foods : [];

      if (rawFoods.length === 0) return [];

      // 填充缺失的宏量营养素
      for (const f of rawFoods) {
        if (!f.protein && !f.fat && !f.carbs && f.calories > 0) {
          const est = estimateNutrition(f.calories, f.category);
          f.protein = est.protein;
          f.fat = est.fat;
          f.carbs = est.carbs;
        }
        if (!f.qualityScore) f.qualityScore = 5;
        if (!f.satietyScore) f.satietyScore = 5;
        if (typeof f.confidence !== 'number') f.confidence = 0.6;
      }

      // 热力学一致性校验
      const validatedFoods = validateAndCorrectFoods(
        rawFoods.map((f: any) => ({
          calories: f.calories || 0,
          protein: f.protein || 0,
          fat: f.fat || 0,
          carbs: f.carbs || 0,
          category: f.category,
          confidence: f.confidence,
          _ref: f,
        })),
      );
      validatedFoods.forEach((v, i) => {
        rawFoods[i].protein = v.protein;
        rawFoods[i].fat = v.fat;
        rawFoods[i].carbs = v.carbs;
        rawFoods[i].confidence = v.confidence;
      });

      // 直接映射到 AnalyzedFoodItem（含 V5.0 新字段）
      return rawFoods.map((f: any): AnalyzedFoodItem => ({
        name: f.name,
        nameEn: f.nameEn,
        quantity: f.quantity,
        estimatedWeightGrams: f.estimatedWeightGrams,
        standardServingG: f.standardServingG,
        standardServingDesc: f.standardServingDesc,
        category: f.category,
        confidence: f.confidence,
        estimated: f.estimated,
        calories: f.calories || 0,
        protein: f.protein || 0,
        fat: f.fat || 0,
        carbs: f.carbs || 0,
        fiber: f.fiber,
        sodium: f.sodium,
        sugar: f.sugar,
        saturatedFat: f.saturatedFat,
        addedSugar: f.addedSugar,
        transFat: f.transFat,
        cholesterol: f.cholesterol,
        omega3: f.omega3,
        omega6: f.omega6,
        solubleFiber: f.solubleFiber,
        vitaminA: f.vitaminA,
        vitaminC: f.vitaminC,
        vitaminD: f.vitaminD,
        calcium: f.calcium,
        iron: f.iron,
        potassium: f.potassium,
        zinc: f.zinc,
        glycemicIndex: f.glycemicIndex,
        glycemicLoad: f.glycemicLoad,
        qualityScore: f.qualityScore,
        satietyScore: f.satietyScore,
        processingLevel: f.processingLevel,
        nutrientDensity: f.nutrientDensity,
        fodmapLevel: f.fodmapLevel,
        oxalateLevel: f.oxalateLevel,
        purine: f.purine,
        allergens: Array.isArray(f.allergens) && f.allergens.length ? f.allergens : undefined,
        tags: Array.isArray(f.tags) && f.tags.length ? f.tags : undefined,
        cookingMethods: Array.isArray(f.cookingMethods) ? f.cookingMethods : undefined,
        ingredientList: Array.isArray(f.ingredientList) ? f.ingredientList : undefined,
        // V5.0: 新增食物库对齐字段
        foodForm: f.foodForm,
        commonPortions: Array.isArray(f.commonPortions) ? f.commonPortions : undefined,
        dishPriority: f.dishPriority,
      }));
    } catch {
      this.logger.warn(`AI response parse to AnalyzedFoodItem[] failed: ${content.substring(0, 200)}`);
      return [];
    }
  }

  /**
   * V5.0 P2.5: Post-analysis library matching for image path
   *
   * Uses nameEn (primary) and name (fallback) to search the food library.
   * Enriches AnalyzedFoodItem with foodLibraryId and calibrated nutrition data
   * when a high-confidence match is found.
   */
  private async matchFoodsToLibrary(foods: AnalyzedFoodItem[]): Promise<void> {
    const MATCH_THRESHOLD = 0.5;

    await Promise.all(
      foods.map(async (food) => {
        if (food.foodLibraryId) return; // Already matched

        try {
          // Try nameEn first (more likely to match English-keyed library)
          const searchName = food.nameEn || food.name;
          if (!searchName) return;

          const results = (await this.foodLibraryService.search(
            searchName,
            1,
          )) as any[];

          if (!results?.length || !results[0] || results[0].sim_score < MATCH_THRESHOLD) {
            // If nameEn search failed, try name as fallback (if different)
            if (food.nameEn && food.name && food.nameEn !== food.name) {
              const fallbackResults = (await this.foodLibraryService.search(
                food.name,
                1,
              )) as any[];
              if (!fallbackResults?.length || !fallbackResults[0] || fallbackResults[0].sim_score < MATCH_THRESHOLD) {
                return;
              }
              this.applyLibraryMatch(food, fallbackResults[0]);
              return;
            }
            return;
          }

          this.applyLibraryMatch(food, results[0]);
        } catch {
          // Search failure is non-fatal for image path
        }
      }),
    );
  }

  /**
   * V5.0 P2.5: Apply library match data to an AnalyzedFoodItem
   */
  private applyLibraryMatch(food: AnalyzedFoodItem, match: any): void {
    food.foodLibraryId = match.id;

    // Calibrate nutrition from library (per-100g) if available
    // Only override if library has the field and AI confidence is not high
    if (food.confidence < 0.8) {
      if (match.calories != null) food.calories = Number(match.calories);
      if (match.protein != null) food.protein = Number(match.protein);
      if (match.fat != null) food.fat = Number(match.fat);
      if (match.carbs != null) food.carbs = Number(match.carbs);
      if (match.fiber != null) food.fiber = Number(match.fiber);
      if (match.sodium != null) food.sodium = Number(match.sodium);
    }

    // Enrich quality/satiety from library
    if (match.qualityScore != null) food.qualityScore = Number(match.qualityScore);
    if (match.satietyScore != null) food.satietyScore = Number(match.satietyScore);

    // V5.0: Enrich foodForm and flavorProfile from library
    if (match.foodForm && !food.foodForm) food.foodForm = match.foodForm;
    if (match.flavorProfile) food.flavorProfile = match.flavorProfile;
    // V5.0 P3.5: Carry compatibility data for coach enrichment
    if (match.compatibility) food.compatibility = match.compatibility;

    this.logger.debug(
      `Image food library matched: "${food.name}" → id=${match.id}, sim=${match.sim_score}`,
    );
  }

  // ==================== 私有方法 ====================

  /**
   * V6.1 Phase 2.4: 将已有的旧格式结果转换为 V61 并异步保存分析记录
   *
   * 适用于 Processor 链路：AI 调用已完成（executeAnalysis），无需再次调用。
   * 对外暴露，供 AnalyzeService.processAnalysis() 异步触发。
   *
   * @returns 生成的 analysisId
   */
  async persistAnalysisRecord(
    legacyResult: AnalysisResult,
    userId: string,
    imageUrl: string,
    mealType?: string,
  ): Promise<string> {
    const analysisId = crypto.randomUUID();
    const foods = this.legacyFoodsToAnalyzed(legacyResult);
    const avgConfidence =
      foods.length > 0
        ? foods.reduce((s, f) => s + f.confidence, 0) / foods.length
        : 0.5;

    const result: FoodAnalysisResultV61 = {
      analysisId,
      inputType: 'image',
      inputSnapshot: { imageUrl, mealType: mealType as any },
      foods,
      totals: {
        calories: legacyResult.totalCalories,
        protein: legacyResult.totalProtein,
        fat: legacyResult.totalFat,
        carbs: legacyResult.totalCarbs,
      },
      score: {
        healthScore: legacyResult.nutritionScore || 50,
        nutritionScore: legacyResult.nutritionScore || 50,
        confidenceScore: Math.round(avgConfidence * 100),
      },
      decision: {
        recommendation: mapToRecommendation(legacyResult.decision),
        shouldEat: legacyResult.decision !== 'AVOID',
        reason: legacyResult.reason || legacyResult.advice,
        riskLevel: mapRiskLevel(legacyResult.riskLevel),
      },
      alternatives: (legacyResult.insteadOptions || []).map((name) => ({
        name,
        reason: 'Better suited for current goal',
      })),
      explanation: {
        summary: legacyResult.advice || legacyResult.contextComment || '',
      },
      ingestion: {
        matchedExistingFoods: false,
        shouldPersistCandidate: avgConfidence >= 0.5 && foods.length > 0,
        reviewRequired: avgConfidence < 0.7,
      },
      entitlement: { tier: 'free' as any, fieldsHidden: [] },
    };

    // 异步保存（不阻塞返回）
    this.persistence
      .saveImageRecord({ analysisId, userId, imageUrl, mealType, result })
      .catch((err) =>
        this.logger.warn(`Failed to save image analysis record async: ${(err as Error).message}`),
      );

    return analysisId;
  }

  // ==================== 以下为内部私有方法 ====================

  /**
   * 将 legacy AnalysisResult.foods 转换为 AnalyzedFoodItem[]
   *
   * analyzeToV61 和 persistAnalysisRecord 共用
   */
  private legacyFoodsToAnalyzed(legacy: AnalysisResult): AnalyzedFoodItem[] {
    return legacy.foods.map((f: any) => ({
      name: f.name,
      quantity: f.quantity,
      estimatedWeightGrams: f.estimatedWeightGrams,
      category: f.category,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.6,
      calories: f.calories || 0,
      protein: f.protein || 0,
      fat: f.fat || 0,
      carbs: f.carbs || 0,
      fiber: f.fiber,
      sodium: f.sodium,
      sugar: f.sugar,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
      vitaminA: f.vitaminA,
      vitaminC: f.vitaminC,
      calcium: f.calcium,
      iron: f.iron,
      estimated: f.estimated,
      allergens:
        Array.isArray(f.allergens) && f.allergens.length
          ? f.allergens
          : undefined,
      tags: Array.isArray(f.tags) && f.tags.length ? f.tags : undefined,
      glycemicIndex: f.glycemicIndex,
      // V4.6: 统一字段名
      qualityScore: f.qualityScore ?? undefined,
      satietyScore: f.satietyScore ?? undefined,
      processingLevel: f.processingLevel,
      // V4.6: 新增字段
      nameEn: f.nameEn,
      standardServingDesc: f.standardServingDesc,
      transFat: f.transFat,
      cholesterol: f.cholesterol,
      omega3: f.omega3,
      omega6: f.omega6,
      solubleFiber: f.solubleFiber,
      vitaminD: f.vitaminD,
      potassium: f.potassium,
      zinc: f.zinc,
      glycemicLoad: f.glycemicLoad,
      nutrientDensity: f.nutrientDensity,
      fodmapLevel: f.fodmapLevel,
      oxalateLevel: f.oxalateLevel,
      purine: f.purine,
      cookingMethods: Array.isArray(f.cookingMethods)
        ? f.cookingMethods
        : undefined,
      ingredientList: Array.isArray(f.ingredientList)
        ? f.ingredientList
        : undefined,
    }));
  }

  /**
   * 构建用户上下文（与 AnalyzeService 中逻辑一致）
   */
  /**
   * V1.9: 委托给 UserContextBuilderService
   */
  private async buildUserContext(userId?: string): Promise<{
    context: string;
    goalType: string;
    profile: any;
    healthConditions: string[];
    nutritionPriority: string[];
    budgetStatus: string;
  }> {
    const ctx = await this.userContextBuilder.build(userId);
    return {
      context: this.userContextBuilder.formatAsPromptString(ctx),
      goalType: ctx.goalType,
      profile: ctx.profile,
      healthConditions: ctx.healthConditions || [],
      nutritionPriority: ctx.nutritionPriority || [],
      budgetStatus: ctx.budgetStatus || 'under_target',
    };
  }

  /**
   * 应用评分引擎覆盖 AI 决策（从 AnalyzeService 中提取）
   */
  private async applyScoreEngine(
    result: AnalysisResult,
    userId: string,
    goalType: string,
    profile: any,
    locale: Locale = 'zh-CN',
  ): Promise<void> {
    try {
      // V1.6: 委托给 FoodScoringService
      const scoreResult = await this.foodScoringService.calculateImageScore(
        {
          calories: result.totalCalories,
          protein: result.totalProtein,
          fat: result.totalFat,
          carbs: result.totalCarbs,
          avgQuality: result.avgQuality,
          avgSatiety: result.avgSatiety,
        },
        userId,
        goalType,
        profile,
        locale,
      );

      result.nutritionScore = scoreResult.score;
      result.scoreBreakdown = scoreResult.breakdown;
      result.highlights = scoreResult.highlights;
      result.decision = resolveDecision(result.decision, scoreResult.decision);
    } catch (err) {
      this.logger.warn(`Score computation failed: ${(err as Error).message}`);
    }
  }

  /**
   * V4.6: 解析 AI 返回的文本为结构化结果
   */
  private parseAnalysisResult(content: string): AnalysisResult {
    try {
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      const foods = Array.isArray(parsed.foods) ? parsed.foods : [];

      // V4.8: 从 foods 聚合汇总
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;

      for (const f of foods) {
        totalCalories += f.calories || 0;
        totalProtein += f.protein || 0;
        totalFat += f.fat || 0;
        totalCarbs += f.carbs || 0;
      }

      // 如果汇总营养为零，从粗估兜底
      if (
        totalProtein === 0 &&
        totalFat === 0 &&
        totalCarbs === 0 &&
        totalCalories > 0
      ) {
        const est = estimateNutrition(totalCalories);
        totalProtein = est.protein;
        totalFat = est.fat;
        totalCarbs = est.carbs;
      }

      // 计算 avgQuality / avgSatiety
      let avgQuality = 0;
      let avgSatiety = 0;
      if (foods.some((f: any) => f.qualityScore > 0)) {
        avgQuality =
          Math.round(
            (foods.reduce((s: number, f: any) => s + (f.qualityScore || 5), 0) /
              Math.max(1, foods.length)) *
              10,
          ) / 10;
        avgSatiety =
          Math.round(
            (foods.reduce((s: number, f: any) => s + (f.satietyScore || 5), 0) /
              Math.max(1, foods.length)) *
              10,
          ) / 10;
      } else {
        const mainCategory = foods[0]?.category;
        const est = estimateNutrition(totalCalories, mainCategory);
        avgQuality = est.qualityScore;
        avgSatiety = est.satietyScore;
      }

      // 给 foods 中缺失数据的项填充粗估值
      for (const food of foods) {
        if (!food.protein && !food.fat && !food.carbs) {
          const est = estimateNutrition(food.calories || 0, food.category);
          food.protein = est.protein;
          food.fat = est.fat;
          food.carbs = est.carbs;
        }
        if (!food.qualityScore) {
          food.qualityScore = avgQuality || 5;
        }
        if (!food.satietyScore) {
          food.satietyScore = avgSatiety || 5;
        }
        if (typeof food.confidence !== 'number') food.confidence = 0.6;
      }

      // V3.6 P1.3: 校验并纠偏 AI 估算的营养数据（热力学一致性）
      const validatedFoods = validateAndCorrectFoods(
        foods.map((f: any) => ({
          calories: f.calories || 0,
          protein: f.protein || 0,
          fat: f.fat || 0,
          carbs: f.carbs || 0,
          category: f.category,
          confidence: f.confidence,
          _ref: f,
        })),
      );
      validatedFoods.forEach((v, i) => {
        foods[i].protein = v.protein;
        foods[i].fat = v.fat;
        foods[i].carbs = v.carbs;
        foods[i].confidence = v.confidence;
      });

      // V4.5: 从 parsed 中提取兼容旧格式的决策字段（pipeline 会覆盖）
      const decision = ['SAFE', 'OK', 'LIMIT', 'AVOID'].includes(
        parsed.decision,
      )
        ? parsed.decision
        : 'SAFE';

      return {
        foods,
        totalCalories,
        totalProtein,
        totalFat,
        totalCarbs,
        avgQuality,
        avgSatiety,
        mealType: parsed.mealType || 'lunch',
        advice: parsed.advice || parsed.summary || '',
        isHealthy:
          typeof parsed.isHealthy === 'boolean' ? parsed.isHealthy : true,
        decision,
        riskLevel: parsed.riskLevel || '🟢',
        reason: parsed.reason || '',
        suggestion: parsed.suggestion || '',
        insteadOptions: Array.isArray(parsed.insteadOptions)
          ? parsed.insteadOptions
          : [],
        compensation: parsed.compensation || {},
        contextComment: parsed.contextComment || '',
        encouragement: parsed.encouragement || '',
        nutritionScore: 0,
      };
    } catch {
      this.logger.warn(`AI response parse failed: ${content.substring(0, 200)}`);
      return {
        foods: [],
        totalCalories: 0,
        totalProtein: 0,
        totalFat: 0,
        totalCarbs: 0,
        avgQuality: 5,
        avgSatiety: 5,
        mealType: 'lunch',
        advice: 'Unable to identify image content, please upload a clearer food photo',
        isHealthy: true,
        decision: 'SAFE' as const,
        riskLevel: '🟢',
        reason: '',
        suggestion: '',
        insteadOptions: [],
        compensation: {},
        contextComment: '',
        encouragement: '',
        nutritionScore: 0,
      };
    }
  }
}
