import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ConversionFunnelService } from './conversion-funnel.service';
import {
  GetConversionFunnelQueryDto,
  GetConversionTrendQueryDto,
} from './dto/conversion-funnel.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - 转化漏斗分析')
@Controller('admin/analytics/funnel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ConversionFunnelController {
  constructor(
    private readonly conversionFunnelService: ConversionFunnelService,
  ) {}

  /**
   * 获取转化漏斗数据
   * 五步漏斗: 注册 → 使用功能 → 触发付费墙 → 发起支付 → 支付成功
   */
  @Get()
  @ApiOperation({ summary: '获取转化漏斗数据' })
  async getFunnel(
    @Query() query: GetConversionFunnelQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.conversionFunnelService.getConversionFunnel(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取转化漏斗数据成功',
      data,
    };
  }

  /**
   * 获取转化趋势数据
   * 按日/周/月粒度，展示注册、触发付费墙、支付成功的趋势
   */
  @Get('trend')
  @ApiOperation({ summary: '获取转化趋势数据' })
  async getTrend(
    @Query() query: GetConversionTrendQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.conversionFunnelService.getConversionTrend(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取转化趋势数据成功',
      data,
    };
  }
}
