/**
 * V2.4 Feedback Reporting Controller
 *
 * 端点：用户提交食物分析反馈，系统记录并生成质量指标
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { AnalysisQualityFeedbackService } from '../../../decision/feedback/quality-feedback.service';
import { UserDecisionFeedback } from '../../../decision/feedback/feedback.types';
import { ResponseWrapper, ApiResponse } from '../../../../common/types/response.type';

@ApiTags('App 食物分析反馈')
@Controller('app/food-analysis')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalysisReportController {
  constructor(
    private readonly feedbackService: AnalysisQualityFeedbackService,
  ) {}

  /**
   * POST /food-analyze/:id/feedback
   *
   * 用户提交对食物决策的反馈
   *
   * @param analysisId 分析ID
   * @param feedback 反馈内容 { decision: 'accepted'|'rejected'|'modified', userNote?: string }
   */
  @Post(':id/feedback')
  @ApiOperation({ summary: '提交饮食分析决策反馈' })
  async submitFeedback(
    @Param('id') analysisId: string,
    @CurrentAppUser() user: AppUserPayload,
    @Body()
    feedback: {
      decision: string;
      userNote?: string;
      issueKeys?: string[];
      originalFoodName?: string;
      selectedAlternative?: string;
      locale?: string;
    },
  ): Promise<ApiResponse> {
    const userFeedback: UserDecisionFeedback = {
      analysisId,
      userId: user.id,
      decision: feedback.decision as 'accepted' | 'rejected' | 'modified',
      userNote: feedback.userNote || '',
      issueKeys: feedback.issueKeys,
      originalFoodName: feedback.originalFoodName,
      selectedAlternative: feedback.selectedAlternative,
      locale: feedback.locale,
      timestamp: new Date(),
    };

    this.feedbackService.recordUserFeedback(userFeedback);

    return ResponseWrapper.success({ analysisId }, '反馈已记录');
  }

  /**
   * GET /food-analyze/quality/stats
   *
   * 获取分析质量统计指标
   */
  @Get('quality/stats')
  @ApiOperation({ summary: '获取饮食分析质量统计' })
  getQualityStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): ApiResponse {
    const metrics = this.feedbackService.getQualityMetrics(
      startDate && endDate
        ? { start: new Date(startDate), end: new Date(endDate) }
        : undefined,
    );
    return ResponseWrapper.success(metrics, '获取成功');
  }

  /**
   * GET /food-analyze/quality/suggestions
   *
   * 获取决策规则改进建议
   */
  @Get('quality/suggestions')
  @ApiOperation({ summary: '获取分析策略优化建议' })
  getPolicySuggestions(): ApiResponse {
    const suggestions = this.feedbackService.suggestPolicyChanges();
    return ResponseWrapper.success(suggestions, '获取成功');
  }

  /**
   * GET /food-analyze/quality/distribution
   *
   * 获取反馈分布
   */
  @Get('quality/distribution')
  @ApiOperation({ summary: '获取反馈分布' })
  getFeedbackDistribution(): ApiResponse {
    const distribution = this.feedbackService.getFeedbackDistribution();
    return ResponseWrapper.success(distribution, '获取成功');
  }
}
