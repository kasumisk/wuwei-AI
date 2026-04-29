import { Injectable } from '@nestjs/common';
import {
  AnalysisState,
  ConfidenceDiagnostics,
  CoachOutputSchema,
  DecisionSummary,
  EvidencePack,
  PromptDepthLevel,
  UnifiedUserContext,
  ContextualAnalysis,
  StructuredDecision,
} from '../types/analysis-result.types';
import { DecisionOutput } from '../decision/food-decision.service';
import { DailyMacroSummaryService } from '../coach/daily-macro-summary.service';
import { cl } from '../i18n/decision-labels';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { translateEnum } from '../../../common/i18n/enum-i18n';

@Injectable()
export class EvidencePackBuilderService {
  constructor(
    private readonly dailyMacroSummaryService: DailyMacroSummaryService,
  ) {}

  build(input: {
    decisionOutput: DecisionOutput;
    analysisState: AnalysisState;
    confidenceDiagnostics: ConfidenceDiagnostics;
    summary?: DecisionSummary;
    userContext?: UnifiedUserContext;
    /** V3.3: 上下文分析 */
    contextualAnalysis?: ContextualAnalysis;
    /** V3.3: 结构化决策 */
    structuredDecision?: StructuredDecision;
    locale?: Locale;
  }): EvidencePack {
    const {
      decisionOutput,
      analysisState,
      confidenceDiagnostics,
      summary,
      userContext,
      contextualAnalysis,
      structuredDecision,
      locale,
    } = input;

    const scoreEvidence = [
      ...(decisionOutput.decisionFactors || [])
        .slice(0, 3)
        .map((factor) => `${factor.dimension}: ${factor.message}`),
      ...(decisionOutput.breakdownExplanations || [])
        .slice(0, 2)
        .map((item) => `${item.label}: ${item.message}`),
    ].slice(0, 4);

    const projected = analysisState.projectedAfterMeal.completionRatio;
    const contextEvidence = [
      cl('evidence.caloriesCompletion', locale, {
        percent: projected.calories,
      }),
      cl('evidence.proteinCompletion', locale, {
        percent: projected.protein,
      }),
      cl('evidence.fatCompletion', locale, { percent: projected.fat }),
      cl('evidence.carbsCompletion', locale, { percent: projected.carbs }),
      // V3.3: 上下文分析问题
      ...(contextualAnalysis?.identifiedIssues || [])
        .slice(0, 3)
        .map((issue) => `[${issue.severity}] ${issue.implication}`),
      // V4.0 P3.3: 连续天数激励
      ...(userContext?.goalProgress?.streakDays != null &&
      userContext.goalProgress.streakDays >= 2
        ? [
            cl('evidence.healthyStreak', locale, {
              days: userContext.goalProgress.streakDays,
            }),
          ]
        : []),
      // V4.0 P3.3: 执行率
      ...(userContext?.goalProgress?.executionRate != null
        ? [
            cl('evidence.executionRate', locale, {
              rate: Math.round(userContext.goalProgress.executionRate * 100),
            }),
          ]
        : []),
    ];

    const issueEvidence = [
      ...(decisionOutput.issues || [])
        .slice(0, 4)
        .map((issue) => issue.message),
    ];

    const decisionEvidence = [
      decisionOutput.decision.reason,
      ...(summary ? [summary.quantitativeHighlight] : []),
      // V3.3: 结构化决策多维原因
      ...(structuredDecision?.rationale
        ? [
            structuredDecision.rationale.contextual,
            structuredDecision.rationale.goalAlignment,
            ...(structuredDecision.rationale.healthRisk
              ? [structuredDecision.rationale.healthRisk]
              : []),
            ...(structuredDecision.rationale.timelinessNote
              ? [structuredDecision.rationale.timelinessNote]
              : []),
          ]
        : []),
      ...(confidenceDiagnostics.analysisQualityBand
        ? [
            cl('evidence.analysisQuality', locale, {
              band: translateEnum(
                'analysisQuality',
                confidenceDiagnostics.analysisQualityBand,
                locale,
              ),
            }),
          ]
        : []),
      ...(confidenceDiagnostics.analysisCompletenessScore != null
        ? [
            cl('evidence.analysisCompleteness', locale, {
              percent: Math.round(
                confidenceDiagnostics.analysisCompletenessScore * 100,
              ),
            }),
          ]
        : []),
      ...(confidenceDiagnostics.reviewLevel
        ? [
            cl('evidence.reviewLevel', locale, {
              level: translateEnum(
                'reviewLevel',
                confidenceDiagnostics.reviewLevel,
                locale,
              ),
            }),
          ]
        : []),
      ...(confidenceDiagnostics.qualitySignals?.length
        ? [
            cl('evidence.qualitySignals', locale, {
              signals: confidenceDiagnostics.qualitySignals.join(', '),
            }),
          ]
        : []),
      ...confidenceDiagnostics.uncertaintyReasons,
    ].filter(Boolean);

    const promptDepth = this.resolvePromptDepth(confidenceDiagnostics);
    const structuredOutput = this.buildStructuredOutput(
      decisionOutput,
      summary,
      confidenceDiagnostics,
      promptDepth,
      locale,
    );
    const dailyMacroSummary = userContext
      ? this.dailyMacroSummaryService.buildSummaryText(
          userContext,
          locale,
        )
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
    locale?: Locale,
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
      actionSteps.push(cl('evidence.defaultAction', locale));
    }

    const cautionNote =
      verdict !== 'recommend'
        ? (summary?.decisionGuardrails?.[0] ?? undefined)
        : undefined;

    const confidenceNote =
      promptDepth === 'detailed'
        ? cl('evidence.confidenceNote', locale, {
            percent: Math.round((diag.overallConfidence ?? 0.7) * 100),
          })
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
  private resolvePromptDepth(diag: ConfidenceDiagnostics): PromptDepthLevel {
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
