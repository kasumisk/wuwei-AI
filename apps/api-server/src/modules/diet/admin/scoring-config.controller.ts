import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ScoringConfigService } from '../app/recommendation/scoring-config.service';
import { ScoringConfigSnapshot } from '../app/recommendation/recommendation.types';
import { ApiResponse } from '../../../common/types/response.type';

/**
 * V6.7 Phase 1-B: 评分参数中心化管理 — Admin 端点
 *
 * GET  /api/admin/scoring-config — 查看当前评分配置
 * PUT  /api/admin/scoring-config — 更新评分配置（partial merge）
 */
@ApiTags('管理后台 - 评分参数配置')
@Controller('admin/scoring-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ScoringConfigController {
  constructor(private readonly scoringConfigService: ScoringConfigService) {}

  @Get()
  @ApiOperation({
    summary: '查看当前评分配置',
    description:
      '返回当前生效的 ScoringConfigSnapshot，包含 FoodScorer/RecallMerger/RealisticFilter/MealComposition/CF/Lifestyle 等全部参数',
  })
  async getConfig(): Promise<ApiResponse> {
    const config = await this.scoringConfigService.getConfig();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取评分配置成功',
      data: {
        config,
        defaults: this.scoringConfigService.getDefaults(),
      },
    };
  }

  @Put()
  @ApiOperation({
    summary: '更新评分配置（partial merge）',
    description:
      '支持部分更新：只传需要修改的字段，其余保持当前值。嵌套对象（如 executabilitySubWeights）也支持部分更新。',
  })
  async updateConfig(
    @Body() body: Partial<ScoringConfigSnapshot>,
  ): Promise<ApiResponse> {
    const config = await this.scoringConfigService.updateConfig(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '评分配置更新成功',
      data: config,
    };
  }
}
