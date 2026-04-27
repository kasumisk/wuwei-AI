/**
 * V5.0 P1.5 — Scoring Stage Service
 *
 * Extracted from AnalysisPipelineService to decouple scoring logic.
 * Encapsulates: AnalyzedFoodItem → ScoringFoodItem conversion, score computation, fallback.
 *
 * Consumed by AnalysisPipelineService in Stage 1 (Analyze).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzedFoodItem,
  AnalysisScore,
  NutritionTotals,
} from '../types/analysis-result.types';
import { FoodScoringService, ScoringFoodItem } from './food-scoring.service';
import { computeAvgConfidence } from '../analyze/nutrition-aggregator';
import { UserContextBuilderService } from '../analyze/user-context-builder.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

/** Input for the scoring stage */
export interface ScoringStageInput {
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  userContext: Awaited<ReturnType<UserContextBuilderService['build']>>;
  /** Pre-built scoring food items (text path provides these with libraryMatch) */
  scoringFoods?: ScoringFoodItem[];
  /** Pre-computed score (backward compat for image path) */
  precomputedScore?: AnalysisScore;
  userId?: string;
  locale?: Locale;
}

@Injectable()
export class ScoringStageService {
  private readonly logger = new Logger(ScoringStageService.name);

  constructor(private readonly foodScoringService: FoodScoringService) {}

  /**
   * V5.0: Run unified scoring stage
   *
   * Handles both text and image paths through a single calculateScore() call.
   */
  async run(input: ScoringStageInput): Promise<AnalysisScore> {
    // Pre-computed score takes priority (backward compat)
    if (input.precomputedScore) {
      return input.precomputedScore;
    }

    try {
      // Use pre-built scoringFoods (text path with libraryMatch) or convert from foods
      const scoringFoods =
        input.scoringFoods || this.toScoringFoodItems(input.foods);

      const result = await this.foodScoringService.calculateScore(
        scoringFoods,
        input.totals,
        {
          profile: input.userContext.profile,
          todayCalories: input.userContext.todayCalories,
          todayProtein: input.userContext.todayProtein,
          todayFat: input.userContext.todayFat,
          todayCarbs: input.userContext.todayCarbs,
          goalType: input.userContext.goalType,
          healthConditions: input.userContext.healthConditions,
          phaseWeightAdjustment: input.userContext.phaseWeightAdjustment,
        },
        input.userId,
        input.locale,
      );
      return result.analysisScore;
    } catch (err) {
      this.logger.warn(`Score computation failed: ${(err as Error).message}`);
    }

    // Fallback score
    return {
      healthScore: 50,
      nutritionScore: 50,
      confidenceScore: Math.round(computeAvgConfidence(input.foods) * 100),
    };
  }

  /**
   * V5.0: Convert AnalyzedFoodItem[] to ScoringFoodItem[] (text/image universal)
   */
  toScoringFoodItems(foods: AnalyzedFoodItem[]): ScoringFoodItem[] {
    return foods.map((f) => ({
      name: f.name,
      confidence: f.confidence,
      calories: f.calories,
      estimatedWeightGrams: f.estimatedWeightGrams,
      protein: f.protein || 0,
      fat: f.fat || 0,
      carbs: f.carbs || 0,
      fiber: f.fiber,
      sodium: f.sodium,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
      transFat: f.transFat,
      cholesterol: f.cholesterol,
      glycemicLoad: f.glycemicLoad,
      nutrientDensity: f.nutrientDensity,
      fodmapLevel: f.fodmapLevel,
      purine: f.purine,
      oxalateLevel: f.oxalateLevel,
    }));
  }
}
