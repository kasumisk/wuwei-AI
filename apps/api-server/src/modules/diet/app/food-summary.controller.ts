import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';

@ApiTags('App 饮食汇总')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodSummaryController {
  constructor(
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
  ) {}

  /**
   * 获取今日汇总（已摄入/目标/剩余）
   * GET /api/app/food/summary/today
   */
  @Get('summary/today')
  @ApiOperation({ summary: '获取今日饮食汇总' })
  async getTodaySummary(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const summary = await this.foodService.getTodaySummary(user.id);

    // 补充热量目标
    if (!summary.calorieGoal) {
      summary.calorieGoal = await this.userProfileService.getDailyCalorieGoal(
        user.id,
      );
      summary.remaining = Math.max(
        0,
        summary.calorieGoal - summary.totalCalories,
      );
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
    @CurrentAppUser() user: any,
    @Query('days') days?: string,
  ): Promise<ApiResponse> {
    const data = await this.foodService.getRecentSummaries(
      user.id,
      days ? parseInt(days, 10) : 7,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
