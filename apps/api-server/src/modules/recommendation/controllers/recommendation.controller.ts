import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { RecommendationService } from '../services/recommendation.service';
import { GetRecommendationDto, SubmitFeedbackDto } from '../dto/recommendation.dto';

@ApiTags('Recommendation')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get()
  @ApiOperation({ summary: '获取食物推荐' })
  getRecommendation(
    @CurrentUser('id') userId: string,
    @Query() dto: GetRecommendationDto,
  ) {
    return this.recommendationService.recommend(userId, dto.mealType, dto.topN);
  }

  @Post('feedback')
  @ApiOperation({ summary: '提交推荐反馈' })
  submitFeedback(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitFeedbackDto,
  ) {
    return this.recommendationService.submitFeedback(userId, dto);
  }
}
