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
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
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
import { AiHeavyThrottle } from '../../../../core/throttle/throttle.constants';
import { QuotaGateService } from '../../../subscription/app/services/quota-gate.service';
import { ResultEntitlementService } from '../../../subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../../subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../../subscription/app/services/subscription.service';
import { GatedFeature } from '../../../subscription/subscription.types';
import { I18nService } from '../../../../core/i18n';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodTextAnalyzeController {
  private readonly logger = new Logger(FoodTextAnalyzeController.name);

  constructor(
    private readonly textFoodAnalysisService: TextFoodAnalysisService,
    private readonly quotaGateService: QuotaGateService,
    private readonly resultEntitlementService: ResultEntitlementService,
    private readonly paywallTriggerService: PaywallTriggerService,
    private readonly subscriptionService: SubscriptionService,
    private readonly i18n: I18nService,
    private readonly helper: AnalyzeResultHelperService,
  ) {}

  @Post('analyze-text')
  @HttpCode(HttpStatus.OK)
  @AiHeavyThrottle(15, 60)
  @ApiOperation({ summary: '文本食物 AI 分析' })
  @ApiBody({ type: AnalyzeTextDto })
  async analyzeText(
    @Body() dto: AnalyzeTextDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const startedAt = Date.now();
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
      const fullResult = await this.textFoodAnalysisService.analyze(
        dto.text,
        dto.mealType,
        user.id,
        (dto.locale as any) || undefined,
        dto.contextOverride?.localHour,
        dto.hints,
      );
      this.logger.log(
        `[AnalyzeText] core analysis finished in ${Date.now() - analysisStartedAt}ms key=${cacheKey} foods=${fullResult.foods?.length || 0} ${meta}`,
      );

      const localizeStartedAt = Date.now();
      await this.helper.localizeAnalysisResult(
        fullResult,
        locale,
      );
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
        `[AnalyzeText] success total=${Date.now() - startedAt}ms key=${cacheKey} hiddenFields=${hiddenFields.length} ${meta}`,
      );

      return ResponseWrapper.success(
        trimmedResult,
        this.i18n.t('food.analyzeComplete'),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[AnalyzeText] failed after ${Date.now() - startedAt}ms ${meta}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
