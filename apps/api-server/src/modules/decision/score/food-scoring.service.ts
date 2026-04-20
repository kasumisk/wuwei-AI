/**
 * V3.5 — 食物评分门面服务（健康感知评分）
 *
 * 职责:
 * - calculateScore: 计算综合评分（健康分/营养分/置信度/7维breakdown）
 * - explainBreakdown: 为每个维度生成人类可读解释
 * - estimateQuality / estimateSatiety: 使用 nutrition-estimator 纯函数（V1.9 打破循环依赖）
 *
 * 设计原则:
 * - 无状态，所有数据通过参数传入
 * - 复用 NutritionScoreService、BehaviorService、FoodService
 * - V1.9: 引用共享常量 scoring-dimensions.ts，使用 nutrition-estimator 纯函数
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  NutritionScoreService,
  NutritionScoreBreakdown,
  NutritionScoreResult,
} from '../../diet/app/services/nutrition-score.service';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { FoodService } from '../../diet/app/services/food.service';
import { AnalysisScore } from '../types/analysis-result.types';
import type { AnalyzedFoodItem } from '../types/food-item.types';
import type { BreakdownExplanation } from '../types/decision.types';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';
import {
  estimateQuality as _estimateQuality,
  estimateSatiety as _estimateSatiety,
} from '../../food/app/config/nutrition-estimator';
import { aggregateWithConfidence } from './confidence-weighting';
import {
  DIMENSION_LABELS,
  DIMENSION_EXPLANATIONS,
  scoreToImpact,
  getDimensionSuggestion,
} from '../config/scoring-dimensions';
import { hasCondition } from '../config/condition-aliases';

// ==================== 输入/输出类型 ====================

/**
 * V4.7: 评分输入 — 从 AnalyzedFoodItem 中 Pick 评分所需字段
 *
 * 不再独立定义重复接口，直接复用 AnalyzedFoodItem 类型子集。
 */
export type ScoringFoodItem = Pick<
  AnalyzedFoodItem,
  | 'name'
  | 'confidence'
  | 'calories'
  | 'estimatedWeightGrams'
  | 'saturatedFat'
  | 'addedSugar'
  | 'transFat'
  | 'cholesterol'
  | 'glycemicLoad'
  | 'nutrientDensity'
  | 'fodmapLevel'
  | 'purine'
  | 'oxalateLevel'
> & {
  /** 必须字段（AnalyzedFoodItem 中为 optional，评分链路中保证存在） */
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sodium?: number;
  /** 标准库匹配（有则用库的 quality/satiety） */
  libraryMatch?: {
    qualityScore?: number | string | null;
    satietyScore?: number | string | null;
  };
};

/** 评分上下文 */
export interface ScoringContext {
  /** 用户画像（传给 calculateDailyGoals） */
  profile: any;
  /** 今日已摄入 */
  todayCalories: number;
  todayProtein: number;
  todayFat: number;
  todayCarbs: number;
  /** 目标类型 */
  goalType: string;
  /** V3.5: 用户健康条件（用于调整 healthScore） */
  healthConditions?: string[];
  /** V4.0: 目标阶段权重调整（来自 GoalPhaseService） */
  phaseWeightAdjustment?: Partial<Record<string, number>>;
}

/** 图片链路评分输入（AI 已计算 avgQuality/avgSatiety） */
export interface ImageScoringInput {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  avgQuality: number;
  avgSatiety: number;
  /** V3.6 P1.4: 健康条件（用于调整 healthScore） */
  healthConditions?: string[];
}

/** Re-exported from decision.types.ts for convenience */
export type { BreakdownExplanation } from '../types/decision.types';

/** 完整评分结果 */
export interface ScoringResult {
  /** 分析评分 */
  analysisScore: AnalysisScore;
  /** 原始 NutritionScoreResult（含 highlights/decision） */
  rawScoreResult?: NutritionScoreResult;
  /** 7维解释 */
  breakdownExplanations?: BreakdownExplanation[];
}

// V1.9: DIMENSION_LABELS + DIMENSION_EXPLANATIONS 已提取到 scoring-dimensions.ts

@Injectable()
export class FoodScoringService {
  private readonly logger = new Logger(FoodScoringService.name);

  constructor(
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly behaviorService: BehaviorService,
    private readonly foodService: FoodService,
  ) {}

  // ==================== 公共方法 ====================

  /**
   * 计算综合评分（文本链路）
   *
   * 从 TextFoodAnalysisService.calculateScore() 提取的完整评分逻辑
   */
  async calculateScore(
    foods: ScoringFoodItem[],
    totals: { calories: number; protein: number; fat: number; carbs: number },
    ctx: ScoringContext,
    userId?: string,
    locale: Locale = 'zh-CN',
  ): Promise<ScoringResult> {
    // 置信度: 食物置信度均值
    const avgConfidence =
      foods.length > 0
        ? Math.round(
            (foods.reduce((s, f) => s + f.confidence, 0) / foods.length) * 100,
          )
        : 50;

    let nutritionScore = 70;
    let healthScore = 70;
    let breakdown: NutritionScoreBreakdown | undefined;
    let rawScoreResult: NutritionScoreResult | undefined;
    let breakdownExplanations: BreakdownExplanation[] | undefined;

    try {
      if (ctx.profile) {
        const goals = this.nutritionScoreService.calculateDailyGoals(
          ctx.profile,
        );
        const todayTotals = {
          calories: ctx.todayCalories,
          protein: ctx.todayProtein,
          fat: ctx.todayFat,
          carbs: ctx.todayCarbs,
        };

        // 食物质量和饱腹感：标准库优先，否则用估算
        const avgQuality =
          foods.reduce(
            (s, f) =>
              s +
              (f.libraryMatch
                ? Number(f.libraryMatch.qualityScore) || 5
                : this.estimateQuality(f)),
            0,
          ) / Math.max(1, foods.length);
        const avgSatiety =
          foods.reduce(
            (s, f) =>
              s +
              (f.libraryMatch
                ? Number(f.libraryMatch.satietyScore) || 5
                : this.estimateSatiety(f)),
            0,
          ) / Math.max(1, foods.length);

        // V2.1: 使用共享 fetchStabilityData
        const stabilityData = userId
          ? await this.fetchStabilityData(userId, ctx.profile)
          : undefined;

        // V2.2: 置信度加权 — 低置信度食物的营养数据向单餐目标衰减
        const mealsPerDay = ctx.profile?.mealsPerDay || 3;
        const mealTarget = {
          calories: goals.calories / mealsPerDay,
          protein: goals.protein / mealsPerDay,
          fat: goals.fat / mealsPerDay,
          carbs: goals.carbs / mealsPerDay,
        };
        const weightedTotals = aggregateWithConfidence(foods, mealTarget);

        // V2.1: 委托 computeScoreCore
        const core = await this.computeScoreCore({
          mealNutrition: weightedTotals,
          avgQuality,
          avgSatiety,
          todayTotals,
          goals,
          goalType: ctx.goalType,
          stabilityData,
          locale,
          quantitativeData: {
            mealCalories: totals.calories,
            targetCalories: goals.calories,
            mealProtein: totals.protein,
            proteinRatioPercent:
              totals.calories > 0
                ? Math.round(((totals.protein * 4) / totals.calories) * 100)
                : undefined,
            avgQuality,
            avgSatiety,
          },
          avgConfidence,
          phaseWeightAdjustment: ctx.phaseWeightAdjustment,
        });

        nutritionScore = core.scoreResult.score;
        breakdown = core.scoreResult.breakdown;
        rawScoreResult = core.scoreResult;
        breakdownExplanations = core.breakdownExplanations;
        healthScore = Math.round(nutritionScore * 0.6 + avgQuality * 10 * 0.4);

        // V3.5 P1.1: 健康条件分数调整（只影响 healthScore，保留客观 nutritionScore）
        if (
          ctx.healthConditions &&
          ctx.healthConditions.length > 0 &&
          breakdown
        ) {
          const adjustment = this.applyHealthConditionAdjustment(
            healthScore,
            ctx.healthConditions,
            breakdown,
            foods,
            breakdownExplanations,
            locale,
          );
          healthScore = adjustment.adjustedHealthScore;
          breakdownExplanations = adjustment.explanations;
        }
      }
    } catch {
      // 评分失败不阻断
    }

    const analysisScore: AnalysisScore = {
      healthScore: Math.min(100, Math.max(0, healthScore)),
      nutritionScore: Math.min(100, Math.max(0, nutritionScore)),
      confidenceScore: avgConfidence,
      breakdown,
    };

    return {
      analysisScore,
      rawScoreResult,
      breakdownExplanations,
    };
  }

  /**
   * 计算综合评分（图片链路）
   *
   * 从 ImageFoodAnalysisService.applyScoreEngine() 提取
   */
  async calculateImageScore(
    input: ImageScoringInput,
    userId: string,
    goalType: string,
    profile: any,
    locale: Locale = 'zh-CN',
  ): Promise<{
    score: number;
    breakdown: NutritionScoreBreakdown;
    highlights: string[];
    decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
    breakdownExplanations: BreakdownExplanation[];
  }> {
    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const summary = await this.foodService.getTodaySummary(userId);
    const todayTotals = {
      calories: summary.totalCalories,
      protein: Number(summary.totalProtein) || 0,
      fat: Number(summary.totalFat) || 0,
      carbs: Number(summary.totalCarbs) || 0,
    };

    // V2.1: 使用共享 fetchStabilityData
    const stabilityData = await this.fetchStabilityData(userId, profile);

    // V2.1: 委托 computeScoreCore
    const { scoreResult, breakdownExplanations } = await this.computeScoreCore({
      mealNutrition: {
        calories: input.calories,
        protein: input.protein,
        fat: input.fat,
        carbs: input.carbs,
      },
      avgQuality: input.avgQuality,
      avgSatiety: input.avgSatiety,
      todayTotals,
      goals,
      goalType,
      stabilityData,
      locale,
    });

    // V3.6 P1.4: 健康条件分数调整（只影响 healthScore，保留客观 nutritionScore）
    let adjustedBreakdownExplanations = breakdownExplanations;
    if (
      input.healthConditions &&
      input.healthConditions.length > 0 &&
      scoreResult.breakdown
    ) {
      const adjustment = this.applyHealthConditionAdjustment(
        scoreResult.score,
        input.healthConditions,
        scoreResult.breakdown,
        [],
        breakdownExplanations,
        locale,
      );
      adjustedBreakdownExplanations = adjustment.explanations ?? [];
    }

    return {
      ...scoreResult,
      breakdownExplanations: adjustedBreakdownExplanations,
    };
  }

  // ==================== 维度解释 ====================

  /**
   * 为 7 维 breakdown 生成人类可读解释
   */
  explainBreakdown(
    breakdown: NutritionScoreBreakdown,
    locale: Locale = 'zh-CN',
    quantitativeData?: {
      mealCalories?: number;
      targetCalories?: number;
      mealProtein?: number;
      targetProtein?: number;
      proteinRatioPercent?: number;
      avgQuality?: number;
      avgSatiety?: number;
    },
  ): BreakdownExplanation[] {
    const labels = DIMENSION_LABELS[locale] || DIMENSION_LABELS['zh-CN'];
    const explanations =
      DIMENSION_EXPLANATIONS[locale] || DIMENSION_EXPLANATIONS['zh-CN'];

    const dimensions: Array<keyof NutritionScoreBreakdown> = [
      'energy',
      'proteinRatio',
      'macroBalance',
      'foodQuality',
      'satiety',
      'stability',
      'glycemicImpact',
    ];

    return dimensions.map((dim) => {
      const score = breakdown[dim] ?? 75;
      const impact = this.scoreToImpact(score);

      const result: BreakdownExplanation = {
        dimension: dim,
        label: labels[dim] || dim,
        score: score as number,
        impact,
        message: explanations[dim]?.[impact] || '',
      };

      // V1.9: populate suggestion for warning/critical dimensions
      if (impact === 'warning' || impact === 'critical') {
        const suggestion = getDimensionSuggestion(dim, impact, locale);
        if (suggestion) {
          result.suggestion = suggestion;
        }
      }

      // V1.7: populate quantitative fields when data is available
      if (quantitativeData) {
        switch (dim) {
          case 'energy':
            if (quantitativeData.mealCalories != null) {
              result.actualValue = quantitativeData.mealCalories;
              result.targetValue = quantitativeData.targetCalories;
              result.unit = 'kcal';
            }
            break;
          case 'proteinRatio':
            if (quantitativeData.proteinRatioPercent != null) {
              result.actualValue = quantitativeData.proteinRatioPercent;
              result.targetValue = 25; // default for fat_loss/muscle_gain
              result.unit = '%';
            }
            break;
          case 'foodQuality':
            if (quantitativeData.avgQuality != null) {
              result.actualValue = quantitativeData.avgQuality;
              result.targetValue = 7;
              result.unit = 'score';
            }
            break;
          case 'satiety':
            if (quantitativeData.avgSatiety != null) {
              result.actualValue = quantitativeData.avgSatiety;
              result.targetValue = 7;
              result.unit = 'score';
            }
            break;
        }
      }

      return result;
    });
  }

  // ==================== 委托方法（V1.9: 使用纯函数，不再依赖 FoodDecisionService） ====================

  /**
   * 估算食物质量分
   */
  estimateQuality(food: ScoringFoodItem): number {
    return _estimateQuality(food);
  }

  /**
   * 估算饱腹感分
   */
  estimateSatiety(food: ScoringFoodItem): number {
    return _estimateSatiety(food);
  }

  // ==================== 私有方法 ====================

  /**
   * V2.1: 统一评分核心 — calculateScore 和 calculateImageScore 的共享逻辑
   *
   * 消除两条链路在 stabilityData获取 → calculateMealScore → explainBreakdown 上的重复
   */
  private async computeScoreCore(params: {
    mealNutrition: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
    avgQuality: number;
    avgSatiety: number;
    todayTotals: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
    goals: ReturnType<NutritionScoreService['calculateDailyGoals']>;
    goalType: string;
    stabilityData?: {
      streakDays: number;
      avgMealsPerDay: number;
      targetMeals: number;
    };
    locale: Locale;
    quantitativeData?: Parameters<FoodScoringService['explainBreakdown']>[2];
    /** V3.9 P1.3: 平均置信度 0-100，低于 50 时触发评分衰减 */
    avgConfidence?: number;
    /** V4.0: 目标阶段权重调整（来自 GoalPhaseService） */
    phaseWeightAdjustment?: Partial<Record<string, number>>;
  }): Promise<{
    scoreResult: NutritionScoreResult;
    breakdownExplanations: BreakdownExplanation[];
  }> {
    const scoreResult = this.nutritionScoreService.calculateMealScore(
      {
        calories: params.mealNutrition.calories,
        protein: params.mealNutrition.protein,
        fat: params.mealNutrition.fat,
        carbs: params.mealNutrition.carbs,
        avgQuality: params.avgQuality,
        avgSatiety: params.avgSatiety,
      },
      params.todayTotals,
      params.goals,
      params.goalType,
      params.stabilityData,
    );

    // V3.9 P1.3: 低置信度评分衰减 — 各维度向中性值 60 分衰减
    const conf = params.avgConfidence ?? 100;
    if (conf < 50) {
      const NEUTRAL = 60;
      const decay = 1 - ((50 - conf) / 100) * 0.4; // conf=30 → decay=0.92
      const dims: (keyof NutritionScoreBreakdown)[] = [
        'energy',
        'proteinRatio',
        'macroBalance',
        'foodQuality',
        'satiety',
        'stability',
        'glycemicImpact',
      ];
      let weightedSum = 0;
      let totalWeight = 0;
      for (const dim of dims) {
        const raw = scoreResult.breakdown[dim];
        if (raw != null) {
          scoreResult.breakdown[dim] = Math.round(
            raw * decay + NEUTRAL * (1 - decay),
          );
        }
      }
      // 重算总分（使用 weights 如果有，否则等权）
      const weights = scoreResult.weights ?? {};
      for (const dim of dims) {
        const val = scoreResult.breakdown[dim];
        if (val != null) {
          const w = weights[dim] ?? 1;
          weightedSum += val * w;
          totalWeight += w;
        }
      }
      if (totalWeight > 0) {
        scoreResult.score = Math.round(weightedSum / totalWeight);
      }
    }

    // V4.0: 目标阶段权重调整 — 根据 GoalPhase 动态调整各维度权重并重算总分
    const phaseAdj = params.phaseWeightAdjustment;
    if (phaseAdj && Object.keys(phaseAdj).length > 0) {
      const weights = { ...(scoreResult.weights ?? {}) };
      // 维度名映射：ScoreDimension → NutritionScoreBreakdown key
      const dimMap: Record<string, keyof NutritionScoreBreakdown> = {
        calories: 'energy',
        protein: 'proteinRatio',
        carbs: 'macroBalance',
        fat: 'macroBalance',
        quality: 'foodQuality',
        satiety: 'satiety',
        glycemic: 'glycemicImpact',
      };
      for (const [dim, multiplier] of Object.entries(phaseAdj)) {
        if (multiplier == null) continue;
        const bKey = dimMap[dim];
        if (bKey && weights[bKey] != null) {
          weights[bKey] = (weights[bKey] as number) * multiplier;
        }
      }
      // 用调整后的权重重算总分
      const dims: (keyof NutritionScoreBreakdown)[] = [
        'energy',
        'proteinRatio',
        'macroBalance',
        'foodQuality',
        'satiety',
        'stability',
        'glycemicImpact',
      ];
      let ws = 0;
      let tw = 0;
      for (const d of dims) {
        const val = scoreResult.breakdown[d];
        if (val != null) {
          const w = weights[d] ?? 1;
          ws += val * (w as number);
          tw += w as number;
        }
      }
      if (tw > 0) {
        scoreResult.score = Math.round(ws / tw);
      }
      scoreResult.weights = weights;
    }

    const breakdownExplanations = this.explainBreakdown(
      scoreResult.breakdown,
      params.locale,
      params.quantitativeData,
    );

    return { scoreResult, breakdownExplanations };
  }

  /**
   * 获取用户稳定性数据（文本/图片链路共享）
   */
  private async fetchStabilityData(
    userId: string,
    profile?: any,
  ): Promise<
    | { streakDays: number; avgMealsPerDay: number; targetMeals: number }
    | undefined
  > {
    try {
      const [behaviorProfile, recentSummaries] = await Promise.all([
        this.behaviorService.getProfile(userId),
        this.foodService.getRecentSummaries(userId, 7),
      ]);
      if (!behaviorProfile) return undefined;
      const totalMeals = recentSummaries.reduce(
        (s: number, d: any) => s + (d.mealCount || 0),
        0,
      );
      const avgMealsPerDay =
        recentSummaries.length > 0 ? totalMeals / recentSummaries.length : 3;
      return {
        streakDays: behaviorProfile.streakDays || 0,
        avgMealsPerDay,
        targetMeals: profile?.mealsPerDay || 3,
      };
    } catch {
      return undefined;
    }
  }

  /** 分数 → 影响等级（V1.9: 委托给共享函数） */
  private scoreToImpact(score: number): 'positive' | 'warning' | 'critical' {
    return scoreToImpact(score);
  }

  /**
   * V3.5 P1.1: 健康条件 healthScore 调整
   *
   * 仅调整 healthScore（个性化健康分），不修改 nutritionScore（客观营养分）。
   * 在特定健康条件下放大对应维度的惩罚，并追加可读警告至 breakdownExplanations。
   */
  private applyHealthConditionAdjustment(
    healthScore: number,
    healthConditions: string[],
    breakdown: import('../../diet/app/services/nutrition-score.service').NutritionScoreBreakdown,
    foods: ScoringFoodItem[],
    explanations: BreakdownExplanation[] | undefined,
    locale: Locale,
  ): {
    adjustedHealthScore: number;
    explanations: BreakdownExplanation[] | undefined;
  } {
    const condList = healthConditions.map((c) => c.toLowerCase());
    let adjusted = healthScore;
    const warnings: BreakdownExplanation[] = [];

    // 糖尿病：血糖影响维度 < 60 → healthScore × 0.85
    if (hasCondition(condList, 'diabetes')) {
      if (breakdown.glycemicImpact < 60) {
        adjusted = Math.round(adjusted * 0.85);
        warnings.push({
          dimension: 'healthCondition_diabetes',
          label: cl('health.diabetesRisk.label', locale),
          score: breakdown.glycemicImpact,
          impact: 'critical',
          message: cl('health.diabetesRisk.message', locale).replace(
            '{score}',
            String(breakdown.glycemicImpact),
          ),
          suggestion: cl('health.diabetesRisk.suggestion', locale),
        });
      }
    }

    // 心脏病/心血管：宏量均衡 < 60（脂肪偏高）→ healthScore × 0.85
    if (hasCondition(condList, 'cardiovascular')) {
      if (breakdown.macroBalance < 60) {
        adjusted = Math.round(adjusted * 0.85);
        warnings.push({
          dimension: 'healthCondition_cardiovascular',
          label: cl('health.cardiovascularRisk.label', locale),
          score: breakdown.macroBalance,
          impact: 'critical',
          message: cl('health.cardiovascularRisk.message', locale).replace(
            '{score}',
            String(breakdown.macroBalance),
          ),
          suggestion: cl('health.cardiovascularRisk.suggestion', locale),
        });
      }
    }

    // 高血压：检查 foods 中钠含量 > 800mg → healthScore × 0.9
    if (hasCondition(condList, 'hypertension')) {
      const totalSodium = foods.reduce((s, f) => s + (f.sodium || 0), 0);
      if (totalSodium > 800) {
        adjusted = Math.round(adjusted * 0.9);
        warnings.push({
          dimension: 'healthCondition_hypertension',
          label: cl('health.hypertensionRisk.label', locale),
          score: Math.max(0, 100 - Math.round((totalSodium - 800) / 10)),
          impact: 'warning',
          message: cl('health.hypertensionRisk.message', locale).replace(
            '{sodium}',
            String(Math.round(totalSodium)),
          ),
          suggestion: cl('health.hypertensionRisk.suggestion', locale),
        });
      }
    }

    // V4.6: 痛风 — 高嘌呤食物 → healthScore × 0.85
    if (hasCondition(condList, 'gout')) {
      const highPurineFoods = foods.filter((f) => f.purine === 'high');
      if (highPurineFoods.length > 0) {
        adjusted = Math.round(adjusted * 0.85);
        warnings.push({
          dimension: 'healthCondition_gout',
          label: cl('health.goutRisk.label', locale),
          score: 30,
          impact: 'critical',
          message: cl('health.goutRisk.message', locale).replace(
            '{foods}',
            highPurineFoods.map((f) => f.name).join(', '),
          ),
          suggestion: cl('health.goutRisk.suggestion', locale),
        });
      }
    }

    // V4.6: IBS — 高 FODMAP 食物 → healthScore × 0.85
    if (hasCondition(condList, 'ibs')) {
      const highFodmapFoods = foods.filter((f) => f.fodmapLevel === 'high');
      if (highFodmapFoods.length > 0) {
        adjusted = Math.round(adjusted * 0.85);
        warnings.push({
          dimension: 'healthCondition_ibs',
          label: cl('health.ibsRisk.label', locale),
          score: 30,
          impact: 'critical',
          message: cl('health.ibsRisk.message', locale).replace(
            '{foods}',
            highFodmapFoods.map((f) => f.name).join(', '),
          ),
          suggestion: cl('health.ibsRisk.suggestion', locale),
        });
      }
    }

    // V4.6: 肾结石 — 高草酸食物 → healthScore × 0.9
    if (hasCondition(condList, 'kidney_disease')) {
      const highOxalateFoods = foods.filter((f) => f.oxalateLevel === 'high');
      if (highOxalateFoods.length > 0) {
        adjusted = Math.round(adjusted * 0.9);
        warnings.push({
          dimension: 'healthCondition_kidney_stones',
          label: cl('health.kidneyStoneRisk.label', locale),
          score: 40,
          impact: 'warning',
          message: cl('health.kidneyStoneRisk.message', locale).replace(
            '{foods}',
            highOxalateFoods.map((f) => f.name).join(', '),
          ),
          suggestion: cl('health.kidneyStoneRisk.suggestion', locale),
        });
      }
    }

    // V4.6: 高血脂 — 高胆固醇或高反式脂肪 → healthScore × 0.85
    if (hasCondition(condList, 'hyperlipidemia')) {
      const totalCholesterol = foods.reduce(
        (s, f) => s + (f.cholesterol || 0),
        0,
      );
      const totalTransFat = foods.reduce((s, f) => s + (f.transFat || 0), 0);
      if (totalCholesterol > 200 || totalTransFat > 1) {
        adjusted = Math.round(adjusted * 0.85);
        warnings.push({
          dimension: 'healthCondition_hyperlipidemia',
          label: cl('health.hyperlipidemiaRisk.label', locale),
          score: Math.max(
            0,
            100 -
              Math.round(totalCholesterol / 5) -
              Math.round(totalTransFat * 20),
          ),
          impact: totalTransFat > 1 ? 'critical' : 'warning',
          message: cl('health.hyperlipidemiaRisk.message', locale)
            .replace('{cholesterol}', String(Math.round(totalCholesterol)))
            .replace('{transFat}', String(Math.round(totalTransFat * 10) / 10)),
          suggestion: cl('health.hyperlipidemiaRisk.suggestion', locale),
        });
      }
    }

    return {
      adjustedHealthScore: Math.min(100, Math.max(0, adjusted)),
      explanations:
        warnings.length > 0
          ? [...(explanations || []), ...warnings]
          : explanations,
    };
  }
}
