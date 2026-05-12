/**
 * FoodTextAnalyzeController
 *
 * Phase 7: 文本分析子控制器，从 FoodAnalyzeController 拆分。
 * 路由前缀: app/food
 *
 * 端点：
 * - POST   analyze-text — 文本食物分析（同步，含内存缓存）
 */

import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { TextFoodAnalysisService } from '../services/text-food-analysis.service';
import { AnalyzeTextDto } from '../dto/analyze-text.dto';
import { RefineTextAnalysisDto } from '../dto/refine-text-analysis.dto';
import { AiHeavyThrottle } from '../../../../core/throttle/throttle.constants';
import { QuotaGateService } from '../../../subscription/app/services/quota-gate.service';
import { QuotaService } from '../../../subscription/app/services/quota.service';
import { ResultEntitlementService } from '../../../subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../../subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../../subscription/app/services/subscription.service';
import { GatedFeature } from '../../../subscription/subscription.types';
import { I18nService } from '../../../../core/i18n';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AnalysisSessionService } from '../services/analysis-session.service';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodTextAnalyzeController {
  private readonly logger = new Logger(FoodTextAnalyzeController.name);
  /**
   * In-flight LLM 请求去重表（thundering herd 保护）
   *
   * 当相同 cacheKey 有多个并发 cache miss 时，只发起一次 LLM 调用，
   * 后续相同 key 的请求等待第一个 Promise resolve 即可。
   * 完成后（无论成功或失败）从 Map 中删除，避免内存泄漏。
   */
  private readonly inFlightAnalysis = new Map<string, Promise<any>>();

  constructor(
    private readonly textFoodAnalysisService: TextFoodAnalysisService,
    private readonly quotaGateService: QuotaGateService,
    private readonly quotaService: QuotaService,
    private readonly resultEntitlementService: ResultEntitlementService,
    private readonly paywallTriggerService: PaywallTriggerService,
    private readonly subscriptionService: SubscriptionService,
    private readonly i18n: I18nService,
    private readonly helper: AnalyzeResultHelperService,
    private readonly prisma: PrismaService,
    private readonly analysisSessionService: AnalysisSessionService,
  ) {}

  @Post('analyze-text')
  @HttpCode(HttpStatus.OK)
  @AiHeavyThrottle(100, 60) // 100/min：缓存命中 ~5ms 不应受限；LLM 配额保护由 quotaGateService 负责
  @ApiOperation({ summary: '文本食物 AI 分析' })
  @ApiBody({ type: AnalyzeTextDto })
  async analyzeText(
    @Body() dto: AnalyzeTextDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const startedAt = Date.now();
    let quotaConsumed = false;
    const locale = dto.locale || this.i18n.currentLocale();
    const meta = `userId=${user.id} mealType=${dto.mealType || 'none'} locale=${locale} textLength=${dto.text?.trim().length || 0}`;
    this.logger.log(`[AnalyzeText] start ${meta}`);

    try {
      const summaryStartedAt = Date.now();
      const summary = await this.subscriptionService.getUserSummary(user.id);
      this.logger.log(
        `[AnalyzeText] summary loaded in ${Date.now() - summaryStartedAt}ms ${meta} tier=${summary.tier}`,
      );

      const cacheKey = this.helper.buildTextAnalysisCacheKey(
        dto.text,
        dto.mealType,
        user.id,
        locale,
      );
      const cached = this.helper.getFromTextAnalysisCache(cacheKey);
      if (cached) {
        // 内存缓存命中：直接返回，不再做冗余DB验证（内存缓存10min TTL，结果是新鲜的）
        this.logger.log(
          `[AnalyzeText] cache hit key=${cacheKey} ${meta} ageMs=${Date.now() - startedAt}`,
        );
        await this.helper.localizeAnalysisResult(cached, locale);
        const trimmedResult = this.resultEntitlementService.trimResult(
          cached,
          summary.tier,
          summary.entitlements,
        );
        this.logger.log(
          `[AnalyzeText] cached success total=${Date.now() - startedAt}ms key=${cacheKey} ${meta}`,
        );
        return ResponseWrapper.success(
          trimmedResult,
          this.i18n.t('food.analyzeCompleteCached'),
        );
      }

      this.logger.log(`[AnalyzeText] cache miss key=${cacheKey} ${meta}`);

      const quotaStartedAt = Date.now();
      const access = await this.quotaGateService.checkAccess({
        userId: user.id,
        feature: GatedFeature.AI_TEXT_ANALYSIS,
        scene: 'food_text_analysis',
        consumeQuota: true,
      });
      quotaConsumed = access.allowed && access.quotaConsumed;
      this.logger.log(
        `[AnalyzeText] quota checked in ${Date.now() - quotaStartedAt}ms allowed=${access.allowed} key=${cacheKey} ${meta}`,
      );

      if (!access.allowed) {
        const paywallDisplay =
          await this.paywallTriggerService.handleAccessDecision(
            access,
            user.id,
            GatedFeature.AI_TEXT_ANALYSIS,
            summary.tier,
          );
        const errorMessage =
          access.paywall?.message ?? this.i18n.t('food.textQuotaExceeded');
        this.logger.warn(
          `[AnalyzeText] quota denied total=${Date.now() - startedAt}ms key=${cacheKey} ${meta}`,
        );
        if (paywallDisplay) {
          return ResponseWrapper.error(errorMessage, 403, paywallDisplay);
        }
        return ResponseWrapper.error(errorMessage, 403);
      }

      const analysisStartedAt = Date.now();

      // ── Thundering herd 去重：相同 cacheKey 同时 miss 时只发一次 LLM ──────
      let inFlightPromise = this.inFlightAnalysis.get(cacheKey);
      if (!inFlightPromise) {
        inFlightPromise = this.textFoodAnalysisService
          .analyze(
            dto.text,
            dto.mealType,
            user.id,
            (dto.locale as any) || undefined,
            dto.contextOverride?.localHour,
            dto.hints,
            { awaitPersistence: false },
          )
          .finally(() => {
            this.inFlightAnalysis.delete(cacheKey);
          });
        this.inFlightAnalysis.set(cacheKey, inFlightPromise);
        this.logger.debug(`[AnalyzeText] in-flight registered key=${cacheKey}`);
      } else {
        this.logger.debug(`[AnalyzeText] in-flight coalesced key=${cacheKey}`);
      }
      const fullResult = await inFlightPromise;
      this.logger.log(
        `[AnalyzeText] core analysis finished in ${Date.now() - analysisStartedAt}ms key=${cacheKey} foods=${fullResult.foods?.length || 0} ${meta}`,
      );

      const localizeStartedAt = Date.now();
      await this.helper.localizeAnalysisResult(fullResult, locale);
      this.logger.log(
        `[AnalyzeText] localization finished in ${Date.now() - localizeStartedAt}ms key=${cacheKey} ${meta}`,
      );

      this.helper.setToTextAnalysisCache(cacheKey, fullResult);

      const trimmedResult = this.resultEntitlementService.trimResult(
        fullResult,
        summary.tier,
        summary.entitlements,
      );

      const hiddenFields = trimmedResult.entitlement?.fieldsHidden ?? [];
      if (hiddenFields.length > 0) {
        this.paywallTriggerService
          .recordResultTrimTrigger(user.id, summary.tier, hiddenFields)
          .catch(() => {});
      }

      this.logger.log(
        `[AnalyzeText] success total=${Date.now() - startedAt}ms key=${cacheKey} hiddenFields=${hiddenFields.length} analysisId=${fullResult.analysisId || 'missing'} ${meta}`,
      );

      quotaConsumed = false;

      return ResponseWrapper.success(
        trimmedResult,
        this.i18n.t('food.analyzeComplete'),
      );
    } catch (error) {
      if (quotaConsumed) {
        await this.quotaService
          .rollback(user.id, GatedFeature.AI_TEXT_ANALYSIS)
          .catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[AnalyzeText] failed after ${Date.now() - startedAt}ms ${meta}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @Post('analysis/:analysisId/refine')
  @HttpCode(HttpStatus.OK)
  @AiHeavyThrottle(15, 60)
  @ApiOperation({ summary: '文字分析结果修正并重算完整汇总' })
  @ApiBody({ type: RefineTextAnalysisDto })
  async refineTextAnalysis(
    @Param('analysisId') analysisId: string,
    @Body() dto: RefineTextAnalysisDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const locale = dto.locale || this.i18n.currentLocale();
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: analysisId },
      select: {
        id: true,
        userId: true,
        status: true,
        mealType: true,
      },
    });

    if (!record) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }
    if (record.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionEdit'),
      );
    }
    if (record.status !== 'completed') {
      throw new BadRequestException(this.i18n.t('food.analysisIncomplete'));
    }

    let derivedText: string;
    try {
      derivedText = this.analysisSessionService.buildDerivedText(
        dto.foods,
        dto.userNote,
      );
    } catch (e) {
      throw new BadRequestException(
        (e as Error).message || this.i18n.t('food.correctedListInvalid'),
      );
    }

    const fullResult =
      await this.textFoodAnalysisService.recomputeFromStructuredFoods(
        dto.foods,
        record.mealType ?? undefined,
        user.id,
        (locale as any) || undefined,
        {
          analysisId: record.id,
          persistRecord: false,
          emitCompletedEvent: false,
        },
      );

    const matchedFoodCount = fullResult.foods.filter(
      (food) => !!food.foodLibraryId,
    ).length;

    await this.prisma.foodAnalysisRecords.update({
      where: { id: record.id },
      data: {
        rawText: derivedText,
        mealType: record.mealType ?? null,
        recognizedPayload: {
          terms: dto.foods.map((food) => ({
            name: food.name,
            quantity: `${Math.round(food.estimatedWeightGrams)}克`,
            fromLibrary: false,
          })),
          foods: fullResult.foods,
        } as any,
        normalizedPayload: {
          foods: fullResult.foods,
        } as any,
        nutritionPayload: {
          foods: fullResult.foods,
          totals: fullResult.totals,
          score: fullResult.score,
          analysisState: fullResult.analysisState,
          confidenceDiagnostics: fullResult.confidenceDiagnostics,
        } as any,
        decisionPayload: {
          decision: fullResult.decision,
          alternatives: fullResult.alternatives,
          explanation: fullResult.explanation,
          summary: fullResult.summary,
          evidencePack: fullResult.evidencePack,
          shouldEatAction: fullResult.shouldEatAction,
          structuredDecision: fullResult.structuredDecision,
          foodAnalysisPackage: fullResult.foodAnalysisPackage,
          contextualAnalysis: fullResult.contextualAnalysis,
          unifiedUserContext: fullResult.unifiedUserContext,
          coachActionPlan: fullResult.coachActionPlan,
        } as any,
        confidenceScore: fullResult.score.confidenceScore,
        qualityScore: fullResult.score.healthScore,
        matchedFoodCount,
        candidateFoodCount: fullResult.foods.length - matchedFoodCount,
      },
    });

    await this.helper.localizeAnalysisResult(fullResult, locale);

    const summary = await this.subscriptionService.getUserSummary(user.id);
    const trimmedResult = this.resultEntitlementService.trimResult(
      fullResult,
      summary.tier,
      summary.entitlements,
    );

    return ResponseWrapper.success(
      trimmedResult,
      this.i18n.t('food.refineSuccess'),
    );
  }
}
