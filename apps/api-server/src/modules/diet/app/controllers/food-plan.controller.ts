import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserApiThrottle, AiHeavyThrottle } from '../../../../core/throttle';
import { I18nService } from '../../../../core/i18n';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { RequireFeature } from '../../../subscription/app/decorators/require-feature.decorator';
import { GatedFeature } from '../../../subscription/subscription.types';
import { ApiResponse } from '../../../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { DailyPlanService } from '../services/daily-plan.service';
import { WeeklyPlanService } from '../services/weekly-plan.service';
import { RecommendationEngineService } from '../services/recommendation-engine.service';
import { RecommendationFeedbackService } from '../recommendation/feedback/feedback.service';
import { PreferenceProfileService } from '../recommendation/profile/preference-profile.service';
import { SubstitutionService } from '../recommendation/filter/substitution.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import {
  AdjustPlanDto,
  RegeneratePlanDto,
  SubstitutesQueryDto,
  RecommendationFeedbackDto,
  ExplainWhyNotDto,
} from '../dto/food.dto';
import { UserProfileConstraints } from '../recommendation/types/recommendation.types';

/**
 * 将 Prisma daily_plans 行（snake_case）转换为前端期望的 camelCase 格式
 */
function toDailyPlanResponse(plan: any) {
  if (!plan) return plan;
  return {
    id: plan.id,
    date: plan.date,
    morningPlan: plan.morningPlan ?? null,
    lunchPlan: plan.lunchPlan ?? null,
    dinnerPlan: plan.dinnerPlan ?? null,
    snackPlan: plan.snackPlan ?? null,
    adjustments: plan.adjustments ?? [],
    strategy: plan.strategy ?? null,
    totalBudget: plan.totalBudget ?? null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

@ApiTags('App 饮食计划')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodPlanController {
  constructor(
    private readonly foodService: FoodService,
    private readonly dailyPlanService: DailyPlanService,
    private readonly weeklyPlanService: WeeklyPlanService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly feedbackService: RecommendationFeedbackService,
    private readonly userProfileService: UserProfileService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly substitutionService: SubstitutionService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取下一餐推荐
   * GET /api/app/food/meal-suggestion
   *
   * TODO(P1): 接入 client-context middleware 后，从请求中解析 channel
   * (X-Client-Type / User-Agent) 并透传到 foodService.getMealSuggestion 与
   * precomputeService.{getPrecomputed,savePrecomputed}，激活 channel 维度
   * 差异化推荐与独立缓存。当前所有渠道共享 'unknown' 缓存键。
   */
  @Get('meal-suggestion')
  @UserApiThrottle(10, 60)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '获取下一餐推荐' })
  async getMealSuggestion(
    @CurrentAppUser() user: AppUserPayload,
    @Query('refresh') refresh?: string,
    @Query('_t') timestamp?: string,
  ): Promise<ApiResponse> {
    // FIX: 支持 ?refresh=1 或 ?_t=<timestamp> 强制跳过粘性缓存
    const forceRefresh = !!refresh || !!timestamp;
    const suggestion = await this.foodService.getMealSuggestion(
      user.id,
      forceRefresh,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: suggestion,
    };
  }

  /**
   * 获取今日计划（惰性生成）
   * GET /api/app/food/daily-plan
   */
  @Get('daily-plan')
  @ApiOperation({ summary: '获取今日饮食计划' })
  async getDailyPlan(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const plan = await this.dailyPlanService.getPlan(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: toDailyPlanResponse(plan),
    };
  }

  /**
   * V5 2.4: 获取本周计划（已有日期保留，缺失日期自动生成）
   * GET /api/app/food/weekly-plan
   *
   * 返回包含 7 天的计划摘要和周均营养汇总。
   * 跨天多样性由 WeeklyPlanService 自动保证（V5 2.3 排除集传递）。
   * 仅订阅用户（PRO/PREMIUM）可访问，需具备 WEEKLY_PLAN 权益。
   */
  @Get('weekly-plan')
  @RequireFeature(GatedFeature.WEEKLY_PLAN)
  @UserApiThrottle(5, 60)
  @ApiOperation({ summary: '获取本周饮食计划（需订阅权益）' })
  async getWeeklyPlan(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const weeklyPlan = await this.weeklyPlanService.getWeeklyPlan(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: weeklyPlan,
    };
  }

  /**
   * 触发计划动态调整
   * POST /api/app/food/daily-plan/adjust
   */
  @Post('daily-plan/adjust')
  @AiHeavyThrottle(3, 60)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '触发饮食计划调整' })
  async adjustDailyPlan(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: AdjustPlanDto,
  ): Promise<ApiResponse> {
    const result = await this.dailyPlanService.adjustPlan(
      user.id,
      dto.reason,
      dto.mealType,
    );
    // FIX: adjustPlan 返回 { updatedPlan, adjustmentNote }，需解构后分别传入
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.planAdjusted'),
      data: {
        ...toDailyPlanResponse(
          await this.dailyPlanService.localizePlan(result.updatedPlan, user.id),
        ),
        adjustmentNote: result.adjustmentNote,
      },
    };
  }

  /**
   * 强制重新生成今日计划（删除缓存后重新推荐）
   * POST /api/app/food/daily-plan/regenerate
   */
  @Post('daily-plan/regenerate')
  @AiHeavyThrottle(3, 60)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '强制重新生成今日饮食计划' })
  async regenerateDailyPlan(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: RegeneratePlanDto,
  ): Promise<ApiResponse> {
    const mealType = dto?.mealType;

    // 如果指定了 mealType，仅替换该餐；否则重新生成全部
    const plan = mealType
      ? await this.dailyPlanService.regenerateMeal(user.id, mealType)
      : await this.dailyPlanService.regeneratePlan(user.id);
    const localizedPlan = await this.dailyPlanService.localizePlan(
      plan,
      user.id,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: mealType
        ? this.i18n.t(
            'diet.recommendation.response.replacedMealRecommendation',
            {
              meal: this.i18n.t(`diet.recommendation.meal.label.${mealType}`),
            },
          )
        : this.i18n.t('diet.recommendation.response.planRegenerated'),
      data: toDailyPlanResponse(localizedPlan),
    };
  }

  /**
   * 获取食物替代建议
   * GET /api/app/food/substitutes?foodId=xxx&mealType=lunch
   *
   * 为指定食物返回 Top-5 替代候选，考虑：
   * - 食物相似度（分类/主料/标签）
   * - 营养接近度（热量/蛋白质）
   * - 用户历史替换偏好
   * - 用户偏好画像
   * - 过敏原/饮食限制
   */
  @Get('substitutes')
  @ApiOperation({ summary: '获取食物替代建议' })
  async getSubstitutes(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: SubstitutesQueryDto,
  ): Promise<ApiResponse> {
    // 加载用户画像 + 偏好
    const profile = await this.userProfileService.getProfile(user.id);
    const userConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
          timezone: profile.timezone ?? undefined,
        }
      : undefined;

    const preferenceProfile =
      await this.preferenceProfileService.getUserPreferenceProfile(user.id);

    const substitutes = await this.substitutionService.findSubstitutes(
      query.foodId,
      user.id,
      query.mealType,
      5,
      [],
      userConstraints,
      preferenceProfile,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: substitutes.map((s) => ({
        foodId: s.food.id,
        name: s.food.name,
        category: s.food.category,
        subCategory: s.food.subCategory,
        mainIngredient: s.food.mainIngredient,
        servingDesc:
          s.food.standardServingDesc ||
          `${s.food.standardServingG}g`,
        servingCalories: s.servingCalories,
        servingProtein: s.servingProtein,
        servingFat: s.servingFat,
        servingCarbs: s.servingCarbs,
        substituteScore: Math.round(s.substituteScore * 100) / 100,
        similarity: Math.round(s.similarity * 100) / 100,
        nutritionProximity: Math.round(s.nutritionProximity * 100) / 100,
        historicalCount: s.historicalCount,
        imageUrl: s.food.imageUrl,
        thumbnailUrl: s.food.thumbnailUrl,
      })),
    };
  }

  /**
   * 提交推荐反馈（接受/替换/跳过）
   * POST /api/app/food/recommendation-feedback
   *
   * body:
   *   mealType:  'breakfast' | 'lunch' | 'dinner' | 'snack'
   *   foodName:  推荐的食物名称
   *   foodId?:   食物库ID（可选）
   *   action:    'accepted' | 'replaced' | 'skipped'
   *   replacementFood?: 替换后的食物名（仅 action=replaced 时需要）
   *   recommendationScore?: 推荐时的评分（可选）
   *   goalType?: 用户目标类型（可选，快照）
   */
  @Post('recommendation-feedback')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '提交推荐反馈（接受/替换/跳过）' })
  async submitRecommendationFeedback(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: RecommendationFeedbackDto,
  ): Promise<ApiResponse> {
    await this.feedbackService.submitFeedback({
      userId: user.id,
      mealType: dto.mealType,
      foodName: dto.foodName,
      foodId: dto.foodId,
      action: dto.action,
      replacementFood: dto.replacementFood,
      recommendationScore: dto.recommendationScore,
      goalType: dto.goalType,
      ratings: dto.ratings,
      implicitSignals: dto.implicitSignals,
    });
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('diet.feedbackRecorded'),
      data: null,
    };
  }

  /**
   * V6 2.8: 反向解释 API — "为什么不推荐这个食物？"
   * POST /api/app/food/explain-why-not
   *
   * 对用户指定的食物跑完整评分 + 过滤分析，
   * 返回不推荐的原因 + 替代推荐。
   *
   * body:
   *   foodName:  食物名称（中文或英文）
   *   mealType:  餐次 (breakfast/lunch/dinner/snack)
   */
  @Post('explain-why-not')
  @UserApiThrottle(10, 60)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '反向解释 — 为什么不推荐某食物' })
  async explainWhyNot(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: ExplainWhyNotDto,
  ): Promise<ApiResponse> {
    const result = await this.foodService.explainWhyNot(
      user.id,
      dto.foodName,
      dto.mealType,
      dto.locale || undefined,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.explanationGenerated'),
      data: result,
    };
  }

  /**
   * V6 2.19: 获取用户多维反馈统计
   * GET /api/app/food/feedback-stats
   *
   * 返回按食物分组的多维评分均值（口味/份量/价格/时间适合度）
   * 以及全局聚合统计。
   *
   * query:
   *   days?: 统计窗口天数（默认 30）
   */
  @Get('feedback-stats')
  @UserApiThrottle(20, 60)
  @ApiOperation({ summary: '获取多维反馈统计' })
  async getFeedbackDimensionStats(
    @CurrentAppUser() user: AppUserPayload,
    @Query('days') daysStr?: string,
  ): Promise<ApiResponse> {
    const days = daysStr
      ? Math.min(Math.max(parseInt(daysStr, 10) || 30, 1), 90)
      : 30;
    const [perFood, global] = await Promise.all([
      this.feedbackService.getUserDimensionStats(user.id, days),
      this.feedbackService.getUserGlobalDimensionStats(user.id, days),
    ]);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: { perFood, global, days },
    };
  }
}
