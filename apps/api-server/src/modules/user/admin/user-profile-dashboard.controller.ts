import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { UserProfileDashboardService } from './user-profile-dashboard.service';
import {
  UserGrowthTrendQueryDto,
  ProfileDistributionQueryDto,
} from './dto/user-profile-dashboard.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - 用户画像看板')
@Controller('admin/user-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class UserProfileDashboardController {
  constructor(private readonly dashboardService: UserProfileDashboardService) {}

  // ==================== 用户增长趋势 ====================

  @Get('growth-trend')
  @ApiOperation({
    summary: '用户增长趋势',
    description: '按天/周/月粒度返回新增注册数、累计数、按 authType 细分',
  })
  async getGrowthTrend(
    @Query() query: UserGrowthTrendQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.dashboardService.getGrowthTrend(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户增长趋势成功',
      data,
    };
  }

  // ==================== 用户画像分布 ====================

  @Get('profile-distribution')
  @ApiOperation({
    summary: '用户画像分布统计',
    description:
      '聚合统计注册渠道、目标类型、活动等级、性别、onboarding 完成率、行为画像指标、推断画像指标、流失风险/依从率分段',
  })
  async getProfileDistribution(
    @Query() query: ProfileDistributionQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.dashboardService.getProfileDistribution(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户画像分布成功',
      data,
    };
  }

  // ==================== 活跃用户统计 ====================

  @Get('active-stats')
  @ApiOperation({
    summary: '活跃用户统计',
    description: 'DAU / WAU / MAU，粘性比率，日活趋势',
  })
  async getActiveStats(@Query('days') days?: number): Promise<ApiResponse> {
    const data = await this.dashboardService.getActiveStats(
      days ? Number(days) : 30,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取活跃用户统计成功',
      data,
    };
  }
}
