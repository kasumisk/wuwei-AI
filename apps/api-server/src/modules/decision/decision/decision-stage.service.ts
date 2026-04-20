/**
 * V5.0 P2.3 — Decision Stage Service
 *
 * Extracted from AnalysisPipelineService.runDecide() to decouple the decision stage.
 * Encapsulates: full decision (FoodDecisionService), structured decision (DecisionEngineService),
 * summary (DecisionSummaryService), food item conversion, and fallback logic.
 *
 * Consumed by AnalysisPipelineService in Stage 2 (Decide).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzedFoodItem,
  AnalyzeStageResult,
  DecideStageResult,
  StructuredDecision,
} from '../types/analysis-result.types';
import {
  FoodDecisionService,
  DecisionOutput,
} from './food-decision.service';
import { DecisionEngineService } from './decision-engine.service';
import { DecisionSummaryService } from './decision-summary.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';
import { toPerServing, getWeightFactor } from '../analyze/nutrition-aggregator';

/** Input for the decision stage */
export interface DecisionStageInput {
  foods: AnalyzedFoodItem[];
  analyze: AnalyzeStageResult;
  userId?: string;
  locale?: Locale;
  decisionMode?: 'pre_eat' | 'post_eat';
}

@Injectable()
export class DecisionStageService {
  private readonly logger = new Logger(DecisionStageService.name);

  constructor(
    private readonly foodDecisionService: FoodDecisionService,
    private readonly decisionEngineService: DecisionEngineService,
    private readonly decisionSummaryService: DecisionSummaryService,
  ) {}

  /**
   * V5.0: Run the decision stage — full decision + structured decision + summary
   */
  async run(input: DecisionStageInput): Promise<DecideStageResult> {
    const mode = input.decisionMode || 'pre_eat';
    const { totals, userContext, score, contextualAnalysis, nutritionIssues } =
      input.analyze;

    // Full decision
    let decisionOutput: DecisionOutput;
    try {
      decisionOutput = await this.foodDecisionService.computeFullDecision(
        this.toDecisionFoodItems(input.foods),
        totals,
        userContext,
        score.nutritionScore,
        score.breakdown,
        input.userId,
        input.locale,
        mode,
        nutritionIssues,
        contextualAnalysis ?? undefined,
      );
    } catch (err) {
      this.logger.warn(`Decision computation failed, using fallback: ${(err as Error).message}`);
      decisionOutput = this.buildFallbackDecision(input.locale);
    }

    // Structured decision
    let structuredDecision: StructuredDecision | undefined;
    try {
      structuredDecision = this.decisionEngineService.computeStructuredDecision(
        this.toDecisionFoodItems(input.foods),
        userContext,
        score.nutritionScore,
        score.breakdown,
        input.locale,
      );
    } catch (err) {
      this.logger.warn(
        `StructuredDecision computation failed: ${(err as Error).message}`,
      );
    }

    // Summary
    let summary;
    try {
      summary = this.decisionSummaryService.summarize({
        decisionOutput,
        totals,
        userContext,
        foodNames: input.foods.map((f) => f.name),
        structuredDecision,
        nutritionIssues,
        decisionMode: mode,
        locale: input.locale,
      });
    } catch (err) {
      this.logger.warn(`Summary generation failed: ${(err as Error).message}`);
    }

    return {
      decision: decisionOutput,
      structuredDecision: structuredDecision || null,
      summary: summary!,
    };
  }

  /**
   * V5.1: Convert AnalyzedFoodItem[] to DecisionFoodItem[] using centralized per-serving conversion
   */
  toDecisionFoodItems(foods: AnalyzedFoodItem[]) {
    return foods.map((f) => {
      const {
        libraryMatch: _lib,
        normalizedName: _norm,
        ...rest
      } = f as any;

      const grams = f.estimatedWeightGrams || f.standardServingG || 100;
      const perServing = toPerServing(f);

      return {
        ...rest,
        estimatedWeightGrams: grams,
        calories: perServing.calories,
        protein: perServing.protein,
        fat: perServing.fat,
        carbs: perServing.carbs,
        fiber: perServing.fiber || undefined,
        sodium: perServing.sodium || undefined,
        saturatedFat: perServing.saturatedFat,
        addedSugar: perServing.addedSugar,
        purineLevel: typeof f.purine === 'string' ? f.purine : undefined,
        purine: typeof f.purine === 'number' ? f.purine : undefined,
      };
    });
  }

  /**
   * Fallback decision output when decision service fails
   */
  private buildFallbackDecision(locale?: Locale): DecisionOutput {
    return {
      decision: {
        recommendation: 'caution',
        shouldEat: true,
        reason: cl('pipeline.fallback.reason', locale),
        riskLevel: 'medium',
      },
      alternatives: [],
      explanation: {
        summary: cl('pipeline.fallback.summary', locale),
      },
      decisionFactors: [],
    };
  }
}
