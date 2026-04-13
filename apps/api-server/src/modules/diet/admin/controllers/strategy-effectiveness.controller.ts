import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { StrategyEffectivenessService } from '../services/strategy-effectiveness.service';
import { ResponseWrapper } from '../../../../common/types/response.type';

/**
 * V6.4 Phase 3.6: 策略效果分析 Admin API
 *
 * 提供推荐策略效果的分析和对比接口，
 * 支持按策略、实验分组、渠道维度分析。
 */
@ApiTags('管理后台 - 策略效果分析')
@Controller('admin/strategy-effectiveness')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class StrategyEffectivenessController {
  constructor(
    private readonly effectivenessService: StrategyEffectivenessService,
  ) {}

  /**
   * 获取策略效果概览报告
   */
  @Get('report')
  @ApiOperation({ summary: '获取策略效果概览报告' })
  @ApiQuery({
    name: 'strategyId',
    required: false,
    description: '策略 ID（不传则统计全局）',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计天数（默认 7）',
  })
  async getReport(
    @Query('strategyId') strategyId?: string,
    @Query('days') days?: string,
  ) {
    const report = await this.effectivenessService.getEffectivenessReport(
      strategyId,
      days ? parseInt(days, 10) : 7,
    );
    return ResponseWrapper.success(report, '获取策略效果报告成功');
  }

  /**
   * A/B 实验分组对比
   */
  @Get('experiment-compare')
  @ApiOperation({ summary: 'A/B 实验分组效果对比' })
  @ApiQuery({ name: 'experimentId', required: true, description: '实验 ID' })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计天数（默认 7）',
  })
  async compareExperiment(
    @Query('experimentId') experimentId: string,
    @Query('days') days?: string,
  ) {
    const result = await this.effectivenessService.compareExperimentGroups(
      experimentId,
      days ? parseInt(days, 10) : 7,
    );
    return ResponseWrapper.success(result, '获取实验对比结果成功');
  }

  /**
   * 按渠道分析推荐效果
   */
  @Get('channel-analysis')
  @ApiOperation({ summary: '按获取渠道分析推荐效果' })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计天数（默认 7）',
  })
  async analyzeByChannel(@Query('days') days?: string) {
    const results = await this.effectivenessService.analyzeByChannel(
      days ? parseInt(days, 10) : 7,
    );
    return ResponseWrapper.success(results, '获取渠道分析结果成功');
  }
}
