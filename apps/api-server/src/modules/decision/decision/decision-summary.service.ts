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
  StructuredDecision,
  NutritionIssue,
} from '../types/analysis-result.types';
import { DecisionOutput } from './food-decision.service';
import { UnifiedUserContext } from '../types/analysis-result.types';
import {
  getSignalPriority,
  SIGNAL_PRIORITY_MATRIX,
} from '../config/signal-priority.config';
import { DynamicSignalWeightService } from '../config/dynamic-signal-weight.service';
import { cl } from '../i18n/decision-labels';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

// ==================== 摘要输入 ====================

export interface SummaryInput {
  decisionOutput: DecisionOutput;
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  foodNames: string[];
  /** V3.3: 结构化决策（用于增强 topIssues 和 actionItems） */
  structuredDecision?: StructuredDecision;
  /** V3.5: 营养问题列表（用于增强 healthConstraintNote） */
  nutritionIssues?: NutritionIssue[];
  /** V3.5: 决策模式（pre_eat / post_eat），影响 actionItems 建议方向 */
  decisionMode?: 'pre_eat' | 'post_eat';
  /** V3.8: locale for i18n */
  locale?: Locale;
}

// ==================== 严重度权重 ====================

const SEVERITY_ORDER: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

@Injectable()
export class DecisionSummaryService {
  constructor(
    private readonly dynamicSignalWeightService: DynamicSignalWeightService,
  ) {}

  /**
   * 从决策输出中生成结构化摘要
   */
  summarize(input: SummaryInput): DecisionSummary {
    const {
      decisionOutput,
      totals,
      userContext,
      foodNames,
      structuredDecision,
      nutritionIssues,
      decisionMode,
      locale,
    } = input;
    const { decision, alternatives, issues, macroProgress } = decisionOutput;

    const headline = this.buildHeadline(
      decision,
      totals,
      foodNames,
      userContext,
      locale,
    );
    let topIssues = this.extractTopIssues(issues, 3);
    const topStrengths = this.extractTopStrengths(
      decisionOutput.breakdownExplanations,
      2,
      locale,
    );
    let actionItems = this.extractActionItems(
      issues,
      decision,
      3,
      decisionMode,
      locale,
    );

    // V3.3: 用 StructuredDecision.factors 增强 topIssues 和 actionItems
    if (structuredDecision) {
      topIssues = this.enrichTopIssuesFromFactors(
        topIssues,
        structuredDecision,
        locale,
      );
      actionItems = this.enrichActionItemsFromRationale(
        actionItems,
        structuredDecision,
      );
    }

    // V3.6 P2.4: 将 nutritionIssues 的 implication（含量化数据）前插到 topIssues
    if (nutritionIssues && nutritionIssues.length > 0) {
      const issueImplications = nutritionIssues
        .filter((ni) => ni.severity !== 'low' && ni.implication)
        .slice(0, 2)
        .map((ni) => ni.implication);
      const existingSet = new Set(topIssues);
      for (const impl of issueImplications.reverse()) {
        if (!existingSet.has(impl)) {
          topIssues.unshift(impl);
          existingSet.add(impl);
        }
      }
      topIssues = topIssues.slice(0, 4);
    }
    const quantitativeHighlight = this.buildQuantitativeHighlight(
      macroProgress,
      totals,
      userContext,
      locale,
    );
    const contextSignals = this.extractContextSignals(
      userContext,
      totals,
      decision,
    );
    const coachFocus = this.resolveCoachFocus(
      userContext,
      topIssues,
      decision,
      nutritionIssues,
      locale,
    );
    const alternativeSummary = this.buildAlternativeSummary(
      alternatives,
      locale,
    );
    const dynamicDecisionHint = this.buildDynamicDecisionHint(
      userContext,
      decision,
      locale,
    );
    const healthConstraintNote = this.buildHealthConstraintNote(
      userContext,
      nutritionIssues,
      locale,
    );
    // V3.0: 信号追踪
    const signalTrace = this.buildSignalTrace(
      userContext,
      contextSignals,
      locale,
    );

    // V4.0: 生成行为上下文说明
    const behaviorNote = this.buildBehaviorNote(userContext, locale);

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
      behaviorNote,
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
    locale?: Locale,
  ): string {
    const foodDesc =
      foodNames.length <= 2
        ? foodNames.join(cl('summary.join', locale))
        : cl('summary.foodCount', locale)
            .replace('{first}', foodNames[0])
            .replace('{count}', String(foodNames.length));

    const calText = `${Math.round(totals.calories)}kcal`;

    if (decision.recommendation === 'recommend') {
      if (ctx.budgetStatus === 'near_limit') {
        return cl('summary.recommend.nearLimit', locale)
          .replace('{food}', foodDesc)
          .replace('{cal}', calText);
      }
      return cl('summary.recommend.ok', locale)
        .replace('{food}', foodDesc)
        .replace('{cal}', calText);
    }

    if (decision.recommendation === 'avoid') {
      if (ctx.budgetStatus === 'over_limit') {
        return cl('summary.avoid.overLimit', locale)
          .replace('{food}', foodDesc)
          .replace('{cal}', calText);
      }
      return cl('summary.avoid.generic', locale)
        .replace('{food}', foodDesc)
        .replace('{cal}', calText);
    }

    // caution — 给出具体原因
    if (decision.optimalPortion) {
      return cl('summary.caution.portion', locale)
        .replace('{food}', foodDesc)
        .replace('{cal}', calText)
        .replace(
          '{percent}',
          String(decision.optimalPortion.recommendedPercent),
        );
    }

    const remaining = ctx.remainingCalories;
    if (totals.calories > remaining && remaining > 0) {
      return cl('summary.caution.overBudget', locale)
        .replace('{food}', foodDesc)
        .replace('{cal}', calText)
        .replace('{amount}', String(Math.round(totals.calories - remaining)));
    }

    return cl('summary.caution.reason', locale)
      .replace('{food}', foodDesc)
      .replace('{cal}', calText)
      .replace('{reason}', decision.reason);
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
    locale?: Locale,
  ): string[] {
    if (!explanations || explanations.length === 0) return [];

    return explanations
      .filter((e) => e.impact === 'positive')
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount)
      .map((e) =>
        cl('summary.strength', locale)
          .replace('{label}', e.label)
          .replace('{score}', String(e.score))
          .replace('{message}', e.message),
      );
  }

  /**
   * 提取可执行建议
   *
   * 优先从 issues 的 actionable 字段提取，不足时从 decision.advice 补充。
   * V3.5: post_eat 模式追加恢复性行动提示。
   */
  private extractActionItems(
    issues: DietIssue[] | undefined,
    decision: FoodDecision,
    maxCount: number,
    decisionMode?: 'pre_eat' | 'post_eat',
    locale?: Locale,
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

    // 3. V3.5: post_eat 模式追加恢复性行动提示
    if (decisionMode === 'post_eat' && items.length < maxCount) {
      items.push(cl('summary.postEatAction', locale));
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
    locale?: Locale,
  ): string {
    if (macroProgress) {
      // 找偏离最大的维度
      const dimensions = [
        {
          name: cl('summary.macro.calories', locale),
          consumed: macroProgress.calories.consumed,
          target: macroProgress.calories.target,
          percent: macroProgress.calories.percent,
          unit: 'kcal',
        },
        {
          name: cl('summary.macro.protein', locale),
          consumed: macroProgress.protein.consumed,
          target: macroProgress.protein.target,
          percent: macroProgress.protein.percent,
          unit: 'g',
        },
        {
          name: cl('summary.macro.fat', locale),
          consumed: macroProgress.fat.consumed,
          target: macroProgress.fat.target,
          percent: macroProgress.fat.percent,
          unit: 'g',
        },
        {
          name: cl('summary.macro.carbs', locale),
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
          ? cl('summary.status.over', locale)
          : mostDeviated.percent < 50
            ? cl('summary.status.severeDeficit', locale)
            : mostDeviated.percent < 80
              ? cl('summary.status.low', locale)
              : cl('summary.status.ok', locale);

      return cl('summary.quantitative', locale)
        .replace('{name}', mostDeviated.name)
        .replace('{consumed}', String(mostDeviated.consumed))
        .replace('{unit}', mostDeviated.unit)
        .replace('{target}', String(mostDeviated.target))
        .replace('{unit}', mostDeviated.unit)
        .replace('{percent}', String(mostDeviated.percent))
        .replace('{status}', status);
    }

    // fallback: 用 totals + ctx 计算热量进度
    const calPercent =
      ctx.goalCalories > 0
        ? Math.round(
            ((ctx.todayCalories + totals.calories) / ctx.goalCalories) * 100,
          )
        : 0;
    return cl('summary.quantitativeFallback', locale)
      .replace(
        '{consumed}',
        String(Math.round(ctx.todayCalories + totals.calories)),
      )
      .replace('{target}', String(ctx.goalCalories))
      .replace('{percent}', String(calPercent));
  }

  /**
   * 构建替代方案摘要
   */
  private buildAlternativeSummary(
    alternatives: FoodAlternative[] | undefined,
    locale?: Locale,
  ): string | undefined {
    if (!alternatives || alternatives.length === 0) return undefined;

    const top = alternatives[0];
    const parts = [top.name];
    if (top.comparison) {
      if (top.comparison.caloriesDiff < 0) {
        parts.push(
          cl('summary.altCalLess', locale).replace(
            '{amount}',
            String(Math.abs(top.comparison.caloriesDiff)),
          ),
        );
      }
      if (top.comparison.proteinDiff > 0) {
        parts.push(
          cl('summary.altProteinMore', locale).replace(
            '{amount}',
            String(top.comparison.proteinDiff),
          ),
        );
      }
    }

    if (alternatives.length > 1) {
      return cl('summary.altSummary.multi', locale)
        .replace('{desc}', parts.join(', '))
        .replace('{count}', String(alternatives.length - 1));
    }
    return cl('summary.altSummary.single', locale).replace(
      '{desc}',
      parts.join(', '),
    );
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
    if (
      totals.calories > Math.max(ctx.remainingCalories, 0) &&
      ctx.remainingCalories > 0
    ) {
      signals.push('meal_over_remaining_budget');
    }

    return Array.from(new Set(signals)).slice(0, 5);
  }

  private resolveCoachFocus(
    ctx: UnifiedUserContext,
    topIssues: string[],
    decision: FoodDecision,
    nutritionIssues?: NutritionIssue[],
    locale?: Locale,
  ): string {
    // V3.6 P2.3: 健康风险优先 — high severity 强制覆盖信号矩阵
    const HEALTH_RISK_TYPES = new Set([
      'glycemic_risk',
      'cardiovascular_risk',
      'sodium_risk',
      'purine_risk',
      'kidney_stress',
    ]);
    const highRisk = (nutritionIssues || []).find(
      (ni) => HEALTH_RISK_TYPES.has(ni.type) && ni.severity === 'high',
    );
    if (highRisk) {
      return cl('summary.focus.healthRisk', locale).replace(
        '{detail}',
        highRisk.implication || highRisk.type,
      );
    }
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
        ? cl('summary.focus.overLimit.fatLoss', locale)
        : cl('summary.focus.overLimit.other', locale);
    }
    if (topSignal === 'protein_gap') {
      return cl('summary.focus.proteinGap', locale);
    }
    if (topSignal === 'health_constraint') {
      return cl('summary.focus.healthConstraint', locale);
    }
    if (topSignal === 'fat_excess') {
      return cl('summary.focus.fatExcess', locale);
    }
    if (topSignal === 'carb_excess') {
      return cl('summary.focus.carbExcess', locale);
    }
    if (topSignal === 'late_night_window') {
      return cl('summary.focus.lateNight', locale);
    }
    if (topSignal === 'meal_count_low') {
      return cl('summary.focus.mealCountLow', locale);
    }
    if (topSignal === 'under_target') {
      return cl('summary.focus.underTarget', locale);
    }
    if (decision.recommendation === 'avoid') {
      return cl('summary.focus.avoid', locale);
    }
    if (topIssues.length > 0) {
      return cl('summary.focus.topIssue', locale).replace(
        '{issue}',
        topIssues[0],
      );
    }
    return cl('summary.focus.default', locale);
  }

  private buildDynamicDecisionHint(
    ctx: UnifiedUserContext,
    decision: FoodDecision,
    locale?: Locale,
  ): string {
    const isLateWindow = ctx.localHour >= 21 || ctx.localHour <= 5;
    if (ctx.budgetStatus === 'over_limit') {
      return cl('summary.hint.overLimit', locale);
    }
    if (ctx.budgetStatus === 'near_limit') {
      return cl('summary.hint.nearLimit', locale);
    }
    if (isLateWindow && decision.recommendation !== 'avoid') {
      return cl('summary.hint.lateNight', locale);
    }
    return cl('summary.hint.default', locale);
  }

  private buildHealthConstraintNote(
    ctx: UnifiedUserContext,
    nutritionIssues?: NutritionIssue[],
    locale?: Locale,
  ): string | undefined {
    const constraints = [
      ...(ctx.allergens || []),
      ...(ctx.dietaryRestrictions || []),
      ...(ctx.healthConditions || []),
    ].filter(Boolean);

    if (constraints.length === 0) return undefined;

    // V3.5: 优先使用 nutritionIssues 中健康条件相关问题的 implication（更精准）
    const HEALTH_CONDITION_ISSUE_TYPES = new Set([
      'glycemic_risk',
      'cardiovascular_risk',
      'sodium_risk',
      'purine_risk',
      'kidney_stress',
    ]);
    const healthIssueImplications = (nutritionIssues || [])
      .filter((ni) => HEALTH_CONDITION_ISSUE_TYPES.has(ni.type))
      .sort((a, b) => {
        const severityOrder: Record<string, number> = {
          high: 3,
          medium: 2,
          low: 1,
        };
        return (
          (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0)
        );
      })
      .slice(0, 2)
      .map((ni) => ni.implication);

    if (healthIssueImplications.length > 0) {
      return cl('summary.healthNote.issues', locale).replace(
        '{details}',
        healthIssueImplications.join('；'),
      );
    }

    return cl('summary.healthNote.generic', locale).replace(
      '{constraints}',
      constraints.slice(0, 3).join('、'),
    );
  }
  // ==================== V3.3: StructuredDecision 增强 ====================

  /**
   * 从 StructuredDecision.factors 中补充低分维度到 topIssues
   * 只补充 score < 50 且尚未覆盖的维度
   */
  private enrichTopIssuesFromFactors(
    topIssues: string[],
    sd: StructuredDecision,
    locale?: Locale,
  ): string[] {
    if (!sd.factors) return topIssues;

    const existing = new Set(topIssues);
    const DIMENSION_LABEL_KEYS: Record<string, string> = {
      nutritionAlignment: 'summary.dimension.nutritionAlignment',
      macroBalance: 'summary.dimension.macroBalance',
      healthConstraint: 'summary.dimension.healthConstraint',
      timeliness: 'summary.dimension.timeliness',
    };

    const entries = Object.entries(sd.factors) as Array<
      [string, { score: number; rationale: string }]
    >;
    const lowScoreFactors = entries
      .filter(([, f]) => f.score < 50)
      .sort((a, b) => a[1].score - b[1].score);

    for (const [key, factor] of lowScoreFactors) {
      if (topIssues.length >= 4) break;
      const label = DIMENSION_LABEL_KEYS[key]
        ? cl(DIMENSION_LABEL_KEYS[key], locale)
        : key;
      const msg = `${label}: ${factor.rationale}`;
      if (!existing.has(msg)) {
        topIssues.push(msg);
        existing.add(msg);
      }
    }

    return topIssues;
  }

  /**
   * 从 StructuredDecision.rationale 中补充行动建议到 actionItems
   */
  private enrichActionItemsFromRationale(
    actionItems: string[],
    sd: StructuredDecision,
  ): string[] {
    if (!sd.rationale) return actionItems;

    const existing = new Set(actionItems);

    // 从各维度理由中提取可执行建议
    const rationaleTexts = [
      sd.rationale.contextual,
      sd.rationale.goalAlignment,
      sd.rationale.healthRisk,
      sd.rationale.timelinessNote,
    ].filter((t): t is string => !!t && t.length > 0);

    for (const text of rationaleTexts) {
      if (actionItems.length >= 4) break;
      if (!existing.has(text)) {
        actionItems.push(text);
        existing.add(text);
      }
    }

    return actionItems;
  }

  /** V3.0: 从 contextSignals 构建有序信号追踪列表 */
  private buildSignalTrace(
    ctx: UnifiedUserContext,
    contextSignals: string[],
    locale?: Locale,
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
      health_constraint: cl('summary.signal.healthConstraint', locale).replace(
        '{details}',
        [
          ...(ctx.allergens || []),
          ...(ctx.dietaryRestrictions || []),
          ...(ctx.healthConditions || []),
        ]
          .slice(0, 2)
          .join('/'),
      ),
      over_limit: cl('summary.signal.overLimit', locale)
        .replace('{consumed}', String(Math.round(ctx.todayCalories)))
        .replace('{goal}', String(ctx.goalCalories)),
      near_limit: cl('summary.signal.nearLimit', locale).replace(
        '{remaining}',
        String(Math.round(ctx.remainingCalories)),
      ),
      under_target: cl('summary.signal.underTarget', locale).replace(
        '{remaining}',
        String(Math.round(ctx.remainingCalories)),
      ),
      protein_gap: cl('summary.signal.proteinGap', locale)
        .replace('{remaining}', String(Math.round(ctx.remainingProtein)))
        .replace('{goal}', String(ctx.goalProtein)),
      fat_excess: cl('summary.signal.fatExcess', locale).replace(
        '{amount}',
        String(Math.abs(Math.round(ctx.remainingFat))),
      ),
      carb_excess: cl('summary.signal.carbExcess', locale).replace(
        '{amount}',
        String(Math.abs(Math.round(ctx.remainingCarbs))),
      ),
      late_night_window: cl('summary.signal.lateNight', locale).replace(
        '{hour}',
        String(ctx.localHour),
      ),
      meal_count_low: cl('summary.signal.mealCountLow', locale).replace(
        '{count}',
        String(ctx.mealCount),
      ),
      fresh_day: cl('summary.signal.freshDay', locale),
    };

    const goalType = ctx.goalType || 'health';
    const baseWeights = SIGNAL_PRIORITY_MATRIX[goalType] ?? {};
    const adjustedWeights = this.dynamicSignalWeightService.adjustWeights(
      baseWeights,
      ctx.macroSlotStatus,
      goalType,
    );

    for (const signal of contextSignals) {
      const dynamicPriority =
        adjustedWeights[signal] ?? getSignalPriority(signal, goalType);
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
  }

  /**
   * V4.0: 基于用户行为画像生成行为上下文说明
   */
  private buildBehaviorNote(
    ctx: UnifiedUserContext,
    locale?: Locale,
  ): string | undefined {
    const parts: string[] = [];

    if (ctx.goalProgress) {
      const gp = ctx.goalProgress;
      if (gp.streakDays > 0) {
        parts.push(
          cl('summary.streakNote', locale).replace(
            '{days}',
            String(gp.streakDays),
          ),
        );
      }
      if (gp.executionRate > 0) {
        parts.push(
          cl('summary.executionNote', locale).replace(
            '{rate}',
            String(Math.round(gp.executionRate * 100)),
          ),
        );
      }
    }

    if (ctx.shortTermBehavior?.intakeTrends === 'increasing') {
      parts.push(cl('summary.trendIncreasing', locale));
    } else if (ctx.shortTermBehavior?.intakeTrends === 'decreasing') {
      parts.push(cl('summary.trendDecreasing', locale));
    }

    return parts.length > 0
      ? parts.join(cl('summary.noteSep', locale))
      : undefined;
  }
}
