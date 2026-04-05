import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AnalyticsService } from '../services/analytics.service';
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
} from '../dto/analytics.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('统计分析')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * 获取总览数据
   * GET /api/admin/analytics/overview
   */
  @Get('overview')
  @ApiOperation({ summary: '获取总览数据' })
  @SwaggerResponse({ status: 200, type: OverviewStatsDto })
  async getOverview(@Query() query: GetOverviewQueryDto): Promise<ApiResponse> {
    const data = await this.analyticsService.getOverview(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取总览数据成功',
      data,
    };
  }

  /**
   * 获取客户端排行
   * GET /api/admin/analytics/top-clients
   */
  @Get('top-clients')
  @ApiOperation({ summary: '获取客户端排行' })
  @SwaggerResponse({ status: 200, type: TopClientsResponseDto })
  async getTopClients(
    @Query() query: GetTopClientsQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getTopClients(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取客户端排行成功',
      data,
    };
  }

  /**
   * 获取能力使用统计
   * GET /api/admin/analytics/capability-usage
   */
  @Get('capability-usage')
  @ApiOperation({ summary: '获取能力使用统计' })
  @SwaggerResponse({ status: 200, type: CapabilityUsageResponseDto })
  async getCapabilityUsage(
    @Query() query: GetCapabilityUsageQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getCapabilityUsage(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取能力使用统计成功',
      data,
    };
  }

  /**
   * 获取时间序列数据
   * GET /api/admin/analytics/time-series
   */
  @Get('time-series')
  @ApiOperation({ summary: '获取时间序列数据' })
  @SwaggerResponse({ status: 200, type: TimeSeriesResponseDto })
  async getTimeSeries(
    @Query() query: GetTimeSeriesQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getTimeSeries(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取时间序列数据成功',
      data,
    };
  }

  /**
   * 获取成本分析
   * GET /api/admin/analytics/cost-analysis
   */
  @Get('cost-analysis')
  @ApiOperation({ summary: '获取成本分析' })
  @SwaggerResponse({ status: 200, type: CostAnalysisResponseDto })
  async getCostAnalysis(
    @Query() query: GetCostAnalysisQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getCostAnalysis(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成本分析成功',
      data,
    };
  }

  /**
   * 获取错误分析
   * GET /api/admin/analytics/error-analysis
   */
  @Get('error-analysis')
  @ApiOperation({ summary: '获取错误分析' })
  @SwaggerResponse({ status: 200, type: ErrorAnalysisResponseDto })
  async getErrorAnalysis(
    @Query() query: GetErrorAnalysisQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getErrorAnalysis(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取错误分析成功',
      data,
    };
  }

  /**
   * 获取仪表盘聚合数据
   * GET /api/admin/analytics/dashboard
   */
  @Get('dashboard')
  @ApiOperation({ summary: '获取仪表盘聚合数据' })
  @SwaggerResponse({ status: 200, type: DashboardStatsDto })
  async getDashboard(
    @Query() query: GetOverviewQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analyticsService.getDashboard(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取仪表盘数据成功',
      data,
    };
  }
}
