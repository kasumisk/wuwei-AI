import { Injectable } from '@nestjs/common';
import {
  BreakdownExplanation,
  CoachActionPlan,
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
  ShouldEatAction,
} from '../../../decision/types/analysis-result.types';

@Injectable()
export class CoachActionPlanService {
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
  }): CoachActionPlan {
    const { shouldEatAction, summary, evidencePack, confidenceDiagnostics, goalType, breakdownExplanations, nextMealAdvice } = input;

    // V2.7: 从 breakdownExplanations 提取最低分的 warning/critical 维度
    const breakdownInsight = this.resolveBreakdownInsight(breakdownExplanations);

    return {
      conclusion: summary?.headline || shouldEatAction.primaryReason,
      why: [
        ...(summary?.topIssues || []),
        ...(summary?.contextSignals || []),
        ...(summary?.coachFocus ? [summary.coachFocus] : []),
        ...(summary?.dynamicDecisionHint ? [summary.dynamicDecisionHint] : []),
        ...(summary?.healthConstraintNote ? [summary.healthConstraintNote] : []),
        ...(evidencePack?.decisionEvidence || []),
        ...(breakdownInsight ? [breakdownInsight] : []),
        ...(confidenceDiagnostics?.decisionConfidence != null &&
        confidenceDiagnostics.decisionConfidence < 0.6
          ? ['当前结论偏保守，建议结合更清晰输入复核']
          : []),
      ].slice(0, 4),
      doNow: [
        shouldEatAction.immediateAction,
        ...(shouldEatAction.followUpActions || []),
        ...(summary?.actionItems || []),
      ].filter(Boolean).slice(0, 4),
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
    };
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
    if (!breakdownExplanations || breakdownExplanations.length === 0) return undefined;
    const candidates = breakdownExplanations.filter(
      (b) => b.impact === 'critical' || b.impact === 'warning',
    );
    if (candidates.length === 0) return undefined;
    const worst = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
    return worst.message || undefined;
  }
}