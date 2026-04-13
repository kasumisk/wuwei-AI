/**
 * V6.5 Phase 3I: Thompson Sampling 收敛可视化 API
 *
 * 端点：
 * - GET /admin/thompson-sampling/convergence         全局收敛统计
 * - GET /admin/thompson-sampling/convergence/:userId  指定用户的 TS 分布详情
 */

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { ThompsonSamplingService } from '../services/thompson-sampling.service';
import { ResponseWrapper } from '../../../../common/types/response.type';

@ApiTags('管理后台 - Thompson Sampling 收敛分析')
@Controller('admin/thompson-sampling')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ThompsonSamplingController {
  constructor(
    private readonly thompsonSamplingService: ThompsonSamplingService,
  ) {}

  /**
   * 全局 TS 收敛统计
   *
   * 返回活跃用户数、平均收敛度、阶段分布、
   * 收敛最高/最低的 Top N 食物。
   */
  @Get('convergence')
  @ApiOperation({
    summary: '获取全局 Thompson Sampling 收敛统计',
    description:
      '返回所有活跃用户的 TS 收敛概览：用户分布（exploring/converging/converged）、全局平均收敛度、收敛最高/最低的食物排行',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计窗口天数（默认 30）',
  })
  @ApiQuery({
    name: 'topN',
    required: false,
    description: '食物排行展示数量（默认 10）',
  })
  async getGlobalConvergence(
    @Query('days') days?: string,
    @Query('topN') topN?: string,
  ) {
    const result = await this.thompsonSamplingService.getGlobalConvergence(
      days ? parseInt(days, 10) : 30,
      topN ? parseInt(topN, 10) : 10,
    );
    return ResponseWrapper.success(result, '获取全局 TS 收敛统计成功');
  }

  /**
   * 指定用户的 TS 收敛详情
   *
   * 返回该用户所有食物的 alpha/beta 分布参数、
   * 期望值、方差、收敛度，以及整体收敛阶段。
   */
  @Get('convergence/:userId')
  @ApiOperation({
    summary: '获取指定用户的 Thompson Sampling 收敛详情',
    description:
      '返回该用户每个食物的 Beta 分布参数（α,β）、期望值、方差、收敛度，以及整体收敛阶段',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计窗口天数（默认 30）',
  })
  async getUserConvergence(
    @Param('userId') userId: string,
    @Query('days') days?: string,
  ) {
    const result = await this.thompsonSamplingService.getUserConvergence(
      userId,
      days ? parseInt(days, 10) : 30,
    );
    return ResponseWrapper.success(result, '获取用户 TS 收敛详情成功');
  }
}
