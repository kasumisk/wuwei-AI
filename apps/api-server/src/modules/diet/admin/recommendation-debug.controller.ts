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
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { RecommendationDebugService } from './recommendation-debug.service';
import {
  SimulateRecommendDto,
  WhyNotDto,
  QualityDashboardQueryDto,
} from './dto/recommendation-debug.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - 推荐调试')
@Controller('admin/recommendation-debug')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class RecommendationDebugController {
  constructor(private readonly debugService: RecommendationDebugService) {}

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
      message: '模拟推荐成功',
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
      message: '获取反向解释成功',
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
      message: '获取用户策略成功',
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
      message: '获取质量仪表盘成功',
      data,
    };
  }
}
