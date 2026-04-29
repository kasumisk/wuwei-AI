/**
 * FoodAnalysisHistoryController
 *
 * Phase 7: 历史记录子控制器，从 FoodAnalyzeController 拆分。
 * 路由前缀: app/food
 *
 * 端点：
 * - GET    analysis/history          — 获取分析历史列表（分级限制）
 * - GET    analysis/:analysisId      — 获取分析详情（按订阅裁剪）
 * - DELETE analysis/:analysisId      — 删除分析记录
 */

import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { UserApiThrottle } from '../../../../core/throttle/throttle.constants';
import { QuotaGateService } from '../../../subscription/app/services/quota-gate.service';
import { ResultEntitlementService } from '../../../subscription/app/services/result-entitlement.service';
import { SubscriptionService } from '../../../subscription/app/services/subscription.service';
import { PaywallTriggerService } from '../../../subscription/app/services/paywall-trigger.service';
import {
  GatedFeature,
  SubscriptionTier,
} from '../../../subscription/subscription.types';
import { AnalysisRecordStatus } from '../../food.types';
import { FoodAnalysisResultV61 } from '../../../decision/types/analysis-result.types';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { translateEnum } from '../../../../common/i18n/enum-i18n';
import { AlternativeSuggestionService } from '../../../decision/decision/alternative-suggestion.service';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { FoodI18nService } from '../../../diet/app/services/food-i18n.service';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalysisHistoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly quotaGateService: QuotaGateService,
    private readonly resultEntitlementService: ResultEntitlementService,
    private readonly paywallTriggerService: PaywallTriggerService,
    private readonly i18n: I18nService,
    private readonly alternativeSuggestionService: AlternativeSuggestionService,
    private readonly foodI18nService: FoodI18nService,
    private readonly helper: AnalyzeResultHelperService,
  ) {}

  // ─── GET analysis/history ───

  @Get('analysis/history')
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '获取分析历史列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'inputType', required: false, enum: ['text', 'image'] })
  async getAnalysisHistory(
    @CurrentAppUser() user: AppUserPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('inputType') inputType?: 'text' | 'image',
  ): Promise<ApiResponse> {
    const summary = await this.subscriptionService.getUserSummary(user.id);

    await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.ANALYSIS_HISTORY,
      consumeQuota: false,
    });

    const historyLimit =
      summary.entitlements?.[GatedFeature.ANALYSIS_HISTORY] ?? 3;
    const isUnlimited = historyLimit >= 999999;

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const size = Math.min(
      50,
      Math.max(1, parseInt(pageSize || '20', 10) || 20),
    );
    const skip = (pageNum - 1) * size;

    const where: any = {
      userId: user.id,
      status: AnalysisRecordStatus.COMPLETED,
    };
    if (inputType) {
      where.inputType = inputType;
    }

    let items: any[];
    let total: number;

    if (!isUnlimited) {
      items = await this.prisma.foodAnalysisRecords.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: historyLimit,
      });
      total = historyLimit;
    } else {
      [items, total] = await Promise.all([
        this.prisma.foodAnalysisRecords.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: size,
        }),
        this.prisma.foodAnalysisRecords.count({ where }),
      ]);
    }

    const locale = this.i18n.currentLocale();
    const summaries = await Promise.all(
      items.map((r) => this.extractHistorySummary(r, locale)),
    );

    const list = items.map((r, index) => ({
      analysisId: r.id,
      inputType: r.inputType,
      mealType: r.mealType,
      mealTypeLabel: translateEnum('mealType', r.mealType, locale),
      status: r.status,
      confidenceScore: r.confidenceScore,
      qualityScore: r.qualityScore,
      persistStatus: r.persistStatus,
      createdAt: r.createdAt,
      summary: summaries[index],
    }));

    const paywallHint = !isUnlimited
      ? {
          limitedTo: historyLimit,
          message: this.i18n.t('food.freeTierHistoryLimit', {
            limit: historyLimit,
          }),
          recommendedTier: SubscriptionTier.PRO,
        }
      : null;

    return ResponseWrapper.success({
      items: list,
      total: isUnlimited ? total : historyLimit,
      page: isUnlimited ? pageNum : 1,
      pageSize: isUnlimited ? size : historyLimit,
      paywallHint,
    });
  }

  // ─── GET analysis/:analysisId ───

  @Get('analysis/:analysisId')
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '获取分析详情' })
  @ApiParam({ name: 'analysisId', description: '分析记录 ID' })
  async getAnalysisDetail(
    @Param('analysisId') analysisId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: analysisId },
    });

    if (!record) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }
    if (record.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionView'),
      );
    }

    const summary = await this.subscriptionService.getUserSummary(user.id);
    const fullResult = this.helper.reconstructAnalysisResult(record);
    const locale = this.i18n.currentLocale();

    await this.helper.localizeAnalysisResult(fullResult, locale);

    if (fullResult.alternatives?.length) {
      await this.alternativeSuggestionService.localizeAlternatives(
        fullResult.alternatives,
        locale as Locale,
      );
    }

    const v61: FoodAnalysisResultV61 = {
      analysisId: record.id,
      inputType: record.inputType as 'text' | 'image',
      inputSnapshot: {
        rawText: record.rawText ?? undefined,
        imageUrl: record.imageUrl ?? undefined,
        mealType: record.mealType as
          | 'breakfast'
          | 'lunch'
          | 'dinner'
          | 'snack'
          | undefined,
      },
      foods: fullResult.foods ?? [],
      totals: fullResult.totals ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      },
      score: fullResult.score ?? {
        healthScore: 0,
        nutritionScore: 0,
        confidenceScore: record.confidenceScore
          ? Number(record.confidenceScore)
          : 0,
      },
      decision: fullResult.decision ?? {
        recommendation: 'caution',
        shouldEat: true,
        reason: '',
        riskLevel: 'medium',
      },
      alternatives: fullResult.alternatives ?? [],
      explanation: fullResult.explanation ?? { summary: '' },
      summary: fullResult.summary,
      analysisState: fullResult.analysisState,
      confidenceDiagnostics: fullResult.confidenceDiagnostics,
      evidencePack: fullResult.evidencePack,
      shouldEatAction: fullResult.shouldEatAction,
      foodAnalysisPackage: fullResult.foodAnalysisPackage,
      structuredDecision: fullResult.structuredDecision,
      contextualAnalysis: fullResult.contextualAnalysis,
      unifiedUserContext: fullResult.unifiedUserContext,
      coachActionPlan: fullResult.coachActionPlan,
      entitlement: {
        tier: summary.tier,
        fieldsHidden: [],
      },
    };

    const trimmedResult = this.resultEntitlementService.trimResult(
      v61,
      summary.tier,
      summary.entitlements,
    );

    const detail = {
      ...trimmedResult,
      meta: {
        qualityScore: record.qualityScore,
        persistStatus: record.persistStatus,
        matchedFoodCount: record.matchedFoodCount,
        candidateFoodCount: record.candidateFoodCount,
        createdAt: record.createdAt,
        mealTypeLabel: translateEnum('mealType', record.mealType, locale),
      },
    };

    return ResponseWrapper.success(detail);
  }

  // ─── DELETE analysis/:analysisId ───

  @Delete('analysis/:analysisId')
  @UserApiThrottle(20, 60)
  @ApiOperation({ summary: '删除分析记录' })
  @ApiParam({ name: 'analysisId', description: '分析记录 ID' })
  async deleteAnalysis(
    @Param('analysisId') analysisId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: analysisId },
      select: { id: true, userId: true },
    });

    if (!record) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }
    if (record.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionDelete'),
      );
    }

    await this.prisma.foodAnalysisRecords.delete({
      where: { id: analysisId },
    });

    return ResponseWrapper.success(
      null,
      this.i18n.t('food.analyzeRecordDeleted'),
    );
  }

  // ─── 私有辅助 ───

  private async extractHistorySummary(
    record: any,
    locale: string,
  ): Promise<{
    foodNames: string[];
    totalCalories: number;
    recommendation?: string;
  }> {
    const recognized = record.recognizedPayload as Record<
      string,
      unknown
    > | null;
    const nutrition = record.nutritionPayload as Record<string, unknown> | null;
    const decision = record.decisionPayload as Record<string, unknown> | null;

    const foods = (recognized?.foods ?? nutrition?.foods ?? []) as Array<{
      name?: string;
    }>;
    let foodNames = foods
      .map((f) => f.name)
      .filter((n): n is string => !!n)
      .slice(0, 5);

    if (foodNames.length > 0) {
      const translated =
        await this.foodI18nService.loadTranslationsByFoodNames(
          foodNames,
          locale,
        );
      foodNames = foodNames.map((name) => translated.get(name) ?? name);
    }

    const totals = nutrition?.totals as { calories?: number } | undefined;
    const totalCalories = totals?.calories ?? 0;
    const dec = decision?.decision as { recommendation?: string } | undefined;
    const recommendation = dec?.recommendation;

    return { foodNames, totalCalories, recommendation };
  }
}
