import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { NutritionScoreService } from '../services/nutrition-score.service';
import { RecentSummaryQueryDto } from '../dto/food.dto';

@ApiTags('App 饮食汇总')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodSummaryController {
  constructor(
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
  ) {}

  /**
   * 获取今日汇总（已摄入/目标/剩余）
   * GET /api/app/food/summary/today
   */
  @Get('summary/today')
  @ApiOperation({ summary: '获取今日饮食汇总' })
  async getTodaySummary(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const summary = await this.foodService.getTodaySummary(user.id);

    // 补充热量目标和宏量素目标（实时路径返回 0 时补充）
    if (!summary.calorieGoal || !summary.proteinGoal) {
      try {
        const profile = await this.userProfileService.getProfile(user.id);
        const goals = this.nutritionScoreService.calculateDailyGoals(profile);
        if (!summary.calorieGoal) {
          summary.calorieGoal = goals.calories;
          summary.remaining = Math.max(
            0,
            summary.calorieGoal - summary.totalCalories,
          );
        }
        if (!summary.proteinGoal) summary.proteinGoal = goals.protein;
        if (!summary.fatGoal) summary.fatGoal = goals.fat;
        if (!summary.carbsGoal) summary.carbsGoal = goals.carbs;
      } catch {
        // fallback: 只补充热量目标
        if (!summary.calorieGoal) {
          summary.calorieGoal =
            await this.userProfileService.getDailyCalorieGoal(user.id);
          summary.remaining = Math.max(
            0,
            summary.calorieGoal - summary.totalCalories,
          );
        }
      }
    }

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: summary,
    };
  }

  /**
   * 获取最近 N 天汇总（趋势图）
   * GET /api/app/food/summary/recent?days=7
   */
  @Get('summary/recent')
  @ApiOperation({ summary: '获取最近 N 天饮食汇总' })
  async getRecentSummaries(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: RecentSummaryQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.foodService.getRecentSummaries(
      user.id,
      query.days ?? 7,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
