/**
 * V5.0 P2.4 — Coaching Stage Service
 *
 * Extracted from AnalysisPipelineService.runCoaching() to decouple the coaching stage.
 * Encapsulates: confidence diagnostics, post-meal recovery, evidence pack, shouldEat action,
 * analysis accuracy, and summary enrichment.
 *
 * Consumed by AnalysisPipelineService in Stage 3 (Coaching).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzedFoodItem,
  AnalyzeStageResult,
  DecideStageResult,
  PostProcessStageResult,
  ConfidenceDiagnostics,
  EvidencePack,
  FoodAnalysisPackage,
  FoodAnalysisResultV61,
} from '../types/analysis-result.types';
import { ConfidenceDiagnosticsService } from '../analyze/confidence-diagnostics.service';
import { PostMealRecoveryService } from '../decision/post-meal-recovery.service';
import { EvidencePackBuilderService } from '../analyze/evidence-pack-builder.service';
import { DecisionToneResolverService } from '../decision/decision-tone-resolver.service';
import { ShouldEatActionService } from '../decision/should-eat-action.service';
import { AnalysisAccuracyService } from '../analyze/analysis-accuracy.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { I18nService, I18nLocale } from '../../../core/i18n';

/** Input for the coaching stage */
export interface CoachingStageInput {
  foods: AnalyzedFoodItem[];
  analyze: AnalyzeStageResult;
  decide: DecideStageResult;
  userId?: string;
  locale?: Locale;
  decisionMode?: 'pre_eat' | 'post_eat';
}

@Injectable()
export class CoachingStageService {
  private readonly logger = new Logger(CoachingStageService.name);

  constructor(
    private readonly confidenceDiagnosticsService: ConfidenceDiagnosticsService,
    private readonly postMealRecoveryService: PostMealRecoveryService,
    private readonly evidencePackBuilder: EvidencePackBuilderService,
    private readonly decisionToneResolverService: DecisionToneResolverService,
    private readonly shouldEatActionService: ShouldEatActionService,
    private readonly analysisAccuracyService: AnalysisAccuracyService,
    private readonly i18n: I18nService,
  ) {}

  private static readonly DEFAULT_DIAGNOSTICS: ConfidenceDiagnostics = {
    recognitionConfidence: 0.7,
    normalizationConfidence: 0.7,
    nutritionEstimationConfidence: 0.7,
    decisionConfidence: 0.7,
    overallConfidence: 0.7,
    analysisQualityBand: 'medium',
    qualitySignals: [],
    analysisCompletenessScore: 0.7,
    reviewLevel: 'auto_review',
    uncertaintyReasons: [],
  };

  /**
   * V5.0: Run the coaching stage — diagnostics + recovery + evidence + shouldEat + accuracy
   */
  async run(input: CoachingStageInput): Promise<PostProcessStageResult> {
    const mode = input.decisionMode || 'pre_eat';
    const { userContext, analysisState, contextualAnalysis } = input.analyze;
    const {
      decision: decisionOutput,
      structuredDecision,
      summary,
    } = input.decide;

    // Confidence diagnostics
    let confidenceDiagnostics: ConfidenceDiagnostics | undefined;
    try {
      confidenceDiagnostics = await this.confidenceDiagnosticsService.diagnose({
        foods: input.foods,
        userId: input.userId,
        summary,
        locale: input.locale,
      });
      if (summary && confidenceDiagnostics) {
        this.enrichSummaryWithConfidence(
          summary,
          confidenceDiagnostics,
          mode,
          input.locale,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Confidence diagnostics failed: ${(err as Error).message}`,
      );
    }

    const diagnostics =
      confidenceDiagnostics || CoachingStageService.DEFAULT_DIAGNOSTICS;

    // Recovery action
    const recoveryAction = this.postMealRecoveryService.build({
      mode,
      macroProgress: decisionOutput.macroProgress,
      userContext,
    });

    // Evidence pack
    const evidencePack: EvidencePack = this.evidencePackBuilder.build({
      decisionOutput,
      analysisState,
      confidenceDiagnostics: diagnostics,
      summary,
      userContext,
      contextualAnalysis: contextualAnalysis ?? undefined,
      structuredDecision: structuredDecision ?? undefined,
      locale: input.locale,
    });
    evidencePack.toneModifier =
      this.decisionToneResolverService.resolveModifier({
        goalType: userContext.goalType,
        verdict: decisionOutput.decision.recommendation,
        coachFocus: summary?.coachFocus,
        executionRate: userContext.goalProgress?.executionRate,
        streakDays: userContext.goalProgress?.streakDays,
      });

    // ShouldEat action
    const shouldEatAction = this.shouldEatActionService.build({
      mode,
      decisionOutput,
      summary,
      evidencePack,
      userContext,
      confidenceDiagnostics: diagnostics,
      recoveryAction,
    });

    // Analysis accuracy
    let analysisAccuracy: FoodAnalysisPackage | undefined;
    try {
      const reviewLevel = diagnostics.reviewLevel || 'auto_review';
      const accuracyMetrics = this.analysisAccuracyService.assessFromFoods(
        input.foods,
        reviewLevel,
      );
      analysisAccuracy = {
        totalCalories: input.analyze.totals.calories,
        macros: {
          protein: input.analyze.totals.protein,
          fat: input.analyze.totals.fat,
          carbs: input.analyze.totals.carbs,
        },
        accuracyLevel: accuracyMetrics.level,
        accuracyScore: accuracyMetrics.score,
        accuracyFactors: accuracyMetrics.factors,
        nutritionBreakdown: input.analyze.score.breakdown || {
          energy: 50,
          proteinRatio: 50,
          macroBalance: 50,
          foodQuality: 50,
          satiety: 50,
          stability: 50,
          glycemicImpact: 50,
          mealQuality: 50,
        },
        decisionImpact: accuracyMetrics.decisionImpact,
      };
    } catch (err) {
      this.logger.warn(
        `FoodAnalysisPackage assembly failed: ${(err as Error).message}`,
      );
    }

    return {
      shouldEatAction: shouldEatAction || null,
      recoveryAction,
      evidencePack,
      confidenceDiagnostics: diagnostics,
      analysisAccuracy: analysisAccuracy!,
    };
  }

  /**
   * Enrich summary with confidence diagnostics quality band and guardrails
   */
  private enrichSummaryWithConfidence(
    summary: NonNullable<FoodAnalysisResultV61['summary']>,
    diagnostics: ConfidenceDiagnostics,
    mode?: 'pre_eat' | 'post_eat',
    locale?: Locale,
  ): void {
    summary.analysisQualityBand = diagnostics.analysisQualityBand;
    summary.reviewLevel = diagnostics.reviewLevel;
    const loc = (locale ?? this.i18n.currentLocale()) as I18nLocale;
    if (diagnostics.analysisQualityBand === 'high') {
      summary.analysisQualityNote = this.i18n.t(
        'decision.pipeline.quality.high',
        loc,
      );
    } else if (diagnostics.analysisQualityBand === 'medium') {
      summary.analysisQualityNote = this.i18n.t(
        'decision.pipeline.quality.medium',
        loc,
      );
    } else {
      summary.analysisQualityNote = this.i18n.t(
        'decision.pipeline.quality.low',
        loc,
      );
    }

    const guardrails: string[] = [];
    if (summary.analysisQualityBand === 'low') {
      guardrails.push(
        this.i18n.t('decision.pipeline.guardrail.lowQuality', loc),
      );
    }
    if (summary.healthConstraintNote) {
      guardrails.push(summary.healthConstraintNote);
    }
    if (summary.dynamicDecisionHint) {
      guardrails.push(summary.dynamicDecisionHint);
    }
    if (summary.verdict === 'avoid') {
      guardrails.push(this.i18n.t('decision.pipeline.guardrail.avoid', loc));
    }
    if (mode === 'post_eat') {
      guardrails.push(this.i18n.t('decision.pipeline.guardrail.postEat', loc));
    }

    summary.decisionGuardrails = Array.from(new Set(guardrails)).slice(0, 3);
  }
}
