import { Injectable } from '@nestjs/common';
import {
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
  FoodAlternative,
  RecoveryAction,
  ShouldEatAction,
} from '../types/analysis-result.types';
import { DecisionOutput } from './food-decision.service';

@Injectable()
export class ShouldEatActionService {
  build(input: {
    mode: 'pre_eat' | 'post_eat';
    decisionOutput: DecisionOutput;
    summary?: DecisionSummary;
    evidencePack: EvidencePack;
    confidenceDiagnostics: ConfidenceDiagnostics;
    recoveryAction?: RecoveryAction;
  }): ShouldEatAction {
    const { mode, decisionOutput, summary, evidencePack, confidenceDiagnostics, recoveryAction } = input;
    const { decision, alternatives } = decisionOutput;

    const immediateAction = this.resolveImmediateAction(
      mode,
      decisionOutput,
      summary,
      confidenceDiagnostics,
      recoveryAction,
    );

    return {
      verdict: decision.recommendation,
      shouldEat: decision.shouldEat,
      mode,
      primaryReason: summary?.topIssues[0] || decision.reason,
      evidence: [
        ...evidencePack.issueEvidence,
        ...evidencePack.contextEvidence,
        ...evidencePack.decisionEvidence,
      ].slice(0, 4),
      immediateAction,
      portionAction: decision.optimalPortion
        ? {
            suggestedPercent: decision.optimalPortion.recommendedPercent,
            suggestedCalories: decision.optimalPortion.recommendedCalories,
          }
        : undefined,
      replacementAction:
        alternatives.length > 0
          ? {
              strategy: this.resolveReplacementStrategy(alternatives),
              candidates: alternatives.slice(0, 3),
            }
          : undefined,
      recoveryAction,
    };
  }

  private resolveImmediateAction(
    mode: 'pre_eat' | 'post_eat',
    decisionOutput: DecisionOutput,
    summary: DecisionSummary | undefined,
    confidenceDiagnostics: ConfidenceDiagnostics,
    recoveryAction?: RecoveryAction,
  ): string {
    if (mode === 'post_eat' && recoveryAction) {
      return recoveryAction.todayAdjustment;
    }

    if (confidenceDiagnostics.decisionConfidence < 0.6) {
      return '先按保守策略处理，必要时补充更清晰输入后再判断';
    }

    if (summary?.actionItems?.[0]) {
      return summary.actionItems[0];
    }

    if (decisionOutput.decision.advice) {
      return decisionOutput.decision.advice;
    }

    return decisionOutput.decision.recommendation === 'recommend'
      ? '按当前搭配食用即可'
      : '优先调整份量或更换搭配后再食用';
  }

  private resolveReplacementStrategy(
    alternatives: FoodAlternative[],
  ): 'replace_food' | 'reduce_portion' | 'change_pairing' {
    const reasons = alternatives.map((item) => item.reason).join(' ');
    if (reasons.includes('减') || reasons.includes('portion')) {
      return 'reduce_portion';
    }
    if (reasons.includes('搭配') || reasons.includes('pair')) {
      return 'change_pairing';
    }
    return 'replace_food';
  }
}