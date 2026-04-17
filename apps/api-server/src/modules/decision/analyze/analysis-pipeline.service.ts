/**
 * V2.1 Phase 2.4 — 统一分析管道服务
 *
 * 编排 text/image 食物识别之后的所有共享步骤：
 *   营养汇总 → 用户上下文 → 评分 → 决策 → 组装 → 持久化 → 事件
 *
 * text/image 服务只负责"食物识别"（Step 1），其余步骤由本管道统一处理。
 *
 * 设计原则:
 * - 消除 text/image 编排重复
 * - 每个步骤委托给独立服务/纯函数
 * - 持久化是 fire-and-forget，不阻塞返回
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import {
  DomainEvents,
  AnalysisCompletedEvent,
} from '../../../core/events/domain-events';
import {
  AnalysisState,
  ConfidenceDiagnostics,
  EvidencePack,
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
  AnalysisScore,
  AnalysisInputSnapshot,
  NutritionTotals,
  FoodAnalysisPackage,
  StructuredDecision,
  ContextualAnalysis,
} from '../types/analysis-result.types';
import {
  aggregateNutrition,
  computeAvgConfidence,
} from './nutrition-aggregator';
import { ResultAssemblerService } from './result-assembler.service';
import {
  AnalysisPersistenceService,
  TextPersistInput,
  ImagePersistInput,
} from './analysis-persistence.service';
import { UserContextBuilderService } from '../decision/user-context-builder.service';
import {
  FoodScoringService,
  ScoringFoodItem,
} from '../score/food-scoring.service';
import {
  FoodDecisionService,
  DecisionOutput,
} from '../decision/food-decision.service';
import { DecisionSummaryService } from '../decision/decision-summary.service';
import { DecisionToneResolverService } from '../decision/decision-tone-resolver.service';
import { AnalysisStateBuilderService } from './analysis-state-builder.service';
import { ConfidenceDiagnosticsService } from './confidence-diagnostics.service';
import { EvidencePackBuilderService } from './evidence-pack-builder.service';
import { PostMealRecoveryService } from '../decision/post-meal-recovery.service';
import { ShouldEatActionService } from '../decision/should-eat-action.service';
import { AnalysisAccuracyService } from './analysis-accuracy.service';
import { AnalysisContextService } from './analysis-context.service';
import { DecisionEngineService } from '../decision/decision-engine.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';

// ==================== 管道输入类型 ====================

/** 文本链路管道输入 */
export interface TextPipelineInput {
  inputType: 'text';
  rawText: string;
  mealType?: string;
  userId?: string;
  locale?: Locale;
  /** 解析后的食物列表（文本链路 Step 1 输出） */
  foods: AnalyzedFoodItem[];
  /** 用于评分的 ScoringFoodItem（含 libraryMatch 信息） */
  scoringFoods: ScoringFoodItem[];
  /** 持久化所需的解析元数据 */
  parsedFoodMeta: Array<{
    name: string;
    quantity?: string;
    fromLibrary: boolean;
  }>;
  decisionMode?: 'pre_eat' | 'post_eat';
}

/** 图片链路管道输入 */
export interface ImagePipelineInput {
  inputType: 'image';
  imageUrl: string;
  mealType?: string;
  userId: string;
  locale?: Locale;
  /** 识别后的食物列表（图片链路 Step 1 输出） */
  foods: AnalyzedFoodItem[];
  /** 图片链路已有评分（来自 AI 或评分引擎覆盖），可选 */
  precomputedScore?: AnalysisScore;
  /** 图片链路已有营养汇总（来自 legacy result），可选 */
  precomputedTotals?: NutritionTotals;
  decisionMode?: 'pre_eat' | 'post_eat';
}

export type PipelineInput = TextPipelineInput | ImagePipelineInput;

@Injectable()
export class AnalysisPipelineService {
  private readonly logger = new Logger(AnalysisPipelineService.name);

  constructor(
    private readonly userContextBuilder: UserContextBuilderService,
    private readonly foodScoringService: FoodScoringService,
    private readonly foodDecisionService: FoodDecisionService,
    private readonly resultAssembler: ResultAssemblerService,
    private readonly persistence: AnalysisPersistenceService,
    private readonly eventEmitter: EventEmitter2,
    private readonly decisionSummaryService: DecisionSummaryService,
    private readonly decisionToneResolverService: DecisionToneResolverService,
    private readonly analysisStateBuilder: AnalysisStateBuilderService,
    private readonly confidenceDiagnosticsService: ConfidenceDiagnosticsService,
    private readonly evidencePackBuilder: EvidencePackBuilderService,
    private readonly postMealRecoveryService: PostMealRecoveryService,
    private readonly shouldEatActionService: ShouldEatActionService,
    private readonly analysisAccuracyService: AnalysisAccuracyService,
    private readonly analysisContextService: AnalysisContextService,
    private readonly decisionEngineService: DecisionEngineService,
  ) {}

  /**
   * 执行统一分析管道
   *
   * Step 2: 营养汇总
   * Step 3: 用户上下文
   * Step 4: 评分
   * Step 5: 决策
   * Step 6: 组装
   * Step 7: 持久化（异步）
   * Step 8: 事件发射
   */
  async execute(input: PipelineInput): Promise<FoodAnalysisResultV61> {
    const analysisId = crypto.randomUUID();

    // Step 2: 营养汇总
    const totals =
      input.inputType === 'image' && input.precomputedTotals
        ? input.precomputedTotals
        : aggregateNutrition(input.foods);

    // Step 3: 用户上下文
    const userContext = await this.userContextBuilder.build(
      input.userId,
      input.locale,
    );
    if (input.mealType) {
      userContext.mealType = input.mealType;
    }

    // Step 4: 评分
    const score = await this.computeScore(input, totals, userContext);
    const mode = input.decisionMode || 'pre_eat';

    // V3.3 Step 4.1: 构建上下文分析（当天摄入 + 用户画像 + 问题识别）
    let contextualAnalysis: ContextualAnalysis | undefined;
    try {
      contextualAnalysis = this.analysisContextService.buildContextualAnalysis(
        userContext,
        input.locale,
      );
      // 将当前食物加入排除列表（去重）
      if (contextualAnalysis) {
        contextualAnalysis =
          this.analysisContextService.excludeFoodsFromRecommendation(
            contextualAnalysis,
            input.foods.map((f) => f.name),
          );
      }
    } catch (err) {
      this.logger.warn(`上下文分析构建失败: ${(err as Error).message}`);
    }

    // Step 4.5: 构建分析状态
    const analysisState = this.analysisStateBuilder.build({
      foods: input.foods,
      totals,
      score,
      userContext,
      mealType: input.mealType,
    });

    // Step 5: 决策
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
        contextualAnalysis?.identifiedIssues,
        contextualAnalysis, // V3.6 P2.1: 传入完整上下文分析供动态目标参数
      );
    } catch (err) {
      this.logger.warn(`决策计算失败，使用默认: ${(err as Error).message}`);
      decisionOutput = this.buildFallbackDecision(input.locale);
    }

    // V3.3 Step 5.45: 计算 StructuredDecision（在摘要之前，供摘要消费）
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
        `StructuredDecision 计算失败: ${(err as Error).message}`,
      );
    }

    // Step 6: 组装
    // V2.2: Step 5.5 — 生成决策结构化摘要
    let summary;
    try {
      summary = this.decisionSummaryService.summarize({
        decisionOutput,
        totals,
        userContext,
        foodNames: input.foods.map((f) => f.name),
        structuredDecision,
        // V3.5 P2.3: 传入营养问题列表和决策模式
        nutritionIssues: contextualAnalysis?.identifiedIssues,
        decisionMode: mode,
        // V3.8: locale for i18n
        locale: input.locale,
      });
    } catch (err) {
      this.logger.warn(`摘要生成失败: ${(err as Error).message}`);
    }

    // Step 5.6: 分层置信度诊断
    let confidenceDiagnostics: ConfidenceDiagnostics | undefined;
    try {
      confidenceDiagnostics = await this.confidenceDiagnosticsService.diagnose({
        foods: input.foods,
        userId: input.userId,
        summary,
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
      this.logger.warn(`置信度诊断失败: ${(err as Error).message}`);
    }

    // Step 5.7: 补偿建议 + 证据块 + 行动决策
    const recoveryAction = this.postMealRecoveryService.build({
      mode,
      macroProgress: decisionOutput.macroProgress,
      userContext,
    });

    const evidencePack: EvidencePack = this.evidencePackBuilder.build({
      decisionOutput,
      analysisState,
      confidenceDiagnostics: confidenceDiagnostics || {
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
      },
      summary,
      contextualAnalysis,
      structuredDecision,
    });
    // V3.0: 注入语气修饰
    evidencePack.toneModifier =
      this.decisionToneResolverService.resolveModifier({
        goalType: userContext.goalType,
        verdict: decisionOutput.decision.recommendation,
        coachFocus: summary.coachFocus,
      });

    const shouldEatAction = this.shouldEatActionService.build({
      mode,
      decisionOutput,
      summary,
      evidencePack,
      userContext,
      confidenceDiagnostics: confidenceDiagnostics || {
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
      },
      recoveryAction,
    });

    // V3.3 Step 5.8: 组装 FoodAnalysisPackage
    let foodAnalysisPackage: FoodAnalysisPackage | undefined;
    try {
      const reviewLevel = confidenceDiagnostics?.reviewLevel || 'auto_review';
      // V3.4 P1.4: 使用多信号 assessFromFoods() 替代单一 assessAccuracy()
      const accuracyMetrics = this.analysisAccuracyService.assessFromFoods(
        input.foods,
        reviewLevel,
      );
      foodAnalysisPackage = {
        totalCalories: totals.calories,
        macros: {
          protein: totals.protein,
          fat: totals.fat,
          carbs: totals.carbs,
        },
        accuracyLevel: accuracyMetrics.level,
        accuracyScore: accuracyMetrics.score,
        accuracyFactors: accuracyMetrics.factors,
        nutritionBreakdown: score.breakdown || {
          energy: 50,
          proteinRatio: 50,
          macroBalance: 50,
          foodQuality: 50,
          satiety: 50,
          stability: 50,
          glycemicImpact: 50,
          mealQuality: 50,
        },
      };
    } catch (err) {
      this.logger.warn(
        `FoodAnalysisPackage 组装失败: ${(err as Error).message}`,
      );
    }

    // V3.7 P2.2: 准确度→决策联动 — 低准确度时自动降级 verdict
    if (foodAnalysisPackage?.accuracyLevel === 'low') {
      // avoid → caution + disclaimer
      if (structuredDecision && structuredDecision.verdict === 'avoid') {
        structuredDecision = {
          ...structuredDecision,
          verdict: 'caution',
        };
        this.logger.log('P2.2: accuracy=low, downgraded verdict avoid→caution');
      }
      if (decisionOutput.decision.recommendation === 'avoid') {
        decisionOutput = {
          ...decisionOutput,
          decision: {
            ...decisionOutput.decision,
            recommendation: 'caution',
          },
        };
      }
      // Enrich summary with accuracy disclaimer
      if (summary) {
        const disclaimers: Record<string, string> = {
          'zh-CN':
            '⚠️ 分析准确度较低，本次决策已自动降级为谨慎建议，请结合实际情况判断。',
          'en-US':
            '⚠️ Analysis accuracy is low. The decision has been automatically downgraded to caution. Please use your own judgment.',
          'ja-JP':
            '⚠️ 分析精度が低いため、判定は自動的に注意レベルに引き下げられました。ご自身の判断も併せてください。',
        };
        const loc = input.locale || 'zh-CN';
        const disclaimer = disclaimers[loc] || disclaimers['zh-CN'];
        summary.analysisQualityNote = disclaimer;
      }
    }

    const avgConfidence = computeAvgConfidence(input.foods);
    const ingestion =
      input.inputType === 'text'
        ? this.resultAssembler.evaluateTextIngestion(input.foods)
        : this.resultAssembler.evaluateImageIngestion(
            input.foods,
            avgConfidence,
          );

    const inputSnapshot: AnalysisInputSnapshot =
      input.inputType === 'text'
        ? { rawText: input.rawText, mealType: input.mealType as any }
        : { imageUrl: input.imageUrl, mealType: input.mealType as any };

    const result = this.resultAssembler.assemble({
      analysisId,
      inputType: input.inputType,
      inputSnapshot,
      foods: input.foods,
      totals,
      score,
      decisionOutput,
      ingestion,
      summary,
      analysisState,
      confidenceDiagnostics,
      evidencePack,
      shouldEatAction,
      foodAnalysisPackage,
      structuredDecision,
    });

    // Step 7: 持久化（异步，不阻塞）
    if (input.userId) {
      this.persistAsync(input, analysisId, result);
    }

    // V3.5 P3.2: 附上下文分析和用户上下文到 result，供 CoachService 缓存后注入教练 prompt
    if (contextualAnalysis) {
      result.contextualAnalysis = contextualAnalysis;
    }
    result.unifiedUserContext = userContext;

    // Step 8: 事件发射
    if (input.userId) {
      this.emitAnalysisCompleted(
        input.userId,
        analysisId,
        input.inputType,
        input.foods,
        totals,
        result.decision.recommendation,
        avgConfidence,
        result,
      );
    }

    return result;
  }

  // ==================== 私有方法 ====================

  /**
   * Step 4: 评分 — 根据输入类型选择评分策略
   */
  private async computeScore(
    input: PipelineInput,
    totals: NutritionTotals,
    userContext: Awaited<ReturnType<UserContextBuilderService['build']>>,
  ): Promise<AnalysisScore> {
    // 图片链路如果有预计算评分，直接使用
    if (input.inputType === 'image' && input.precomputedScore) {
      return input.precomputedScore;
    }

    try {
      if (input.inputType === 'text' && input.scoringFoods) {
        const result = await this.foodScoringService.calculateScore(
          input.scoringFoods,
          totals,
          {
            profile: userContext.profile,
            todayCalories: userContext.todayCalories,
            todayProtein: userContext.todayProtein,
            todayFat: userContext.todayFat,
            todayCarbs: userContext.todayCarbs,
            goalType: userContext.goalType,
            // V3.5 P1.2: 注入健康条件用于健康感知评分调整
            healthConditions: userContext.healthConditions,
          },
          input.userId,
          input.locale,
        );
        return result.analysisScore;
      }

      // 图片链路无预计算评分时，使用 calculateImageScore
      if (input.inputType === 'image' && input.userId) {
        const avgQuality =
          input.foods.length > 0
            ? input.foods.reduce((s, f) => s + (f.confidence * 8 || 5), 0) /
              input.foods.length
            : 5;
        const avgSatiety = avgQuality; // 简化估算

        const result = await this.foodScoringService.calculateImageScore(
          {
            calories: totals.calories,
            protein: totals.protein,
            fat: totals.fat,
            carbs: totals.carbs,
            avgQuality,
            avgSatiety,
            healthConditions: userContext.healthConditions, // V3.6 P1.5
          },
          input.userId,
          userContext.goalType,
          userContext.profile,
          input.locale,
        );
        return {
          healthScore: result.score,
          nutritionScore: result.score,
          confidenceScore: Math.round(computeAvgConfidence(input.foods) * 100),
          breakdown: result.breakdown,
        };
      }
    } catch (err) {
      this.logger.warn(`评分计算失败: ${(err as Error).message}`);
    }

    // fallback 评分
    return {
      healthScore: 50,
      nutritionScore: 50,
      confidenceScore: Math.round(computeAvgConfidence(input.foods) * 100),
    };
  }

  /**
   * Step 7: 异步持久化
   */
  private persistAsync(
    input: PipelineInput,
    analysisId: string,
    result: FoodAnalysisResultV61,
  ): void {
    if (input.inputType === 'text') {
      const textInput = input as TextPipelineInput;
      const matchedCount = textInput.parsedFoodMeta.filter(
        (f) => f.fromLibrary,
      ).length;

      this.persistence
        .saveTextRecord({
          analysisId,
          userId: textInput.userId!,
          rawText: textInput.rawText,
          mealType: textInput.mealType,
          result,
          parsedFoodMeta: textInput.parsedFoodMeta,
          matchedFoodCount: matchedCount,
          candidateFoodCount: textInput.parsedFoodMeta.length - matchedCount,
        })
        .catch((err) =>
          this.logger.warn(`保存文本分析记录失败: ${(err as Error).message}`),
        );
    } else {
      const imageInput = input as ImagePipelineInput;
      this.persistence
        .saveImageRecord({
          analysisId,
          userId: imageInput.userId,
          imageUrl: imageInput.imageUrl,
          mealType: imageInput.mealType,
          result,
        })
        .catch((err) =>
          this.logger.warn(`保存图片分析记录失败: ${(err as Error).message}`),
        );
    }
  }

  /**
   * Step 8: 事件发射
   */
  private emitAnalysisCompleted(
    userId: string,
    analysisId: string,
    inputType: 'text' | 'image',
    foods: AnalyzedFoodItem[],
    totals: NutritionTotals,
    recommendation: string,
    avgConfidence: number,
    result: FoodAnalysisResultV61,
  ): void {
    const foodNames = foods.map((f) => f.name);
    const foodCategories = [
      ...new Set(foods.map((f) => f.category).filter(Boolean) as string[]),
    ];

    this.eventEmitter.emit(
      DomainEvents.ANALYSIS_COMPLETED,
      new AnalysisCompletedEvent(
        userId,
        analysisId,
        inputType,
        foodNames,
        foodCategories,
        totals.calories,
        recommendation,
        avgConfidence,
      ),
    );
  }

  /**
   * V3.8: 将 AnalyzedFoodItem[] 转换为决策所需的食物参数格式
   */
  private toDecisionFoodItems(foods: AnalyzedFoodItem[]) {
    return foods.map((f) => ({
      name: f.name,
      estimatedWeightGrams:
        f.estimatedWeightGrams ||
        (f.calories > 0 ? Math.round(f.calories / 1.5) : 100),
      category: f.category,
      confidence: f.confidence,
      calories: f.calories || 0,
      protein: f.protein || 0,
      fat: f.fat || 0,
      carbs: f.carbs || 0,
      fiber: f.fiber,
      sodium: f.sodium,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
    }));
  }

  /**
   * 构建 fallback 决策输出（当决策服务失败时）
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

  private enrichSummaryWithConfidence(
    summary: NonNullable<FoodAnalysisResultV61['summary']>,
    diagnostics: ConfidenceDiagnostics,
    mode?: 'pre_eat' | 'post_eat',
    locale?: Locale,
  ): void {
    summary.analysisQualityBand = diagnostics.analysisQualityBand;
    summary.reviewLevel = diagnostics.reviewLevel;
    if (diagnostics.analysisQualityBand === 'high') {
      summary.analysisQualityNote = cl('pipeline.quality.high', locale);
    } else if (diagnostics.analysisQualityBand === 'medium') {
      summary.analysisQualityNote = cl('pipeline.quality.medium', locale);
    } else {
      summary.analysisQualityNote = cl('pipeline.quality.low', locale);
    }

    const guardrails: string[] = [];
    if (summary.analysisQualityBand === 'low') {
      guardrails.push(cl('pipeline.guardrail.lowQuality', locale));
    }
    if (summary.healthConstraintNote) {
      guardrails.push(summary.healthConstraintNote);
    }
    if (summary.dynamicDecisionHint) {
      guardrails.push(summary.dynamicDecisionHint);
    }
    if (summary.verdict === 'avoid') {
      guardrails.push(cl('pipeline.guardrail.avoid', locale));
    }
    // V3.5 P3.1: post_eat 模式追加恢复型 guardrail
    if (mode === 'post_eat') {
      guardrails.push(cl('pipeline.guardrail.postEat', locale));
    }

    summary.decisionGuardrails = Array.from(new Set(guardrails)).slice(0, 3);
  }
}
