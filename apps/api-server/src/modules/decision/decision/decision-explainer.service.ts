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
import { DIMENSION_LABELS } from '../config/scoring-dimensions';
import { cl as dlCl } from '../i18n/decision-labels';
import { chainLabel as cl, CHAIN_LABELS } from '../i18n/explainer-labels';
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
        return dlCl('advice.goodProtein', locale);
      }
      return dlCl('advice.balanced', locale);
    }

    if (decision.recommendation === 'avoid') {
      if (decision.reason?.includes('⚠️')) {
        return dlCl('advice.switch', locale);
      }
      const remaining = ctx.remainingCalories - totalCalories;
      if (remaining < -(th?.overBudgetMargin ?? 100)) {
        const excessCal = Math.abs(Math.round(remaining));
        const excessSuffix = dlCl('suffix.excessCal', locale).replace(
          '{amount}',
          String(excessCal),
        );
        return (
          dlCl('advice.reducePortion', locale).replace(
            '{percent}',
            String(
              Math.max(
                30,
                Math.round((ctx.remainingCalories / totalCalories) * 100),
              ),
            ),
          ) + excessSuffix
        );
      }
      return dlCl('advice.switch', locale);
    }

    // caution
    const tips: string[] = [];
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < lowProtein &&
      totalCalories > significantCal
    ) {
      const proteinQuantSuffix = dlCl('suffix.currentProtein', locale).replace(
        '{amount}',
        String(Math.round(totalProtein)),
      );
      tips.push(dlCl('advice.addProtein', locale) + proteinQuantSuffix);
    }
    if (ctx.remainingCalories - totalCalories < 0) {
      tips.push(dlCl('advice.halfPortion', locale));
    }
    if (
      totalFat != null &&
      totalFat > highFat &&
      ctx.goalFat > 0 &&
      (ctx.todayFat + totalFat) / ctx.goalFat > (th?.fatExcessRatio ?? 1)
    ) {
      tips.push(dlCl('advice.reduceFat', locale));
    }
    if (
      totalCarbs != null &&
      ctx.goalCarbs > 0 &&
      (ctx.todayCarbs + totalCarbs) / ctx.goalCarbs >
        (th?.carbExcessRatio ?? 1.1) &&
      ctx.goalType === 'fat_loss'
    ) {
      tips.push(dlCl('advice.reduceCarbs', locale));
    }
    if (tips.length === 0) {
      tips.push(dlCl('advice.controlOther', locale));
    }
    return tips.join(dlCl('separator.list', locale));
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
    const contextual = dlCl('rationale.contextual', locale).replace(
      '{percent}',
      String(calorieProgress),
    );

    const goalLabel = ctx.goalLabel || ctx.goalType;
    const goalAlignment = dlCl('rationale.goalAlignment', locale).replace(
      '{goalLabel}',
      goalLabel,
    );

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
      timelinessNote = dlCl('rationale.timelinessLateNight', locale);
    } else if (hour >= 6 && hour < 10) {
      // V4.2: 使用 DynamicThresholds 但保留早餐时段标注
      timelinessNote = dlCl('rationale.timelinessBreakfast', locale);
    } else if (hour >= 10 && hour < dynamicTh.eveningStart - 3) {
      // V4.2: 午餐到下午前段
      if (hour < 14) {
        timelinessNote = dlCl('rationale.timelinessLunch', locale);
      } else {
        timelinessNote = dlCl('rationale.timelinessAfternoon', locale);
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
        step: cl('step.aggregation', {}, locale),
        input: cl(
          'step.aggregation.input',
          { count: String(agg.foodCount) },
          locale,
        ),
        output: cl(
          'step.aggregation.output',
          {
            cal: String(Math.round(agg.totalCalories)),
            pro: String(Math.round(agg.totalProtein)),
            fat: String(Math.round(agg.totalFat)),
            carbs: String(Math.round(agg.totalCarbs)),
          },
          locale,
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
          : dlCl('explainer.noConditions', locale);
      steps.push({
        step: cl('step.context', {}, locale),
        input: cl('step.context.input', {}, locale),
        output: cl(
          'step.context.output',
          {
            goal: ctx.goalType,
            remaining: String(Math.round(ctx.remainingCalories)),
            conditions: conditionsText,
          },
          locale,
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
        ? 'step.scoring.output.high'
        : input.baseScore >= 45
          ? 'step.scoring.output.mid'
          : 'step.scoring.output.low';
    steps.push({
      step: cl('step.scoring', {}, locale),
      input: cl('step.scoring.input', {}, locale),
      output: cl(
        scoreLabel,
        { score: String(Math.round(input.baseScore)) },
        locale,
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
        'step.allergen.triggered',
        { allergens: input.allergenCheck.allergens.join(', ') },
        locale,
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
        'step.health.triggered',
        { conditions: input.healthCheck.conditions.join(', ') },
        locale,
      );
      decisionFactors.push(msg);
      conflictNodes.push({
        type: 'health',
        severity: 'warning',
        message: msg,
      });
    }
    if (input.timingCheck.isLateNight) {
      const msg = cl('step.timing.lateNight', {}, locale);
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
        cl('step.budget.over', {}, locale) +
        dlCl('explainer.budgetExcess', locale).replace(
          '{amount}',
          String(budgetExcess),
        );
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
      step: cl('step.final', {}, locale),
      input: cl('step.final.input', {}, locale),
      output: cl(`step.final.${input.finalDecision}`, {}, locale),
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
        step: cl('step.coach', {}, locale),
        input: cl('step.coach.input', {}, locale),
        output: cl(
          'step.coach.output',
          {
            verdict: coach.verdict,
            count: String(coach.actionCount),
          },
          locale,
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
      .join(dlCl('separator.enumeration', locale));

    const verdict = decision.shouldEat
      ? dlCl('explain.suitable', locale)
      : dlCl('explain.adjust', locale);
    const summary = dlCl('explain.summary', locale)
      .replace('{foods}', foodNames)
      .replace('{calories}', String(totalCalories))
      .replace('{verdict}', verdict);

    const primaryReason = decision.reason;

    const userContextImpact: string[] = [];
    if (ctx.goalType !== 'health') {
      userContextImpact.push(
        dlCl('explain.goal', locale).replace('{goal}', ctx.goalLabel),
      );
    }
    if (ctx.remainingCalories < totalCalories && ctx.goalCalories > 0) {
      userContextImpact.push(
        dlCl('explain.remaining', locale)
          .replace('{remaining}', String(Math.round(ctx.remainingCalories)))
          .replace('{meal}', String(totalCalories)),
      );
    }
    if (totalProtein > 0) {
      const proteinPercent = Math.round(
        (totalProtein * 4 * 100) / Math.max(1, totalCalories),
      );
      const proteinGrams = Math.round(totalProtein);
      // 量化：附带绝对蛋白克数，如 "蛋白质占比 15%（18g）"
      const proteinQuantSuffix = dlCl(
        'explainer.proteinQuantSuffix',
        locale,
      ).replace('{grams}', String(proteinGrams));
      userContextImpact.push(
        dlCl('explain.proteinRatio', locale).replace(
          '{percent}',
          String(proteinPercent),
        ) + proteinQuantSuffix,
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
        dlCl('explain.fatProgress', locale).replace(
          '{percent}',
          String(fatProgress),
        ),
      );
    }
    if (ctx.goalCarbs > 0 && totalCarbs > 0) {
      const carbsProgress = Math.round(
        ((ctx.todayCarbs + totalCarbs) / ctx.goalCarbs) * 100,
      );
      userContextImpact.push(
        dlCl('explain.carbsProgress', locale).replace(
          '{percent}',
          String(carbsProgress),
        ),
      );
    }

    // Breakdown 弱项分析
    if (breakdown) {
      const loc = locale || 'zh-CN';
      const labels = DIMENSION_LABELS[loc] || DIMENSION_LABELS['zh-CN'];
      const weakDims = Object.entries(breakdown)
        .filter(([_, score]) => (score as number) < 50)
        .sort((a, b) => (a[1] as number) - (b[1] as number));

      if (weakDims.length > 0) {
        const weakList = weakDims
          .slice(0, 3)
          .map(
            ([dim, score]) =>
              `${labels[dim] || dim}(${Math.round(score as number)})`,
          )
          .join(dlCl('separator.enumeration', locale));
        userContextImpact.push(
          dlCl('explain.weakDimensions', locale).replace(
            '{dimensions}',
            weakList,
          ),
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

    const loc = locale || 'zh-CN';
    const labels = DIMENSION_LABELS[loc] || DIMENSION_LABELS['zh-CN'];

    // 找出 score < 60 的弱项维度
    const weakFactors = Object.entries(breakdown)
      .filter(([_, score]) => (score as number) < 60)
      .sort((a, b) => (a[1] as number) - (b[1] as number))
      .slice(0, 3)
      .map(
        ([dim, score]) =>
          `${labels[dim] || dim}(${Math.round(score as number)})`,
      );

    if (weakFactors.length === 0) return undefined;

    const because = dlCl('causal.because', locale);
    const and = dlCl('causal.and', locale);
    const therefore = dlCl(
      `causal.therefore.${decision.recommendation}`,
      locale,
    );

    const factorText = weakFactors.join(and);
    return `${because}${factorText}${therefore}`;
  }
}
