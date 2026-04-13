/**
 * V6.5 Phase 3J: 暴食干预效果追踪 Admin API
 *
 * 端点：
 * - GET /admin/binge-intervention/effectiveness      全局干预效果统计
 * - GET /admin/binge-intervention/effectiveness/:userId  指定用户干预历史
 * - POST /admin/binge-intervention/evaluate          手动触发未评估干预的效果评估
 */

import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { BingeInterventionService } from '../services/binge-intervention.service';
import { ResponseWrapper } from '../../../../common/types/response.type';

@ApiTags('管理后台 - 暴食干预效果追踪')
@Controller('admin/binge-intervention')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class BingeInterventionController {
  constructor(
    private readonly bingeInterventionService: BingeInterventionService,
  ) {}

  /**
   * 全局干预效果统计
   */
  @Get('effectiveness')
  @ApiOperation({
    summary: '获取全局暴食干预效果统计',
    description:
      '返回指定窗口期内的干预次数、有效率、分时段统计、平均卡路里削减等',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计窗口天数（默认 30）',
  })
  async getEffectiveness(@Query('days') days?: string) {
    const result = await this.bingeInterventionService.getEffectivenessStats(
      days ? parseInt(days, 10) : 30,
    );
    return ResponseWrapper.success(result, '获取干预效果统计成功');
  }

  /**
   * 指定用户干预历史
   */
  @Get('effectiveness/:userId')
  @ApiOperation({
    summary: '获取指定用户的暴食干预历史',
    description: '返回该用户的干预次数、有效率及最近干预记录详情',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '统计窗口天数（默认 30）',
  })
  async getUserEffectiveness(
    @Param('userId') userId: string,
    @Query('days') days?: string,
  ) {
    const result =
      await this.bingeInterventionService.getUserInterventionOverview(
        userId,
        days ? parseInt(days, 10) : 30,
      );
    return ResponseWrapper.success(result, '获取用户干预历史成功');
  }

  /**
   * 手动触发未评估干预的效果评估
   */
  @Post('evaluate')
  @ApiOperation({
    summary: '手动触发暴食干预效果评估',
    description:
      '评估所有创建时间 >= 3h 且尚未评估的干预记录，计算 post_calories 和 effective 字段',
  })
  async triggerEvaluation() {
    const evaluatedCount =
      await this.bingeInterventionService.evaluatePendingInterventions();
    return ResponseWrapper.success(
      { evaluatedCount },
      `评估完成，处理 ${evaluatedCount} 条记录`,
    );
  }
}
