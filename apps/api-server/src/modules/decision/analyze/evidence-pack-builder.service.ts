import { Injectable } from '@nestjs/common';
import {
  AnalysisState,
  ConfidenceDiagnostics,
  CoachOutputSchema,
  DecisionSummary,
  EvidencePack,
  PromptDepthLevel,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { DecisionOutput } from '../decision/food-decision.service';
import { DailyMacroSummaryService } from '../decision/daily-macro-summary.service';

@Injectable()
export class EvidencePackBuilderService {
  constructor(private readonly dailyMacroSummaryService: DailyMacroSummaryService) {}

  build(input: {
    decisionOutput: DecisionOutput;
    analysisState: AnalysisState;
    confidenceDiagnostics: ConfidenceDiagnostics;
    summary?: DecisionSummary;
    userContext?: UnifiedUserContext;
  }): EvidencePack {
    const { decisionOutput, analysisState, confidenceDiagnostics, summary, userContext } = input;

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
      ...(confidenceDiagnostics.analysisQualityBand
        ? [`分析质量: ${confidenceDiagnostics.analysisQualityBand}`]
        : []),
      ...(confidenceDiagnostics.analysisCompletenessScore != null
        ? [`分析完整度: ${Math.round(confidenceDiagnostics.analysisCompletenessScore * 100)}%`]
        : []),
      ...(confidenceDiagnostics.reviewLevel
        ? [`复核级别: ${confidenceDiagnostics.reviewLevel}`]
        : []),
      ...(confidenceDiagnostics.qualitySignals?.length
        ? [`质量信号: ${confidenceDiagnostics.qualitySignals.join(', ')}`]
        : []),
      ...confidenceDiagnostics.uncertaintyReasons,
    ].filter(Boolean);

    const promptDepth = this.resolvePromptDepth(confidenceDiagnostics);
    const structuredOutput = this.buildStructuredOutput(decisionOutput, summary, confidenceDiagnostics, promptDepth);
    const dailyMacroSummary = userContext
      ? this.dailyMacroSummaryService.buildSummaryText(userContext, 'zh-CN')
      : undefined;

    return {
      scoreEvidence,
      contextEvidence,
      issueEvidence,
      decisionEvidence,
      promptDepth,
      structuredOutput,
      dailyMacroSummary,
    };
  }

  /** V3.1: 组装结构化教练输出模板 */
  private buildStructuredOutput(
    decisionOutput: DecisionOutput,
    summary: DecisionSummary | undefined,
    diag: ConfidenceDiagnostics,
    promptDepth: PromptDepthLevel,
  ): CoachOutputSchema {
    const verdict = decisionOutput.decision.recommendation ?? 'caution';
    const mainReason = decisionOutput.decision.reason ?? '';

    const actionSteps: string[] = [];
    if (decisionOutput.decision.advice) {
      actionSteps.push(decisionOutput.decision.advice);
    }
    if (summary?.actionItems?.length) {
      actionSteps.push(...summary.actionItems.slice(0, 2));
    }
    if (actionSteps.length === 0) {
      actionSteps.push('保持均衡饮食，注意控制摄入量');
    }

    const cautionNote =
      verdict !== 'recommend'
        ? (summary?.decisionGuardrails?.[0] ?? undefined)
        : undefined;

    const confidenceNote =
      promptDepth === 'detailed'
        ? `数据置信度 ${Math.round((diag.overallConfidence ?? 0.7) * 100)}%，建议结合实际情况判断`
        : undefined;

    return {
      verdict: verdict as CoachOutputSchema['verdict'],
      mainReason,
      actionSteps: actionSteps.slice(0, 3),
      cautionNote,
      confidenceNote,
    };
  }

  /** V3.1: 根据置信度诊断推导 prompt 输出深度 */
  private resolvePromptDepth(
    diag: ConfidenceDiagnostics,
  ): PromptDepthLevel {
    const score = diag.analysisCompletenessScore ?? 1;
    const reviewLevel = diag.reviewLevel ?? 'auto_review';

    if (reviewLevel === 'manual_review' || score < 0.5) {
      return 'detailed';
    }
    if (score >= 0.8 && reviewLevel === 'auto_review') {
      return 'brief';
    }
    return 'standard';
  }
}