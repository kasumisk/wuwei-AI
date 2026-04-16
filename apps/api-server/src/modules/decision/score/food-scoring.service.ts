/**
 * V1.9 — 食物评分门面服务
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
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
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

// ==================== 输入/输出类型 ====================

/** 评分输入：食物项（文本链路） */
export interface ScoringFoodItem {
  name: string;
  confidence: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sodium?: number;
  saturatedFat?: number | null;
  addedSugar?: number | null;
  estimatedWeightGrams: number;
  /** 标准库匹配（有则用库的 quality/satiety） */
  libraryMatch?: {
    qualityScore?: number | string | null;
    satietyScore?: number | string | null;
  };
}

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
}

/** 图片链路评分输入（AI 已计算 avgQuality/avgSatiety） */
export interface ImageScoringInput {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  avgQuality: number;
  avgSatiety: number;
}

/** Breakdown 维度解释 */
export interface BreakdownExplanation {
  /** 维度键 */
  dimension: string;
  /** 维度本地化标签 */
  label: string;
  /** 维度分数 0-100 */
  score: number;
  /** 影响等级 */
  impact: 'positive' | 'warning' | 'critical';
  /** 人类可读解释 */
  message: string;
  /** V1.7: 实际值 */
  actualValue?: number;
  /** V1.7: 目标/推荐值 */
  targetValue?: number;
  /** V1.7: 单位 */
  unit?: string;
  /** V1.9: 改善建议 */
  suggestion?: string;
}

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
        });

        nutritionScore = core.scoreResult.score;
        breakdown = core.scoreResult.breakdown;
        rawScoreResult = core.scoreResult;
        breakdownExplanations = core.breakdownExplanations;
        healthScore = Math.round(nutritionScore * 0.6 + avgQuality * 10 * 0.4);
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

    return {
      ...scoreResult,
      breakdownExplanations,
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
      const score = breakdown[dim];
      const impact = this.scoreToImpact(score);

      const result: BreakdownExplanation = {
        dimension: dim,
        label: labels[dim] || dim,
        score,
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
}
