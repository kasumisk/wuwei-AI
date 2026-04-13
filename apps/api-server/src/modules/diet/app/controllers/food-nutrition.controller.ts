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
import { SaveUserProfileDto } from '../dto/food.dto';

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
    targetWeightKg:
      p.targetWeightKg != null ? Number(p.targetWeightKg) : null,
    bodyFatPercent:
      p.bodyFatPercent != null ? Number(p.bodyFatPercent) : null,
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
