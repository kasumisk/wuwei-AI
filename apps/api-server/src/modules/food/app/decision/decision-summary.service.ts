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
} from '../types/analysis-result.types';
import { DecisionOutput } from './food-decision.service';
import { UnifiedUserContext } from '../types/analysis-result.types';

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
    const alternativeSummary = this.buildAlternativeSummary(alternatives);

    return {
      headline,
      verdict: decision.recommendation,
      topIssues,
      topStrengths,
      actionItems,
      quantitativeHighlight,
      alternativeSummary,
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
      return `${foodDesc}(${calText})营养搭配不错，可以放心吃`;
    }

    if (decision.recommendation === 'avoid') {
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
}
