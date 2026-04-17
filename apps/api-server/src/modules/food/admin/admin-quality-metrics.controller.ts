/**
 * V2.4 Admin Quality Metrics Controller
 *
 * 端点：管理员查看分析质量仪表板、决策规则改进建议、反馈分析
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { AnalysisQualityFeedbackService } from '../../decision/feedback/quality-feedback.service';

@ApiTags('管理后台 - 决策质量')
@Controller('admin/analysis')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class AdminQualityMetricsController {
  constructor(
    private readonly feedbackService: AnalysisQualityFeedbackService,
  ) {}

  /**
   * GET /admin/analysis/quality-metrics
   *
   * 获取分析质量指标总览
   */
  @Get('quality-metrics')
  @ApiOperation({ summary: '获取决策质量总览' })
  getQualityMetricsOverview(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const dateRange =
      startDate && endDate
        ? {
            start: new Date(startDate),
            end: new Date(endDate),
          }
        : undefined;

    const metrics = this.feedbackService.getQualityMetrics(dateRange);

    return {
      success: true,
      timestamp: new Date(),
      data: {
        // 核心指标
        totalAnalyses: metrics.totalAnalyses,
        acceptanceRate: `${metrics.acceptanceRate.toFixed(2)}%`,
        acceptedCount: metrics.acceptedCount,
        rejectedCount: metrics.rejectedCount,
        dateRange: metrics.dateRange,

        // 问题分布
        topIssues: (
          Object.entries(metrics.issueBreakdown) as Array<[string, number]>
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([issue, count]) => ({
            issue,
            count,
            percentage: `${((count / metrics.totalAnalyses) * 100).toFixed(1)}%`,
          })),

        // 常见替代
        commonAlternatives: (metrics.commonAlternatives || []).slice(0, 5),
      },
    };
  }

  /**
   * GET /admin/analysis/policy-suggestions
   *
   * 获取决策规则改进建议
   */
  @Get('policy-suggestions')
  @ApiOperation({ summary: '获取策略优化建议' })
  getPolicySuggestions() {
    const suggestions = this.feedbackService.suggestPolicyChanges();

    return {
      success: true,
      timestamp: new Date(),
      data: {
        totalSuggestions: suggestions.length,
        highImpact: suggestions.filter((s) => s.impact === 'high'),
        mediumImpact: suggestions.filter((s) => s.impact === 'medium'),
        lowImpact: suggestions.filter((s) => s.impact === 'low'),
        suggestions,
      },
    };
  }

  /**
   * GET /admin/analysis/feedback-distribution
   *
   * 获取用户反馈分布
   */
  @Get('feedback-distribution')
  @ApiOperation({ summary: '获取反馈分布' })
  getFeedbackDistribution() {
    const distribution = this.feedbackService.getFeedbackDistribution();
    const total =
      distribution.accepted + distribution.rejected + distribution.modified;
    const safePercent = (count: number) =>
      total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0.0%';

    return {
      success: true,
      timestamp: new Date(),
      data: {
        total,
        breakdown: {
          accepted: {
            count: distribution.accepted,
            percentage: safePercent(distribution.accepted),
          },
          rejected: {
            count: distribution.rejected,
            percentage: safePercent(distribution.rejected),
          },
          modified: {
            count: distribution.modified,
            percentage: safePercent(distribution.modified),
          },
        },
      },
    };
  }

  /**
   * GET /admin/analysis/health-check
   *
   * 系统健康检查：验证决策质量是否在预期范围内
   */
  @Get('health-check')
  @ApiOperation({ summary: '获取决策质量健康检查' })
  getHealthCheck() {
    const metrics = this.feedbackService.getQualityMetrics();
    const suggestions = this.feedbackService.suggestPolicyChanges();

    const healthStatus = {
      isHealthy: metrics.acceptanceRate >= 70 && suggestions.length === 0,
      acceptanceRateOK: metrics.acceptanceRate >= 70,
      hasPolicySuggestions: suggestions.length > 0,
      acceptanceRate: `${metrics.acceptanceRate.toFixed(2)}%`,
      suggestionsCount: suggestions.length,
      recommendations: [] as string[],
    };

    if (metrics.acceptanceRate < 70) {
      healthStatus.recommendations.push(
        'Acceptance rate below threshold, review decision rules',
      );
    }

    if (suggestions.length > 0) {
      healthStatus.recommendations.push(
        `${suggestions.length} policy improvements suggested`,
      );
    }

    return {
      success: true,
      timestamp: new Date(),
      data: healthStatus,
    };
  }
}
