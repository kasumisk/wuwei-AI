import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { RecommendationDebugService } from '../services/recommendation-debug.service';
import {
  SimulateRecommendDto,
  WhyNotDto,
  QualityDashboardQueryDto,
  TraceListQueryDto,
  ScoreBreakdownDto,
  StrategyDiffDto,
  PipelineStatsQueryDto,
} from '../dto/recommendation-debug.dto';
import { ApiResponse } from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n';

@ApiTags('管理后台 - 推荐调试')
@Controller('admin/recommendation-debug')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class RecommendationDebugController {
  constructor(
    private readonly debugService: RecommendationDebugService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 模拟推荐 ====================

  @Post('simulate')
  @ApiOperation({
    summary: '模拟推荐（只读，不保存）',
    description:
      '为指定用户模拟一餐推荐，返回推荐结果和性能指标。不会产生任何副作用。',
  })
  async simulateRecommend(
    @Body() dto: SimulateRecommendDto,
  ): Promise<ApiResponse> {
    const data = await this.debugService.simulateRecommend(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.simulateRecommendOk'),
      data,
    };
  }

  // ==================== 反向解释 ====================

  @Post('why-not')
  @ApiOperation({
    summary: '反向解释：为什么不推荐某食物',
    description: '查询指定食物为什么没有出现在用户的推荐列表中',
  })
  async whyNot(@Body() dto: WhyNotDto): Promise<ApiResponse> {
    const data = await this.debugService.whyNot(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.reverseExplainOk'),
      data,
    };
  }

  // ==================== 用户策略解析 ====================

  @Get('user-strategy/:userId')
  @ApiOperation({
    summary: '查看用户当前生效的策略',
    description:
      '展示用户当前的策略解析结果（包括策略来源优先级、AB实验分组、合并后的配置）',
  })
  async getUserStrategy(
    @Param('userId') userId: string,
    @Query('goalType') goalType?: string,
  ): Promise<ApiResponse> {
    const data = await this.debugService.getUserStrategy(userId, goalType);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.userStrategyOk'),
      data,
    };
  }

  // ==================== 质量仪表盘 ====================

  @Get('quality-dashboard')
  @ApiOperation({
    summary: '推荐质量仪表盘（聚合）',
    description:
      '聚合推荐质量概览、按目标/餐次的接受率、日趋势、计划覆盖等指标',
  })
  async getQualityDashboard(
    @Query() query: QualityDashboardQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.debugService.getQualityDashboard(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.qualityDashboardOk'),
      data,
    };
  }

  // ==================== V7.9 P2-01: 查看单条 Trace ====================

  @Get('trace/:traceId')
  @ApiOperation({
    summary: '查看推荐 Trace 详情',
    description:
      '根据 traceId 查看一次推荐的完整追踪数据，包含各阶段耗时、候选数、评分详情等',
  })
  async getTraceById(@Param('traceId') traceId: string): Promise<ApiResponse> {
    const data = await this.debugService.getTraceById(traceId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.traceDetailOk'),
      data,
    };
  }

  // ==================== V7.9 P2-02: Trace 列表 ====================

  @Get('traces')
  @ApiOperation({
    summary: '分页查询推荐 Trace 列表',
    description:
      '按 userId、mealType、sceneName、日期范围过滤，分页返回 Trace 摘要列表',
  })
  async getTraceList(@Query() query: TraceListQueryDto): Promise<ApiResponse> {
    const data = await this.debugService.getTraceList(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.traceListOk'),
      data,
    };
  }

  // ==================== V7.9 P2-03: 得分分解 ====================

  @Post('score-breakdown')
  @ApiOperation({
    summary: '食物得分完整分解',
    description:
      '输入 userId + foodId，返回 14维基础评分 + 10因子链式评分 + 健康修正的完整得分分解',
  })
  async getScoreBreakdown(
    @Body() dto: ScoreBreakdownDto,
  ): Promise<ApiResponse> {
    const data = await this.debugService.getScoreBreakdown(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.scoreBreakdownOk'),
      data,
    };
  }

  // ==================== V7.9 P2-04: 策略推荐差异对比 ====================

  @Post('strategy-diff')
  @ApiOperation({
    summary: '策略推荐差异对比',
    description:
      '输入 userId + 两个 strategyId，分别使用两种策略模拟推荐并对比差异',
  })
  async getStrategyDiff(@Body() dto: StrategyDiffDto): Promise<ApiResponse> {
    const data = await this.debugService.getStrategyDiff(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.strategyDiffOk'),
      data,
    };
  }

  // ==================== V7.9 P2-05: 管道聚合统计 ====================

  @Get('pipeline-stats')
  @ApiOperation({
    summary: '推荐管道聚合统计',
    description:
      '统计指定时间范围内的管道各阶段平均耗时、平均候选数、缓存命中率、降级频率等',
  })
  async getPipelineStats(
    @Query() query: PipelineStatsQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.debugService.getPipelineStats(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.pipelineStatsOk'),
      data,
    };
  }
}
