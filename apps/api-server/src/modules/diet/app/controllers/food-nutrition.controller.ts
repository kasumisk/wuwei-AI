import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { FoodRecordService } from '../services/food-record.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { NutritionScoreService } from '../services/nutrition-score.service';
import { BehaviorService } from '../services/behavior.service';
import { SaveUserProfileDto } from '../dto/food.dto';
import { getUserLocalHour } from '../../../../common/utils/timezone.util';

/** P3.1: 评分等级标签（与前端 4 档一致） */
function getStatusLabel(score: number): string {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'fair';
  return 'needs_improvement';
}

/**
 * 将 Prisma user_profiles 行（snake_case）转换为前端期望的 camelCase 格式
 */
function toProfileResponse(p: any) {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    gender: p.gender ?? null,
    birthYear: p.birthYear ?? null,
    heightCm: p.heightCm != null ? Number(p.heightCm) : null,
    weightKg: p.weightKg != null ? Number(p.weightKg) : null,
    targetWeightKg: p.targetWeightKg != null ? Number(p.targetWeightKg) : null,
    bodyFatPercent: p.bodyFatPercent != null ? Number(p.bodyFatPercent) : null,
    activityLevel: p.activityLevel,
    dailyCalorieGoal: p.dailyCalorieGoal ?? null,
    goal: p.goal,
    goalSpeed: p.goalSpeed,
    mealsPerDay: p.mealsPerDay,
    takeoutFrequency: p.takeoutFrequency,
    canCook: p.canCook,
    foodPreferences: p.foodPreferences ?? [],
    dietaryRestrictions: p.dietaryRestrictions ?? [],
    allergens: p.allergens ?? [],
    healthConditions: p.healthConditions ?? [],
    weakTimeSlots: p.weakTimeSlots ?? [],
    bingeTriggers: p.bingeTriggers ?? [],
    discipline: p.discipline,
    onboardingCompleted: p.onboardingCompleted ?? false,
    onboardingStep: p.onboardingStep ?? 0,
    dataCompleteness:
      p.dataCompleteness != null ? Number(p.dataCompleteness) : 0,
    regionCode: p.regionCode ?? 'CN',
    timezone: p.timezone ?? 'Asia/Shanghai',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@ApiTags('App 营养与档案')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodNutritionController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodRecordService: FoodRecordService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly behaviorService: BehaviorService,
  ) {}

  /**
   * 获取今日营养评分详情
   * GET /api/app/food/nutrition-score
   */
  @Get('nutrition-score')
  @ApiOperation({ summary: '获取今日营养评分详情' })
  async getNutritionScore(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const [summary, profile, behaviorProfile] = await Promise.all([
      this.foodService.getTodaySummary(user.id),
      this.userProfileService.getProfile(user.id),
      this.behaviorService.getProfile(user.id),
    ]);

    // V1.5: 预加载配置权重（使 computePersonalizedWeights 可同步读取）
    await this.nutritionScoreService.preloadWeightsConfig();

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);

    // V1.3: 获取用户本地小时数
    const tz = (profile as any)?.timezone || 'Asia/Shanghai';
    const localHour = getUserLocalHour(tz);

    // V1.4: 获取今日原始记录，聚合每餐决策信号
    const todayRecords = await this.foodRecordService.getTodayRecords(
      user.id,
      tz,
    );
    const mealSignals = this.nutritionScoreService.aggregateMealSignals(
      todayRecords,
      Number(profile?.mealsPerDay) || 3,
    );

    // P1.3: 注入真实 stabilityData
    const stabilityData = {
      streakDays: behaviorProfile?.streakDays || 0,
      avgMealsPerDay: summary.mealCount,
      targetMeals: Number(profile?.mealsPerDay) || 3,
      complianceRate: Number(behaviorProfile?.avgComplianceRate) || 0,
    };

    const score = this.nutritionScoreService.calculateScore(
      {
        calories: summary.totalCalories,
        targetCalories: goals.calories,
        protein: summary.totalProtein || 0,
        fat: summary.totalFat || 0,
        carbs: summary.totalCarbs || 0,
        // Phase 1.2: 有记录时用真实值(若缺失用合理中性值3)，无记录时返回0
        // 这样权重分摊逻辑会自动处理零值维度
        foodQuality:
          summary.mealCount > 0
            ? summary.avgQuality > 0
              ? summary.avgQuality
              : 3
            : 0,
        satiety:
          summary.mealCount > 0
            ? summary.avgSatiety > 0
              ? summary.avgSatiety
              : 3
            : 0,
      },
      profile?.goal || 'health',
      stabilityData,
      profile?.healthConditions as string[] | undefined,
      localHour,
      mealSignals,
    );

    const feedback = this.nutritionScoreService.generateFeedback(
      score.highlights,
      profile?.goal || 'health',
    );

    // V1.2: 宏量槽位状态检测
    const intake = {
      calories: summary.totalCalories,
      protein: summary.totalProtein || 0,
      fat: summary.totalFat || 0,
      carbs: summary.totalCarbs || 0,
    };
    const macroSlotStatus = this.nutritionScoreService.computeMacroSlotStatus(
      intake,
      {
        calories: goals.calories,
        protein: goals.protein,
        fat: goals.fat,
        carbs: goals.carbs,
      },
      localHour,
    );

    // V1.2: 结构化问题识别
    const locale: 'zh' | 'en' | 'ja' = (() => {
      const region = (profile as any)?.regionCode || 'CN';
      if (region === 'JP') return 'ja';
      if (region === 'CN' || region === 'TW' || region === 'HK') return 'zh';
      return 'en';
    })();

    const issueHighlights = this.nutritionScoreService.detectIssueHighlights(
      intake,
      {
        calories: goals.calories,
        protein: goals.protein,
        fat: goals.fat,
        carbs: goals.carbs,
      },
      score.breakdown,
      summary.mealCount,
      locale,
      localHour,
    );

    // Phase 1.4: 生成自然语言状态解释（V1.2: 增加 macroSlotStatus 融合 + i18n locale）
    const statusExplanation = this.nutritionScoreService.buildStatusExplanation(
      score.breakdown,
      goals,
      {
        calories: summary.totalCalories,
        targetCalories: goals.calories,
        protein: summary.totalProtein || 0,
        fat: summary.totalFat || 0,
        carbs: summary.totalCarbs || 0,
        foodQuality:
          summary.mealCount > 0
            ? summary.avgQuality > 0
              ? summary.avgQuality
              : 3
            : 0,
        satiety:
          summary.mealCount > 0
            ? summary.avgSatiety > 0
              ? summary.avgSatiety
              : 3
            : 0,
      },
      stabilityData,
      score.decision,
      locale,
      macroSlotStatus,
      localHour,
      mealSignals,
    );

    // Phase 1.5: 增强 response — 状态标签、行为加分、最强/最弱维度、合规对比、状态解释
    const statusLabel = getStatusLabel(score.score);
    const breakdownEntries = Object.entries(score.breakdown) as Array<
      [string, number]
    >;
    const sorted = [...breakdownEntries].sort((a, b) => b[1] - a[1]);
    const topStrength = sorted[0]
      ? { dimension: sorted[0][0], score: Math.round(sorted[0][1]) }
      : undefined;
    const topWeakness = sorted[sorted.length - 1]
      ? {
          dimension: sorted[sorted.length - 1][0],
          score: Math.round(sorted[sorted.length - 1][1]),
        }
      : undefined;

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: {
        totalScore: score.score,
        breakdown: score.breakdown,
        highlights: score.highlights,
        decision: score.decision,
        feedback,
        goals,
        intake: {
          calories: summary.totalCalories,
          protein: summary.totalProtein || 0,
          fat: summary.totalFat || 0,
          carbs: summary.totalCarbs || 0,
        },
        // Phase 1.5: 增强字段 - 状态标签和解释
        statusLabel,
        statusExplanation,
        topStrength,
        topWeakness,
        // 行为加分数据
        behaviorBonus: {
          streakDays: stabilityData.streakDays,
          complianceRate: stabilityData.complianceRate,
          bonusPoints:
            stabilityData.streakDays >= 7
              ? Math.min(5, Math.floor(stabilityData.streakDays / 7) * 1.5)
              : 0,
        },
        // 各宏量合规性对比
        complianceInsight: {
          calorieAdherence:
            goals.calories > 0
              ? Math.round((summary.totalCalories / goals.calories) * 100)
              : 0,
          proteinAdherence:
            goals.protein > 0
              ? Math.round(((summary.totalProtein || 0) / goals.protein) * 100)
              : 0,
          fatAdherence:
            goals.fat > 0
              ? Math.round(((summary.totalFat || 0) / goals.fat) * 100)
              : 0,
          carbsAdherence:
            goals.carbs > 0
              ? Math.round(((summary.totalCarbs || 0) / goals.carbs) * 100)
              : 0,
        },
        // V1.2: 宏量槽位状态
        macroSlotStatus,
        // V1.2: 结构化问题列表
        issueHighlights,
        // V1.4: 每餐决策信号聚合 + 建议符合度
        mealSignals,
        decisionAlignment: this.nutritionScoreService.buildDecisionAlignment(
          mealSignals,
          locale,
          intake,
          {
            calories: goals.calories,
            protein: goals.protein,
            fat: goals.fat,
            carbs: goals.carbs,
          },
        ),
        // V1.5: 当前评分使用的维度权重及来源
        weights: score.weights,
        weightsSource: score.weightsSource,
        // V1.3: 每日进度（分离质量评分与完成度追踪）
        dailyProgress: {
          localHour,
          expectedProgress:
            Math.round(
              this.nutritionScoreService.getExpectedProgress(localHour) * 100,
            ) / 100,
          actualProgress:
            goals.calories > 0
              ? Math.round((summary.totalCalories / goals.calories) * 100) / 100
              : 0,
          isOnTrack:
            goals.calories > 0
              ? summary.totalCalories / goals.calories >=
                this.nutritionScoreService.getExpectedProgress(localHour) * 0.7
              : true,
        },
      },
    };
  }

  /**
   * 获取用户健康档案
   * GET /api/app/food/profile
   */
  @Get('profile')
  @ApiOperation({ summary: '获取用户健康档案' })
  async getProfile(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: toProfileResponse(profile),
    };
  }

  /**
   * 保存/更新用户健康档案
   * PUT /api/app/food/profile
   */
  @Put('profile')
  @ApiOperation({ summary: '保存用户健康档案' })
  async saveProfile(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: SaveUserProfileDto,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.saveProfile(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '保存成功',
      data: toProfileResponse(profile),
    };
  }
}
