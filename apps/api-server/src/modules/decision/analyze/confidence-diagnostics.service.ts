import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ConfidenceDiagnostics,
  DecisionSummary,
  FoodAnalysisResultV61,
} from '../types/analysis-result.types';
import { AnalyzedFoodItem } from '../types/analysis-result.types';
import { cl } from '../i18n/decision-labels';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

@Injectable()
export class ConfidenceDiagnosticsService {
  constructor(private readonly prisma: PrismaService) {}

  async diagnose(input: {
    foods: AnalyzedFoodItem[];
    userId?: string;
    summary?: DecisionSummary;
    locale?: Locale;
  }): Promise<ConfidenceDiagnostics> {
    const { foods, userId, summary, locale } = input;

    const recognitionConfidence = this.avg(
      foods.map((food) => this.clamp(food.confidence ?? 0.7)),
    );

    const normalizedFoods = foods.filter(
      (food) => food.foodLibraryId || food.normalizedName,
    ).length;
    const normalizationConfidence =
      foods.length > 0 ? normalizedFoods / foods.length : recognitionConfidence;

    const estimatedFoods = foods.filter(
      (food) => food.estimated || food.foodLibraryId == null,
    ).length;
    const macroCompleteFoods = foods.filter(
      (food) =>
        food.calories != null &&
        food.protein != null &&
        food.fat != null &&
        food.carbs != null,
    ).length;
    const estimationBase =
      foods.length > 0 ? macroCompleteFoods / foods.length : 1;
    const nutritionEstimationConfidence = this.clamp(
      estimationBase -
        (foods.length > 0 ? estimatedFoods / foods.length : 0) * 0.25,
    );

    const auditConfidence = await this.getAuditFeedbackConfidence(userId);
    const overallConfidence = this.avg([
      recognitionConfidence,
      normalizationConfidence,
      nutritionEstimationConfidence,
      auditConfidence,
    ]);

    const decisionConfidence = this.clamp(
      overallConfidence * 0.8 + auditConfidence * 0.2,
    );
    const analysisQualityBand =
      this.resolveAnalysisQualityBand(decisionConfidence);
    const analysisCompletenessScore = this.clamp(
      normalizationConfidence * 0.5 + nutritionEstimationConfidence * 0.5,
    );
    const qualitySignals = this.collectQualitySignals({
      recognitionConfidence,
      normalizationConfidence,
      nutritionEstimationConfidence,
      auditConfidence,
    });

    const uncertaintyReasons: string[] = [];
    if (recognitionConfidence < 0.7) {
      uncertaintyReasons.push(cl('diag.recognitionLow', locale));
    }
    if (normalizationConfidence < 0.7) {
      uncertaintyReasons.push(cl('diag.normalizationLow', locale));
    }
    if (nutritionEstimationConfidence < 0.7) {
      uncertaintyReasons.push(cl('diag.nutritionEstimationLow', locale));
    }
    if (auditConfidence < 0.7) {
      uncertaintyReasons.push(cl('diag.auditLow', locale));
    }
    if (summary?.verdict === 'avoid' && decisionConfidence < 0.6) {
      uncertaintyReasons.push(cl('diag.avoidLowConfidence', locale));
    }

    // V4.9 P3.4: Category mismatch detection (LLM category vs library category)
    const categoryMismatches = await this.detectCategoryMismatches(foods);
    if (categoryMismatches.length > 0) {
      qualitySignals.push('category_mismatch');
      for (const mm of categoryMismatches) {
        uncertaintyReasons.push(
          `Category mismatch: "${mm.name}" LLM=${mm.llmCategory} vs DB=${mm.dbCategory}`,
        );
      }
    }

    const reviewLevel = this.resolveReviewLevel(
      analysisQualityBand,
      qualitySignals,
      uncertaintyReasons,
    );

    return {
      recognitionConfidence: this.round(recognitionConfidence),
      normalizationConfidence: this.round(normalizationConfidence),
      nutritionEstimationConfidence: this.round(nutritionEstimationConfidence),
      decisionConfidence: this.round(decisionConfidence),
      overallConfidence: this.round(overallConfidence),
      analysisQualityBand,
      qualitySignals,
      analysisCompletenessScore: this.round(analysisCompletenessScore),
      reviewLevel,
      uncertaintyReasons,
    };
  }

  private resolveReviewLevel(
    band: 'high' | 'medium' | 'low',
    qualitySignals: string[],
    uncertaintyReasons: string[],
  ): 'auto_review' | 'manual_review' {
    if (band === 'low') return 'manual_review';
    if (qualitySignals.length >= 2) return 'manual_review';
    if (uncertaintyReasons.length >= 2) return 'manual_review';
    return 'auto_review';
  }

  private resolveAnalysisQualityBand(
    decisionConfidence: number,
  ): 'high' | 'medium' | 'low' {
    if (decisionConfidence >= 0.8) return 'high';
    if (decisionConfidence >= 0.6) return 'medium';
    return 'low';
  }

  private collectQualitySignals(input: {
    recognitionConfidence: number;
    normalizationConfidence: number;
    nutritionEstimationConfidence: number;
    auditConfidence: number;
  }): string[] {
    const signals: string[] = [];
    if (input.recognitionConfidence < 0.7) signals.push('recognition_low');
    if (input.normalizationConfidence < 0.7) signals.push('normalization_low');
    if (input.nutritionEstimationConfidence < 0.7) {
      signals.push('nutrition_estimation_low');
    }
    if (input.auditConfidence < 0.7) signals.push('audit_feedback_low');
    return signals;
  }

  private async getAuditFeedbackConfidence(userId?: string): Promise<number> {
    const rows = await this.prisma.foodAnalysisRecords.findMany({
      where: {
        ...(userId ? { userId } : {}),
        reviewStatus: { in: ['accurate', 'inaccurate'] },
      },
      select: { reviewStatus: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (rows.length === 0) {
      return 0.75;
    }

    const accurate = rows.filter(
      (row) => row.reviewStatus === 'accurate',
    ).length;
    const ratio = accurate / rows.length;
    return this.clamp(0.55 + ratio * 0.45);
  }

  /**
   * V4.9 P3.4: Detect category mismatches between LLM-assigned and DB categories
   */
  private async detectCategoryMismatches(
    foods: AnalyzedFoodItem[],
  ): Promise<Array<{ name: string; llmCategory: string; dbCategory: string }>> {
    const mismatches: Array<{
      name: string;
      llmCategory: string;
      dbCategory: string;
    }> = [];

    const foodsWithLibId = foods.filter(
      (f) => f.foodLibraryId && f.category,
    );
    if (foodsWithLibId.length === 0) return mismatches;

    const libraryIds = foodsWithLibId.map((f) => f.foodLibraryId!);
    const dbFoods = await this.prisma.foods.findMany({
      where: { id: { in: libraryIds } },
      select: { id: true, category: true },
    });
    const dbCategoryMap = new Map(dbFoods.map((f) => [f.id, f.category]));

    for (const food of foodsWithLibId) {
      const dbCategory = dbCategoryMap.get(food.foodLibraryId!);
      if (dbCategory && food.category && dbCategory !== food.category) {
        mismatches.push({
          name: food.name,
          llmCategory: food.category,
          dbCategory,
        });
      }
    }

    return mismatches;
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
