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
import { I18nService, I18nLocale } from '../../../core/i18n';
import {
  AnalyzedFoodItem,
  AnalyzeStageResult,
  DecideStageResult,
  StructuredDecision,
} from '../types/analysis-result.types';
import { FoodDecisionService, DecisionOutput } from './food-decision.service';
import { DecisionEngineService } from './decision-engine.service';
import { DecisionSummaryService } from './decision-summary.service';
// nutrition-aggregator 不再导出按重量缩放的工具；AnalyzedFoodItem 已是 per-serving。

/** Input for the decision stage */
export interface DecisionStageInput {
  foods: AnalyzedFoodItem[];
  analyze: AnalyzeStageResult;
  userId?: string;
  locale?: I18nLocale;
  decisionMode?: 'pre_eat' | 'post_eat';
}

@Injectable()
export class DecisionStageService {
  private readonly logger = new Logger(DecisionStageService.name);

  constructor(private readonly foodDecisionService: FoodDecisionService,
    private readonly decisionEngineService: DecisionEngineService,
    private readonly decisionSummaryService: DecisionSummaryService,
    private readonly i18n: I18nService,
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
      this.logger.warn(
        `Decision computation failed, using fallback: ${(err as Error).message}`,
      );
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
   * 将 AnalyzedFoodItem[] 转换为决策层使用的 DecisionFoodItem[]。
   *
   * AnalyzedFoodItem 上的营养字段已是 per-serving（实际摄入），
   * 此处仅剥离内部字段（libraryMatch 等）并归一化 purine 字段类型。
   */
  toDecisionFoodItems(foods: AnalyzedFoodItem[]) {
    return foods.map((f) => {
      const { libraryMatch: _lib, normalizedName: _norm, ...rest } = f as any;

      return {
        ...rest,
        estimatedWeightGrams:
          f.estimatedWeightGrams || f.standardServingG || 100,
        purineLevel: typeof f.purine === 'string' ? f.purine : undefined,
        purine: typeof f.purine === 'number' ? f.purine : undefined,
      };
    });
  }

  /**
   * Fallback decision output when decision service fails
   */
  private buildFallbackDecision(locale?: I18nLocale): DecisionOutput {
    return {
      decision: {
        recommendation: 'caution',
        shouldEat: true,
        reason: this.i18n.t('decision.pipeline.fallback.reason', locale),
        riskLevel: 'medium',
      },
      alternatives: [],
      explanation: {
        summary: this.i18n.t('decision.pipeline.fallback.summary', locale),
      },
      decisionFactors: [],
    };
  }
}
