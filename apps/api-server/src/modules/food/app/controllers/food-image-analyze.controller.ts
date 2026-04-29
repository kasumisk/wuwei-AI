/**
 * FoodImageAnalyzeController
 *
 * Phase 7: 图片分析子控制器，从 FoodAnalyzeController 拆分。
 * 路由前缀: app/food
 *
 * 端点：
 * - POST   analyze            — 上传图片提交异步分析
 * - GET    analyze/:requestId — 轮询获取分析结果
 * - POST   analyze/:requestId/refine — 低置信度修正（不扣配额）
 * - GET    analyze-quick/:foodId     — 食物库快捷分析（零 AI 成本）
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { StorageService } from '../../../../storage/storage.service';
import { AnalyzeService } from '../services/analyze.service';
import { TextFoodAnalysisService } from '../services/text-food-analysis.service';
import { AnalysisSessionService } from '../services/analysis-session.service';
import { AnalyzeImageDto } from '../../../diet/app/dto/food.dto';
import { RefineAnalysisDto } from '../dto/refine-analysis.dto';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { UserApiThrottle } from '../../../../core/throttle/throttle.constants';
import { QuotaGateService } from '../../../subscription/app/services/quota-gate.service';
import { ResultEntitlementService } from '../../../subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../../subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../../subscription/app/services/subscription.service';
import { GatedFeature } from '../../../subscription/subscription.types';
import { FoodAnalysisResultV61 } from '../../../decision/types/analysis-result.types';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FOOD_SPLIT_INCLUDE } from '../../food-split.helper';
import { I18nService } from '../../../../core/i18n';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodImageAnalyzeController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly storageService: StorageService,
    private readonly textFoodAnalysisService: TextFoodAnalysisService,
    private readonly quotaGateService: QuotaGateService,
    private readonly resultEntitlementService: ResultEntitlementService,
    private readonly paywallTriggerService: PaywallTriggerService,
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
    private readonly analysisSessionService: AnalysisSessionService,
    private readonly i18n: I18nService,
    private readonly helper: AnalyzeResultHelperService,
  ) {}

  // ─── POST analyze ───

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传食物图片 AI 分析（异步）' })
  async analyzeImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: 'jpeg|png|webp|heic',
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: AnalyzeImageDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const summary = await this.subscriptionService.getUserSummary(user.id);
    const access = await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.AI_IMAGE_ANALYSIS,
      scene: 'food_image_analysis',
      consumeQuota: true,
    });

    if (!access.allowed) {
      const paywallDisplay =
        await this.paywallTriggerService.handleAccessDecision(
          access,
          user.id,
          GatedFeature.AI_IMAGE_ANALYSIS,
          summary.tier,
        );
      const errorMessage =
        access.paywall?.message ?? this.i18n.t('food.imageQuotaExceeded');
      if (paywallDisplay) {
        return ResponseWrapper.error(errorMessage, 403, paywallDisplay);
      }
      return ResponseWrapper.error(errorMessage, 403);
    }

    const uploaded = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'food-images',
    );

    const { requestId } = await this.analyzeService.submitAnalysis(
      uploaded.url,
      dto.mealType,
      user.id,
      (dto.locale as Locale | undefined) || undefined,
    );

    const session = await this.analysisSessionService.createSession({
      userId: user.id,
      requestId,
      mealType: dto.mealType,
      imageUrl: uploaded.url,
    });

    return ResponseWrapper.success(
      {
        requestId,
        analysisSessionId: session.id,
        status: 'processing',
        stage: 'analyzing' as const,
        imageUrl: uploaded.url,
      },
      this.i18n.t('food.analyzeSubmitted'),
    );
  }

  // ─── GET analyze/:requestId ───

  @Get('analyze/:requestId')
  @ApiOperation({ summary: '获取 AI 分析结果（轮询）' })
  @ApiParam({ name: 'requestId', description: '分析任务 ID' })
  async getAnalysisResult(
    @Param('requestId') requestId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const entry = await this.analyzeService.getAnalysisStatus(requestId);

    if (!entry) {
      throw new NotFoundException(this.i18n.t('food.analysisTaskNotFound'));
    }

    if (entry.status === 'processing') {
      return ResponseWrapper.success(
        { requestId, status: 'processing', stage: 'analyzing' as const },
        this.i18n.t('food.analyzeInProgress'),
      );
    }

    if (entry.status === 'failed') {
      return ResponseWrapper.error(
        entry.error || this.i18n.t('food.analyzeFailed'),
        HttpStatus.OK,
        { requestId, status: 'failed', error: entry.error },
      );
    }

    // needs_review 分支（低置信度）
    if (entry.stage === 'needs_review' && entry.needsReview) {
      const nr = entry.needsReview;
      const session = await this.analysisSessionService.getById(
        nr.analysisSessionId,
      );
      if (session && session.userId !== user.id) {
        throw new ForbiddenException(
          this.i18n.t('food.analysisTaskNoPermission'),
        );
      }
      return ResponseWrapper.success(
        {
          requestId,
          analysisSessionId: nr.analysisSessionId,
          status: 'completed',
          stage: 'needs_review' as const,
          confidence: {
            level: nr.confidenceLevel,
            overall: nr.overallConfidence,
            threshold: Number(process.env.CONFIDENCE_HIGH_THRESHOLD ?? 0.75),
            reasons: nr.reasons,
          },
          foods: nr.foods,
          imageUrl: nr.imageUrl,
          expiresAt: nr.expiresAt,
          refineUrl: `/api/app/food/analyze/${requestId}/refine`,
        },
        this.i18n.t('food.analyzeNeedsReview'),
      );
    }

    // completed — 裁剪并返回
    const userSummary = await this.subscriptionService.getUserSummary(user.id);
    const rawData = entry.data;
    if (!rawData) {
      return ResponseWrapper.success(
        { requestId, status: 'completed', result: null },
        this.i18n.t('food.analyzeComplete'),
      );
    }

    const v61ForTrim: FoodAnalysisResultV61 = {
      analysisId: requestId,
      inputType: 'image',
      inputSnapshot: { imageUrl: rawData.imageUrl },
      foods: (rawData.foods || []).map((f) => ({
        name: f.name,
        quantity: f.quantity,
        category: f.category,
        confidence: (f as any).confidence ?? 0.6,
        calories: f.calories,
        protein: f.protein,
        fat: f.fat,
        carbs: f.carbs,
      })),
      totals: {
        calories: rawData.totalCalories,
        protein: rawData.totalProtein,
        fat: rawData.totalFat,
        carbs: rawData.totalCarbs,
      },
      score: {
        healthScore: rawData.nutritionScore || 50,
        nutritionScore: rawData.nutritionScore || 50,
        confidenceScore: 60,
      },
      decision: {
        recommendation:
          rawData.decision === 'SAFE' || rawData.decision === 'OK'
            ? 'recommend'
            : rawData.decision === 'AVOID'
              ? 'avoid'
              : 'caution',
        shouldEat: rawData.decision !== 'AVOID',
        reason: rawData.reason || rawData.advice,
        riskLevel: rawData.riskLevel?.includes('🔴')
          ? 'high'
          : rawData.riskLevel?.includes('🟡') ||
              rawData.riskLevel?.includes('🟠')
            ? 'medium'
            : 'low',
      },
      alternatives: (rawData.insteadOptions || []).map((name) => ({
        name,
        reason: this.i18n.t('food.betterForCurrentGoal'),
      })),
      explanation: {
        summary: rawData.advice || rawData.contextComment || '',
        primaryReason: rawData.reason,
        userContextImpact: rawData.contextComment
          ? [rawData.contextComment]
          : undefined,
      },
      ingestion: {
        matchedExistingFoods: false,
        shouldPersistCandidate: false,
        reviewRequired: false,
      },
      entitlement: { tier: userSummary.tier as any, fieldsHidden: [] },
    };

    await this.helper.localizeAnalysisResult(
      v61ForTrim,
      this.i18n.currentLocale(),
    );

    const trimmedResult = this.resultEntitlementService.trimResult(
      v61ForTrim,
      userSummary.tier,
      userSummary.entitlements,
    );

    const hiddenFields = trimmedResult.entitlement?.fieldsHidden ?? [];
    if (hiddenFields.length > 0) {
      this.paywallTriggerService
        .recordResultTrimTrigger(user.id, userSummary.tier, hiddenFields)
        .catch(() => {});
    }

    const linkedSession =
      await this.analysisSessionService.getByRequestId(requestId);

    return ResponseWrapper.success(
      {
        requestId,
        analysisId: entry.analysisId ?? requestId,
        analysisSessionId: linkedSession?.id,
        status: 'completed',
        stage: 'final' as const,
        confidence: linkedSession?.imagePhase
          ? {
              level: linkedSession.imagePhase.confidenceLevel,
              overall: linkedSession.imagePhase.overallConfidence,
              threshold: Number(process.env.CONFIDENCE_HIGH_THRESHOLD ?? 0.75),
              source: 'vision' as const,
            }
          : undefined,
        result: trimmedResult,
      },
      this.i18n.t('food.analyzeComplete'),
    );
  }

  // ─── POST analyze/:requestId/refine ───

  @Post('analyze/:requestId/refine')
  @HttpCode(HttpStatus.OK)
  @UserApiThrottle(10, 60)
  @ApiOperation({ summary: '低置信度分析结果修正（不扣配额）' })
  @ApiParam({ name: 'requestId', description: '首次图片分析 requestId' })
  @ApiBody({ type: RefineAnalysisDto })
  async refineAnalysis(
    @Param('requestId') requestId: string,
    @Body() dto: RefineAnalysisDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const session = await this.analysisSessionService.getByRequestId(requestId);
    if (!session) {
      throw new NotFoundException(this.i18n.t('food.analysisTaskNotFound'));
    }
    if (session.id !== dto.analysisSessionId) {
      throw new BadRequestException(this.i18n.t('food.sessionMismatch'));
    }

    try {
      await this.analysisSessionService.assertRefineable(session.id, user.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SESSION_FORBIDDEN') {
        throw new ForbiddenException(
          this.i18n.t('food.analysisTaskCorrectNoPermission'),
        );
      }
      if (code === 'SESSION_EXPIRED') {
        return ResponseWrapper.error(this.i18n.t('food.sessionExpired'), 410);
      }
      if (code === 'SESSION_WRONG_STATUS') {
        return ResponseWrapper.error(
          this.i18n.t('food.sessionWrongStatus'),
          409,
        );
      }
      throw err;
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
    if (!derivedText) {
      throw new BadRequestException(this.i18n.t('food.correctedListInvalid'));
    }

    const fullResult = await this.textFoodAnalysisService.analyze(
      derivedText,
      session.mealType,
      user.id,
    );

    await this.helper.localizeAnalysisResult(
      fullResult,
      this.i18n.currentLocale(),
    );

    const summary = await this.subscriptionService.getUserSummary(user.id);
    const trimmedResult = this.resultEntitlementService.trimResult(
      fullResult,
      summary.tier,
      summary.entitlements,
    );

    await this.analysisSessionService.markFinalized(session.id, {
      refinePhase: {
        submittedAt: new Date().toISOString(),
        refinedFoods: dto.foods,
        derivedText,
      },
    });

    return ResponseWrapper.success(
      {
        requestId,
        analysisSessionId: session.id,
        status: 'completed',
        stage: 'final' as const,
        confidence: {
          level: 'high' as const,
          source: 'user_refined' as const,
        },
        result: trimmedResult,
        quotaConsumed: false,
      },
      this.i18n.t('food.refineSuccess'),
    );
  }

  // ─── GET analyze-quick/:foodId ───

  @Get('analyze-quick/:foodId')
  @UserApiThrottle(60, 60)
  @ApiOperation({ summary: '按食物ID快捷分析（零AI成本）' })
  @ApiParam({ name: 'foodId', description: '食物库 ID' })
  async analyzeQuickByFoodId(
    @Param('foodId') foodId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const food = await this.prisma.food.findUnique({
      where: { id: foodId },
      include: FOOD_SPLIT_INCLUDE,
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFound'));
    }

    const summary = await this.subscriptionService.getUserSummary(user.id);

    const calories = Number(food.calories) || 0;
    const protein = Number(food.protein) || 0;
    const fat = Number(food.fat) || 0;
    const carbs = Number(food.carbs) || 0;
    const fiber = Number(food.fiber) || 0;
    const sodium = Number((food as any).sodium) || 0;
    const confidence = Number(food.confidence) || 50;

    const qualityScore =
      Number(
        (food as any).healthAssessment?.qualityScore ??
          (food as any).qualityScore,
      ) || 50;
    const nutrientDensity =
      Number(
        (food as any).healthAssessment?.nutrientDensity ??
          (food as any).nutrientDensity,
      ) || 50;
    const healthScore = Math.round((qualityScore + nutrientDensity) / 2);

    const recommendation: 'recommend' | 'caution' | 'avoid' =
      qualityScore >= 70
        ? 'recommend'
        : qualityScore >= 40
          ? 'caution'
          : 'avoid';
    const shouldEat = recommendation !== 'avoid';
    const riskLevel: 'low' | 'medium' | 'high' =
      qualityScore >= 70 ? 'low' : qualityScore >= 40 ? 'medium' : 'high';

    const analysisId = `quick-${foodId}`;
    const pg = (food as any).portionGuide;
    const servingDesc =
      pg?.standardServingDesc || `${pg?.standardServingG || 100}g`;

    const v61: FoodAnalysisResultV61 = {
      analysisId,
      inputType: 'text',
      inputSnapshot: { rawText: food.name },
      foods: [
        {
          name: food.name,
          foodLibraryId: food.id,
          quantity: servingDesc,
          standardServingDesc: servingDesc,
          estimatedWeightGrams: Number(pg?.standardServingG) || 100,
          category: food.category || undefined,
          confidence: confidence / 100,
          calories,
          protein,
          fat,
          carbs,
          fiber: fiber || undefined,
          sodium: sodium || undefined,
        },
      ],
      totals: { calories, protein, fat, carbs, fiber, sodium },
      score: {
        healthScore,
        nutritionScore: qualityScore,
        confidenceScore: confidence,
      },
      decision: {
        recommendation,
        shouldEat,
        reason: this.buildQuickAnalysisReason(food),
        riskLevel,
      },
      alternatives: [],
      explanation: {
        summary: this.i18n.t('food.quickSummaryTemplate', {
          name: food.name,
          servingDesc,
          calories,
          protein,
        }),
      },
      ingestion: {
        matchedExistingFoods: true,
        shouldPersistCandidate: false,
        reviewRequired: false,
      },
      entitlement: { tier: summary.tier, fieldsHidden: [] },
    };

    await this.helper.localizeAnalysisResult(v61, this.i18n.currentLocale());

    const trimmedResult = this.resultEntitlementService.trimResult(
      v61,
      summary.tier,
      summary.entitlements,
    );

    return ResponseWrapper.success(
      trimmedResult,
      this.i18n.t('food.analyzeQuickComplete'),
    );
  }

  private buildQuickAnalysisReason(food: any): string {
    const parts: string[] = [];
    const qualityScore = Number(food.qualityScore) || 0;
    if (qualityScore >= 70) {
      parts.push(this.i18n.t('food.quickReason.qualityGood'));
    }
    if (food.isFried) {
      parts.push(this.i18n.t('food.quickReason.friedControl'));
    }
    if (Number(food.processingLevel) >= 3) {
      parts.push(this.i18n.t('food.quickReason.highProcessing'));
    }
    const protein = Number(food.protein) || 0;
    const calories = Number(food.calories) || 1;
    if (protein / calories > 0.08) {
      parts.push(this.i18n.t('food.quickReason.highProtein'));
    }
    if (Number(food.fiber) >= 3) {
      parts.push(this.i18n.t('food.quickReason.highFiber'));
    }
    return parts.length > 0
      ? parts.join(this.i18n.t('food.quickReason.separator'))
      : this.i18n.t('food.quickReason.moderate');
  }
}
