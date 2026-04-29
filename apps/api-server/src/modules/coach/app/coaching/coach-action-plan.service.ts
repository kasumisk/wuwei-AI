import { Injectable } from '@nestjs/common';
import {
  BreakdownExplanation,
  CoachActionPlan,
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
  ShouldEatAction,
  StructuredDecision,
  NutritionTotals,
} from '../../../decision/types/analysis-result.types';
import { I18nService } from '../../../../core/i18n';
import { ci, toCoachLocale } from '../../../decision/coach/coach-i18n';

@Injectable()
export class CoachActionPlanService {
  constructor(private readonly i18n: I18nService) {}

  build(input: {
    shouldEatAction: ShouldEatAction;
    summary?: DecisionSummary;
    evidencePack?: EvidencePack;
    confidenceDiagnostics?: ConfidenceDiagnostics;
    goalType?: string;
    /** V2.7: 7维评分解释，注入最低分维度 message 到 why[] */
    breakdownExplanations?: BreakdownExplanation[];
    /** V2.7: 下一餐建议 */
    nextMealAdvice?: { suggestion: string; emphasis: string };
    /** V3.7: 结构化决策 — 用于关联 why[] 到 factor details */
    structuredDecision?: StructuredDecision;
    /** V3.7: 营养总量 — 用于 conclusionData 量化 */
    totals?: NutritionTotals;
    /** V3.7: 剩余热量 */
    remainingCalories?: number;
    /** V3.7: 语言 */
    language?: string;
  }): CoachActionPlan {
    const {
      shouldEatAction,
      summary,
      evidencePack,
      confidenceDiagnostics,
      goalType,
      breakdownExplanations,
      nextMealAdvice,
      structuredDecision,
      totals,
      remainingCalories,
      language,
    } = input;

    // V2.7: 从 breakdownExplanations 提取最低分的 warning/critical 维度
    const breakdownInsight = this.resolveBreakdownInsight(
      breakdownExplanations,
    );

    // V3.7: 构建 why[] 关联决策因素
    const why = this.buildWhy(
      summary,
      evidencePack,
      confidenceDiagnostics,
      breakdownInsight,
      structuredDecision,
      language,
    );

    // V3.7: conclusionData 量化
    const conclusionData: CoachActionPlan['conclusionData'] = totals
      ? {
          calories: Math.round(totals.calories),
          remainingCalories:
            remainingCalories != null
              ? Math.round(remainingCalories)
              : undefined,
          score: structuredDecision?.finalScore,
        }
      : undefined;

    // V3.7: educationPoint — 基于最弱因素生成教育要点
    const educationPoint = this.resolveEducationPoint(
      structuredDecision,
      language,
    );

    return {
      conclusion: summary?.headline || shouldEatAction.primaryReason,
      conclusionData,
      why,
      doNow: [
        shouldEatAction.immediateAction,
        ...(shouldEatAction.followUpActions || []),
        ...(summary?.actionItems || []),
      ]
        .filter(Boolean)
        .slice(0, 4),
      ifAlreadyAte: shouldEatAction.recoveryAction
        ? [
            shouldEatAction.recoveryAction.nextMealDirection,
            shouldEatAction.recoveryAction.todayAdjustment,
          ]
        : undefined,
      alternatives: shouldEatAction.replacementAction?.candidates.map(
        (item) => `${item.name}: ${item.reason}`,
      ),
      tone: this.resolveTone(goalType),
      nextMeal: nextMealAdvice?.suggestion,
      educationPoint,
    };
  }

  /** V3.7: 构建 why[] — 关联决策因素 rationale */
  private buildWhy(
    summary?: DecisionSummary,
    evidencePack?: EvidencePack,
    confidenceDiagnostics?: ConfidenceDiagnostics,
    breakdownInsight?: string,
    structuredDecision?: StructuredDecision,
    language?: string,
  ): string[] {
    const why: string[] = [];

    // 从 structuredDecision factors 提取低分因素的 rationale
    if (structuredDecision?.factors) {
      const factors = structuredDecision.factors;
      const factorEntries = Object.entries(factors) as [
        string,
        { score: number; rationale: string },
      ][];
      // 取评分最低的因素（<70 分）加入 why
      const weakFactors = factorEntries
        .filter(([, f]) => f.score < 70)
        .sort((a, b) => a[1].score - b[1].score)
        .slice(0, 2);
      for (const [, factor] of weakFactors) {
        if (factor.rationale) {
          why.push(factor.rationale);
        }
      }
    }

    // 补充 summary 信息
    why.push(...(summary?.topIssues || []));
    why.push(...(summary?.contextSignals || []));
    if (summary?.coachFocus) why.push(summary.coachFocus);
    if (summary?.dynamicDecisionHint) why.push(summary.dynamicDecisionHint);
    if (summary?.healthConstraintNote) why.push(summary.healthConstraintNote);
    why.push(...(evidencePack?.decisionEvidence || []));
    if (breakdownInsight) why.push(breakdownInsight);

    const lang = toCoachLocale(language);
    if (
      confidenceDiagnostics?.decisionConfidence != null &&
      confidenceDiagnostics.decisionConfidence < 0.6
    ) {
      why.push(ci(this.i18n, 'modifier.lowConfidence', lang));
    }

    // 去重 + 截取
    return [...new Set(why)].slice(0, 4);
  }

  /** V3.7: 基于最弱决策因素生成教育要点 */
  private resolveEducationPoint(
    structuredDecision?: StructuredDecision,
    language?: string,
  ): string | undefined {
    if (!structuredDecision?.factors) return undefined;
    const factors = structuredDecision.factors;
    const factorEntries = Object.entries(factors) as [
      string,
      { score: number; rationale: string },
    ][];
    const weakest = factorEntries.sort((a, b) => a[1].score - b[1].score).at(0);
    if (!weakest || weakest[1].score >= 70) return undefined;

    const lang = toCoachLocale(language);
    const educationKeys: Record<string, string> = {
      nutritionAlignment: 'format.reason.pushOverload',
      macroBalance: 'format.suggestion.addProtein',
      healthConstraint: 'format.reason.noSignal',
      timeliness: 'format.suggestion.observeHunger',
    };
    const key = educationKeys[weakest[0]] as
      | keyof import('../../../decision/coach/coach-i18n').CoachI18nStrings
      | undefined;
    return key ? ci(this.i18n, key, lang) : undefined;
  }

  private resolveTone(goalType?: string): 'strict' | 'encouraging' | 'neutral' {
    if (goalType === 'fat_loss') return 'strict';
    if (goalType === 'muscle_gain') return 'encouraging';
    return 'neutral';
  }

  /** V2.7: 提取最低分 critical/warning 维度的简短洞察 */
  private resolveBreakdownInsight(
    breakdownExplanations?: BreakdownExplanation[],
  ): string | undefined {
    if (!breakdownExplanations || breakdownExplanations.length === 0)
      return undefined;
    const candidates = breakdownExplanations.filter(
      (b) => b.impact === 'critical' || b.impact === 'warning',
    );
    if (candidates.length === 0) return undefined;
    const worst = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
    return worst.message || undefined;
  }
}
