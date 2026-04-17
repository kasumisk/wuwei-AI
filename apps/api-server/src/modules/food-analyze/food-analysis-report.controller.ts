/**
 * V2.4 Feedback Reporting Controller
 * 
 * 端点：用户提交食物分析反馈，系统记录并生成质量指标
 */

import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AnalysisQualityFeedbackService } from '../decision/feedback/quality-feedback.service';
import { UserDecisionFeedback } from '../decision/feedback/feedback.types';

@Controller('food-analyze')
export class FoodAnalysisReportController {
  constructor(private readonly feedbackService: AnalysisQualityFeedbackService) {}

  /**
   * POST /food-analyze/:id/feedback
   * 
   * 用户提交对食物决策的反馈
   * 
   * @param analysisId 分析ID
   * @param feedback 反馈内容 { decision: 'accepted'|'rejected'|'modified', userNote?: string }
   */
  @Post(':id/feedback')
  async submitFeedback(
    @Param('id') analysisId: string,
    @Body() feedback: { decision: string; userNote?: string },
  ) {
    const userFeedback: UserDecisionFeedback = {
      analysisId,
      userId: 'current_user', // 从JWT中提取，此处占位符
      decision: feedback.decision as 'accepted' | 'rejected' | 'modified',
      userNote: feedback.userNote || '',
      timestamp: new Date(),
    };

    this.feedbackService.recordUserFeedback(userFeedback);

    return {
      success: true,
      message: '反馈已记录',
      analysisId,
    };
  }

  /**
   * GET /food-analyze/quality/stats
   * 
   * 获取分析质量统计指标
   */
  @Post('quality/stats')
  getQualityStats() {
    const metrics = this.feedbackService.getQualityMetrics();
    return {
      success: true,
      data: metrics,
    };
  }

  /**
   * GET /food-analyze/quality/suggestions
   * 
   * 获取决策规则改进建议
   */
  @Post('quality/suggestions')
  getPolicySuggestions() {
    const suggestions = this.feedbackService.suggestPolicyChanges();
    return {
      success: true,
      data: suggestions,
    };
  }

  /**
   * GET /food-analyze/quality/distribution
   * 
   * 获取反馈分布
   */
  @Post('quality/distribution')
  getFeedbackDistribution() {
    const distribution = this.feedbackService.getFeedbackDistribution();
    return {
      success: true,
      data: distribution,
    };
  }
}
