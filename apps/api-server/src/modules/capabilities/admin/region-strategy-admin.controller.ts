import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RegionStrategyAdminService,
  type RuntimeRegion,
} from '../../../core/region';
import { ApiResponse } from '../../../common/types/response.type';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { UpdateRegionStrategyDto } from './dto/region-strategy-admin.dto';

@ApiTags('管理后台 - Region Strategy')
@Controller('admin/region-strategy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class RegionStrategyAdminController {
  constructor(private readonly regionAdmin: RegionStrategyAdminService) {}

  @Get()
  @ApiOperation({ summary: '获取全部区域策略配置' })
  list(): ApiResponse {
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取区域策略配置成功',
      data: this.regionAdmin.list(),
    };
  }

  @Get(':region')
  @ApiOperation({ summary: '获取单个区域策略配置' })
  get(@Param('region') regionParam: string): ApiResponse {
    const region = this.parseRegion(regionParam);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取区域策略配置成功',
      data: this.regionAdmin.get(region),
    };
  }

  @Put(':region')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新区域策略 override' })
  async update(
    @Param('region') regionParam: string,
    @Body() dto: UpdateRegionStrategyDto,
  ): Promise<ApiResponse> {
    const region = this.parseRegion(regionParam);
    const data = await this.regionAdmin.update(region, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新区域策略配置成功',
      data,
    };
  }

  @Delete(':region')
  @ApiOperation({ summary: '重置区域策略 override' })
  async reset(@Param('region') regionParam: string): Promise<ApiResponse> {
    const region = this.parseRegion(regionParam);
    const data = await this.regionAdmin.reset(region);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '重置区域策略配置成功',
      data,
    };
  }

  private parseRegion(region: string): RuntimeRegion {
    const normalized = region.trim().toUpperCase();
    if (normalized === 'GLOBAL' || normalized === 'CN') {
      return normalized;
    }
    throw new BadRequestException(`Unsupported region: ${region}`);
  }
}
