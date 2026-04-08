import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { MealPlanService } from '../services/meal-plan.service';

@ApiTags('Meal Plan')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/meal-plan')
export class MealPlanController {
  constructor(private readonly mealPlanService: MealPlanService) {}

  @Get('today')
  @ApiOperation({ summary: '获取今日餐计划' })
  getTodayPlan(@CurrentUser('id') userId: string) {
    return this.mealPlanService.getTodayPlan(userId);
  }

  @Post('generate')
  @ApiOperation({ summary: '生成餐计划' })
  generatePlan(@CurrentUser('id') userId: string) {
    return this.mealPlanService.generatePlan(userId);
  }

  @Post('adjust')
  @ApiOperation({ summary: '调整餐计划' })
  adjustPlan(
    @CurrentUser('id') userId: string,
    @Body() body: { reason: string; changes: any },
  ) {
    return this.mealPlanService.adjustPlan(userId, body);
  }
}
