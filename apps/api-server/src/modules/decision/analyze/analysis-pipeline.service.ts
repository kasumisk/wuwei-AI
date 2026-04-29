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
import { I18nService, I18nLocale } from '../../../core/i18n';
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
  AnalyzeStageResult,
  DecideStageResult,
  PostProcessStageResult,
  NutritionIssue,
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
import { UserContextBuilderService } from './user-context-builder.service';
import {
  FoodScoringService,
  ScoringFoodItem,
} from '../score/food-scoring.service';
import { ScoringStageService } from '../score/scoring-stage.service';
import { DecisionStageService } from '../decision/decision-stage.service';
import { CoachingStageService } from '../coach/coaching-stage.service';
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
// ==================== 管道输入类型 ====================

/** 文本链路管道输入 */
export interface TextPipelineInput {
  inputType: 'text';
  rawText: string;
  mealType?: string;
  userId?: string;
  locale?: I18nLocale;
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
  /** V5.2: 覆盖 localHour（补录/跨时区场景） */
  localHourOverride?: number;
  /** 预构建的用户上下文，避免重复调用 UserContextBuilder */
  prebuiltUserContext?: any;
}

/** 图片链路管道输入 */
export interface ImagePipelineInput {
  inputType: 'image';
  imageUrl: string;
  mealType?: string;
  userId: string;
  locale?: I18nLocale;
  /** 识别后的食物列表（图片链路 Step 1 输出） */
  foods: AnalyzedFoodItem[];
  /** 图片链路已有评分（来自 AI 或评分引擎覆盖），可选 */
  precomputedScore?: AnalysisScore;
  /** 图片链路已有营养汇总（来自 legacy result），可选 */
  precomputedTotals?: NutritionTotals;
  decisionMode?: 'pre_eat' | 'post_eat';
  /** V5.2: 覆盖 localHour（补录/跨时区场景） */
  localHourOverride?: number;
  /** 预构建的用户上下文，避免重复调用 UserContextBuilder */
  prebuiltUserContext?: any;
}

export type PipelineInput = TextPipelineInput | ImagePipelineInput;

@Injectable()
export class AnalysisPipelineService {
  private readonly logger = new Logger(AnalysisPipelineService.name);

  constructor(private readonly userContextBuilder: UserContextBuilderService,
    private readonly foodScoringService: FoodScoringService,
    private readonly scoringStageService: ScoringStageService,
    private readonly decisionStageService: DecisionStageService,
    private readonly coachingStageService: CoachingStageService,
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
    private readonly i18n: I18nService,
  ) {}

  /**
   * 执行统一分析管道（V3.9 三阶段架构）
   *
   * Stage 1 — Analyze: 营养汇总 → 用户上下文 → 评分 → 上下文分析
   * Stage 2 — Decide:  决策判断 → 结构化决策 → 摘要
   * Stage 3 — Coach:   置信度诊断 → 恢复建议 → 证据包 → ShouldEat → 准确度
   *
   * V4.6: Stage 3 重命名为 runCoaching（原 runPostProcess），
   * Phase 3 将在此阶段注入个性化教练消息。
   *
   * 最终组装 + 持久化 + 事件发射
   */
  async execute(input: PipelineInput): Promise<FoodAnalysisResultV61> {
    return this.executeWithOptions(input);
  }

  async executeWithOptions(
    input: PipelineInput,
    options?: {
      persistRecord?: boolean;
      emitCompletedEvent?: boolean;
    },
  ): Promise<FoodAnalysisResultV61> {
    // Stage 1: Analyze
    const analyze = await this.runAnalyze(input);

    // Stage 2: Decide — V5.0: delegated to DecisionStageService
    const decide = await this.decisionStageService.run({
      foods: input.foods,
      analyze,
      userId: input.userId,
      locale: input.locale,
      decisionMode: input.decisionMode,
    });

    // Stage 3: Coaching (V4.6: renamed from PostProcess) — V5.0: delegated to CoachingStageService
    const postProcess = await this.coachingStageService.run({
      foods: input.foods,
      analyze,
      decide,
      userId: input.userId,
      locale: input.locale,
      decisionMode: input.decisionMode,
    });

    // 准确度→决策联动：低准确度时自动降级 verdict
    this.applyAccuracyDowngrade(
      postProcess.analysisAccuracy,
      decide,
      input.locale,
    );

    // 组装最终结果
    const avgConfidence = analyze.avgConfidence;
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
      analysisId: analyze.analysisId,
      inputType: input.inputType,
      inputSnapshot,
      foods: input.foods,
      totals: analyze.totals,
      score: analyze.score,
      decisionOutput: decide.decision,
      ingestion,
      summary: decide.summary,
      analysisState: analyze.analysisState,
      confidenceDiagnostics: postProcess.confidenceDiagnostics,
      evidencePack: postProcess.evidencePack,
      shouldEatAction: postProcess.shouldEatAction ?? undefined,
      foodAnalysisPackage: postProcess.analysisAccuracy,
      structuredDecision: decide.structuredDecision ?? undefined,
      decisionMode: input.decisionMode as
        | 'pre_eat'
        | 'post_eat'
        | 'default'
        | undefined,
    });

    // 附上下文分析和用户上下文到 result，供 CoachService 缓存后注入教练 prompt
    if (analyze.contextualAnalysis) {
      result.contextualAnalysis = analyze.contextualAnalysis;
    }
    result.unifiedUserContext = analyze.userContext ?? undefined;
    if (postProcess.recoveryAction) {
      result.contextualAnalysis = {
        ...(result.contextualAnalysis ?? {}),
        recoveryAction: postProcess.recoveryAction,
      } as ContextualAnalysis;
    }

    // 持久化（fire-and-forget，不阻塞响应）
    if (input.userId && options?.persistRecord != false) {
      this.persistRecord(input, analyze.analysisId, result).catch((err) =>
        this.logger.error(
          `Analysis record persistence failed: ${(err as Error).message}`,
        ),
      );
    }

    // 事件发射
    if (input.userId && options?.emitCompletedEvent != false) {
      this.emitAnalysisCompleted(
        input.userId,
        analyze.analysisId,
        input.inputType,
        input.foods,
        analyze.totals,
        result.decision.recommendation,
        avgConfidence,
        result,
      );
    }

    return result;
  }

  // ==================== V3.9: 三阶段编排 ====================

  /**
   * Stage 1 — Analyze: 营养汇总 + 用户上下文 + 评分 + 上下文分析
   *
   * 纯分析，不包含任何决策逻辑。
   */
  private async runAnalyze(input: PipelineInput): Promise<AnalyzeStageResult> {
    const analysisId = crypto.randomUUID();

    // 营养汇总
    const totals =
      input.inputType === 'image' && input.precomputedTotals
        ? input.precomputedTotals
        : aggregateNutrition(input.foods);

    // 用户上下文（优先复用预构建的）
    const userContext = input.prebuiltUserContext
      ? input.prebuiltUserContext
      : await this.userContextBuilder.build(input.userId, input.locale);
    if (input.mealType) {
      userContext.mealType = input.mealType;
    }
    // V5.2: localHour override for retroactive logging / cross-timezone
    if (input.localHourOverride != null) {
      userContext.localHour = input.localHourOverride;
    }

    // 评分 — V5.0: delegated to ScoringStageService
    const score = await this.scoringStageService.run({
      foods: input.foods,
      totals,
      userContext,
      scoringFoods: input.inputType === 'text' ? input.scoringFoods : undefined,
      precomputedScore:
        input.inputType === 'image' ? input.precomputedScore : undefined,
      userId: input.userId,
      locale: input.locale,
    });

    // 上下文分析（当天摄入 + 用户画像 + 营养问题识别）
    let contextualAnalysis: ContextualAnalysis | undefined;
    try {
      contextualAnalysis = this.analysisContextService.buildContextualAnalysis(
        userContext,
        input.locale,
      );
      if (contextualAnalysis) {
        contextualAnalysis =
          this.analysisContextService.excludeFoodsFromRecommendation(
            contextualAnalysis,
            input.foods.map((f) => f.name),
          );
      }
    } catch (err) {
      this.logger.warn(
        `Contextual analysis build failed: ${(err as Error).message}`,
      );
    }

    // 分析状态（吃前/吃后投影）
    const analysisState = this.analysisStateBuilder.build({
      foods: input.foods,
      totals,
      score,
      userContext,
      mealType: input.mealType,
    });

    const avgConfidence = computeAvgConfidence(input.foods);

    return {
      analysisId,
      foods: input.foods,
      totals,
      userContext,
      score,
      contextualAnalysis: contextualAnalysis || null,
      avgConfidence,
      breakdown: score.breakdown || null,
      nutritionIssues: contextualAnalysis?.identifiedIssues || [],
      analysisState: analysisState || null,
    };
  }

  /**
   * Stage 2 — Decide: 决策判断 + 结构化决策 + 摘要
   *
   * 基于分析结果生成"吃/不吃"判断和可执行建议。
   */

  /**
   * V3.9: 准确度→决策联动 — 低准确度时自动降级 verdict
   */
  private applyAccuracyDowngrade(
    accuracy: FoodAnalysisPackage | undefined,
    decide: DecideStageResult,
    locale?: I18nLocale,
  ): void {
    // V4.1: 优先使用 decisionImpact 判断是否降级
    const shouldDowngrade =
      accuracy?.decisionImpact?.shouldDowngrade ??
      accuracy?.accuracyLevel === 'low';
    if (!accuracy || !shouldDowngrade) return;

    if (
      decide.structuredDecision &&
      decide.structuredDecision.verdict === 'avoid'
    ) {
      decide.structuredDecision = {
        ...decide.structuredDecision,
        verdict: 'caution',
      };
      this.logger.log('V3.9: accuracy=low, downgraded verdict avoid→caution');
    }
    if (decide.decision.decision.recommendation === 'avoid') {
      decide.decision = {
        ...decide.decision,
        decision: {
          ...decide.decision.decision,
          recommendation: 'caution',
        },
      };
    }
    if (decide.summary) {
      decide.summary.analysisQualityNote = this.i18n.t(
        'decision.pipeline.guardrail.accuracyLow',
        locale,
      );
    }
  }

  // ==================== 私有方法 ====================

  /**
   * Step 7: 异步持久化
   */
  private async persistRecord(
    input: PipelineInput,
    analysisId: string,
    result: FoodAnalysisResultV61,
  ): Promise<void> {
    if (input.inputType === 'text') {
      const textInput = input as TextPipelineInput;
      const matchedCount = textInput.parsedFoodMeta.filter(
        (f) => f.fromLibrary,
      ).length;

      try {
        await this.persistence.saveTextRecord({
          analysisId,
          userId: textInput.userId!,
          rawText: textInput.rawText,
          mealType: textInput.mealType,
          result,
          parsedFoodMeta: textInput.parsedFoodMeta,
          matchedFoodCount: matchedCount,
          candidateFoodCount: textInput.parsedFoodMeta.length - matchedCount,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to save text analysis record: ${(err as Error).message}`,
        );
      }
    } else {
      const imageInput = input as ImagePipelineInput;
      try {
        await this.persistence.saveImageRecord({
          analysisId,
          userId: imageInput.userId,
          imageUrl: imageInput.imageUrl,
          mealType: imageInput.mealType,
          result,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to save image analysis record: ${(err as Error).message}`,
        );
      }
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

  private enrichSummaryWithConfidence(
    summary: NonNullable<FoodAnalysisResultV61['summary']>,
    diagnostics: ConfidenceDiagnostics,
    mode?: 'pre_eat' | 'post_eat',
    locale?: I18nLocale,
  ): void {
    summary.analysisQualityBand = diagnostics.analysisQualityBand;
    summary.reviewLevel = diagnostics.reviewLevel;
    if (diagnostics.analysisQualityBand === 'high') {
      summary.analysisQualityNote = this.i18n.t('decision.pipeline.quality.high', locale);
    } else if (diagnostics.analysisQualityBand === 'medium') {
      summary.analysisQualityNote = this.i18n.t('decision.pipeline.quality.medium', locale);
    } else {
      summary.analysisQualityNote = this.i18n.t('decision.pipeline.quality.low', locale);
    }

    const guardrails: string[] = [];
    if (summary.analysisQualityBand === 'low') {
      guardrails.push(this.i18n.t('decision.pipeline.guardrail.lowQuality', locale));
    }
    if (summary.healthConstraintNote) {
      guardrails.push(summary.healthConstraintNote);
    }
    if (summary.dynamicDecisionHint) {
      guardrails.push(summary.dynamicDecisionHint);
    }
    if (summary.verdict === 'avoid') {
      guardrails.push(this.i18n.t('decision.pipeline.guardrail.avoid', locale));
    }
    // V3.5 P3.1: post_eat 模式追加恢复型 guardrail
    if (mode === 'post_eat') {
      guardrails.push(this.i18n.t('decision.pipeline.guardrail.postEat', locale));
    }

    summary.decisionGuardrails = Array.from(new Set(guardrails)).slice(0, 3);
  }
}
