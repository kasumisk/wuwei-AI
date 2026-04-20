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
import { cl } from '../i18n/decision-labels';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

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
    locale?: Locale;
  }): ShouldEatAction {
    const {
      mode,
      decisionOutput,
      summary,
      evidencePack,
      userContext,
      confidenceDiagnostics,
      recoveryAction,
      locale,
    } = input;
    const { decision, alternatives } = decisionOutput;

    const immediateAction = this.resolveImmediateAction(
      mode,
      decisionOutput,
      summary,
      userContext,
      confidenceDiagnostics,
      recoveryAction,
      locale,
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
        locale,
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
    locale?: Locale,
  ): string {
    if (mode === 'post_eat' && recoveryAction) {
      return recoveryAction.todayAdjustment;
    }

    const hasHealthConstraint =
      (userContext?.allergens?.length || 0) > 0 ||
      (userContext?.dietaryRestrictions?.length || 0) > 0 ||
      (userContext?.healthConditions?.length || 0) > 0;
    if (hasHealthConstraint) {
      return cl('action.healthConstraintFirst', locale);
    }

    if (confidenceDiagnostics.decisionConfidence < 0.6) {
      return cl('action.conservativeFirst', locale);
    }

    if (summary?.actionItems?.[0]) {
      return summary.actionItems[0];
    }

    if (decisionOutput.decision.advice) {
      return decisionOutput.decision.advice;
    }

    return decisionOutput.decision.recommendation === 'recommend'
      ? cl('action.eatAsIs', locale)
      : cl('action.adjustFirst', locale);
  }

  /**
   * V4.2: 基于结构化数据的替换策略解析（取代关键词匹配）
   */
  private resolveReplacementStrategy(
    alternatives: FoodAlternative[],
  ): 'replace_food' | 'reduce_portion' | 'change_pairing' {
    // 策略1: 如果替代方案有 comparison 且热量差异大 → reduce_portion
    const hasSignificantCalDiff = alternatives.some((alt) => {
      if (!alt.comparison?.caloriesDiff) return false;
      return Math.abs(alt.comparison.caloriesDiff) > 100;
    });
    if (hasSignificantCalDiff && alternatives.length <= 1) {
      return 'reduce_portion';
    }

    // 策略2: 如果有多个不同的替代食物 → replace_food
    if (alternatives.length >= 2) {
      return 'replace_food';
    }

    // 默认
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
    locale?: Locale;
  }): string[] {
    const actions = [...(input.summary?.actionItems || [])];
    if (input.summary?.decisionGuardrails?.length) {
      actions.push(...input.summary.decisionGuardrails);
    }

    if (input.portionAction) {
      actions.push(
        cl('action.portionControl', input.locale)
          .replace('{percent}', String(input.portionAction.suggestedPercent))
          .replace('{cal}', String(input.portionAction.suggestedCalories)),
      );
    }

    if (input.replacementAction?.candidates?.[0]) {
      actions.push(
        cl('action.switchTo', input.locale).replace(
          '{name}',
          input.replacementAction.candidates[0].name,
        ),
      );
    }

    if (input.recoveryAction) {
      actions.push(input.recoveryAction.todayAdjustment);
    }

    return Array.from(new Set(actions.filter(Boolean))).slice(0, 4);
  }
}
