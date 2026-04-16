/**
 * V2.1 — 饮食决策编排服务
 *
 * 职责:
 * - computeFullDecision: 完整决策编排（协调子服务）
 * - computeDecision: 委托 DecisionEngineService
 * - extractDecisionFactors: 委托 DecisionEngineService
 * - calculateOptimalPortion: 委托 PortionAdvisorService
 * - generateNextMealAdvice: 委托 PortionAdvisorService
 *
 * V2.1 变更:
 * - 核心决策逻辑提取到 DecisionEngineService
 * - 份量/下一餐建议提取到 PortionAdvisorService
 * - 问题识别/宏量进度提取到 IssueDetectorService
 * - 本服务只做编排，从 1064 行瘦身
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  FoodDecision,
  FoodAlternative,
  AnalysisExplanation,
  NutritionTotals,
  DecisionChainStep,
  DietIssue,
  MacroProgress,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { AlternativeSuggestionService } from './alternative-suggestion.service';
import { DecisionExplainerService } from './decision-explainer.service';
import {
  FoodScoringService,
  BreakdownExplanation,
} from '../score/food-scoring.service';
import { ContextualDecisionModifierService } from './contextual-modifier.service';
import { DecisionEngineService } from './decision-engine.service';
import { PortionAdvisorService } from './portion-advisor.service';
import { IssueDetectorService } from './issue-detector.service';
import {
  estimateQuality as _estimateQuality,
  estimateSatiety as _estimateSatiety,
} from '../../food/app/config/nutrition-estimator';

// ==================== 公共类型 ====================

/** 解析后的食物项（从 TextFoodAnalysisService 共享） */
export interface DecisionFoodItem {
  name: string;
  normalizedName?: string;
  libraryMatch?: any;
  quantity?: string;
  estimatedWeightGrams: number;
  category?: string;
  confidence: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sodium?: number;
  saturatedFat?: number | null;
  addedSugar?: number | null;
  estimated?: boolean;
}

/** 用户上下文（V2.0: 使用统一接口） */
export type UserContext = UnifiedUserContext;

/** V1.3: 结构化决策因子 */
export interface DecisionFactor {
  dimension: string;
  score: number;
  impact: 'critical' | 'warning' | 'positive';
  message: string;
}

/** V1.3: 最优份量建议 */
export interface OptimalPortion {
  recommendedPercent: number;
  recommendedCalories: number;
}

/** V1.3: 下一餐建议 */
export interface NextMealAdvice {
  targetCalories: number;
  targetProtein: number;
  targetFat: number;
  targetCarbs: number;
  emphasis: string;
  suggestion: string;
}

/** 决策服务完整输出 */
export interface DecisionOutput {
  decision: FoodDecision;
  alternatives: FoodAlternative[];
  explanation: AnalysisExplanation;
  decisionFactors: DecisionFactor[];
  optimalPortion?: OptimalPortion;
  nextMealAdvice?: NextMealAdvice;
  /** V1.6: 决策推理链 */
  decisionChain?: DecisionChainStep[];
  /** V1.6: 7维评分解释 */
  breakdownExplanations?: BreakdownExplanation[];
  /** V1.7: 结构化问题识别 */
  issues?: DietIssue[];
  /** V1.7: 宏量营养素进度 */
  macroProgress?: MacroProgress;
}

// V1.9: 决策阈值已提取到 ../config/decision-thresholds.ts

// ==================== 维度名称映射（V1.9: 使用共享常量） ====================
// DIMENSION_LABELS 已提取到 ../config/scoring-dimensions.ts

@Injectable()
export class FoodDecisionService {
  private readonly logger = new Logger(FoodDecisionService.name);

  constructor(
    private readonly behaviorService: BehaviorService,
    private readonly alternativeSuggestionService: AlternativeSuggestionService,
    private readonly decisionExplainerService: DecisionExplainerService,
    private readonly foodScoringService: FoodScoringService,
    // V1.9: 上下文决策修正器
    private readonly contextualModifier: ContextualDecisionModifierService,
    // V2.1: 子服务
    private readonly decisionEngine: DecisionEngineService,
    private readonly portionAdvisor: PortionAdvisorService,
    private readonly issueDetector: IssueDetectorService,
  ) {}

  // ==================== 主入口 ====================

  /**
   * V2.1: 完整决策编排（协调子服务）
   */
  computeFullDecision(
    foods: DecisionFoodItem[],
    totals: NutritionTotals,
    ctx: UserContext,
    nutritionScore: number,
    breakdown: NutritionScoreBreakdown | undefined,
    userId?: string,
    locale?: Locale,
  ): Promise<DecisionOutput> {
    return this._computeFullDecision(
      foods,
      totals,
      ctx,
      nutritionScore,
      breakdown,
      userId,
      locale,
    );
  }

  private async _computeFullDecision(
    foods: DecisionFoodItem[],
    totals: NutritionTotals,
    ctx: UserContext,
    nutritionScore: number,
    breakdown: NutritionScoreBreakdown | undefined,
    userId?: string,
    locale?: Locale,
  ): Promise<DecisionOutput> {
    // 1. 基础决策（委托 DecisionEngineService）
    const decision = this.decisionEngine.computeDecision(
      foods,
      ctx,
      nutritionScore,
      locale,
    );

    // 1.5 V1.9: 动态上下文修正（累积饱和/多日趋势/暴食风险）
    const modification = await this.contextualModifier.computeModification(
      userId,
      ctx,
      totals.calories,
      locale,
    );

    // V2.0: 应用 scoreMultiplier 到决策
    if (modification.scoreMultiplier !== 1) {
      const adjustedScore = nutritionScore * modification.scoreMultiplier;
      const recalculated = this.decisionEngine.scoreToFoodDecision(
        adjustedScore,
        locale,
        ctx.goalType,
      );
      const levelOrder = { recommend: 0, caution: 1, avoid: 2 };
      if (modification.scoreMultiplier < 1) {
        if (
          levelOrder[recalculated.recommendation] >
          levelOrder[decision.recommendation]
        ) {
          decision.recommendation = recalculated.recommendation;
          decision.shouldEat = recalculated.shouldEat;
          decision.riskLevel = recalculated.riskLevel;
        }
      } else {
        if (
          levelOrder[recalculated.recommendation] <
          levelOrder[decision.recommendation]
        ) {
          decision.recommendation = recalculated.recommendation;
          decision.shouldEat = recalculated.shouldEat;
          decision.riskLevel = recalculated.riskLevel;
        }
      }
      this.logger.debug(
        `V2.0 scoreMultiplier applied: ${nutritionScore} × ${modification.scoreMultiplier} = ${adjustedScore} → ${recalculated.recommendation}`,
      );
    }

    if (modification.additionalReasons.length > 0) {
      decision.reason = [decision.reason, ...modification.additionalReasons]
        .filter(Boolean)
        .join('；');
    }

    // 2. 结构化决策因子（委托 DecisionEngineService）
    const decisionFactors = breakdown
      ? this.decisionEngine.extractDecisionFactors(breakdown, locale)
      : [];

    // 3. 最优份量（委托 PortionAdvisorService）
    const optimalPortion =
      decision.recommendation !== 'recommend'
        ? this.portionAdvisor.calculateOptimalPortion(
            totals.calories,
            ctx.remainingCalories,
            ctx.goalType,
          )
        : undefined;

    // 4. 获取行为数据
    let replacementPatterns: Record<string, number> | undefined;
    let foodPreferences:
      | { frequentFoods?: string[]; loves?: string[]; avoids?: string[] }
      | undefined;
    if (userId) {
      try {
        const bp = await this.behaviorService.getProfile(userId);
        if (bp?.replacementPatterns) {
          replacementPatterns = bp.replacementPatterns as Record<
            string,
            number
          >;
        }
        if (bp?.foodPreferences) {
          foodPreferences = bp.foodPreferences as typeof foodPreferences;
        }
      } catch {
        /* 忽略 */
      }
    }

    // 5. 替代建议（委托 AlternativeSuggestionService）
    const alternatives =
      await this.alternativeSuggestionService.generateAlternatives({
        foods,
        totals,
        userContext: ctx,
        scoreBreakdown: breakdown,
        locale,
        userId,
        replacementPatterns,
        userConstraints: {
          allergens: ctx.allergens,
          dietaryRestrictions: ctx.dietaryRestrictions,
          healthConditions: ctx.healthConditions,
        },
      });

    // 6. 解释（委托 DecisionExplainerService）
    const explanation = this.decisionExplainerService.generateExplanation(
      { foods, decision, ctx, breakdown },
      locale,
    );

    // 7. 下一餐建议（委托 PortionAdvisorService）
    const nextMealAdvice = this.portionAdvisor.generateNextMealAdvice(
      ctx,
      totals,
      locale,
      foodPreferences,
    );

    // 8. 决策推理链（委托 DecisionExplainerService）
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const foodTexts = foods
      .map((f) => `${f.name} ${f.category || ''}`.toLowerCase())
      .join(' ');

    const allergenTriggered =
      ctx.allergens.length > 0 &&
      ctx.allergens.some((a) => foodTexts.includes(a.toLowerCase()));
    const triggeredAllergens = ctx.allergens.filter((a) =>
      foodTexts.includes(a.toLowerCase()),
    );

    const healthTriggered = ctx.healthConditions.length > 0;
    const isLateNight = ctx.localHour >= 21 || ctx.localHour < 5;

    const decisionChain = this.decisionExplainerService.generateDecisionChain(
      {
        baseScore: nutritionScore,
        scoreBreakdown: breakdown,
        allergenCheck: {
          triggered: allergenTriggered,
          allergens: triggeredAllergens,
        },
        healthCheck: {
          triggered: healthTriggered,
          conditions: ctx.healthConditions,
        },
        timingCheck: { isLateNight, localHour: ctx.localHour },
        dailyBudgetCheck: {
          remainingCalories: ctx.remainingCalories,
          mealCalories: totalCalories,
        },
        finalDecision: decision.recommendation,
      },
      locale,
    );

    // 9. breakdownExplanations
    const breakdownExplanations = breakdown
      ? this.foodScoringService.explainBreakdown(breakdown, locale || 'zh-CN')
      : undefined;

    // 合并到 decision 中
    decision.decisionFactors = decisionFactors;
    decision.optimalPortion = optimalPortion;
    decision.nextMealAdvice = nextMealAdvice;
    decision.decisionChain = decisionChain;
    decision.breakdownExplanations = breakdownExplanations;

    // 10. 结构化问题识别（委托 IssueDetectorService）
    const issues = this.issueDetector.identifyIssues(
      foods,
      totals,
      ctx,
      breakdown,
      locale,
    );
    // 合并上下文修正器发现的问题
    issues.push(...modification.additionalIssues);
    decision.issues = issues.length > 0 ? issues : undefined;

    // 11. 宏量进度汇总（委托 IssueDetectorService）
    const macroProgress = this.issueDetector.computeMacroProgress(totals, ctx);

    return {
      decision,
      alternatives,
      explanation,
      decisionFactors,
      optimalPortion,
      nextMealAdvice,
      decisionChain,
      breakdownExplanations,
      issues: issues.length > 0 ? issues : undefined,
      macroProgress,
    };
  }

  // ==================== 委托方法（保持向后兼容） ====================

  computeDecision(
    foods: DecisionFoodItem[],
    ctx: UserContext,
    nutritionScore: number,
    locale?: Locale,
  ): FoodDecision {
    return this.decisionEngine.computeDecision(
      foods,
      ctx,
      nutritionScore,
      locale,
    );
  }

  extractDecisionFactors(
    breakdown: NutritionScoreBreakdown,
    locale?: Locale,
  ): DecisionFactor[] {
    return this.decisionEngine.extractDecisionFactors(breakdown, locale);
  }

  calculateOptimalPortion(
    mealCalories: number,
    remainingCalories: number,
    goalType: string,
  ): OptimalPortion {
    return this.portionAdvisor.calculateOptimalPortion(
      mealCalories,
      remainingCalories,
      goalType,
    );
  }

  generateNextMealAdvice(
    ctx: UserContext,
    currentMealTotals: NutritionTotals,
    locale?: Locale,
    foodPreferences?: {
      frequentFoods?: string[];
      loves?: string[];
      avoids?: string[];
    },
  ): NextMealAdvice {
    return this.portionAdvisor.generateNextMealAdvice(
      ctx,
      currentMealTotals,
      locale,
      foodPreferences,
    );
  }

  estimateQuality(food: DecisionFoodItem): number {
    return _estimateQuality(food);
  }

  estimateSatiety(food: DecisionFoodItem): number {
    return _estimateSatiety(food);
  }
}
