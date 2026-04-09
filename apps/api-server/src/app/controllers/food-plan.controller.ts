import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../guards/app-jwt-auth.guard';
import { CurrentAppUser } from '../decorators/current-app-user.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { DailyPlanService } from '../services/daily-plan.service';

@ApiTags('App 饮食计划')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodPlanController {
  constructor(
    private readonly foodService: FoodService,
    private readonly dailyPlanService: DailyPlanService,
  ) {}

  /**
   * 获取下一餐推荐
   * GET /api/app/food/meal-suggestion
   */
  @Get('meal-suggestion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '获取下一餐推荐' })
  async getMealSuggestion(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const suggestion = await this.foodService.getMealSuggestion(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: suggestion,
    };
  }

  /**
   * 获取今日计划（惰性生成）
   * GET /api/app/food/daily-plan
   */
  @Get('daily-plan')
  @ApiOperation({ summary: '获取今日饮食计划' })
  async getDailyPlan(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const plan = await this.dailyPlanService.getPlan(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: plan,
    };
  }

  /**
   * 触发计划动态调整
   * POST /api/app/food/daily-plan/adjust
   */
  @Post('daily-plan/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '触发饮食计划调整' })
  async adjustDailyPlan(
    @CurrentAppUser() user: any,
    @Body() body: { reason: string },
  ): Promise<ApiResponse> {
    const result = await this.dailyPlanService.adjustPlan(user.id, body.reason);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '计划已调整',
      data: result,
    };
  }

  /**
   * 强制重新生成今日计划（删除缓存后重新推荐）
   * POST /api/app/food/daily-plan/regenerate
   */
  @Post('daily-plan/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '强制重新生成今日饮食计划' })
  async regenerateDailyPlan(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const plan = await this.dailyPlanService.regeneratePlan(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '计划已重新生成',
      data: plan,
    };
  }
}
