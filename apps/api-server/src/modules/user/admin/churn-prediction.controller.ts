/**
 * V6.5 Phase 3L: 用户流失预测 Admin API
 *
 * 端点：
 * - GET /admin/churn-prediction/distribution         全局流失风险分布
 * - GET /admin/churn-prediction/predict/:userId       指定用户流失预测详情
 */

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ChurnPredictionService } from '../app/services/churn-prediction.service';
import { ResponseWrapper } from '../../../common/types/response.type';

@ApiTags('管理后台 - 用户流失预测')
@Controller('admin/churn-prediction')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ChurnPredictionController {
  constructor(
    private readonly churnPredictionService: ChurnPredictionService,
  ) {}

  /**
   * 全局流失风险分布
   */
  @Get('distribution')
  @ApiOperation({
    summary: '获取全局用户流失风险分布',
    description:
      '返回所有用户的 churnRisk 分布（low/medium/high/critical）、平均风险值及高风险用户列表',
  })
  @ApiQuery({
    name: 'topN',
    required: false,
    description: '高风险用户展示数量（默认 20）',
  })
  async getDistribution(@Query('topN') topN?: string) {
    const result = await this.churnPredictionService.getDistribution(
      topN ? parseInt(topN, 10) : 20,
    );
    return ResponseWrapper.success(result, '获取流失风险分布成功');
  }

  /**
   * 指定用户流失预测详情
   */
  @Get('predict/:userId')
  @ApiOperation({
    summary: '获取指定用户的流失风险预测',
    description:
      '返回该用户的多维特征评分、综合 churnRisk、置信度及主要风险因素',
  })
  async predictUser(@Param('userId') userId: string) {
    const result = await this.churnPredictionService.predict(userId);
    return ResponseWrapper.success(result, '获取用户流失预测成功');
  }
}
