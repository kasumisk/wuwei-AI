import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ConfidenceDiagnostics,
  DecisionSummary,
  FoodAnalysisResultV61,
} from '../types/analysis-result.types';
import { AnalyzedFoodItem } from '../types/analysis-result.types';

@Injectable()
export class ConfidenceDiagnosticsService {
  constructor(private readonly prisma: PrismaService) {}

  async diagnose(input: {
    foods: AnalyzedFoodItem[];
    userId?: string;
    summary?: DecisionSummary;
  }): Promise<ConfidenceDiagnostics> {
    const { foods, userId, summary } = input;

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
    const estimationBase = foods.length > 0 ? macroCompleteFoods / foods.length : 1;
    const nutritionEstimationConfidence = this.clamp(
      estimationBase - (foods.length > 0 ? estimatedFoods / foods.length : 0) * 0.25,
    );

    const auditConfidence = await this.getAuditFeedbackConfidence(userId);
    const overallConfidence = this.avg([
      recognitionConfidence,
      normalizationConfidence,
      nutritionEstimationConfidence,
      auditConfidence,
    ]);

    const decisionConfidence = this.clamp(overallConfidence * 0.8 + auditConfidence * 0.2);

    const uncertaintyReasons: string[] = [];
    if (recognitionConfidence < 0.7) {
      uncertaintyReasons.push('识别置信度偏低，原始输入可能存在歧义');
    }
    if (normalizationConfidence < 0.7) {
      uncertaintyReasons.push('标准化命中率偏低，部分食物未稳定映射到食物库');
    }
    if (nutritionEstimationConfidence < 0.7) {
      uncertaintyReasons.push('营养估算包含较多推断值，建议将结论视为保守估算');
    }
    if (auditConfidence < 0.7) {
      uncertaintyReasons.push('近期人工审核准确率偏低，建议教练输出更保守');
    }
    if (summary?.verdict === 'avoid' && decisionConfidence < 0.6) {
      uncertaintyReasons.push('当前建议偏严格，适合配合人工复核或更清晰输入');
    }

    return {
      recognitionConfidence: this.round(recognitionConfidence),
      normalizationConfidence: this.round(normalizationConfidence),
      nutritionEstimationConfidence: this.round(nutritionEstimationConfidence),
      decisionConfidence: this.round(decisionConfidence),
      overallConfidence: this.round(overallConfidence),
      uncertaintyReasons,
    };
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

    const accurate = rows.filter((row) => row.reviewStatus === 'accurate').length;
    const ratio = accurate / rows.length;
    return this.clamp(0.55 + ratio * 0.45);
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