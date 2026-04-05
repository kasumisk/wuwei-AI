import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUrl,
  Min,
  IsObject,
} from 'class-validator';
import type {
  GetProvidersQueryDto as IGetProvidersQueryDto,
  CreateProviderDto as ICreateProviderDto,
  UpdateProviderDto as IUpdateProviderDto,
  ProviderInfoDto as IProviderInfoDto,
  ProvidersListResponseDto as IProvidersListResponseDto,
  TestProviderDto as ITestProviderDto,
  TestProviderResponseDto as ITestProviderResponseDto,
  ProviderHealthDto as IProviderHealthDto,
} from '@ai-platform/shared';
import { ProviderType, ProviderStatus } from '@ai-platform/shared';

/**
 * 获取提供商列表查询参数
 */
export class GetProvidersQueryDto implements IGetProvidersQueryDto {
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

  @ApiPropertyOptional({ description: '搜索关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    enum: ProviderType,
    description: '提供商类型',
  })
  @IsOptional()
  @IsEnum(ProviderType)
  type?: ProviderType;

  @ApiPropertyOptional({
    enum: ProviderStatus,
    description: '提供商状态',
  })
  @IsOptional()
  @IsEnum(ProviderStatus)
  status?: ProviderStatus;
}

/**
 * 创建提供商 DTO
 */
export class CreateProviderDto implements ICreateProviderDto {
  @ApiProperty({ description: '提供商名称', example: 'OpenAI' })
  @IsString()
  name: string;

  @ApiProperty({
    enum: ProviderType,
    description: '提供商类型',
    example: ProviderType.OPENAI,
  })
  @IsEnum(ProviderType)
  type: ProviderType;

  @ApiProperty({
    description: 'API 基础 URL',
    example: 'https://api.openai.com/v1',
  })
  @IsUrl()
  baseUrl: string;

  @ApiProperty({ description: 'API 密钥' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: '健康检查 URL',
    example: 'https://api.openai.com/v1/models',
  })
  @IsOptional()
  @IsUrl()
  healthCheckUrl?: string;

  @ApiPropertyOptional({
    description: '请求超时时间（毫秒）',
    example: 30000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  timeout?: number;

  @ApiPropertyOptional({ description: '重试次数', example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  retryCount?: number;

  @ApiPropertyOptional({ description: '元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 更新提供商 DTO
 */
export class UpdateProviderDto implements IUpdateProviderDto {
  @ApiPropertyOptional({ description: '提供商名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'API 基础 URL' })
  @IsOptional()
  @IsUrl()
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'API 密钥' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '健康检查 URL' })
  @IsOptional()
  @IsUrl()
  healthCheckUrl?: string;

  @ApiPropertyOptional({ description: '请求超时时间（毫秒）' })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  timeout?: number;

  @ApiPropertyOptional({ description: '重试次数' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  retryCount?: number;

  @ApiPropertyOptional({ description: '元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 提供商信息 DTO
 */
export class ProviderInfoDto implements IProviderInfoDto {
  @ApiProperty({ description: '提供商 ID' })
  id: string;

  @ApiProperty({ description: '提供商名称' })
  name: string;

  @ApiProperty({ enum: ProviderType, description: '提供商类型' })
  type: ProviderType;

  @ApiProperty({ description: 'API 基础 URL' })
  baseUrl: string;

  @ApiProperty({ description: '是否启用' })
  enabled: boolean;

  @ApiPropertyOptional({ description: '健康检查 URL' })
  healthCheckUrl?: string;

  @ApiProperty({ description: '请求超时时间（毫秒）' })
  timeout: number;

  @ApiProperty({ description: '重试次数' })
  retryCount: number;

  @ApiProperty({ enum: ProviderStatus, description: '提供商状态' })
  status: ProviderStatus;

  @ApiPropertyOptional({ description: '最后健康检查时间' })
  lastHealthCheck?: Date;

  @ApiPropertyOptional({ description: '元数据' })
  metadata?: Record<string, any>;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/**
 * 提供商列表响应 DTO
 */
export class ProvidersListResponseDto implements IProvidersListResponseDto {
  @ApiProperty({ type: [ProviderInfoDto], description: '提供商列表' })
  list: ProviderInfoDto[];

  @ApiProperty({ description: '总数' })
  total: number;

  @ApiProperty({ description: '当前页码' })
  page: number;

  @ApiProperty({ description: '每页数量' })
  pageSize: number;
}

/**
 * 测试提供商连接 DTO
 */
export class TestProviderDto implements ITestProviderDto {
  @ApiProperty({ description: '提供商 ID' })
  @IsString()
  providerId: string;

  @ApiPropertyOptional({ description: '测试端点' })
  @IsOptional()
  @IsString()
  testEndpoint?: string;
}

/**
 * 测试提供商连接响应 DTO
 */
export class TestProviderResponseDto implements ITestProviderResponseDto {
  @ApiProperty({ description: '是否成功' })
  success: boolean;

  @ApiPropertyOptional({ description: '消息' })
  message?: string;

  @ApiPropertyOptional({ description: '延迟（毫秒）' })
  latency?: number;

  @ApiPropertyOptional({ description: '错误信息' })
  error?: string;
}

/**
 * 提供商健康状态 DTO
 */
export class ProviderHealthDto implements IProviderHealthDto {
  @ApiProperty({ description: '提供商 ID' })
  providerId: string;

  @ApiProperty({ enum: ProviderStatus, description: '状态' })
  status: ProviderStatus;

  @ApiProperty({ description: '最后检查时间' })
  lastCheck: Date;

  @ApiPropertyOptional({ description: '延迟（毫秒）' })
  latency?: number;

  @ApiPropertyOptional({ description: '错误信息' })
  error?: string;
}
