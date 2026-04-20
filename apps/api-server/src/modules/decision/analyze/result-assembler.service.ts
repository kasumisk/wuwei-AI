/**
 * V2.1 Phase 2.2 — 结果组装服务
 *
 * 从 TextFoodAnalysisService 和 ImageFoodAnalysisService 提取 V61 结果组装逻辑。
 * 统一文本/图片两条链路的结果结构构建。
 *
 * 设计原则:
 * - 无状态服务
 * - 只负责数据组装，不包含业务逻辑
 */
import { Injectable } from '@nestjs/common';
import {
  AnalysisState,
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
  NutritionTotals,
  AnalysisScore,
  FoodDecision,
  FoodAlternative,
  AnalysisExplanation,
  IngestionDecision,
  AnalysisInputSnapshot,
  ConfidenceDiagnostics,
  DecisionSummary,
  EvidencePack,
  ShouldEatAction,
  FoodAnalysisPackage,
  StructuredDecision,
} from '../types/analysis-result.types';
import { DecisionOutput } from '../decision/food-decision.service';

// ==================== 输入类型 ====================

export interface AssembleInput {
  analysisId: string;
  inputType: 'text' | 'image';
  inputSnapshot: AnalysisInputSnapshot;
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  score: AnalysisScore;
  decisionOutput: DecisionOutput;
  ingestion: IngestionDecision;
  /** V2.2: 决策结构化摘要 */
  summary?: DecisionSummary;
  analysisState?: AnalysisState;
  confidenceDiagnostics?: ConfidenceDiagnostics;
  evidencePack?: EvidencePack;
  shouldEatAction?: ShouldEatAction;
  /** V3.3: 结构化分析包 */
  foodAnalysisPackage?: FoodAnalysisPackage;
  /** V3.3: 结构化决策 */
  structuredDecision?: StructuredDecision;
  /** V3.9 P1.4: 决策模式，用于裁剪返回字段 */
  decisionMode?: 'pre_eat' | 'post_eat' | 'default';
}

@Injectable()
export class ResultAssemblerService {
  /**
   * 组装 V61 统一结果
   */
  assemble(input: AssembleInput): FoodAnalysisResultV61 {
    const result: FoodAnalysisResultV61 = {
      analysisId: input.analysisId,
      inputType: input.inputType,
      inputSnapshot: input.inputSnapshot,
      foods: input.foods,
      totals: input.totals,
      score: input.score,
      decision: input.decisionOutput.decision,
      alternatives: input.decisionOutput.alternatives,
      explanation: input.decisionOutput.explanation,
      ingestion: input.ingestion,
      entitlement: {
        tier: 'free' as any, // 由 Controller 层设置真实值
        fieldsHidden: [],
      },
      // V2.2: 决策结构化摘要
      summary: input.summary,
      analysisState: input.analysisState,
      confidenceDiagnostics: input.confidenceDiagnostics,
      evidencePack: input.evidencePack,
      shouldEatAction: input.shouldEatAction,
      // V3.3
      foodAnalysisPackage: input.foodAnalysisPackage,
      structuredDecision: input.structuredDecision,
    };

    // V3.9 P1.4: 按 decisionMode 裁剪返回字段
    this.trimByMode(result, input.decisionMode);

    return result;
  }

  /**
   * V3.9 P1.4: 按决策模式裁剪结果字段
   *
   * - pre_eat: 突出 shouldEatAction / alternatives / structuredDecision，
   *            隐藏 post_eat 专属的 recoveryAction
   * - post_eat: 突出 macroProgress / nextMealAdvice / analysisState，
   *             隐藏 pre_eat 专属的 shouldEatAction / alternatives / structuredDecision
   * - default/undefined: 完整返回
   */
  private trimByMode(
    result: FoodAnalysisResultV61,
    mode?: 'pre_eat' | 'post_eat' | 'default',
  ): void {
    if (!mode || mode === 'default') return;

    if (mode === 'post_eat') {
      // post_eat 模式：清除 pre_eat 专属字段
      result.shouldEatAction = undefined;
      result.alternatives = [];
      result.structuredDecision = undefined;
    } else if (mode === 'pre_eat') {
      // pre_eat 模式：保留 shouldEatAction / alternatives / structuredDecision
      // 无需额外裁剪
    }
  }

  /**
   * 评估入库决策 — 文本链路
   */
  evaluateTextIngestion(foods: AnalyzedFoodItem[]): IngestionDecision {
    const matchedCount = foods.filter((f) => f.foodLibraryId).length;
    const unmatchedCount = foods.length - matchedCount;

    return {
      matchedExistingFoods: matchedCount > 0,
      shouldPersistCandidate:
        unmatchedCount > 0 &&
        foods.some((f) => !f.foodLibraryId && f.confidence >= 0.6),
      reviewRequired: foods.some((f) => !f.foodLibraryId && f.confidence < 0.6),
    };
  }

  /**
   * 评估入库决策 — 图片链路
   */
  evaluateImageIngestion(
    foods: AnalyzedFoodItem[],
    avgConfidence: number,
  ): IngestionDecision {
    return {
      matchedExistingFoods: false,
      shouldPersistCandidate: avgConfidence >= 0.5 && foods.length > 0,
      reviewRequired: avgConfidence < 0.7,
    };
  }
}
