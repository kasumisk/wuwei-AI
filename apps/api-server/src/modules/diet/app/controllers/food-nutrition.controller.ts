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
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { NutritionScoreService } from '../services/nutrition-score.service';
import { BehaviorService } from '../services/behavior.service';
import { SaveUserProfileDto } from '../dto/food.dto';

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

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);

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
        // P1.2: 有记录时用真实值，无记录不虚高
        foodQuality: summary.mealCount > 0 ? summary.avgQuality || 3 : 0,
        satiety: summary.mealCount > 0 ? summary.avgSatiety || 3 : 0,
      },
      profile?.goal || 'health',
      stabilityData,
      profile?.healthConditions as string[] | undefined,
    );

    const feedback = this.nutritionScoreService.generateFeedback(
      score.highlights,
      profile?.goal || 'health',
    );

    // P3.1: 增强 response — 状态标签、行为加分、最强/最弱维度、合规对比
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
        // P3 新增字段（向后兼容，前端可选消费）
        statusLabel,
        topStrength,
        topWeakness,
        behaviorBonus: {
          streakDays: stabilityData.streakDays,
          complianceRate: stabilityData.complianceRate,
          bonusPoints:
            stabilityData.streakDays >= 7
              ? Math.min(5, Math.floor(stabilityData.streakDays / 7) * 1.5)
              : 0,
        },
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
