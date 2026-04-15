import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import { GoalType } from '../../services/nutrition-score.service';
import {
  MealTarget,
  ScoredFood,
  CATEGORY_QUALITY,
  CATEGORY_SATIETY,
  MACRO_RANGES,
  MEAL_RATIOS,
  MicroNutrientDefaults,
  computeWeights,
  ScoringContext,
  ScoringConfigSnapshot,
  AcquisitionChannel,
  SCORE_DIMENSIONS,
} from '../types/recommendation.types';
import {
  HealthModifierEngineService,
  HealthModifierContext,
} from '../modifier/health-modifier-engine.service';
import { ScoringExplanation } from '../types/scoring-explanation.interface';
import { RankPolicyConfig } from '../../../../strategy/strategy.types';
import { RecommendationConfigService } from './recommendation.config';
import {
  NutritionTargetService,
  NutritionTargets,
} from './nutrition-target.service';
import { SeasonalityService } from '../utils/seasonality.service';

/** scoreFood 内部计算的中间结果 — 包含分数和评分解释骨架 */
export interface ScorerDetailedResult {
  score: number;
  /** 评分解释（不含 preferenceBoost / regionalBoost / explorationMultiplier / similarityPenalty，由上游填充） */
  explanation: ScoringExplanation;
}

@Injectable()
export class FoodScorerService {
  /**
   * V5 2.7: 品类微量营养素均值表
   * 用于在 NRF 11.4 评分中插补缺失的微量营养素数据
   * 由 RecommendationEngineService 在食物池加载后设置
   */
  private categoryMicroDefaults: Map<string, MicroNutrientDefaults> | null =
    null;

  /**
   * V7.9 P3-01: computeWeights 结果缓存
   * 在同一批评分中，computeWeights 的参数组合通常只有 1 个，
   * 缓存避免对每个候选食物重复计算权重。
   * key = 参数指纹, value = weights 数组
   */
  private weightsCache = new Map<string, number[]>();

  constructor(
    private readonly penaltyEngine: HealthModifierEngineService,
    private readonly recommendationConfig: RecommendationConfigService,
    private readonly nutritionTargetService: NutritionTargetService,
    private readonly seasonalityService: SeasonalityService,
  ) {}

  /**
   * V7.9 P3-01: 构建 computeWeights 缓存 key
   * 参数组合在同一批评分中通常只有 1 个，使用 JSON 序列化生成指纹。
   */
  private buildWeightsCacheKey(
    goalType: string,
    mealType?: string,
    statusFlags?: string[],
    weightOverrides?: number[] | null,
    mealWeightOverrides?: Record<string, Record<string, number>> | null,
    rankPolicy?: RankPolicyConfig | null,
    runtimeBaseWeights?: number[] | null,
  ): string {
    return JSON.stringify([
      goalType,
      mealType ?? null,
      statusFlags ?? null,
      weightOverrides ?? null,
      mealWeightOverrides ?? null,
      rankPolicy ?? null,
      runtimeBaseWeights ?? null,
    ]);
  }

  /**
   * V7.9 P3-01: 清除 computeWeights 缓存
   * 上游在每轮评分开始前调用，避免跨请求缓存污染。
   */
  clearWeightsCache(): void {
    this.weightsCache.clear();
  }

  /**
   * V5 2.7: 设置品类微量营养素均值表
   * 在食物池加载后调用，用于后续评分中插补缺失值
   */
  setCategoryMicroDefaults(
    defaults: Map<string, MicroNutrientDefaults> | null,
  ): void {
    this.categoryMicroDefaults = defaults;
  }

  scoreFood(
    food: FoodLibrary,
    goalType: string,
    target?: MealTarget,
    penaltyContext?: HealthModifierContext,
    mealType?: string,
    statusFlags?: string[],
    weightOverrides?: number[] | null,
    mealWeightOverrides?: Record<string, Record<string, number>> | null,
    /** V6 2.2: 策略引擎排序策略配置 */
    rankPolicy?: RankPolicyConfig | null,
    /** V6.3 P1-2: 用户营养缺口列表 */
    nutritionGaps?: string[] | null,
    /** V6.3 P1-10: 个性化营养目标（替代硬编码 DV） */
    nutritionTargets?: NutritionTargets | null,
  ): number {
    const ctx: ScoringContext = {
      food,
      goalType,
      target,
      penaltyContext,
      mealType,
      statusFlags,
      weightOverrides,
      mealWeightOverrides,
      rankPolicy,
      nutritionGaps,
      nutritionTargets,
    };
    return this.scoreFoodDetailed(ctx).score;
  }

  /**
   * V6.7 Phase 1-A: 评分并返回详细分解 — ScoringContext 统一入参
   *
   * 返回最终分数 + ScoringExplanation 骨架。
   * 上游（recommendation-engine）负责填充 preferenceBoost / profileBoost /
   * regionalBoost / explorationMultiplier / similarityPenalty / finalScore。
   *
   * 变更历史:
   * - V4 Phase 2.3 (D8): 初始引入，位置参数
   * - V6.7 Phase 1-A: 12 位置参数 → ScoringContext 统一入参
   */
  scoreFoodDetailed(ctx: ScoringContext): ScorerDetailedResult {
    const {
      food,
      goalType,
      target,
      penaltyContext,
      mealType,
      statusFlags,
      weightOverrides,
      mealWeightOverrides,
      rankPolicy,
      nutritionGaps,
      healthModifierCache,
      nutritionTargets,
      scoringConfig,
      channel,
      effectiveGoal,
      preferencesProfile,
    } = ctx;

    const servingCal = (food.calories * food.standardServingG) / 100;
    const servingProtein = ((food.protein || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbs || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fat || 0) * food.standardServingG) / 100;

    const quality =
      food.qualityScore ||
      CATEGORY_QUALITY[food.category] ||
      (scoringConfig?.defaultQualityScore ?? 5);
    const satiety =
      food.satietyScore ||
      CATEGORY_SATIETY[food.category] ||
      (scoringConfig?.defaultSatietyScore ?? 4);

    // 热量评分：钟形函数
    const targetCal =
      target?.calories || (scoringConfig?.defaultMealCalorieTarget ?? 400);
    const caloriesScore = this.calcEnergyScore(
      servingCal,
      targetCal,
      goalType,
      scoringConfig?.energySigmaRatios,
      scoringConfig,
    );

    // 蛋白质评分：分段函数
    // V6.8: 传递 scoringConfig 以读取外部化参数
    const proteinScore = this.calcProteinScore(
      servingProtein,
      servingCal,
      goalType,
      scoringConfig,
    );

    // 碳水/脂肪：V4 目标自适应区间评分 (修复 E2)
    const macroRange = MACRO_RANGES[goalType] || MACRO_RANGES.health;
    // V6.8: 从配置读取碳水/脂肪默认分和区间惩罚陡度
    const defaultCarbFatScore = scoringConfig?.defaultCarbFatScore ?? 0.5;
    const rangeOutSteepness = scoringConfig?.rangeOutPenaltySteepness ?? 2;
    const carbsScore =
      servingCal > 0
        ? this.rangeScore(
            (servingCarbs * 4) / servingCal,
            macroRange.carb[0],
            macroRange.carb[1],
            rangeOutSteepness,
          )
        : defaultCarbFatScore;
    const fatScore =
      servingCal > 0
        ? this.rangeScore(
            (servingFat * 9) / servingCal,
            macroRange.fat[0],
            macroRange.fat[1],
            rangeOutSteepness,
          )
        : defaultCarbFatScore;

    const qualityScore = this.logScale(quality);
    const satietyScore = this.logScale(satiety);

    // 血糖影响评分：Sigmoid(GL)
    const glycemicScore = this.calcGlycemicImpactScore(
      food,
      servingCarbs,
      scoringConfig,
    );

    // 微量营养密度评分：NRF 11.4 (V7.3 升级自 NRF 9.3)
    // V6.3 P1-2: 传入用户营养缺口，对缺乏营养素的食物额外加分
    // V6.3 P1-10: 传入个性化营养目标，替代硬编码 DV
    // V6.7 Phase 1-B: Sigmoid 参数从 scoringConfig 读取
    let nutrientDensityScore = this.calcNutrientDensityScore(
      food,
      nutritionGaps,
      nutritionTargets,
      scoringConfig?.nrf93SigmoidCenter,
      scoringConfig?.nrf93SigmoidSlope,
      scoringConfig,
    );

    // V6.8 Phase 1-B: lifestyleAdjustment 不再在 food-scorer 中直接消费。
    // 所有 lifestyle 影响统一通过 pipeline-builder 的 lifestyleNutrientBoost 路径。

    // 炎症指数评分：基于反式脂肪+饱和脂肪+纤维
    // V6.7 Phase 1-B: Sigmoid 参数从 scoringConfig 读取
    const inflammationScore = this.calcInflammationScore(
      food,
      scoringConfig?.inflammationCenter,
      scoringConfig?.inflammationSlope,
      scoringConfig,
    );

    // V5 2.6: 膳食纤维评分 — 按份量纤维 vs 餐次目标
    // V6.3 P1-10: 使用个性化纤维目标替代硬编码 27.5g
    const fiberScore = this.calcFiberScore(
      food,
      goalType,
      mealType,
      nutritionTargets,
    );

    // V6.4 Phase 3.4: 时令感知评分 — 基于区域时令数据
    const seasonalityScore = this.seasonalityService.getSeasonalityScore(
      food.id,
      food.category,
    );

    // V6.5: 可执行性评分 — 综合大众化程度、价格合理性、获取便利性
    // V6.7 Phase 1-B: 子权重从 scoringConfig 读取
    const executabilityScore = this.calcExecutabilityScore(food, scoringConfig);

    // V6.9 Phase 1-D: 大众化/常见度评分 — 基于 commonalityScore + 渠道加分
    const popularityScore = this.scorePopularity(food, channel, scoringConfig);

    // V7.4 Phase 3-C: 食物可获得性评分 — 基于 acquisitionDifficulty（1-5 → 0-1 反转）
    const acquisitionScore = this.calcAcquisitionScore(food, scoringConfig);

    // V7.9 P3-01: computeWeights 缓存 — 同一批评分中参数组合通常相同
    const runtimeBaseWeights = this.recommendationConfig.getBaseWeights(goalType);
    const weightsCacheKey = this.buildWeightsCacheKey(
      goalType, mealType, statusFlags,
      weightOverrides, mealWeightOverrides, rankPolicy, runtimeBaseWeights,
    );
    let weights: number[];
    const cachedWeights = this.weightsCache.get(weightsCacheKey);
    if (cachedWeights) {
      // 缓存命中 — 必须 slice() 复制，因为后续 effectiveGoal 会 in-place 修改数组
      weights = cachedWeights.slice();
    } else {
      weights = computeWeights(
        goalType as GoalType,
        mealType,
        statusFlags,
        weightOverrides,
        mealWeightOverrides, // V5 4.8: A/B 实验组覆盖的餐次权重修正
        rankPolicy, // V6 2.2: 策略引擎排序策略配置（优先级最高）
        runtimeBaseWeights, // V6.2 3.2: 运行时可配置权重
      );
      // 缓存原始结果（未被 effectiveGoal 修改）
      this.weightsCache.set(weightsCacheKey, weights.slice());
    }

    // V7.0 Phase 3-C: 叠加 EffectiveGoal 阶段权重调整
    // weightAdjustment 是 Partial<Record<ScoreDimension, number>>，值为乘数（如 1.3 = 增强30%）
    // 在 computeWeights 结果之上叠加，保持 computeWeights 函数纯粹性
    if (effectiveGoal?.weightAdjustment) {
      const adj = effectiveGoal.weightAdjustment;
      for (let i = 0; i < weights.length && i < SCORE_DIMENSIONS.length; i++) {
        const dim = SCORE_DIMENSIONS[i];
        if (adj[dim] !== undefined) {
          weights[i] *= adj[dim];
        }
      }
      // 重新归一化（保持权重总和 = 1）
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      if (totalWeight > 0) {
        for (let i = 0; i < weights.length; i++) {
          weights[i] /= totalWeight;
        }
      }
    }
    const scores = [
      caloriesScore,
      proteinScore,
      carbsScore,
      fatScore,
      qualityScore,
      satietyScore,
      glycemicScore,
      nutrientDensityScore,
      inflammationScore,
      fiberScore, // V5 2.6: 第 10 维
      seasonalityScore, // V6.4 Phase 3.4: 第 11 维
      executabilityScore, // V6.5: 第 12 维
      popularityScore, // V6.9 Phase 1-D: 第 13 维
      acquisitionScore, // V7.4 Phase 3-C: 第 14 维
    ];

    // V6.8: 默认置信度从配置读取
    const confidence =
      Number(food.confidence) || (scoringConfig?.defaultConfidence ?? 0.5);
    const floor = scoringConfig?.confidenceFloor ?? 0.7;
    const confidenceFactor = floor + (1 - floor) * confidence;
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // ── NOVA 阶梯惩罚 ──
    const novaPenalty = this.calcNovaPenalty(food, scoringConfig);
    rawScore *= novaPenalty;

    // ── V6.2 3.3 → V6.8 Phase 1-C: addedSugar 惩罚（乘法形式，与 NOVA 一致） ──
    // sugarFactor: 1.0 (无添加糖) → floor (满糖)
    // slope = addedSugarPenaltyPerGrams / 100 (归一化到 0-1 衰减)
    // floor = 1.0 + maxAddedSugarPenalty / 100 (转为乘法 floor, 默认 0.85)
    const sugarPerGrams = scoringConfig?.addedSugarPenaltyPerGrams ?? 10;
    const maxSugarPenalty = scoringConfig?.maxAddedSugarPenalty ?? -15;
    const addedSugarAmount = food.addedSugar ? Number(food.addedSugar) : 0;
    const sugarSlope = sugarPerGrams > 0 ? 1 / sugarPerGrams : 0.1;
    const sugarFloor = Math.max(0.5, 1.0 + maxSugarPenalty / 100);
    const sugarFactor =
      addedSugarAmount > 0
        ? Math.max(sugarFloor, 1 - sugarSlope * addedSugarAmount * 0.01)
        : 1.0;
    // 记录为等效加法值用于 explanation 兼容
    const addedSugarPenalty = sugarFactor - 1.0; // 负值
    rawScore *= sugarFactor;

    // ── 健康修正引擎 ──
    const penalty = this.penaltyEngine.evaluate(
      food,
      {
        ...penaltyContext,
        goalType,
      },
      healthModifierCache,
    );
    if (penalty.isVetoed) {
      return {
        score: 0,
        explanation: this.buildExplanation(
          scores,
          weights,
          novaPenalty,
          addedSugarPenalty,
          penalty,
          confidenceFactor,
          0,
        ),
      };
    }
    rawScore *= penalty.finalMultiplier;

    // V7.0 Phase 3-C → V7.1 P3-C: 菜系偏好 + 替换 boost
    // V7.1: 当 PreferenceSignal 存在时，使用统一信号的 cuisineBoost + substitutionBoost
    // 替代原有的 inline 菜系计算。其余信号（exploration, category, ingredient）
    // 在 PipelineBuilder.rankCandidates() 中独立应用，避免双重计算。
    let cuisineBoost = 0;
    let substitutionBoost = 0;
    if (ctx.preferenceSignal) {
      // V7.1 P3-C: 从统一偏好信号读取
      cuisineBoost = ctx.preferenceSignal.cuisineBoost;
      substitutionBoost = ctx.preferenceSignal.substitutionBoost;
      rawScore *= 1 + cuisineBoost + substitutionBoost;
    } else if (preferencesProfile?.cuisineWeights && food.cuisine) {
      // Fallback: 保留 V7.0 inline 菜系计算（向后兼容）
      const cuisineWeight = preferencesProfile.cuisineWeights[food.cuisine];
      if (cuisineWeight !== undefined) {
        // 将 [0, 1] 权重映射到 [-0.1, +0.1] boost
        cuisineBoost =
          (cuisineWeight - 0.5) *
          (scoringConfig?.tuning?.cuisineWeightBoostCoeff ?? 0.2);
        rawScore *= 1 + cuisineBoost;
      }
    }

    const finalScore = Math.max(0, rawScore * confidenceFactor);

    return {
      score: finalScore,
      explanation: this.buildExplanation(
        scores,
        weights,
        novaPenalty,
        addedSugarPenalty,
        penalty,
        confidenceFactor,
        finalScore,
      ),
    };
  }

  /** 构建评分解释骨架（上游 boost/exploration/similarity 字段初始化为 1.0/0） */
  private buildExplanation(
    scores: number[],
    weights: number[],
    novaPenalty: number,
    addedSugarPenalty: number,
    modifierResult: {
      finalMultiplier: number;
      modifiers: Array<{ multiplier: number; reason: string; type: string }>;
      isVetoed: boolean;
    },
    confidenceFactor: number,
    finalScore: number,
  ): ScoringExplanation {
    return {
      dimensions: {
        calories: { raw: scores[0], weighted: scores[0] * weights[0] },
        protein: { raw: scores[1], weighted: scores[1] * weights[1] },
        carbs: { raw: scores[2], weighted: scores[2] * weights[2] },
        fat: { raw: scores[3], weighted: scores[3] * weights[3] },
        quality: { raw: scores[4], weighted: scores[4] * weights[4] },
        satiety: { raw: scores[5], weighted: scores[5] * weights[5] },
        glycemic: { raw: scores[6], weighted: scores[6] * weights[6] },
        nutrientDensity: { raw: scores[7], weighted: scores[7] * weights[7] },
        inflammation: { raw: scores[8], weighted: scores[8] * weights[8] },
        fiber: { raw: scores[9], weighted: scores[9] * weights[9] }, // V5 2.6
        seasonality: { raw: scores[10], weighted: scores[10] * weights[10] }, // V6.4 Phase 3.4
        executability: {
          raw: scores[11],
          weighted: scores[11] * (weights[11] ?? 0),
        }, // V6.5
        popularity: {
          raw: scores[12] ?? 0,
          weighted: (scores[12] ?? 0) * (weights[12] ?? 0),
        }, // V6.9 Phase 1-D
        acquisition: {
          raw: scores[13] ?? 0,
          weighted: (scores[13] ?? 0) * (weights[13] ?? 0),
        }, // V7.4 Phase 3-C
      },
      novaPenalty,
      addedSugarPenalty,
      penaltyResult: {
        multiplier: modifierResult.finalMultiplier,
        reasons: modifierResult.modifiers.map((m) => m.reason),
        vetoed: modifierResult.isVetoed,
      },
      confidenceFactor,
      preferenceBoost: 1.0,
      profileBoost: 1.0,
      regionalBoost: 1.0,
      explorationMultiplier: 1.0,
      similarityPenalty: 0,
      compatibilityBonus: 0,
      cfBoost: 0,
      shortTermBoost: 0, // V6 1.9: 短期画像偏好（由推荐引擎注入）
      sceneBoost: 1.0, // V6 2.18: 上下文场景加权（由推荐引擎注入）
      analysisBoost: 1.0, // V6.1 Phase 3.5: 分析画像加权（由推荐引擎注入）
      lifestyleBoost: 1.0, // V6.5 Phase 1E: 生活方式画像乘数（由推荐引擎注入）
      foodPrefBoost: 1.0, // V6.3 P2-4: 声明偏好加成（由推荐引擎注入）
      popularityBoost: 1.0, // V6.3 P2-4: 热门食物加成（由推荐引擎注入）
      replacementBoost: 1.0, // V6.6 Phase 2-B: 替换反馈乘数（由推荐引擎注入）
      finalScore,
    };
  }

  scoreFoodsWithServing(
    candidates: FoodLibrary[],
    goalType: string,
    target?: MealTarget,
    penaltyContext?: HealthModifierContext,
    mealType?: string,
    statusFlags?: string[],
    weightOverrides?: number[] | null,
    mealWeightOverrides?: Record<string, Record<string, number>> | null,
    /** V6 2.2: 策略引擎排序策略配置 */
    rankPolicy?: RankPolicyConfig | null,
    /** V6.3 P2-12: NRF 9.3 个性化营养目标 */
    nutritionTargets?: NutritionTargets | null,
  ): ScoredFood[] {
    return candidates
      .map((food) => ({
        food,
        score: this.scoreFood(
          food,
          goalType,
          target,
          penaltyContext,
          mealType,
          statusFlags,
          weightOverrides,
          mealWeightOverrides,
          rankPolicy,
          undefined, // nutritionGaps
          nutritionTargets,
        ),
        ...this.calcServingNutrition(food),
      }))
      .filter((sf) => sf.score > 0) // 过滤掉被否决的食物
      .sort((a, b) => b.score - a.score);
  }

  calcServingNutrition(
    food: FoodLibrary,
  ): Pick<
    ScoredFood,
    | 'servingCalories'
    | 'servingProtein'
    | 'servingFat'
    | 'servingCarbs'
    | 'servingFiber'
    | 'servingGL'
  > {
    return {
      servingCalories: Math.round(
        (food.calories * food.standardServingG) / 100,
      ),
      servingProtein: Math.round(
        ((food.protein || 0) * food.standardServingG) / 100,
      ),
      servingFat: Math.round(((food.fat || 0) * food.standardServingG) / 100),
      servingCarbs: Math.round(
        ((food.carbs || 0) * food.standardServingG) / 100,
      ),
      // V5 2.2: 膳食纤维按份量换算
      servingFiber: Math.round(
        ((food.fiber || 0) * food.standardServingG) / 100,
      ),
      // V5 2.2: 血糖负荷直接使用食物级别值（GL 不按重量线性缩放）
      servingGL: Number(food.glycemicLoad) || 0,
    };
  }

  /** 热量评分 — 高斯钟形函数 */
  private calcEnergyScore(
    actual: number,
    target: number,
    goalType: string,
    configSigmaRatios?: Record<string, number> | null,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // V6.8: 从配置读取默认分
    if (target <= 0) return cfg?.energyDefaultScore ?? 0.8;
    const defaultSigmaRatios: Record<string, number> = {
      fat_loss: 0.12,
      muscle_gain: 0.2,
      health: 0.15,
      habit: 0.25,
    };
    const sigmaRatio = configSigmaRatios ?? defaultSigmaRatios;
    const sigma = target * (sigmaRatio[goalType] || 0.15);
    const diff = actual - target;
    let score = Math.exp(-(diff * diff) / (2 * sigma * sigma));

    // V6.8: 从配置读取不对称惩罚系数
    if (goalType === 'fat_loss' && diff > 0)
      score *= cfg?.energyFatLossPenalty ?? 0.85;
    if (goalType === 'muscle_gain' && diff < 0)
      score *= cfg?.energyMuscleGainPenalty ?? 0.9;
    return score;
  }

  /** 蛋白质评分 — 分段函数 */
  private calcProteinScore(
    protein: number,
    calories: number,
    goalType: string,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // V6.8: 从配置读取默认分和蛋白质范围
    if (calories <= 0) return cfg?.proteinDefaultScore ?? 0.8;
    const ratio = (protein * 4) / calories;

    // V6.8: 从配置读取每目标蛋白质理想范围
    const configRanges = cfg?.proteinRangeByGoal;
    const defaultRanges: Record<string, [number, number]> = {
      fat_loss: [0.25, 0.35],
      muscle_gain: [0.25, 0.4],
      health: [0.15, 0.25],
      habit: [0.12, 0.3],
    };
    const ranges = configRanges ?? defaultRanges;
    const [min, max] = ranges[goalType] ?? [0.15, 0.25];

    // V6.8: 从配置读取曲线参数
    const belowCoeff = cfg?.proteinBelowRangeCoeff ?? 0.3;
    const belowBase = cfg?.proteinBelowRangeBase ?? 0.7;
    const aboveDecay = cfg?.proteinAboveRangeDecay ?? 0.5;
    const aboveDiv = cfg?.proteinAboveRangeDiv ?? 0.15;

    if (ratio >= min && ratio <= max) return 1.0;
    if (ratio < min) return Math.max(0, belowCoeff + belowBase * (ratio / min));
    return Math.max(0, 1.0 - aboveDecay * ((ratio - max) / aboveDiv));
  }

  /** 区间评分 */
  private rangeScore(
    value: number,
    min: number,
    max: number,
    steepness?: number,
  ): number {
    if (value >= min && value <= max) return 1.0;
    const diff = value < min ? min - value : value - max;
    // V6.8: steepness 从配置读取
    return Math.max(0, 1.0 - diff * (steepness ?? 2));
  }

  /**
   * 对数映射 — 将 1-10 映射到 0-1
   * 低分区差异大（边际效用高），高分区差异小（边际效用递减）
   * log(1+1)/log(11) ≈ 0.29, log(1+5)/log(11) ≈ 0.75, log(1+10)/log(11) = 1.0
   */
  private logScale(value: number): number {
    const clamped = Math.max(0, Math.min(10, value));
    return Math.log(1 + clamped) / Math.log(11);
  }

  /**
   * NRF 11.4 微量营养密度评分
   * 鼓励11种: 蛋白质、纤维、维A、维C、维D、维E、钙、铁、钾、锌、镁
   * 限制4种: 饱和脂肪、添加糖、钠、反式脂肪
   * 每项按 DV% 计算后 cap 到 100%，总分归一化到 0-1
   * 基于 per 100g 数据计算
   *
   * V4 Phase 4.7: 糖分惩罚改用 addedSugar（添加糖）替代总糖
   * 当 addedSugar 字段可用时，仅惩罚添加糖，天然糖（水果糖/乳糖）不扣分
   * 这修正了水果和乳制品在 NRF 中被不合理降分的问题
   *
   * V5 2.7: 当微量营养素字段缺失（null/0）时，使用品类均值插补
   * 这避免了数据不完整的食物被系统性低估
   *
   * V7.3: NRF9.3 → NRF11.4 升级
   * 新增鼓励项: 锌（免疫/代谢）、镁（神经/肌肉/骨骼）
   * 新增限制项: 反式脂肪（心血管风险）
   */
  private calcNutrientDensityScore(
    food: FoodLibrary,
    nutritionGaps?: string[] | null,
    /** V6.3 P1-10: 个性化营养目标，替代硬编码 DV */
    nutritionTargets?: NutritionTargets | null,
    /** V6.7 Phase 1-B: Sigmoid 中心点（默认 150） */
    sigmoidCenter?: number | null,
    /** V6.7 Phase 1-B: Sigmoid 斜率（默认 0.01） */
    sigmoidSlope?: number | null,
    /** V6.8: 评分参数快照 */
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // V5 2.7: 获取品类默认值用于插补
    const catDefaults = this.categoryMicroDefaults?.get(
      food.category || 'unknown',
    );

    // 插补辅助函数：优先使用食物自身值，缺失时回退品类均值
    const impute = (
      value: number | undefined | null,
      field: keyof MicroNutrientDefaults,
    ): number => {
      const v = Number(value) || 0;
      if (v > 0) return v;
      return catDefaults?.[field] ?? 0;
    };

    // V6.3 P1-10: 每日推荐值 — 优先使用个性化目标，回退到 FDA 标准 DV
    const DV = {
      protein: nutritionTargets?.protein ?? 50, // g
      fiber: nutritionTargets?.fiber ?? 28, // g
      vitaminA: nutritionTargets?.vitaminA ?? 900, // ug RAE
      vitaminC: nutritionTargets?.vitaminC ?? 90, // mg
      vitaminD: nutritionTargets?.vitaminD ?? 20, // ug
      vitaminE: nutritionTargets?.vitaminE ?? 15, // mg
      calcium: nutritionTargets?.calcium ?? 1300, // mg
      iron: nutritionTargets?.iron ?? 18, // mg
      potassium: nutritionTargets?.potassium ?? 4700, // mg
      // V7.3 NRF11.4 新增
      zinc: nutritionTargets?.zinc ?? 11, // mg, FDA DV
      magnesium: nutritionTargets?.magnesium ?? 420, // mg, FDA DV
    };

    const LIMIT_DV = {
      saturatedFat: nutritionTargets?.saturatedFatLimit ?? 20, // g
      addedSugar: nutritionTargets?.addedSugarLimit ?? 50, // g
      sodium: nutritionTargets?.sodiumLimit ?? 2300, // mg
      // V7.3 NRF11.4 新增
      transFat: nutritionTargets?.transFatLimit ?? 2.2, // g, WHO <1% 总能量
    };

    // 鼓励项: 每项 = min(nutrient / DV * 100, 100)
    // 蛋白质不做插补（蛋白质数据通常完整且是主要宏量素）
    const encourage =
      Math.min(((food.protein || 0) / DV.protein) * 100, 100) +
      Math.min((impute(food.fiber, 'fiber') / DV.fiber) * 100, 100) +
      Math.min((impute(food.vitaminA, 'vitaminA') / DV.vitaminA) * 100, 100) +
      Math.min((impute(food.vitaminC, 'vitaminC') / DV.vitaminC) * 100, 100) +
      Math.min((impute(food.vitaminD, 'vitaminD') / DV.vitaminD) * 100, 100) +
      Math.min((impute(food.vitaminE, 'vitaminE') / DV.vitaminE) * 100, 100) +
      Math.min((impute(food.calcium, 'calcium') / DV.calcium) * 100, 100) +
      Math.min((impute(food.iron, 'iron') / DV.iron) * 100, 100) +
      Math.min(
        (impute(food.potassium, 'potassium') / DV.potassium) * 100,
        100,
      ) +
      // V7.3 NRF11.4 新增鼓励项
      Math.min((impute(food.zinc, 'zinc') / DV.zinc) * 100, 100) +
      Math.min((impute(food.magnesium, 'magnesium') / DV.magnesium) * 100, 100);

    // V4 Phase 4.7: 优先使用 addedSugar，回退到 sugar（向后兼容）
    // 当 addedSugar 字段有值时，仅惩罚添加糖
    // 当 addedSugar 为 null/undefined 时，使用总糖作为保守估计
    const sugarForPenalty =
      food.addedSugar != null
        ? Number(food.addedSugar)
        : Number(food.sugar) || 0;

    // 限制项: 每项 = min(nutrient / DV * 100, 100)
    const discourage =
      Math.min(((food.saturatedFat || 0) / LIMIT_DV.saturatedFat) * 100, 100) +
      Math.min((sugarForPenalty / LIMIT_DV.addedSugar) * 100, 100) +
      Math.min(((food.sodium || 0) / LIMIT_DV.sodium) * 100, 100) +
      // V7.3 NRF11.4 新增限制项
      // transFatLimit=0 时跳过（已通过炎症评分强惩罚，避免除零）
      (LIMIT_DV.transFat > 0
        ? Math.min(
            ((Number(food.transFat) || 0) / LIMIT_DV.transFat) * 100,
            100,
          )
        : (Number(food.transFat) || 0) > 0
          ? 100
          : 0);

    // NRF11.4 原始分 = encourage - discourage
    // 理论范围: -400 ~ 1100, 实际大部分食物在 -50 ~ 500
    const raw = encourage - discourage;

    // V6.3 P1-2: 营养缺口加权 — 如果用户缺乏特定营养素，
    // 且该食物富含该营养素（>= threshold% DV），额外加分
    // V6.8: 阈值、单项最大 bonus、总上限从配置读取
    const gapThreshold = cfg?.nrfGapThreshold ?? 15;
    const gapMaxBonus = cfg?.nrfGapMaxBonus ?? 20;
    const gapTotalCap = cfg?.nrfGapTotalCap ?? 80;
    let gapBonus = 0;
    if (nutritionGaps?.length) {
      // 营养素名称到 DV% 的映射
      const nutrientDvPercent: Record<string, number> = {
        protein: Math.min(((food.protein || 0) / DV.protein) * 100, 100),
        fiber: Math.min((impute(food.fiber, 'fiber') / DV.fiber) * 100, 100),
        vitaminA: Math.min(
          (impute(food.vitaminA, 'vitaminA') / DV.vitaminA) * 100,
          100,
        ),
        vitaminC: Math.min(
          (impute(food.vitaminC, 'vitaminC') / DV.vitaminC) * 100,
          100,
        ),
        vitaminD: Math.min(
          (impute(food.vitaminD, 'vitaminD') / DV.vitaminD) * 100,
          100,
        ),
        vitaminE: Math.min(
          (impute(food.vitaminE, 'vitaminE') / DV.vitaminE) * 100,
          100,
        ),
        calcium: Math.min(
          (impute(food.calcium, 'calcium') / DV.calcium) * 100,
          100,
        ),
        iron: Math.min((impute(food.iron, 'iron') / DV.iron) * 100, 100),
        potassium: Math.min(
          (impute(food.potassium, 'potassium') / DV.potassium) * 100,
          100,
        ),
        // V7.3 NRF11.4 新增
        zinc: Math.min((impute(food.zinc, 'zinc') / DV.zinc) * 100, 100),
        magnesium: Math.min(
          (impute(food.magnesium, 'magnesium') / DV.magnesium) * 100,
          100,
        ),
      };

      for (const gap of nutritionGaps) {
        const dvPct = nutrientDvPercent[gap];
        if (dvPct !== undefined && dvPct >= gapThreshold) {
          // V6.8 Phase 1-C: 连续函数 — bonus 随 %DV 线性增长
          // nrfGapContinuous=true(默认): bonus = maxBonus × min(1, (dvPct - threshold) / (100 - threshold))
          // nrfGapContinuous=false: V6.7 二值逻辑，达标即满分
          const useContinuous = cfg?.nrfGapContinuous ?? true;
          if (useContinuous && gapThreshold < 100) {
            const ratio = Math.min(
              1,
              (dvPct - gapThreshold) / (100 - gapThreshold),
            );
            gapBonus += gapMaxBonus * ratio;
          } else {
            gapBonus += gapMaxBonus;
          }
        }
      }
      gapBonus = Math.min(gapBonus, gapTotalCap);
    }

    // 归一化到 0-1: 使用 Sigmoid 平滑映射
    // V6.7 Phase 1-B: 中心点/斜率从 scoringConfig 读取，默认 150/0.01
    const center = sigmoidCenter ?? 150;
    const slope = sigmoidSlope ?? 0.01;
    return 1 / (1 + Math.exp(-slope * (raw + gapBonus - center)));
  }

  /**
   * 炎症指数评分 (Anti-Inflammatory Score)
   * 促炎因子: 反式脂肪(强)、饱和脂肪(中)
   * 抗炎因子: 纤维(中)
   * 基于 per 100g 数据计算，返回 0-1 (1=抗炎/无炎症风险)
   */
  private calcInflammationScore(
    food: FoodLibrary,
    configCenter?: number | null,
    configSlope?: number | null,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    const transFat = Number(food.transFat) || 0;
    const saturatedFat = Number(food.saturatedFat) || 0;
    const fiber = Number(food.fiber) || 0;

    // V6.8: 炎症公式参数从配置读取
    const transDiv = cfg?.inflammTransFatDiv ?? 2;
    const transMax = cfg?.inflammTransFatMax ?? 50;
    const satDiv = cfg?.inflammSatFatDiv ?? 10;
    const satMax = cfg?.inflammSatFatMax ?? 30;
    const fiberDiv = cfg?.inflammFiberDiv ?? 5;
    const fiberMax = cfg?.inflammFiberMax ?? 40;

    // 促炎分:
    const transInflam = Math.min(transFat / transDiv, 1) * transMax;
    const satInflam = Math.min(saturatedFat / satDiv, 1) * satMax;
    const proInflammatory = transInflam + satInflam;

    // 抗炎分:
    const antiInflammatory = Math.min(fiber / fiberDiv, 1) * fiberMax;

    // 净炎症指数: 低=好, 高=差
    const netInflammation = proInflammatory - antiInflammatory;

    // 归一化到 0-1: Sigmoid, 中心点/斜率从 scoringConfig 读取（默认 20/0.08）
    const center = configCenter ?? 20;
    const slope = configSlope ?? 0.08;
    return 1 / (1 + Math.exp(slope * (netInflammation - center)));
  }

  /**
   * V5 2.6: 膳食纤维评分
   * V6.3 P1-10: 使用个性化纤维目标替代硬编码 27.5g
   * 评分 = min(1.0, 实际纤维 / 餐次纤维目标)
   *
   * @param food 食物
   * @param goalType 目标类型（决定餐次比例）
   * @param mealType 餐次类型（决定纤维分配比例）
   * @param nutritionTargets 个性化营养目标（可选，提供个性化纤维目标）
   */
  private calcFiberScore(
    food: FoodLibrary,
    goalType: string,
    mealType?: string,
    nutritionTargets?: NutritionTargets | null,
  ): number {
    // V6.3 P1-10: 优先使用个性化纤维目标，回退到中国膳食指南中值 27.5g
    const dailyFiberTarget = nutritionTargets?.fiber ?? 27.5;
    const fiber = ((food.fiber || 0) * food.standardServingG) / 100; // 按份量换算

    // 获取餐次热量比例作为纤维分配比例
    const ratios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;
    const mealRatio = (mealType && ratios[mealType]) || 0.25;
    const mealFiberTarget = Math.max(dailyFiberTarget * mealRatio, 1);

    return Math.min(1.0, fiber / mealFiberTarget);
  }

  /**
   * V6.3 P1-13: NOVA 加工程度单品化惩罚
   *
   * 改进前: 所有 NOVA-4 食物统一 0.55 倍惩罚（酸奶和薯片同等对待）
   * 改进后: 在 NOVA 级别基准上，根据单品的实际营养品质微调惩罚幅度
   *
   * 调整逻辑（仅对 NOVA 3/4 生效）:
   * - 高纤维（>= 3g/100g）：惩罚缓解 +0.05（如全麦面包 NOVA-4 但纤维丰富）
   * - 低添加糖（< 5g/100g）：惩罚缓解 +0.05（如无糖酸奶）
   * - 低饱和脂肪（< 3g/100g）：惩罚缓解 +0.05（如脱脂乳制品）
   * - 高钠（> 800mg/100g）：惩罚加重 -0.05（如方便面调味包）
   *
   * 最终范围锁定: NOVA 3 [0.75, 0.95], NOVA 4 [0.45, 0.70]
   *
   * @param food 食物对象（用于读取单品营养数据）
   */
  private calcNovaPenalty(
    food: FoodLibrary,
    scoringConfig?: ScoringConfigSnapshot | null,
  ): number {
    const processingLevel = food.processingLevel ?? 1;
    // V6.7 Phase 1-B: NOVA 基准从 scoringConfig 读取
    const NOVA_BASE = scoringConfig?.novaBase ?? [1.0, 1.0, 1.0, 0.85, 0.55];
    const level = Math.max(0, Math.min(4, processingLevel));
    let penalty = NOVA_BASE[level];

    // 单品微调仅对 NOVA 3/4 生效（NOVA 1/2 不惩罚，无需微调）
    if (level >= 3) {
      // V6.8: 微调阈值和缓解量从配置读取
      const highFiberThreshold = scoringConfig?.novaHighFiberThreshold ?? 3;
      const highFiberRelief = scoringConfig?.novaHighFiberRelief ?? 0.05;
      const lowSugarThreshold = scoringConfig?.novaLowSugarThreshold ?? 5;
      const lowSugarRelief = scoringConfig?.novaLowSugarRelief ?? 0.05;
      const lowSatFatThreshold = scoringConfig?.novaLowSatFatThreshold ?? 3;
      const lowSatFatRelief = scoringConfig?.novaLowSatFatRelief ?? 0.05;
      const highSodiumThreshold = scoringConfig?.novaHighSodiumThreshold ?? 800;
      const highSodiumPenalty = scoringConfig?.novaHighSodiumPenalty ?? 0.05;

      // 高纤维缓解（全麦/高纤维加工食品不应被过度惩罚）
      if ((Number(food.fiber) || 0) >= highFiberThreshold) {
        penalty += highFiberRelief;
      }
      // 低添加糖缓解（无糖/低糖加工食品）
      const sugar =
        food.addedSugar != null
          ? Number(food.addedSugar)
          : Number(food.sugar) || 0;
      if (sugar < lowSugarThreshold) {
        penalty += lowSugarRelief;
      }
      // 低饱和脂肪缓解（脱脂/低脂加工食品）
      if ((Number(food.saturatedFat) || 0) < lowSatFatThreshold) {
        penalty += lowSatFatRelief;
      }
      // 高钠加重（重盐加工食品）
      if ((Number(food.sodium) || 0) > highSodiumThreshold) {
        penalty -= highSodiumPenalty;
      }

      // V6.8: clamp 范围从配置读取
      const clampMin = scoringConfig?.novaClampMin ?? [0.75, 0.45];
      const clampMax = scoringConfig?.novaClampMax ?? [0.95, 0.7];
      const minPenalty = level === 3 ? clampMin[0] : clampMin[1];
      const maxPenalty = level === 3 ? clampMax[0] : clampMax[1];
      penalty = Math.max(minPenalty, Math.min(maxPenalty, penalty));
    }

    return penalty;
  }

  /**
   * 血糖影响评分 — Sigmoid(GL)
   * GL = GI × 碳水(g/份) / 100
   * 返回 0-1 区间
   *
   * V6.3 P1-12: 当 GI 数据缺失时，使用三因素估算模型替代固定 0.75
   *   - 品类基准 GI（CATEGORY_GI_MAP）
   *   - NOVA 加工程度修正（加工越深 GI 越高）
   *   - 膳食纤维修正（纤维越多 GI 越低）
   */
  private calcGlycemicImpactScore(
    food: FoodLibrary,
    servingCarbs: number,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    const gi = food.glycemicIndex
      ? food.glycemicIndex
      : this.estimateGI(food, cfg);
    // V6.8: 无法估算时默认分从配置读取
    if (gi <= 0) return cfg?.giDefaultScore ?? 0.75;
    // 优先使用食物库的 glycemicLoad，否则根据份量碳水计算
    const gl =
      food.glycemicLoad != null && food.glycemicLoad > 0
        ? Number(food.glycemicLoad)
        : (gi * servingCarbs) / 100;
    // V6.8: Sigmoid 斜率和中心点从配置读取
    const slope = cfg?.glSigmoidSlope ?? 0.3;
    const center = cfg?.glSigmoidCenter ?? 15;
    return 1 / (1 + Math.exp(slope * (gl - center)));
  }

  /**
   * V6.3 P1-12: 三因素 GI 估算模型
   *
   * 当食物库无 glycemicIndex 数据时，基于以下三因素估算:
   * 1. 品类基准 GI — 不同品类食物的典型 GI 中位数
   * 2. 加工程度修正 — NOVA 级别越高，淀粉糊化越充分，GI 越高
   * 3. 膳食纤维修正 — 纤维延缓糖吸收，降低 GI
   *
   * 范围锁定 [20, 100]
   */
  private estimateGI(
    food: FoodLibrary,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // V6.8: 品类基准 GI map 从配置读取
    const DEFAULT_CATEGORY_GI_MAP: Record<string, number> = {
      grain: 70, // 谷物类：白米 73，面包 75，燕麦 55 → 中位 70
      veggie: 35, // 蔬菜类：多数 < 40
      protein: 40, // 蛋白质类：肉/鱼/蛋 GI 极低，但混合烹饪会升高
      fruit: 45, // 水果类：苹果 36，香蕉 51，西瓜 72 → 中位 45
      dairy: 35, // 乳制品：牛奶 27，酸奶 36
      fat: 25, // 油脂类：极低 GI
      beverage: 55, // 饮品类：差异大，果汁较高
      snack: 65, // 零食类：多数加工较深
      composite: 60, // 组合类：混合食物
      soup: 40, // 汤类
    };
    const categoryGiMap = cfg?.categoryGiMap ?? DEFAULT_CATEGORY_GI_MAP;
    const fallbackGI = cfg?.giFallback ?? 55;

    const categoryGI = categoryGiMap[food.category] ?? fallbackGI;

    // V6.8: 加工程度修正步长从配置读取
    const processingStep = cfg?.giProcessingStep ?? 5;
    const processingLevel = food.processingLevel ?? 1;
    const processingAdj = Math.max(0, (processingLevel - 1) * processingStep);

    // V6.8: 纤维减量和上限从配置读取
    const fiberReduction = cfg?.giFiberReduction ?? 2;
    const fiberReductionCap = cfg?.giFiberReductionCap ?? 15;
    const fiberPer100g = Number(food.fiber) || 0;
    const fiberAdj = Math.min(fiberPer100g * fiberReduction, fiberReductionCap);

    return Math.max(20, Math.min(100, categoryGI + processingAdj - fiberAdj));
  }

  // ─── V6.5: 可执行性评分 ───

  /**
   * 计算食物可执行性评分 (0-1)
   *
   * 综合以下因素：
   * 1. 大众化程度 (0-0.35)：commonalityScore 越高越容易获取
   * 2. 价格合理性 (0-0.25)：estimatedCostLevel 越低越实惠
   * 3. 烹饪便利性 (0-0.25)：prepTime + cookTime 越短越便利
   * 4. 技能要求 (0-0.15)：skillRequired 越低越容易制作
   *
   * 输出归一化到 0-1，作为第 12 维评分。
   * 更精细的场景化/画像化评分（渠道、预算、时段）由 Phase 1E 画像激活实现。
   */
  private calcExecutabilityScore(
    food: FoodLibrary,
    scoringConfig?: ScoringConfigSnapshot | null,
  ): number {
    // V6.7 Phase 1-B: 子权重从配置读取，默认 0.35/0.25/0.25/0.15
    const subW = scoringConfig?.executabilitySubWeights ?? {
      commonality: 0.35,
      cost: 0.25,
      cookTime: 0.25,
      skill: 0.15,
    };
    let score = 0;

    // 1. 大众化程度
    const commonality = food.commonalityScore ?? 50;
    score += (commonality / 100) * subW.commonality;

    // 2. 价格合理性 (0-0.25)
    // estimatedCostLevel: 1=便宜, 2=适中, 3=偏贵, 4=贵, 5=昂贵
    const costLevel = food.estimatedCostLevel ?? 2;
    const costScore = Math.max(0, 1 - (costLevel - 1) / 4); // 1→1.0, 5→0.0
    score += costScore * subW.cost;

    // 3. 烹饪便利性
    // V6.8: 阈值和分数从配置读取
    const quickTime = scoringConfig?.cookTimeQuick ?? 15;
    const quickScore = scoringConfig?.cookTimeQuickScore ?? 1.0;
    const mediumTime = scoringConfig?.cookTimeMedium ?? 30;
    const mediumScore = scoringConfig?.cookTimeMediumScore ?? 0.8;
    const longTime = scoringConfig?.cookTimeLong ?? 60;
    const longScore = scoringConfig?.cookTimeLongScore ?? 0.5;
    const zeroScore = scoringConfig?.cookTimeZeroScore ?? 0.8;

    const totalTime = (food.prepTimeMinutes ?? 0) + (food.cookTimeMinutes ?? 0);
    let convenienceScore: number;
    if (totalTime === 0) {
      convenienceScore = zeroScore; // 无需烹饪（即食食物）
    } else if (totalTime <= quickTime) {
      convenienceScore = quickScore; // 快手菜
    } else if (totalTime <= mediumTime) {
      convenienceScore = mediumScore;
    } else if (totalTime <= longTime) {
      convenienceScore = longScore;
    } else {
      convenienceScore = Math.max(0, longScore - (totalTime - longTime) / 120);
    }
    score += convenienceScore * subW.cookTime;

    // 4. 技能要求 (0-0.15)
    // skillRequired: 'easy'(1)=简单, 'medium'(2)=中等, 'hard'(3)=困难
    const SKILL_MAP: Record<string, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    };
    const skillLevel = SKILL_MAP[food.skillRequired ?? 'easy'] ?? 1;
    const skillScore = Math.max(0, 1 - (skillLevel - 1) / 2); // 1→1.0, 3→0.0
    score += skillScore * subW.skill;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * V6.9 Phase 1-D: 大众化/常见度评分
   *
   * 与 executability 中的 commonality 子权重有所不同：
   * - executability.commonality 是可执行性的一个子维度（占 35%）
   * - popularity 是独立的评分维度，直接反映食物的大众化接受度
   * - 额外加入渠道适配加分：食物在当前渠道有标注时 +0.1
   *
   * 评分范围: 0-1
   */
  private scorePopularity(
    food: FoodLibrary,
    channel?: AcquisitionChannel,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // 基础大众化分: commonalityScore 0-100 → 归一化到 0-1
    const basePop = (food.commonalityScore ?? 50) / 100;

    // 渠道调整: 如果食物在当前渠道有明确标注且包含该渠道，加分
    let channelBonus = 0;
    if (channel && food.availableChannels?.includes(channel)) {
      channelBonus = cfg?.tuning?.channelMatchBonus ?? 0.1;
    }

    return Math.min(1, basePop + channelBonus);
  }

  // ─── V6.7 Phase 1-A: 含水率估算 ───

  /**
   * 当 food.waterContentPercent 字段不存在时，基于品类估算含水率。
   * 数据来源：中国食物成分表品类中位数。
   * Phase 1-B (ScoringConfigService) 完成后可通过 Prisma 新增字段实现精确值。
   */
  private estimateWaterContent(
    food: FoodLibrary,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    // V6.8: 品类含水量 map 从配置读取
    const DEFAULT_CATEGORY_WATER_MAP: Record<string, number> = {
      veggie: 90, // 蔬菜类：绝大多数 > 85%
      fruit: 85, // 水果类：多数 80-92%
      beverage: 95, // 饮品类
      dairy: 87, // 乳制品：牛奶 87%，酸奶 80%
      protein: 65, // 蛋白质类：肉 60-75%
      grain: 12, // 谷物类（干态）
      composite: 55, // 组合类：差异大
      snack: 5, // 零食类
      fat: 0, // 油脂类
      condiment: 50, // 调味品：差异大
    };
    const waterMap = cfg?.categoryWaterMap ?? DEFAULT_CATEGORY_WATER_MAP;
    return waterMap[food.category] ?? 50;
  }

  // ─── V7.4 Phase 3-C: 食物可获得性评分 ───

  /**
   * 基于 acquisitionDifficulty (1-5) 计算可获得性评分。
   *
   * 映射逻辑:
   * - 1 (随处可得) → 1.0
   * - 2 (常见)     → 0.85
   * - 3 (普通)     → 0.65
   * - 4 (较难)     → 0.40
   * - 5 (稀有)     → 0.15
   *
   * 非线性映射（不是简单线性反转），因为用户体验中
   * "随处可得"和"常见"的差距远小于"较难"和"稀有"的差距。
   *
   * 评分范围: 0-1
   */
  private calcAcquisitionScore(
    food: FoodLibrary,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    const difficulty = food.acquisitionDifficulty ?? 3;
    // 非线性映射表: difficulty 1-5 → score（V7.5: 从配置读取）
    const DEFAULT_MAP: Record<number, number> = {
      1: 1.0,
      2: 0.85,
      3: 0.65,
      4: 0.4,
      5: 0.15,
    };
    const scoreMap = cfg?.tuning?.acquisitionScoreMap ?? DEFAULT_MAP;
    return scoreMap[Math.min(5, Math.max(1, difficulty))] ?? 0.65;
  }
}
