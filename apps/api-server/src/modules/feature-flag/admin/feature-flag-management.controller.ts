/**
 * V6 Phase 1.5 — 功能开关 Admin 管理控制器
 *
 * 提供功能开关的 CRUD 接口，供管理后台使用。
 * 路由前缀: /api/admin/feature-flags
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { FeatureFlagService } from '../feature-flag.service';
import { FeatureFlagType } from '../entities/feature-flag.entity';

// ─── DTO ───

class UpsertFeatureFlagDto {
  @ApiProperty({ description: '功能开关 key（唯一标识）' })
  @IsString()
  @MaxLength(100)
  key: string;

  @ApiProperty({ description: '名称' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: FeatureFlagType,
    default: FeatureFlagType.BOOLEAN,
  })
  @IsOptional()
  @IsEnum(FeatureFlagType)
  type?: FeatureFlagType;

  @ApiPropertyOptional({ description: '是否启用', default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: '类型相关配置（JSONB）',
    example: { percentage: 10 },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

@ApiTags('管理后台 - 功能开关')
@Controller('admin/feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FeatureFlagManagementController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  /**
   * 获取所有功能开关
   * GET /api/admin/feature-flags
   */
  @Get()
  @ApiOperation({ summary: '获取所有功能开关' })
  async list(): Promise<ApiResponse> {
    const flags = await this.featureFlagService.getAllFlags();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: flags,
    };
  }

  /**
   * 创建或更新功能开关
   * POST /api/admin/feature-flags
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建/更新功能开关' })
  async upsert(@Body() dto: UpsertFeatureFlagDto): Promise<ApiResponse> {
    const flag = await this.featureFlagService.upsertFlag(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '保存成功',
      data: flag,
    };
  }

  /**
   * 快速切换开关状态
   * PUT /api/admin/feature-flags/:key/toggle
   */
  @Put(':key/toggle')
  @ApiOperation({ summary: '切换功能开关启用状态' })
  async toggle(@Param('key') key: string): Promise<ApiResponse> {
    const flags = await this.featureFlagService.getAllFlags();
    const existing = flags.find((f) => f.key === key);
    if (!existing) {
      return {
        success: false,
        code: HttpStatus.NOT_FOUND,
        message: '功能开关不存在',
        data: null,
      };
    }

    const updated = await this.featureFlagService.upsertFlag({
      key,
      enabled: !existing.enabled,
    });

    return {
      success: true,
      code: HttpStatus.OK,
      message: `已${updated.enabled ? '启用' : '禁用'}`,
      data: updated,
    };
  }

  /**
   * 删除功能开关
   * DELETE /api/admin/feature-flags/:key
   */
  @Delete(':key')
  @ApiOperation({ summary: '删除功能开关' })
  async remove(@Param('key') key: string): Promise<ApiResponse> {
    await this.featureFlagService.deleteFlag(key);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '删除成功',
      data: null,
    };
  }
}
