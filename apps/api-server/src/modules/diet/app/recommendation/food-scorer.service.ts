import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import { GoalType } from '../nutrition-score.service';
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
} from './recommendation.types';
import {
  HealthModifierEngineService,
  HealthModifierContext,
} from './health-modifier-engine.service';
import { ScoringExplanation } from './scoring-explanation.interface';
import { RankPolicyConfig } from '../../../strategy/strategy.types';
import { RecommendationConfigService } from './recommendation.config';
import {
  NutritionTargetService,
  NutritionTargets,
} from './nutrition-target.service';
import { SeasonalityService } from './seasonality.service';

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
   * 用于在 NRF 9.3 评分中插补缺失的微量营养素数据
   * 由 RecommendationEngineService 在食物池加载后设置
   */
  private categoryMicroDefaults: Map<string, MicroNutrientDefaults> | null =
    null;

  constructor(
    private readonly penaltyEngine: HealthModifierEngineService,
    private readonly recommendationConfig: RecommendationConfigService,
    private readonly nutritionTargetService: NutritionTargetService,
    private readonly seasonalityService: SeasonalityService,
  ) {}

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
      lifestyleAdjustment,
    } = ctx;

    const servingCal = (food.calories * food.standardServingG) / 100;
    const servingProtein = ((food.protein || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbs || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fat || 0) * food.standardServingG) / 100;

    const quality = food.qualityScore || CATEGORY_QUALITY[food.category] || 5;
    const satiety = food.satietyScore || CATEGORY_SATIETY[food.category] || 4;

    // 热量评分：钟形函数
    const targetCal = target?.calories || 400;
    const caloriesScore = this.calcEnergyScore(servingCal, targetCal, goalType);

    // 蛋白质评分：分段函数
    const proteinScore = this.calcProteinScore(
      servingProtein,
      servingCal,
      goalType,
    );

    // 碳水/脂肪：V4 目标自适应区间评分 (修复 E2)
    const macroRange = MACRO_RANGES[goalType] || MACRO_RANGES.health;
    const carbsScore =
      servingCal > 0
        ? this.rangeScore(
            (servingCarbs * 4) / servingCal,
            macroRange.carb[0],
            macroRange.carb[1],
          )
        : 0.5;
    const fatScore =
      servingCal > 0
        ? this.rangeScore(
            (servingFat * 9) / servingCal,
            macroRange.fat[0],
            macroRange.fat[1],
          )
        : 0.5;

    const qualityScore = this.logScale(quality);
    const satietyScore = this.logScale(satiety);

    // 血糖影响评分：Sigmoid(GL)
    const glycemicScore = this.calcGlycemicImpactScore(food, servingCarbs);

    // 微量营养密度评分：NRF 9.3
    // V6.3 P1-2: 传入用户营养缺口，对缺乏营养素的食物额外加分
    // V6.3 P1-10: 传入个性化营养目标，替代硬编码 DV
    let nutrientDensityScore = this.calcNutrientDensityScore(
      food,
      nutritionGaps,
      nutritionTargets,
    );

    // V6.7 Phase 1-A: 消费 lifestyleAdjustment 信号（修复 waterContent/tryptophan 断路）
    if (lifestyleAdjustment) {
      // waterContent boost：高含水率食物在高饮水目标用户中加分
      const waterAdj = lifestyleAdjustment['waterContent'] ?? 0;
      if (waterAdj > 0) {
        // 使用食物含水率属性（若存在），回退到品类估算
        const waterPct =
          Number((food as any).waterContentPercent) ||
          this.estimateWaterContent(food);
        if (waterPct > 80) {
          nutrientDensityScore = Math.min(
            1,
            nutrientDensityScore + waterAdj * 0.8,
          );
        } else if (waterPct > 60) {
          nutrientDensityScore = Math.min(
            1,
            nutrientDensityScore + waterAdj * 0.4,
          );
        }
      }

      // tryptophan boost：色氨酸丰富食物在睡眠质量差的用户中加分
      const tryptAdj = lifestyleAdjustment['tryptophan'] ?? 0;
      if (tryptAdj > 0) {
        const TRYPTOPHAN_RICH_TAGS = [
          'poultry',
          'dairy',
          'banana',
          'oats',
          'eggs',
          'seeds',
          'nuts',
          'turkey',
        ];
        const hasTryptophan = TRYPTOPHAN_RICH_TAGS.some(
          (t) =>
            food.tags?.includes(t) ||
            food.category === t ||
            food.mainIngredient?.toLowerCase().includes(t),
        );
        if (hasTryptophan) {
          nutrientDensityScore = Math.min(1, nutrientDensityScore + tryptAdj);
        }
      }
    }

    // 炎症指数评分：基于反式脂肪+饱和脂肪+纤维
    const inflammationScore = this.calcInflammationScore(food);

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
    const executabilityScore = this.calcExecutabilityScore(food);

    const weights = computeWeights(
      goalType as GoalType,
      mealType,
      statusFlags,
      weightOverrides,
      mealWeightOverrides, // V5 4.8: A/B 实验组覆盖的餐次权重修正
      rankPolicy, // V6 2.2: 策略引擎排序策略配置（优先级最高）
      this.recommendationConfig.getBaseWeights(goalType), // V6.2 3.2: 运行时可配置权重
    );
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
    ];

    const confidence = Number(food.confidence) || 0.5;
    const confidenceFactor = 0.7 + 0.3 * confidence;
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // ── NOVA 阶梯惩罚 ──
    const novaPenalty = this.calcNovaPenalty(food);
    rawScore *= novaPenalty;

    // ── V6.2 3.3: addedSugar 惩罚 ──
    // 每 10g 添加糖扣 15 分（乘数），上限 -15 分
    const addedSugarPenalty = food.addedSugar
      ? Math.min(Number(food.addedSugar) / 10, 1) * -15
      : 0;
    rawScore += addedSugarPenalty;

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
  ): number {
    if (target <= 0) return 0.8;
    const sigmaRatio: Record<string, number> = {
      fat_loss: 0.12,
      muscle_gain: 0.2,
      health: 0.15,
      habit: 0.25,
    };
    const sigma = target * (sigmaRatio[goalType] || 0.15);
    const diff = actual - target;
    let score = Math.exp(-(diff * diff) / (2 * sigma * sigma));

    if (goalType === 'fat_loss' && diff > 0) score *= 0.85;
    if (goalType === 'muscle_gain' && diff < 0) score *= 0.9;
    return score;
  }

  /** 蛋白质评分 — 分段函数 */
  private calcProteinScore(
    protein: number,
    calories: number,
    goalType: string,
  ): number {
    if (calories <= 0) return 0.8;
    const ratio = (protein * 4) / calories;
    const ranges: Record<string, [number, number]> = {
      fat_loss: [0.25, 0.35],
      muscle_gain: [0.25, 0.4],
      health: [0.15, 0.25],
      habit: [0.12, 0.3],
    };
    const [min, max] = ranges[goalType] || [0.15, 0.25];

    if (ratio >= min && ratio <= max) return 1.0;
    if (ratio < min) return Math.max(0, 0.3 + 0.7 * (ratio / min));
    return Math.max(0, 1.0 - 0.5 * ((ratio - max) / 0.15));
  }

  /** 区间评分 */
  private rangeScore(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 1.0;
    const diff = value < min ? min - value : value - max;
    return Math.max(0, 1.0 - diff * 2);
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
   * NRF 9.3 微量营养密度评分
   * 鼓励9种: 蛋白质、纤维、维A、维C、维D、维E、钙、铁、钾
   * 限制3种: 饱和脂肪、添加糖、钠
   * 每项按 DV% 计算后 cap 到 100%，总分归一化到 0-1
   * 基于 per 100g 数据计算
   *
   * V4 Phase 4.7: 糖分惩罚改用 addedSugar（添加糖）替代总糖
   * 当 addedSugar 字段可用时，仅惩罚添加糖，天然糖（水果糖/乳糖）不扣分
   * 这修正了水果和乳制品在 NRF 9.3 中被不合理降分的问题
   *
   * V5 2.7: 当微量营养素字段缺失（null/0）时，使用品类均值插补
   * 这避免了数据不完整的食物被系统性低估
   */
  private calcNutrientDensityScore(
    food: FoodLibrary,
    nutritionGaps?: string[] | null,
    /** V6.3 P1-10: 个性化营养目标，替代硬编码 DV */
    nutritionTargets?: NutritionTargets | null,
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
    };

    const LIMIT_DV = {
      saturatedFat: nutritionTargets?.saturatedFatLimit ?? 20, // g
      addedSugar: nutritionTargets?.addedSugarLimit ?? 50, // g
      sodium: nutritionTargets?.sodiumLimit ?? 2300, // mg
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
      Math.min((impute(food.potassium, 'potassium') / DV.potassium) * 100, 100);

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
      Math.min(((food.sodium || 0) / LIMIT_DV.sodium) * 100, 100);

    // NRF9.3 原始分 = encourage - discourage
    // 理论范围: -300 ~ 900, 实际大部分食物在 -50 ~ 400
    const raw = encourage - discourage;

    // V6.3 P1-2: 营养缺口加权 — 如果用户缺乏特定营养素，
    // 且该食物富含该营养素（>= 15% DV），额外加分
    // 每个匹配的缺口营养素 +20 分（等效于额外 ~20% DV 的鼓励分），封顶 +80 分
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
      };

      for (const gap of nutritionGaps) {
        const dvPct = nutrientDvPercent[gap];
        // 只有该食物确实富含该缺口营养素（>= 15% DV）才加分
        if (dvPct !== undefined && dvPct >= 15) {
          gapBonus += 20;
        }
      }
      gapBonus = Math.min(gapBonus, 80); // 封顶 +80 分
    }

    // 归一化到 0-1: 使用 Sigmoid 平滑映射
    // 中心点 150（中等营养密度），斜率 0.01
    return 1 / (1 + Math.exp(-0.01 * (raw + gapBonus - 150)));
  }

  /**
   * 炎症指数评分 (Anti-Inflammatory Score)
   * 促炎因子: 反式脂肪(强)、饱和脂肪(中)
   * 抗炎因子: 纤维(中)
   * 基于 per 100g 数据计算，返回 0-1 (1=抗炎/无炎症风险)
   */
  private calcInflammationScore(food: FoodLibrary): number {
    const transFat = Number(food.transFat) || 0;
    const saturatedFat = Number(food.saturatedFat) || 0;
    const fiber = Number(food.fiber) || 0;

    // 促炎分 (0-100):
    // 反式脂肪: >0.5g/100g 显著促炎, 权重最高
    // 饱和脂肪: >5g/100g 中度促炎
    const transInflam = Math.min(transFat / 2, 1) * 50; // 0-50 (2g→满分)
    const satInflam = Math.min(saturatedFat / 10, 1) * 30; // 0-30 (10g→满分)
    const proInflammatory = transInflam + satInflam; // 0-80

    // 抗炎分 (0-40):
    // 纤维: 5g+/100g 显著抗炎
    const antiInflammatory = Math.min(fiber / 5, 1) * 40; // 0-40

    // 净炎症指数: 低=好, 高=差
    // 范围大约 -40 ~ 80
    const netInflammation = proInflammatory - antiInflammatory;

    // 归一化到 0-1: Sigmoid, 中心点 20, 斜率 -0.08 (越炎越低分)
    return 1 / (1 + Math.exp(0.08 * (netInflammation - 20)));
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
  private calcNovaPenalty(food: FoodLibrary): number {
    const processingLevel = food.processingLevel ?? 1;
    // index 0 兜底，index 1-4 对应 NOVA 1-4
    const NOVA_BASE = [1.0, 1.0, 1.0, 0.85, 0.55];
    const level = Math.max(0, Math.min(4, processingLevel));
    let penalty = NOVA_BASE[level];

    // 单品微调仅对 NOVA 3/4 生效（NOVA 1/2 不惩罚，无需微调）
    if (level >= 3) {
      // 高纤维缓解（全麦/高纤维加工食品不应被过度惩罚）
      if ((Number(food.fiber) || 0) >= 3) {
        penalty += 0.05;
      }
      // 低添加糖缓解（无糖/低糖加工食品）
      const sugar =
        food.addedSugar != null
          ? Number(food.addedSugar)
          : Number(food.sugar) || 0;
      if (sugar < 5) {
        penalty += 0.05;
      }
      // 低饱和脂肪缓解（脱脂/低脂加工食品）
      if ((Number(food.saturatedFat) || 0) < 3) {
        penalty += 0.05;
      }
      // 高钠加重（重盐加工食品）
      if ((Number(food.sodium) || 0) > 800) {
        penalty -= 0.05;
      }

      // 锁定范围: NOVA 3 [0.75, 0.95], NOVA 4 [0.45, 0.70]
      const minPenalty = level === 3 ? 0.75 : 0.45;
      const maxPenalty = level === 3 ? 0.95 : 0.7;
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
  ): number {
    const gi = food.glycemicIndex ? food.glycemicIndex : this.estimateGI(food);
    if (gi <= 0) return 0.75; // 无法估算时给中等分
    // 优先使用食物库的 glycemicLoad，否则根据份量碳水计算
    const gl =
      food.glycemicLoad != null && food.glycemicLoad > 0
        ? Number(food.glycemicLoad)
        : (gi * servingCarbs) / 100;
    // Sigmoid: score = 1 / (1 + e^(0.3 * (GL - 15)))
    return 1 / (1 + Math.exp(0.3 * (gl - 15)));
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
  private estimateGI(food: FoodLibrary): number {
    // 品类基准 GI（基于 GI 文献中位数）
    const CATEGORY_GI_MAP: Record<string, number> = {
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

    const categoryGI = CATEGORY_GI_MAP[food.category] ?? 55;

    // 加工程度修正: NOVA 1 → +0, NOVA 2 → +5, NOVA 3 → +10, NOVA 4 → +15
    const processingLevel = food.processingLevel ?? 1;
    const processingAdj = Math.max(0, (processingLevel - 1) * 5);

    // 膳食纤维修正: 每 g 纤维/100g 降低 ~2 GI 点，封顶 -15
    const fiberPer100g = Number(food.fiber) || 0;
    const fiberAdj = Math.min(fiberPer100g * 2, 15);

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
  private calcExecutabilityScore(food: FoodLibrary): number {
    let score = 0;

    // 1. 大众化程度 (0-0.35)
    const commonality = food.commonalityScore ?? 50;
    score += (commonality / 100) * 0.35;

    // 2. 价格合理性 (0-0.25)
    // estimatedCostLevel: 1=便宜, 2=适中, 3=偏贵, 4=贵, 5=昂贵
    const costLevel = food.estimatedCostLevel ?? 2;
    const costScore = Math.max(0, 1 - (costLevel - 1) / 4); // 1→1.0, 5→0.0
    score += costScore * 0.25;

    // 3. 烹饪便利性 (0-0.25)
    // 总制作时间 = prepTime + cookTime
    const totalTime = (food.prepTimeMinutes ?? 0) + (food.cookTimeMinutes ?? 0);
    let convenienceScore: number;
    if (totalTime === 0) {
      convenienceScore = 0.8; // 无需烹饪（即食食物）
    } else if (totalTime <= 15) {
      convenienceScore = 1.0; // 快手菜
    } else if (totalTime <= 30) {
      convenienceScore = 0.8;
    } else if (totalTime <= 60) {
      convenienceScore = 0.5;
    } else {
      convenienceScore = Math.max(0, 0.5 - (totalTime - 60) / 120);
    }
    score += convenienceScore * 0.25;

    // 4. 技能要求 (0-0.15)
    // skillRequired: 'easy'(1)=简单, 'medium'(2)=中等, 'hard'(3)=困难
    const SKILL_MAP: Record<string, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    };
    const skillLevel = SKILL_MAP[food.skillRequired ?? 'easy'] ?? 1;
    const skillScore = Math.max(0, 1 - (skillLevel - 1) / 2); // 1→1.0, 3→0.0
    score += skillScore * 0.15;

    return Math.max(0, Math.min(1, score));
  }
}
