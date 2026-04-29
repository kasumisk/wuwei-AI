/**
 * V1.6 Phase 2 — 决策解释服务
 *
 * 职责:
 * - generateDecisionChain: 生成决策推理链（从评分到最终建议的步骤记录）
 * - generateExplanation: 生成增强版 AnalysisExplanation
 *
 * 设计原则:
 * - 无状态，所有数据通过参数传入
 * - 使用本地 i18n 映射，不修改 diet 模块的 i18n 文件
 */
import { Injectable } from '@nestjs/common';
import {
  AnalysisExplanation,
  DecisionChainStep,
  FoodDecision,
  UnifiedUserContext,
  DetailedRationale,
  NutritionDualDisplay,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { DecisionFoodItem } from './food-decision.service';
import { getDimensionLabel } from '../config/scoring-dimensions';
import { cl } from '../i18n/decision-labels';
import {
  checkAllergenConflict,
  checkRestrictionConflict,
} from '../config/decision-checks';
import {
  DynamicThresholdsService,
  UserThresholds,
} from '../config/dynamic-thresholds.service';

// ==================== 输入类型 ====================

export interface DecisionChainInput {
  baseScore: number;
  scoreBreakdown?: NutritionScoreBreakdown;
  allergenCheck: { triggered: boolean; allergens: string[] };
  healthCheck: { triggered: boolean; conditions: string[] };
  timingCheck: { isLateNight: boolean; localHour: number };
  dailyBudgetCheck: { remainingCalories: number; mealCalories: number };
  finalDecision: 'recommend' | 'caution' | 'avoid';
  /** V3.9 P2.2: 营养聚合数据（Step 1） */
  nutritionAggregation?: {
    foodCount: number;
    totalCalories: number;
    totalProtein: number;
    totalFat: number;
    totalCarbs: number;
    avgConfidence: number;
  };
  /** V3.9 P2.2: 用户上下文摘要（Step 2） */
  userContextSummary?: {
    goalType: string;
    goalCalories: number;
    remainingCalories: number;
    healthConditions: string[];
    mealType: string;
  };
  /** V3.9 P2.2: 教练输出摘要（Step 6） */
  coachSummary?: {
    verdict: string;
    actionCount: number;
    toneModifier?: string;
  };
  /** V4.6: 健康冲突详情（Step 4 snapshot 增强） */
  healthConflictDetails?: Array<{
    condition: string;
    riskType: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
}

export interface ExplanationInput {
  foods: DecisionFoodItem[];
  decision: FoodDecision;
  ctx: UnifiedUserContext;
  breakdown?: NutritionScoreBreakdown;
}

// ==================== 本地 i18n 映射 ====================
// V4.0 P3.5: CHAIN_LABELS 已提取到 ../i18n/explainer-labels.ts

@Injectable()
export class DecisionExplainerService {
  constructor(private readonly dynamicThresholds: DynamicThresholdsService) {}

  // ==================== V3.7 P2.1: 从 DecisionEngineService 提取的文案生成 ====================

  /**
   * 生成行动建议文案（原 DecisionEngineService.generateDecisionAdvice）
   */
  generateDecisionAdvice(
    decision: FoodDecision,
    ctx: UnifiedUserContext,
    totalCalories: number,
    totalProtein: number,
    locale?: Locale,
    totalFat?: number,
    totalCarbs?: number,
    th?: UserThresholds,
  ): string {
    const lowProtein = th?.lowProteinMeal ?? 15;
    const significantCal = th?.significantMealCal ?? 300;
    const highFat = th?.highFatMeal ?? 30;
    const highProtein = th?.highProteinMeal ?? 25;

    if (decision.recommendation === 'recommend') {
      if (ctx.goalType === 'muscle_gain' && totalProtein >= highProtein) {
        return cl('advice.goodProtein', locale);
      }
      return cl('advice.balanced', locale);
    }

    if (decision.recommendation === 'avoid') {
      if (decision.reason?.includes('⚠️')) {
        return cl('advice.switch', locale);
      }
      const remaining = ctx.remainingCalories - totalCalories;
      if (remaining < -(th?.overBudgetMargin ?? 100)) {
        const excessCal = Math.abs(Math.round(remaining));
        const excessSuffix = cl('suffix.excessCal', locale, {
          amount: excessCal,
        });
        return (
          cl('advice.reducePortion', locale, {
            percent: Math.max(
              30,
              Math.round((ctx.remainingCalories / totalCalories) * 100),
            ),
          }) + excessSuffix
        );
      }
      return cl('advice.switch', locale);
    }

    // caution
    const tips: string[] = [];
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < lowProtein &&
      totalCalories > significantCal
    ) {
      const proteinQuantSuffix = cl('suffix.currentProtein', locale, {
        amount: Math.round(totalProtein),
      });
      tips.push(cl('advice.addProtein', locale) + proteinQuantSuffix);
    }
    if (ctx.remainingCalories - totalCalories < 0) {
      tips.push(cl('advice.halfPortion', locale));
    }
    if (
      totalFat != null &&
      totalFat > highFat &&
      ctx.goalFat > 0 &&
      (ctx.todayFat + totalFat) / ctx.goalFat > (th?.fatExcessRatio ?? 1)
    ) {
      tips.push(cl('advice.reduceFat', locale));
    }
    if (
      totalCarbs != null &&
      ctx.goalCarbs > 0 &&
      (ctx.todayCarbs + totalCarbs) / ctx.goalCarbs >
        (th?.carbExcessRatio ?? 1.1) &&
      ctx.goalType === 'fat_loss'
    ) {
      tips.push(cl('advice.reduceCarbs', locale));
    }
    if (tips.length === 0) {
      tips.push(cl('advice.controlOther', locale));
    }
    return tips.join(cl('separator.list', locale));
  }

  /**
   * 构建多维决策原因（原 DecisionEngineService.buildDetailedRationale）
   */
  buildDetailedRationale(
    decision: FoodDecision,
    ctx: UnifiedUserContext,
    nutritionScore: number,
    hour: number,
    foods: DecisionFoodItem[],
    locale?: Locale,
  ): DetailedRationale {
    const baseline = decision.reason || '';

    const calorieProgress =
      ctx.goalCalories > 0
        ? Math.round((ctx.todayCalories / ctx.goalCalories) * 100)
        : 0;
    const contextual = cl('rationale.contextual', locale, {
      percent: calorieProgress,
    });

    const goalLabel = ctx.goalLabel || ctx.goalType;
    const goalAlignment = cl('rationale.goalAlignment', locale, {
      goalLabel,
    });

    const allergenCheck = checkAllergenConflict(foods, ctx, locale);
    const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
    const healthRisk = allergenCheck?.triggered
      ? allergenCheck.reason || null
      : restrictionCheck?.triggered
        ? restrictionCheck.reason || null
        : null;

    let timelinessNote: string | null = null;
    const dynamicTh = this.dynamicThresholds.compute(ctx);
    if (hour >= dynamicTh.lateNightStart || hour < dynamicTh.lateNightEnd) {
      timelinessNote = cl('rationale.timelinessLateNight', locale);
    } else if (hour >= 6 && hour < 10) {
      // V4.2: 使用 DynamicThresholds 但保留早餐时段标注
      timelinessNote = cl('rationale.timelinessBreakfast', locale);
    } else if (hour >= 10 && hour < dynamicTh.eveningStart - 3) {
      // V4.2: 午餐到下午前段
      if (hour < 14) {
        timelinessNote = cl('rationale.timelinessLunch', locale);
      } else {
        timelinessNote = cl('rationale.timelinessAfternoon', locale);
      }
    }

    return {
      baseline,
      contextual,
      goalAlignment,
      healthRisk,
      timelinessNote,
    };
  }

  // ==================== 决策推理链 ====================

  generateDecisionChain(
    input: DecisionChainInput,
    locale?: Locale,
  ): DecisionChainStep[] {
    const steps: DecisionChainStep[] = [];

    // V3.9 Step 1: 营养数据聚合
    if (input.nutritionAggregation) {
      const agg = input.nutritionAggregation;
      steps.push({
        step: cl('chain.step.aggregation', locale),
        input: cl(
          'chain.step.aggregation.input',
          locale,
          { count: String(agg.foodCount) },
        ),
        output: cl(
          'chain.step.aggregation.output',
          locale,
          {
            cal: String(Math.round(agg.totalCalories)),
            pro: String(Math.round(agg.totalProtein)),
            fat: String(Math.round(agg.totalFat)),
            carbs: String(Math.round(agg.totalCarbs)),
          },
        ),
        confidence: Math.max(0.3, Math.min(1, agg.avgConfidence / 100)),
        snapshot: {
          totalCalories: agg.totalCalories,
          totalProtein: agg.totalProtein,
          avgConfidence: agg.avgConfidence,
        },
      });
    }

    // V3.9 Step 2: 用户上下文构建
    if (input.userContextSummary) {
      const ctx = input.userContextSummary;
      const conditionsText =
        ctx.healthConditions.length > 0
          ? ctx.healthConditions.join(', ')
          : cl('explainer.noConditions', locale);
      steps.push({
        step: cl('chain.step.context', locale),
        input: cl('chain.step.context.input', locale),
        output: cl(
          'chain.step.context.output',
          locale,
          {
            goal: ctx.goalType,
            remaining: String(Math.round(ctx.remainingCalories)),
            conditions: conditionsText,
          },
        ),
        confidence: 0.95,
        snapshot: {
          goalType: ctx.goalType,
          goalCalories: ctx.goalCalories,
          remainingCalories: ctx.remainingCalories,
          mealType: ctx.mealType,
        },
      });
    }

    // Step 3: 营养评分
    const scoreLabel =
      input.baseScore >= 75
        ? 'chain.step.scoring.output.high'
        : input.baseScore >= 45
          ? 'chain.step.scoring.output.mid'
          : 'chain.step.scoring.output.low';
    steps.push({
      step: cl('chain.step.scoring', locale),
      input: cl('chain.step.scoring.input', locale),
      output: cl(
        scoreLabel,
        locale,
        { score: String(Math.round(input.baseScore)) },
      ),
      confidence: input.baseScore >= 75 || input.baseScore < 30 ? 0.95 : 0.7,
      snapshot: input.scoreBreakdown
        ? {
            energy: input.scoreBreakdown.energy,
            proteinRatio: input.scoreBreakdown.proteinRatio,
            macroBalance: input.scoreBreakdown.macroBalance,
            overallScore: input.baseScore,
          }
        : undefined,
    });

    // Step 4: Decision engine — per-conflict-type explanation nodes (V4.8 P2.3)
    const decisionFactors: string[] = [];

    // V4.8 P2.3: Categorized conflict nodes for structured explainability
    const conflictNodes: Array<{
      type: 'allergen' | 'health' | 'timing' | 'budget' | 'health_detail';
      severity: 'info' | 'warning' | 'critical';
      message: string;
    }> = [];

    if (input.allergenCheck.triggered) {
      const msg = cl(
        'chain.step.allergen.triggered',
        locale,
        { allergens: input.allergenCheck.allergens.join(', ') },
      );
      decisionFactors.push(msg);
      conflictNodes.push({
        type: 'allergen',
        severity: 'critical',
        message: msg,
      });
    }
    if (input.healthCheck.triggered) {
      const msg = cl(
        'chain.step.health.triggered',
        locale,
        { conditions: input.healthCheck.conditions.join(', ') },
      );
      decisionFactors.push(msg);
      conflictNodes.push({
        type: 'health',
        severity: 'warning',
        message: msg,
      });
    }
    if (input.timingCheck.isLateNight) {
      const msg = cl('chain.step.timing.lateNight', locale);
      decisionFactors.push(msg);
      conflictNodes.push({ type: 'timing', severity: 'info', message: msg });
    }
    const budgetOver =
      input.dailyBudgetCheck.mealCalories >
      input.dailyBudgetCheck.remainingCalories;
    if (budgetOver) {
      const budgetExcess = Math.round(
        input.dailyBudgetCheck.mealCalories -
          input.dailyBudgetCheck.remainingCalories,
      );
      const msg =
        cl('chain.step.budget.over', locale) +
        cl('explainer.budgetExcess', locale, { amount: budgetExcess });
      decisionFactors.push(msg);
      conflictNodes.push({ type: 'budget', severity: 'warning', message: msg });
    }

    // V4.6: Health conflict details
    if (input.healthConflictDetails?.length) {
      for (const conflict of input.healthConflictDetails) {
        if (
          conflict.severity === 'critical' ||
          conflict.severity === 'warning'
        ) {
          decisionFactors.push(conflict.message);
          conflictNodes.push({
            type: 'health_detail',
            severity: conflict.severity,
            message: conflict.message,
          });
        }
      }
    }

    // Step 4 output: Final decision
    steps.push({
      step: cl('chain.step.final', locale),
      input: cl('chain.step.final.input', locale),
      output: cl(`chain.step.final.${input.finalDecision}`, locale),
      confidence:
        input.allergenCheck.triggered || input.healthCheck.triggered
          ? 0.95
          : input.baseScore >= 60 || input.baseScore < 30
            ? 0.9
            : 0.7,
      snapshot: {
        allergenTriggered: input.allergenCheck.triggered,
        healthTriggered: input.healthCheck.triggered,
        isLateNight: input.timingCheck.isLateNight,
        budgetOver,
        verdict: input.finalDecision,
        // V4.8 P2.3: Per-conflict-type explanation nodes
        conflictNodes: conflictNodes.length > 0 ? conflictNodes : undefined,
        // V4.6: Health conflict details (preserved for backward compat)
        ...(input.healthConflictDetails?.length
          ? { healthConflicts: input.healthConflictDetails }
          : {}),
      },
    });

    // V3.9 Step 5: 问题识别 + 替代方案（保留详细检查步骤作为子项）
    // 这些信息现在内联到 Step 4 的 snapshot 中
    // 单独的 allergen/health/timing/budget 步骤不再独立输出

    // V3.9 Step 6: 教练输出
    if (input.coachSummary) {
      const coach = input.coachSummary;
      steps.push({
        step: cl('chain.step.coach', locale),
        input: cl('chain.step.coach.input', locale),
        output: cl(
          'chain.step.coach.output',
          locale,
          {
            verdict: coach.verdict,
            count: String(coach.actionCount),
          },
        ),
        confidence: 0.85,
        snapshot: {
          verdict: coach.verdict,
          actionCount: coach.actionCount,
          toneModifier: coach.toneModifier,
        },
      });
    }

    return steps;
  }

  // ==================== 增强版解释 ====================

  generateExplanation(
    input: ExplanationInput,
    locale?: Locale,
  ): AnalysisExplanation {
    const { foods, decision, ctx, breakdown } = input;

    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const foodNames = foods
      .map((f) => f.name)
      .join(cl('separator.enumeration', locale));

    const verdict = decision.shouldEat
      ? cl('explain.suitable', locale)
      : cl('explain.adjust', locale);
    const summary = cl('explain.summary', locale, {
      foods: foodNames,
      calories: totalCalories,
      verdict,
    });

    const primaryReason = decision.reason;

    const userContextImpact: string[] = [];
    if (ctx.goalType !== 'health') {
      userContextImpact.push(
        cl('explain.goal', locale, { goal: ctx.goalLabel }),
      );
    }
    if (ctx.remainingCalories < totalCalories && ctx.goalCalories > 0) {
      userContextImpact.push(
        cl('explain.remaining', locale, {
          remaining: Math.round(ctx.remainingCalories),
          meal: totalCalories,
        }),
      );
    }
    if (totalProtein > 0) {
      const proteinPercent = Math.round(
        (totalProtein * 4 * 100) / Math.max(1, totalCalories),
      );
      const proteinGrams = Math.round(totalProtein);
      // 量化：附带绝对蛋白克数，如 "蛋白质占比 15%（18g）"
      const proteinQuantSuffix = cl(
        'explainer.proteinQuantSuffix',
        locale,
        { grams: proteinGrams },
      );
      userContextImpact.push(
        cl('explain.proteinRatio', locale, { percent: proteinPercent }) +
          proteinQuantSuffix,
      );
    }

    // 脂肪/碳水进度
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    if (ctx.goalFat > 0 && totalFat > 0) {
      const fatProgress = Math.round(
        ((ctx.todayFat + totalFat) / ctx.goalFat) * 100,
      );
      userContextImpact.push(
        cl('explain.fatProgress', locale, { percent: fatProgress }),
      );
    }
    if (ctx.goalCarbs > 0 && totalCarbs > 0) {
      const carbsProgress = Math.round(
        ((ctx.todayCarbs + totalCarbs) / ctx.goalCarbs) * 100,
      );
      userContextImpact.push(
        cl('explain.carbsProgress', locale, { percent: carbsProgress }),
      );
    }

    // Breakdown 弱项分析
    if (breakdown) {
      const weakDims = Object.entries(breakdown)
        .filter(([_, score]) => (score as number) < 50)
        .sort((a, b) => (a[1] as number) - (b[1] as number));

      if (weakDims.length > 0) {
        const weakList = weakDims
          .slice(0, 3)
          .map(
            ([dim, score]) =>
              `${getDimensionLabel(dim, locale)}(${Math.round(score as number)})`,
          )
          .join(cl('separator.enumeration', locale));
        userContextImpact.push(
          cl('explain.weakDimensions', locale, { dimensions: weakList }),
        );
      }
    }

    // V4.9 P3.3: Build dual nutrition display (per-100g base + per-serving actual)
    const nutritionBreakdown: NutritionDualDisplay[] = foods.map((f) => {
      const wf = f.estimatedWeightGrams > 0 ? f.estimatedWeightGrams / 100 : 1;
      return {
        name: f.name,
        estimatedWeightGrams: f.estimatedWeightGrams,
        per100g: {
          calories: Math.round(f.calories / wf),
          protein: Math.round((f.protein / wf) * 10) / 10,
          fat: Math.round((f.fat / wf) * 10) / 10,
          carbs: Math.round((f.carbs / wf) * 10) / 10,
        },
        perServing: {
          calories: Math.round(f.calories),
          protein: Math.round(f.protein * 10) / 10,
          fat: Math.round(f.fat * 10) / 10,
          carbs: Math.round(f.carbs * 10) / 10,
        },
      };
    });

    return {
      summary,
      primaryReason,
      userContextImpact:
        userContextImpact.length > 0 ? userContextImpact : undefined,
      causalNarrative: this.buildCausalNarrative(
        input.breakdown,
        input.decision,
        locale,
      ),
      nutritionBreakdown,
    };
  }

  /**
   * V4.2: 构建因果叙事
   * 从 breakdown 弱项 + decision 组合为 "因为A和B，建议C" 格式
   */
  private buildCausalNarrative(
    breakdown: NutritionScoreBreakdown | undefined,
    decision: FoodDecision,
    locale?: Locale,
  ): string | undefined {
    if (!breakdown) return undefined;

    // 找出 score < 60 的弱项维度
    const weakFactors = Object.entries(breakdown)
      .filter(([_, score]) => (score as number) < 60)
      .sort((a, b) => (a[1] as number) - (b[1] as number))
      .slice(0, 3)
      .map(
        ([dim, score]) =>
          `${getDimensionLabel(dim, locale)}(${Math.round(score as number)})`,
      );

    if (weakFactors.length === 0) return undefined;

    const because = cl('causal.because', locale);
    const and = cl('causal.and', locale);
    const therefore = cl(
      `causal.therefore.${decision.recommendation}`,
      locale,
    );

    const factorText = weakFactors.join(and);
    return `${because}${factorText}${therefore}`;
  }
}
