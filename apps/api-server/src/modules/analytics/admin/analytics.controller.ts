import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
} from '@nestjs/swagger';
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { AnalyticsService } from './analytics.service';
import {
  GetOverviewQueryDto,
  GetTopClientsQueryDto,
  GetCapabilityUsageQueryDto,
  GetTimeSeriesQueryDto,
  GetCostAnalysisQueryDto,
  GetErrorAnalysisQueryDto,
  OverviewStatsDto,
  TopClientsResponseDto,
  CapabilityUsageResponseDto,
  TimeSeriesResponseDto,
  CostAnalysisResponseDto,
  ErrorAnalysisResponseDto,
  DashboardStatsDto,
} from './dto/analytics.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('统计分析')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: '获取总览数据' })
  @SwaggerResponse({ status: 200, type: OverviewStatsDto })
  async getOverview(
    @Query() query: GetOverviewQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getOverview(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.overviewSuccess'),
      data,
    };
  }

  @Get('top-clients')
  @ApiOperation({ summary: '获取客户端排行' })
  @SwaggerResponse({ status: 200, type: TopClientsResponseDto })
  async getTopClients(
    @Query() query: GetTopClientsQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getTopClients(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.topClientsSuccess'),
      data,
    };
  }

  @Get('capability-usage')
  @ApiOperation({ summary: '获取能力使用统计' })
  @SwaggerResponse({ status: 200, type: CapabilityUsageResponseDto })
  async getCapabilityUsage(
    @Query() query: GetCapabilityUsageQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getCapabilityUsage(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.capabilityUsageSuccess'),
      data,
    };
  }

  @Get('time-series')
  @ApiOperation({ summary: '获取时间序列数据' })
  @SwaggerResponse({ status: 200, type: TimeSeriesResponseDto })
  async getTimeSeries(
    @Query() query: GetTimeSeriesQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getTimeSeries(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.timeSeriesSuccess'),
      data,
    };
  }

  @Get('cost-analysis')
  @ApiOperation({ summary: '获取成本分析' })
  @SwaggerResponse({ status: 200, type: CostAnalysisResponseDto })
  async getCostAnalysis(
    @Query() query: GetCostAnalysisQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getCostAnalysis(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.costAnalysisSuccess'),
      data,
    };
  }

  @Get('error-analysis')
  @ApiOperation({ summary: '获取错误分析' })
  @SwaggerResponse({ status: 200, type: ErrorAnalysisResponseDto })
  async getErrorAnalysis(
    @Query() query: GetErrorAnalysisQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getErrorAnalysis(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.errorAnalysisSuccess'),
      data,
    };
  }

  @Get('dashboard')
  @ApiOperation({ summary: '获取仪表盘聚合数据' })
  @SwaggerResponse({ status: 200, type: DashboardStatsDto })
  async getDashboard(
    @Query() query: GetOverviewQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getDashboard(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('analytics.analytics.dashboardSuccess'),
      data,
    };
  }
}
