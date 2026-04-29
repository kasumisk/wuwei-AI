/**
 * V2.1 Phase 2.3 — 分析持久化服务
 *
 * 从 TextFoodAnalysisService 和 ImageFoodAnalysisService 提取持久化逻辑。
 * 统一文本/图片的 food_analysis_records 写入。
 *
 * 设计原则:
 * - 所有持久化都是 fire-and-forget（调用方 .catch 处理错误）
 * - 不阻塞主分析流程
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../types/analysis-result.types';
import { AnalysisRecordStatus, PersistStatus } from '../../food/food.types';

// ==================== 输入类型 ====================

export interface TextPersistInput {
  analysisId: string;
  userId: string;
  rawText: string;
  mealType?: string;
  result: FoodAnalysisResultV61;
  /** 原始解析的食物列表（含 libraryMatch 信息） */
  parsedFoodMeta: Array<{
    name: string;
    quantity?: string;
    fromLibrary: boolean;
  }>;
  matchedFoodCount: number;
  candidateFoodCount: number;
}

export interface ImagePersistInput {
  analysisId: string;
  userId: string;
  imageUrl: string;
  mealType?: string;
  result: FoodAnalysisResultV61;
}

@Injectable()
export class AnalysisPersistenceService {
  private readonly logger = new Logger(AnalysisPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 保存文本分析记录
   */
  async saveTextRecord(input: TextPersistInput): Promise<void> {
    await this.prisma.foodAnalysisRecords.create({
      data: {
        id: input.analysisId,
        userId: input.userId,
        inputType: 'text',
        rawText: input.rawText,
        mealType: input.mealType || null,
        status: AnalysisRecordStatus.COMPLETED,
        recognizedPayload: {
          terms: input.parsedFoodMeta,
          foods: input.result.foods,
        } as any,
        normalizedPayload: {
          foods: input.result.foods,
        } as any,
        nutritionPayload: {
          foods: input.result.foods,
          totals: input.result.totals,
          score: input.result.score,
          analysisState: input.result.analysisState,
          confidenceDiagnostics: input.result.confidenceDiagnostics,
        } as any,
        decisionPayload: {
          decision: input.result.decision,
          alternatives: input.result.alternatives,
          explanation: input.result.explanation,
          summary: input.result.summary,
          evidencePack: input.result.evidencePack,
          shouldEatAction: input.result.shouldEatAction,
          structuredDecision: input.result.structuredDecision,
          foodAnalysisPackage: input.result.foodAnalysisPackage,
          contextualAnalysis: input.result.contextualAnalysis,
          unifiedUserContext: input.result.unifiedUserContext,
          coachActionPlan: input.result.coachActionPlan,
        } as any,
        confidenceScore: input.result.score.confidenceScore,
        qualityScore: input.result.score.healthScore,
        matchedFoodCount: input.matchedFoodCount,
        candidateFoodCount: input.candidateFoodCount,
        persistStatus: PersistStatus.PENDING,
      },
    });
    this.logger.debug(`Text analysis record saved: ${input.analysisId}`);
  }

  /**
   * 保存图片分析记录
   */
  async saveImageRecord(input: ImagePersistInput): Promise<void> {
    await this.prisma.foodAnalysisRecords.create({
      data: {
        id: input.analysisId,
        userId: input.userId,
        inputType: 'image',
        rawText: null,
        imageUrl: input.imageUrl,
        mealType: input.mealType || null,
        status: AnalysisRecordStatus.COMPLETED,
        recognizedPayload: { foods: input.result.foods } as any,
        normalizedPayload: null as any,
        nutritionPayload: {
          foods: input.result.foods,
          totals: input.result.totals,
          score: input.result.score,
          analysisState: input.result.analysisState,
          confidenceDiagnostics: input.result.confidenceDiagnostics,
        } as any,
        decisionPayload: {
          decision: input.result.decision,
          alternatives: input.result.alternatives,
          explanation: input.result.explanation,
          summary: input.result.summary,
          evidencePack: input.result.evidencePack,
          shouldEatAction: input.result.shouldEatAction,
          structuredDecision: input.result.structuredDecision,
          foodAnalysisPackage: input.result.foodAnalysisPackage,
          contextualAnalysis: input.result.contextualAnalysis,
          unifiedUserContext: input.result.unifiedUserContext,
          coachActionPlan: input.result.coachActionPlan,
        } as any,
        confidenceScore: input.result.score.confidenceScore,
        qualityScore: null,
        matchedFoodCount: 0,
        candidateFoodCount: 0,
      },
    });
    this.logger.debug(`Image analysis record saved: ${input.analysisId}`);
  }
}
