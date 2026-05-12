/**
 * 图片食物分析服务（V6.x 重构版）
 *
 * 编排器：负责把以下子组件串成完整链路
 *   ImagePromptBuilder  → 构建 vision prompt（用户上下文 + persona + 行为画像）
 *   VisionApiClient     → OpenRouter 多模态调用（含 fallback / 超时）
 *   ImageResultParser   → AI JSON → AnalyzedFoodItem[]
 *   FoodLibraryMatcher  → 食物库匹配 + 营养校准
 *   AnalysisPipeline    → 评分 / 决策 / 组装 V61
 *   LegacyResultAdapter → V61 ↔ legacy AnalysisResult 互转
 *
 * 对外公开方法：
 *   - executeAnalysisBundle(): 同时返回 legacy + V61（AnalyzeService 缓存 + 入库管道）
 *   - analyzeToV61():           只返回 V61
 *   - persistV61AnalysisRecord(): 把 V61 结果落库
 *
 * 不在本服务内做：
 *   - HTTP 入口路由     → controller
 *   - 队列 / 缓存       → AnalyzeService
 *   - 持久化数据库写入 → AnalysisPersistenceService
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { I18nService } from '../../../../core/i18n';
import {
  LlmQuotaExceededError,
  LlmUnavailableError,
} from '../../../../core/llm/llm.types';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../../../decision/types/analysis-result.types';
import { AnalysisResult } from './analyze.service';
import { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { AnalysisPipelineService } from '../../../decision/analyze/analysis-pipeline.service';
import { AnalysisPersistenceService } from '../../../decision/analyze/analysis-persistence.service';
import { UserContextBuilderService } from '../../../decision/analyze/user-context-builder.service';
import { VisionApiClient } from './image/vision-api.client';
import { ImagePromptBuilder } from './image/image-prompt.builder';
import { ImageResultParser } from './image/image-result.parser';
import { FoodLibraryMatcher } from './image/food-library-matcher.service';
import { ImageNutritionFillService } from './image/image-nutrition-fill.service';
import { LegacyResultAdapter } from './image/mappers/legacy-result.adapter';

@Injectable()
export class ImageFoodAnalysisService {
  private readonly logger = new Logger(ImageFoodAnalysisService.name);

  constructor(
    private readonly analysisPipeline: AnalysisPipelineService,
    private readonly persistence: AnalysisPersistenceService,
    private readonly userContextBuilder: UserContextBuilderService,
    private readonly visionApi: VisionApiClient,
    private readonly promptBuilder: ImagePromptBuilder,
    private readonly resultParser: ImageResultParser,
    private readonly libraryMatcher: FoodLibraryMatcher,
    private readonly nutritionFill: ImageNutritionFillService,
    private readonly legacyAdapter: LegacyResultAdapter,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 公共方法 ====================

  /**
   * 同时返回 legacy + V61。
   * AnalyzeService.processAnalysis 把 legacy 写入缓存，V61 给入库管道。
   */
  async executeAnalysisBundle(
    imageUrl: string,
    mealType?: string,
    userId?: string,
    locale?: Locale,
  ): Promise<{ legacy: AnalysisResult; v61: FoodAnalysisResultV61 }> {
    const v61 = await this.analyzeToV61(imageUrl, mealType, userId!, locale);
    return { legacy: this.legacyAdapter.toLegacyResult(v61), v61 };
  }

  async analyzeToV61(
    imageUrl: string,
    mealType: string | undefined,
    userId: string,
    locale?: Locale,
  ): Promise<FoodAnalysisResultV61> {
    // Build user context ONCE, reuse everywhere below.
    const ctx = await this.userContextBuilder.build(userId, locale);
    const foods = await this.analyzeImageToFoods(
      imageUrl,
      mealType,
      userId,
      locale,
      ctx,
    );

    // Post-analysis 食物库匹配：补 foodLibraryId + 校准营养
    await this.libraryMatcher.matchAll(foods);

    // Phase 2 文本 LLM 补全：对未命中食物填充营养数据
    await this.nutritionFill.fillMissing(foods, userId, locale);

    const result = await this.analysisPipeline.executeWithOptions(
      {
        inputType: 'image',
        imageUrl,
        mealType,
        userId,
        locale,
        foods,
        prebuiltUserContext: ctx,
      },
      {
        persistRecord: false,
        emitCompletedEvent: false,
      },
    );
    return result;
  }

  /**
   * 把已生成的 V61 结果落库。
   */
  async persistV61AnalysisRecord(
    result: FoodAnalysisResultV61,
    userId: string,
    imageUrl: string,
    mealType?: string,
  ): Promise<string> {
    await this.persistence.saveImageRecord({
      analysisId: result.analysisId,
      userId,
      imageUrl,
      mealType,
      result,
    });
    return result.analysisId;
  }

  // ==================== 私有方法 ====================

  /**
   * 单步：构建 prompt → 调 vision API → 解析为 AnalyzedFoodItem[]。
   *
   * 失败时统一抛 BadRequestException（携带本地化文案）。
   */
  private async analyzeImageToFoods(
    imageUrl: string,
    mealType: string | undefined,
    userId: string,
    locale?: Locale,
    prebuiltCtx?: any,
  ): Promise<AnalyzedFoodItem[]> {
    const userHint = mealType ? `User hint: this is ${mealType}. ` : '';
    const { systemPrompt } = await this.promptBuilder.build(
      userId,
      locale,
      prebuiltCtx,
    );

    try {
      const content = await this.visionApi.complete(
        systemPrompt,
        imageUrl,
        userHint,
        userId,
        locale,
      );
      this.logger.debug(`[Phase1 raw] ${content.slice(0, 500)}`);
      const foods = this.resultParser.parse(content);
      if (foods.length > 0) return foods;

      try {
        const retryContent = await this.visionApi.complete(
          systemPrompt,
          imageUrl,
          `${userHint}Important: do not return an empty foods array if any edible item is visible. Return the most likely 1-8 food candidates with lower confidence when uncertain, and reserve an empty array only for clearly non-food images. `,
          userId,
          locale,
        );
        this.logger.debug(`[Phase1 retry raw] ${retryContent.slice(0, 500)}`);
        return this.resultParser.parse(retryContent);
      } catch (retryErr) {
        return foods;
      }
    } catch (err) {
      if (err instanceof LlmQuotaExceededError) {
        throw err;
      }
      if (err instanceof LlmUnavailableError) {
        throw new BadRequestException(this.i18n.t('food.analyze.timeout'));
      }
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI image analysis error: ${(err as Error).message}`);
      throw new BadRequestException(this.i18n.t('food.analyze.timeout'));
    }
  }
}
