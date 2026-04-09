import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { AppPlatform } from '../../entities/app-version.entity';

/**
 * 客户端检查更新请求 DTO
 */
export class CheckUpdateDto {
  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型（可选）',
    example: 'android',
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiProperty({
    description: '当前 App 版本号',
    example: '1.2.3',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: '版本号格式必须为 x.y.z',
  })
  current_version: string;

  @ApiPropertyOptional({
    description: '分发渠道',
    example: 'official',
  })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({
    description: '设备唯一 ID（用于灰度发布）',
    example: 'abc123',
  })
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional({
    description: '客户端语言',
    example: 'zh-CN',
  })
  @IsOptional()
  @IsString()
  language?: string;
}

/**
 * 获取最新版本查询参数 DTO
 */
export class GetLatestVersionQueryDto {
  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型（可选）',
    example: 'android',
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiPropertyOptional({
    description: '分发渠道',
    example: 'official',
  })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({
    description: '客户端语言',
    example: 'zh-CN',
  })
  @IsOptional()
  @IsString()
  language?: string;
}

/**
 * 获取版本更新历史查询参数 DTO
 */
export class GetVersionHistoryQueryDto {
  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型（可选）',
    example: 'android',
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiPropertyOptional({ description: '页码', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页数量', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({
    description: '客户端语言',
    example: 'zh-CN',
  })
  @IsOptional()
  @IsString()
  language?: string;
}
