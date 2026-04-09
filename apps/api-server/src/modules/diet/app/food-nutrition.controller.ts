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
import { ApiResponse } from '../../../common/types/response.type';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';
import { SaveUserProfileDto } from './food.dto';

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
  async getNutritionScore(@CurrentAppUser() user: any): Promise<ApiResponse> {
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

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: {
        ...score,
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
  async getProfile(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const profile = await this.userProfileService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: profile,
    };
  }

  /**
   * 保存/更新用户健康档案
   * PUT /api/app/food/profile
   */
  @Put('profile')
  @ApiOperation({ summary: '保存用户健康档案' })
  async saveProfile(
    @CurrentAppUser() user: any,
    @Body() dto: SaveUserProfileDto,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.saveProfile(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '保存成功',
      data: profile,
    };
  }
}
