import { Injectable } from '@nestjs/common';
import {
  AnalysisState,
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
} from '../types/analysis-result.types';
import { DecisionOutput } from '../decision/food-decision.service';

@Injectable()
export class EvidencePackBuilderService {
  build(input: {
    decisionOutput: DecisionOutput;
    analysisState: AnalysisState;
    confidenceDiagnostics: ConfidenceDiagnostics;
    summary?: DecisionSummary;
  }): EvidencePack {
    const { decisionOutput, analysisState, confidenceDiagnostics, summary } = input;

    const scoreEvidence = [
      ...(decisionOutput.decisionFactors || []).slice(0, 3).map(
        (factor) => `${factor.dimension}: ${factor.message}`,
      ),
      ...(decisionOutput.breakdownExplanations || []).slice(0, 2).map(
        (item) => `${item.label}: ${item.message}`,
      ),
    ].slice(0, 4);

    const projected = analysisState.projectedAfterMeal.completionRatio;
    const contextEvidence = [
      `餐后热量完成度 ${projected.calories}%`,
      `餐后蛋白完成度 ${projected.protein}%`,
      `餐后脂肪完成度 ${projected.fat}%`,
      `餐后碳水完成度 ${projected.carbs}%`,
    ];

    const issueEvidence = [
      ...(decisionOutput.issues || []).slice(0, 4).map((issue) => issue.message),
    ];

    const decisionEvidence = [
      decisionOutput.decision.reason,
      ...(summary ? [summary.quantitativeHighlight] : []),
      ...confidenceDiagnostics.uncertaintyReasons,
    ].filter(Boolean);

    return {
      scoreEvidence,
      contextEvidence,
      issueEvidence,
      decisionEvidence,
    };
  }
}