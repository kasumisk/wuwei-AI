/**
 * V2.2 Phase 2 — 决策结构化摘要服务
 *
 * 从决策输出中提取关键信息，生成精简的结构化摘要。
 * 摘要用于：
 * 1. 教练 prompt 精简上下文（替代 20 段原始数据）
 * 2. 前端卡片式展示
 *
 * 设计原则：
 * - 无状态纯逻辑服务
 * - 不修改原始决策输出，只做信息提取和文案生成
 */
import { Injectable } from '@nestjs/common';
import {
  DecisionSummary,
  FoodDecision,
  FoodAlternative,
  DietIssue,
  NutritionTotals,
  BreakdownExplanation,
  MacroProgress,
  SignalTraceItem,
} from '../types/analysis-result.types';
import { DecisionOutput } from './food-decision.service';
import { UnifiedUserContext } from '../types/analysis-result.types';
import { getSignalPriority } from '../config/signal-priority.config';

// ==================== 摘要输入 ====================

export interface SummaryInput {
  decisionOutput: DecisionOutput;
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  foodNames: string[];
}

// ==================== 严重度权重 ====================

const SEVERITY_ORDER: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

@Injectable()
export class DecisionSummaryService {
  /**
   * 从决策输出中生成结构化摘要
   */
  summarize(input: SummaryInput): DecisionSummary {
    const { decisionOutput, totals, userContext, foodNames } = input;
    const { decision, alternatives, issues, macroProgress } = decisionOutput;

    const headline = this.buildHeadline(
      decision,
      totals,
      foodNames,
      userContext,
    );
    const topIssues = this.extractTopIssues(issues, 3);
    const topStrengths = this.extractTopStrengths(
      decisionOutput.breakdownExplanations,
      2,
    );
    const actionItems = this.extractActionItems(issues, decision, 3);
    const quantitativeHighlight = this.buildQuantitativeHighlight(
      macroProgress,
      totals,
      userContext,
    );
    const contextSignals = this.extractContextSignals(userContext, totals, decision);
    const coachFocus = this.resolveCoachFocus(userContext, topIssues, decision);
    const alternativeSummary = this.buildAlternativeSummary(alternatives);
    const dynamicDecisionHint = this.buildDynamicDecisionHint(userContext, decision);
    const healthConstraintNote = this.buildHealthConstraintNote(userContext);
    // V3.0: 信号追踪
    const signalTrace = this.buildSignalTrace(userContext, contextSignals);

    return {
      headline,
      verdict: decision.recommendation,
      topIssues,
      topStrengths,
      actionItems,
      quantitativeHighlight,
      contextSignals,
      coachFocus,
      alternativeSummary,
      dynamicDecisionHint,
      healthConstraintNote,
      signalTrace,
    };
  }

  // ==================== 私有方法 ====================

  /**
   * 构建一句话摘要标题
   */
  private buildHeadline(
    decision: FoodDecision,
    totals: NutritionTotals,
    foodNames: string[],
    ctx: UnifiedUserContext,
  ): string {
    const foodDesc =
      foodNames.length <= 2
        ? foodNames.join('和')
        : `${foodNames[0]}等${foodNames.length}种食物`;

    const calText = `${Math.round(totals.calories)}kcal`;

    if (decision.recommendation === 'recommend') {
      if (ctx.budgetStatus === 'near_limit') {
        return `${foodDesc}(${calText})可以吃，但已经接近今日预算，注意控制份量`;
      }
      return `${foodDesc}(${calText})营养搭配不错，可以放心吃`;
    }

    if (decision.recommendation === 'avoid') {
      if (ctx.budgetStatus === 'over_limit') {
        return `${foodDesc}(${calText})当前已超出今日预算，不建议继续吃`;
      }
      return `${foodDesc}(${calText})当前不建议食用`;
    }

    // caution — 给出具体原因
    if (decision.optimalPortion) {
      return `${foodDesc}(${calText})建议减量到${decision.optimalPortion.recommendedPercent}%`;
    }

    const remaining = ctx.remainingCalories;
    if (totals.calories > remaining && remaining > 0) {
      return `${foodDesc}(${calText})超出剩余预算${Math.round(totals.calories - remaining)}kcal，建议调整`;
    }

    return `${foodDesc}(${calText})需要注意：${decision.reason}`;
  }

  /**
   * 提取最严重的 N 个问题
   */
  private extractTopIssues(
    issues: DietIssue[] | undefined,
    maxCount: number,
  ): string[] {
    if (!issues || issues.length === 0) return [];

    return issues
      .sort(
        (a, b) =>
          (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0),
      )
      .slice(0, maxCount)
      .map((issue) => issue.message);
  }

  /**
   * 提取正面评分维度
   */
  private extractTopStrengths(
    explanations: BreakdownExplanation[] | undefined,
    maxCount: number,
  ): string[] {
    if (!explanations || explanations.length === 0) return [];

    return explanations
      .filter((e) => e.impact === 'positive')
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount)
      .map((e) => `${e.label}: ${e.score}分 — ${e.message}`);
  }

  /**
   * 提取可执行建议
   *
   * 优先从 issues 的 actionable 字段提取，不足时从 decision.advice 补充
   */
  private extractActionItems(
    issues: DietIssue[] | undefined,
    decision: FoodDecision,
    maxCount: number,
  ): string[] {
    const items: string[] = [];

    // 1. 从问题的 actionable 字段提取
    if (issues) {
      const sorted = [...issues].sort(
        (a, b) =>
          (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0),
      );
      for (const issue of sorted) {
        if (issue.actionable && items.length < maxCount) {
          items.push(issue.actionable);
        }
      }
    }

    // 2. 从 decision.advice 补充
    if (items.length < maxCount && decision.advice) {
      items.push(decision.advice);
    }

    return items.slice(0, maxCount);
  }

  /**
   * 构建量化亮点
   *
   * 找到偏离目标最大的宏量维度，生成量化描述
   */
  private buildQuantitativeHighlight(
    macroProgress: MacroProgress | undefined,
    totals: NutritionTotals,
    ctx: UnifiedUserContext,
  ): string {
    if (macroProgress) {
      // 找偏离最大的维度
      const dimensions = [
        {
          name: '热量',
          consumed: macroProgress.calories.consumed,
          target: macroProgress.calories.target,
          percent: macroProgress.calories.percent,
          unit: 'kcal',
        },
        {
          name: '蛋白质',
          consumed: macroProgress.protein.consumed,
          target: macroProgress.protein.target,
          percent: macroProgress.protein.percent,
          unit: 'g',
        },
        {
          name: '脂肪',
          consumed: macroProgress.fat.consumed,
          target: macroProgress.fat.target,
          percent: macroProgress.fat.percent,
          unit: 'g',
        },
        {
          name: '碳水',
          consumed: macroProgress.carbs.consumed,
          target: macroProgress.carbs.target,
          percent: macroProgress.carbs.percent,
          unit: 'g',
        },
      ];

      // 最偏离的维度（偏离 100% 最远的）
      const mostDeviated = dimensions.reduce((prev, curr) =>
        Math.abs(curr.percent - 100) > Math.abs(prev.percent - 100)
          ? curr
          : prev,
      );

      const status =
        mostDeviated.percent > 120
          ? '超标'
          : mostDeviated.percent < 50
            ? '严重不足'
            : mostDeviated.percent < 80
              ? '偏低'
              : '正常';

      return `${mostDeviated.name} ${mostDeviated.consumed}${mostDeviated.unit}/目标${mostDeviated.target}${mostDeviated.unit}(${mostDeviated.percent}%), ${status}`;
    }

    // fallback: 用 totals + ctx 计算热量进度
    const calPercent =
      ctx.goalCalories > 0
        ? Math.round(
            ((ctx.todayCalories + totals.calories) / ctx.goalCalories) * 100,
          )
        : 0;
    return `今日总热量 ${Math.round(ctx.todayCalories + totals.calories)}kcal/目标${ctx.goalCalories}kcal(${calPercent}%)`;
  }

  /**
   * 构建替代方案摘要
   */
  private buildAlternativeSummary(
    alternatives: FoodAlternative[] | undefined,
  ): string | undefined {
    if (!alternatives || alternatives.length === 0) return undefined;

    const top = alternatives[0];
    const parts = [top.name];
    if (top.comparison) {
      if (top.comparison.caloriesDiff < 0) {
        parts.push(`少${Math.abs(top.comparison.caloriesDiff)}kcal`);
      }
      if (top.comparison.proteinDiff > 0) {
        parts.push(`多${top.comparison.proteinDiff}g蛋白`);
      }
    }

    if (alternatives.length > 1) {
      return `建议替换为：${parts.join(', ')}（还有${alternatives.length - 1}个备选）`;
    }
    return `建议替换为：${parts.join(', ')}`;
  }

  private extractContextSignals(
    ctx: UnifiedUserContext,
    totals: NutritionTotals,
    decision: FoodDecision,
  ): string[] {
    const signals = [...(ctx.contextSignals || [])];

    if (decision.recommendation === 'avoid') {
      signals.push('high_risk_decision');
    }
    if (decision.optimalPortion) {
      signals.push('portion_adjustment_needed');
    }
    if (totals.calories > Math.max(ctx.remainingCalories, 0) && ctx.remainingCalories > 0) {
      signals.push('meal_over_remaining_budget');
    }

    return Array.from(new Set(signals)).slice(0, 5);
  }

  private resolveCoachFocus(
    ctx: UnifiedUserContext,
    topIssues: string[],
    decision: FoodDecision,
  ): string {
    // V2.7: 使用信号优先级仲裁矩阵替代顺序 if-else
    const signals = [
      ...(ctx.contextSignals || []),
      ...(ctx.nutritionPriority || []),
      ...(ctx.budgetStatus ? [ctx.budgetStatus] : []),
    ];

    // 去重并查矩阵，找出最高优先级信号
    const uniqueSignals = Array.from(new Set(signals));
    const topSignal = uniqueSignals.sort(
      (a, b) =>
        getSignalPriority(b, ctx.goalType) - getSignalPriority(a, ctx.goalType),
    )[0];

    if (topSignal === 'over_limit' || topSignal === 'near_limit') {
      return ctx.goalType === 'fat_loss'
        ? '优先强调热量边界和份量控制'
        : '今日已达热量目标上限，注意整体平衡';
    }
    if (topSignal === 'protein_gap') {
      return '优先强调蛋白质补充和更优搭配';
    }
    if (topSignal === 'health_constraint') {
      return '优先满足健康约束与过敏/忌口，再做营养优化';
    }
    if (topSignal === 'fat_excess') {
      return '控制脂肪摄入，优先选择低脂替代方案';
    }
    if (topSignal === 'carb_excess') {
      return '降低碳水比例，优先补充蛋白质和蔬菜';
    }
    if (topSignal === 'late_night_window') {
      return '当前处于晚间餐次窗口，建议控制总量';
    }
    if (topSignal === 'meal_count_low') {
      return '今日餐次不足，建议补充营养密度高的食物';
    }
    if (topSignal === 'under_target') {
      return '当前摄入低于目标，可适当增加摄入';
    }
    if (decision.recommendation === 'avoid') {
      return '优先解释为什么现在不适合继续吃';
    }
    if (topIssues.length > 0) {
      return `优先围绕“${topIssues[0]}”给出具体行动建议`;
    }
    return '优先给出简单、可执行、可坚持的下一步建议';
  }

  private buildDynamicDecisionHint(
    ctx: UnifiedUserContext,
    decision: FoodDecision,
  ): string {
    const isLateWindow = ctx.localHour >= 21 || ctx.localHour <= 5;
    if (ctx.budgetStatus === 'over_limit') {
      return '同样食物在当前状态更容易超预算，建议优先控制份量或替代。';
    }
    if (ctx.budgetStatus === 'near_limit') {
      return '同样食物在接近预算上限时需要更谨慎，建议减量或调整搭配。';
    }
    if (isLateWindow && decision.recommendation !== 'avoid') {
      return '同样食物在夜间窗口更应关注总量与消化负担。';
    }
    return '同样食物在不同时段与摄入状态下，结论可能不同。';
  }

  private buildHealthConstraintNote(ctx: UnifiedUserContext): string | undefined {
    const constraints = [
      ...(ctx.allergens || []),
      ...(ctx.dietaryRestrictions || []),
      ...(ctx.healthConditions || []),
    ].filter(Boolean);

    if (constraints.length === 0) return undefined;

    return `存在健康约束（${constraints.slice(0, 3).join('、')}），建议优先满足约束再优化营养。`;
  }
  /** V3.0: 从 contextSignals 构建有序信号追踪列表 */
  private buildSignalTrace(
    ctx: UnifiedUserContext,
    contextSignals: string[],
  ): SignalTraceItem[] {
    const trace: SignalTraceItem[] = [];

    const SIGNAL_SOURCE_MAP: Record<string, SignalTraceItem['source']> = {
      health_constraint: 'health_constraint',
      over_limit: 'user_context',
      near_limit: 'user_context',
      under_target: 'user_context',
      protein_gap: 'nutrition',
      fat_excess: 'nutrition',
      carb_excess: 'nutrition',
      late_night_window: 'time_window',
      meal_count_low: 'user_context',
      fresh_day: 'user_context',
    };

    const SIGNAL_DESC_MAP: Record<string, string> = {
      health_constraint: `健康约束（${[
        ...(ctx.allergens || []),
        ...(ctx.dietaryRestrictions || []),
        ...(ctx.healthConditions || []),
      ]
        .slice(0, 2)
        .join('/')}）`,
      over_limit: `今日热量超标（已摄入 ${Math.round(ctx.todayCalories)}/${ctx.goalCalories}kcal）`,
      near_limit: `今日热量接近上限（剩余 ${Math.round(ctx.remainingCalories)}kcal）`,
      under_target: `今日摄入低于目标（剩余 ${Math.round(ctx.remainingCalories)}kcal）`,
      protein_gap: `蛋白质缺口较大（剩余 ${Math.round(ctx.remainingProtein)}g/${ctx.goalProtein}g）`,
      fat_excess: `脂肪超标（超出 ${Math.abs(Math.round(ctx.remainingFat))}g）`,
      carb_excess: `碳水超标（超出 ${Math.abs(Math.round(ctx.remainingCarbs))}g）`,
      late_night_window: `当前处于晚间餐次窗口（${ctx.localHour}点）`,
      meal_count_low: `今日餐次偏少（已记录 ${ctx.mealCount} 餐）`,
      fresh_day: '今日摄入较少，营养余量充足',
    };

    const goalType = ctx.goalType || 'health';
    const { getSignalPriority, SIGNAL_PRIORITY_MATRIX } = require('../config/signal-priority.config');
    const { DynamicSignalWeightService } = require('../config/dynamic-signal-weight.service');
    const dynamicWeightSvc = new DynamicSignalWeightService();
    const baseWeights = SIGNAL_PRIORITY_MATRIX[goalType] ?? {};
    const adjustedWeights = dynamicWeightSvc.adjustWeights(
      baseWeights,
      ctx.macroSlotStatus,
      goalType,
    );

    for (const signal of contextSignals) {
      const dynamicPriority = adjustedWeights[signal] ?? getSignalPriority(signal, goalType);
      trace.push({
        signal,
        priority: dynamicPriority,
        source: SIGNAL_SOURCE_MAP[signal] ?? 'user_context',
        description: SIGNAL_DESC_MAP[signal] ?? signal,
      });
    }

    // 按优先级降序
    trace.sort((a, b) => b.priority - a.priority);

    return trace;
  }}
