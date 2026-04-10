import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';
import { SaveUserProfileDto } from './food.dto';

/**
 * 将 Prisma user_profiles 行（snake_case）转换为前端期望的 camelCase 格式
 */
function toProfileResponse(p: any) {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.user_id,
    gender: p.gender ?? null,
    birthYear: p.birth_year ?? null,
    heightCm: p.height_cm != null ? Number(p.height_cm) : null,
    weightKg: p.weight_kg != null ? Number(p.weight_kg) : null,
    targetWeightKg:
      p.target_weight_kg != null ? Number(p.target_weight_kg) : null,
    bodyFatPercent:
      p.body_fat_percent != null ? Number(p.body_fat_percent) : null,
    activityLevel: p.activity_level,
    dailyCalorieGoal: p.daily_calorie_goal ?? null,
    goal: p.goal,
    goalSpeed: p.goal_speed,
    mealsPerDay: p.meals_per_day,
    takeoutFrequency: p.takeout_frequency,
    canCook: p.can_cook,
    foodPreferences: p.food_preferences ?? [],
    dietaryRestrictions: p.dietary_restrictions ?? [],
    allergens: p.allergens ?? [],
    healthConditions: p.health_conditions ?? [],
    weakTimeSlots: p.weak_time_slots ?? [],
    bingeTriggers: p.binge_triggers ?? [],
    discipline: p.discipline,
    onboardingCompleted: p.onboarding_completed ?? false,
    onboardingStep: p.onboarding_step ?? 0,
    dataCompleteness:
      p.data_completeness != null ? Number(p.data_completeness) : 0,
    regionCode: p.region_code ?? 'CN',
    timezone: p.timezone ?? 'Asia/Shanghai',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
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
    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(user.id),
      this.userProfileService.getProfile(user.id),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const score = this.nutritionScoreService.calculateScore(
      {
        calories: summary.totalCalories,
        targetCalories: goals.calories,
        protein: summary.totalProtein || 0,
        fat: summary.totalFat || 0,
        carbs: summary.totalCarbs || 0,
        foodQuality: summary.avgQuality || 3,
        satiety: summary.avgSatiety || 3,
      },
      profile?.goal || 'health',
    );

    const feedback = this.nutritionScoreService.generateFeedback(
      score.highlights,
      profile?.goal || 'health',
    );

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
