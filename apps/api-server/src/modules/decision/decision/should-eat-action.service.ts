import { Injectable } from '@nestjs/common';
import {
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
  FoodAlternative,
  RecoveryAction,
  ShouldEatAction,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { DecisionOutput } from './food-decision.service';

@Injectable()
export class ShouldEatActionService {
  build(input: {
    mode: 'pre_eat' | 'post_eat';
    decisionOutput: DecisionOutput;
    summary?: DecisionSummary;
    evidencePack: EvidencePack;
    userContext?: UnifiedUserContext;
    confidenceDiagnostics: ConfidenceDiagnostics;
    recoveryAction?: RecoveryAction;
  }): ShouldEatAction {
    const { mode, decisionOutput, summary, evidencePack, userContext, confidenceDiagnostics, recoveryAction } = input;
    const { decision, alternatives } = decisionOutput;

    const immediateAction = this.resolveImmediateAction(
      mode,
      decisionOutput,
      summary,
      userContext,
      confidenceDiagnostics,
      recoveryAction,
    );

    const replacementAction =
      alternatives.length > 0
        ? {
            strategy: this.resolveReplacementStrategy(alternatives),
            candidates: alternatives.slice(0, 3),
          }
        : undefined;
    const portionAction = decision.optimalPortion
      ? {
          suggestedPercent: decision.optimalPortion.recommendedPercent,
          suggestedCalories: decision.optimalPortion.recommendedCalories,
        }
      : undefined;

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
      followUpActions: this.buildFollowUpActions({
        summary,
        portionAction,
        replacementAction,
        recoveryAction,
      }),
      portionAction,
      replacementAction,
      recoveryAction,
    };
  }

  private resolveImmediateAction(
    mode: 'pre_eat' | 'post_eat',
    decisionOutput: DecisionOutput,
    summary: DecisionSummary | undefined,
    userContext: UnifiedUserContext | undefined,
    confidenceDiagnostics: ConfidenceDiagnostics,
    recoveryAction?: RecoveryAction,
  ): string {
    if (mode === 'post_eat' && recoveryAction) {
      return recoveryAction.todayAdjustment;
    }

    const hasHealthConstraint =
      ((userContext?.allergens?.length || 0) > 0) ||
      ((userContext?.dietaryRestrictions?.length || 0) > 0) ||
      ((userContext?.healthConditions?.length || 0) > 0);
    if (hasHealthConstraint) {
      return '先满足过敏/忌口/健康约束，再决定是否食用与食用份量';
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

  private buildFollowUpActions(input: {
    summary?: DecisionSummary;
    portionAction?: {
      suggestedPercent: number;
      suggestedCalories: number;
    };
    replacementAction?: {
      strategy: 'replace_food' | 'reduce_portion' | 'change_pairing';
      candidates: FoodAlternative[];
    };
    recoveryAction?: RecoveryAction;
  }): string[] {
    const actions = [...(input.summary?.actionItems || [])];
    if (input.summary?.decisionGuardrails?.length) {
      actions.push(...input.summary.decisionGuardrails);
    }

    if (input.portionAction) {
      actions.push(
        `优先按 ${input.portionAction.suggestedPercent}% 份量控制，本次约 ${input.portionAction.suggestedCalories} kcal`,
      );
    }

    if (input.replacementAction?.candidates?.[0]) {
      actions.push(`优先改成 ${input.replacementAction.candidates[0].name}`);
    }

    if (input.recoveryAction) {
      actions.push(input.recoveryAction.todayAdjustment);
    }

    return Array.from(new Set(actions.filter(Boolean))).slice(0, 4);
  }
}