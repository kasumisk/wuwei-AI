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
} from './recommendation.types';
import {
  HealthModifierEngineService,
  HealthModifierContext,
} from './health-modifier-engine.service';
import { ScoringExplanation } from './scoring-explanation.interface';
import { RankPolicyConfig } from '../../../strategy/strategy.types';

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

  constructor(private readonly penaltyEngine: HealthModifierEngineService) {}

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
  ): number {
    return this.scoreFoodDetailed(
      food,
      goalType,
      target,
      penaltyContext,
      mealType,
      statusFlags,
      weightOverrides,
      mealWeightOverrides,
      rankPolicy,
    ).score;
  }

  /**
   * 评分并返回详细分解 — V4 Phase 2.3 (D8)
   *
   * 返回最终分数 + ScoringExplanation 骨架。
   * 上游（recommendation-engine）负责填充 preferenceBoost / profileBoost /
   * regionalBoost / explorationMultiplier / similarityPenalty / finalScore。
   *
   * @param weightOverrides A/B 实验组覆盖的基础权重（Phase 3.8）
   * @param mealWeightOverrides A/B 实验组覆盖的餐次权重修正（V5 4.8）
   * @param rankPolicy V6 2.2: 策略引擎排序策略配置（优先级最高）
   */
  scoreFoodDetailed(
    food: FoodLibrary,
    goalType: string,
    target?: MealTarget,
    penaltyContext?: HealthModifierContext,
    mealType?: string,
    statusFlags?: string[],
    weightOverrides?: number[] | null,
    mealWeightOverrides?: Record<string, Record<string, number>> | null,
    rankPolicy?: RankPolicyConfig | null,
  ): ScorerDetailedResult {
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
    const nutrientDensityScore = this.calcNutrientDensityScore(food);

    // 炎症指数评分：基于反式脂肪+饱和脂肪+纤维
    const inflammationScore = this.calcInflammationScore(food);

    // V5 2.6: 膳食纤维评分 — 按份量纤维 vs 餐次目标
    const fiberScore = this.calcFiberScore(food, goalType, mealType);

    const weights = computeWeights(
      goalType as GoalType,
      mealType,
      statusFlags,
      weightOverrides,
      mealWeightOverrides, // V5 4.8: A/B 实验组覆盖的餐次权重修正
      rankPolicy, // V6 2.2: 策略引擎排序策略配置（优先级最高）
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
    ];

    const confidence = Number(food.confidence) || 0.5;
    const confidenceFactor = 0.7 + 0.3 * confidence;
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // ── NOVA 阶梯惩罚 ──
    const novaPenalty = this.calcNovaPenalty(food.processingLevel ?? 1);
    rawScore *= novaPenalty;

    // ── 健康修正引擎 ──
    const penalty = this.penaltyEngine.evaluate(food, {
      ...penaltyContext,
      goalType,
    });
    if (penalty.isVetoed) {
      return {
        score: 0,
        explanation: this.buildExplanation(
          scores,
          weights,
          novaPenalty,
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
      },
      novaPenalty,
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
  private calcNutrientDensityScore(food: FoodLibrary): number {
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

    // 每日推荐值 (DV) — 基于 FDA 标准
    const DV = {
      protein: 50, // g
      fiber: 28, // g
      vitaminA: 900, // ug RAE
      vitaminC: 90, // mg
      vitaminD: 20, // ug
      vitaminE: 15, // mg
      calcium: 1300, // mg
      iron: 18, // mg
      potassium: 4700, // mg
    };

    const LIMIT_DV = {
      saturatedFat: 20, // g
      addedSugar: 50, // g (FDA 2020 DV for added sugars)
      sodium: 2300, // mg
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

    // 归一化到 0-1: 使用 Sigmoid 平滑映射
    // 中心点 150（中等营养密度），斜率 0.01
    return 1 / (1 + Math.exp(-0.01 * (raw - 150)));
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
   * 每日推荐膳食纤维 25~30g（取中值 27.5g），按餐次比例分配目标
   * 评分 = min(1.0, 实际纤维 / 餐次纤维目标)
   *
   * @param food 食物
   * @param goalType 目标类型（决定餐次比例）
   * @param mealType 餐次类型（决定纤维分配比例）
   */
  private calcFiberScore(
    food: FoodLibrary,
    goalType: string,
    mealType?: string,
  ): number {
    const DAILY_FIBER_TARGET = 27.5; // g/天（中国居民膳食指南推荐 25-30g）
    const fiber = ((food.fiber || 0) * food.standardServingG) / 100; // 按份量换算

    // 获取餐次热量比例作为纤维分配比例
    const ratios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;
    const mealRatio = (mealType && ratios[mealType]) || 0.25;
    const mealFiberTarget = Math.max(DAILY_FIBER_TARGET * mealRatio, 1);

    return Math.min(1.0, fiber / mealFiberTarget);
  }

  /**
   * NOVA 加工程度阶梯惩罚
   * NOVA 1 (天然/未加工): 1.0 — 无惩罚
   * NOVA 2 (加工原料如油/糖/面粉): 1.0 — 无惩罚
   * NOVA 3 (加工食品如罐头/腌制): 0.85 — 轻度惩罚
   * NOVA 4 (超加工如方便面/薯片): 0.55 — 重度惩罚
   * 返回 0-1 乘数因子
   */
  private calcNovaPenalty(processingLevel: number): number {
    // index 0 兜底，index 1-4 对应 NOVA 1-4
    const NOVA_SCALE = [1.0, 1.0, 1.0, 0.85, 0.55];
    const level = Math.max(0, Math.min(4, processingLevel));
    return NOVA_SCALE[level];
  }

  /**
   * 血糖影响评分 — Sigmoid(GL)
   * GL = GI × 碳水(g/份) / 100
   * 返回 0-1 区间
   */
  private calcGlycemicImpactScore(
    food: FoodLibrary,
    servingCarbs: number,
  ): number {
    const gi = food.glycemicIndex || 0;
    if (gi <= 0) return 0.75; // 无 GI 数据给中等分
    // 优先使用食物库的 glycemicLoad，否则根据份量碳水计算
    const gl =
      food.glycemicLoad != null && food.glycemicLoad > 0
        ? Number(food.glycemicLoad)
        : (gi * servingCarbs) / 100;
    // Sigmoid: score = 1 / (1 + e^(0.3 * (GL - 15)))
    return 1 / (1 + Math.exp(0.3 * (gl - 15)));
  }
}
