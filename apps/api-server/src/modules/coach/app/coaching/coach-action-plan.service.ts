import { Injectable } from '@nestjs/common';
import {
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
  }): CoachActionPlan {
    const { shouldEatAction, summary, evidencePack, confidenceDiagnostics, goalType } = input;

    return {
      conclusion: summary?.headline || shouldEatAction.primaryReason,
      why: [
        ...(summary?.topIssues || []),
        ...(evidencePack?.decisionEvidence || []),
        ...(confidenceDiagnostics?.decisionConfidence != null &&
        confidenceDiagnostics.decisionConfidence < 0.6
          ? ['当前结论偏保守，建议结合更清晰输入复核']
          : []),
      ].slice(0, 3),
      doNow: [
        shouldEatAction.immediateAction,
        ...(summary?.actionItems || []),
      ].filter(Boolean).slice(0, 3),
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
    };
  }

  private resolveTone(goalType?: string): 'strict' | 'encouraging' | 'neutral' {
    if (goalType === 'fat_loss') return 'strict';
    if (goalType === 'muscle_gain') return 'encouraging';
    return 'neutral';
  }
}