import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { NutritionService } from '../services/nutrition.service';
import { CreateFoodRecordDto, QueryRecordsDto } from '../dto/nutrition.dto';

@ApiTags('Nutrition')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/nutrition')
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Post('record')
  @ApiOperation({ summary: '创建饮食记录' })
  createRecord(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFoodRecordDto,
  ) {
    return this.nutritionService.createRecord(userId, dto);
  }

  @Get('records')
  @ApiOperation({ summary: '查询饮食记录' })
  getRecords(
    @CurrentUser('id') userId: string,
    @Query() dto: QueryRecordsDto,
  ) {
    return this.nutritionService.getRecords(userId, dto);
  }

  @Get('summary/today')
  @ApiOperation({ summary: '今日汇总' })
  getTodaySummary(@CurrentUser('id') userId: string) {
    return this.nutritionService.getDailySummary(userId);
  }

  @Get('summary/weekly')
  @ApiOperation({ summary: '本周汇总' })
  getWeeklySummaries(@CurrentUser('id') userId: string) {
    return this.nutritionService.getWeeklySummaries(userId);
  }
}
