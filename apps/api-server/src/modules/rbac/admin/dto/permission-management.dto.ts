import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  IsNotEmpty,
  IsEnum,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CapabilityType,
  CreatePermissionDto as ICreatePermissionDto,
  UpdatePermissionDto as IUpdatePermissionDto,
  BatchPermissionItemDto as IBatchPermissionItemDto,
  BatchUpdatePermissionsDto as IBatchUpdatePermissionsDto,
  PermissionConfigDto as IPermissionConfigDto,
} from '@ai-platform/shared';

/**
 * 权限配置 DTO
 */
export class PermissionConfigDto implements IPermissionConfigDto {
  @ApiProperty({ description: '最大并发请求数', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrentRequests?: number;

  @ApiProperty({
    description: '允许的模型列表',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedModels?: string[];

  @ApiProperty({ description: '自定义参数', required: false })
  @IsOptional()
  @IsObject()
  customParams?: any;

  // 其他额外配置
  [key: string]: any;
}

/**
 * 创建权限 DTO
 */
export class CreatePermissionDto implements ICreatePermissionDto {
  @ApiProperty({ description: '客户端ID' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: '能力类型', enum: CapabilityType })
  @IsEnum(CapabilityType)
  @IsNotEmpty()
  capabilityType: CapabilityType;

  @ApiProperty({ description: '是否启用', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @ApiProperty({
    description: '速率限制（次/分钟）',
    required: false,
    default: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimit?: number = 60;

  @ApiProperty({ description: '配额限制', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  quotaLimit?: number;

  @ApiProperty({ description: '首选提供商', required: false })
  @IsOptional()
  @IsString()
  preferredProvider?: string;

  @ApiProperty({
    description: '配置',
    type: PermissionConfigDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PermissionConfigDto)
  config?: PermissionConfigDto;
}

/**
 * 更新权限 DTO
 */
export class UpdatePermissionDto implements IUpdatePermissionDto {
  @ApiProperty({ description: '是否启用', required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ description: '速率限制（次/分钟）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimit?: number;

  @ApiProperty({ description: '配额限制', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  quotaLimit?: number;

  @ApiProperty({ description: '首选提供商', required: false })
  @IsOptional()
  @IsString()
  preferredProvider?: string;

  @ApiProperty({
    description: '配置',
    type: PermissionConfigDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PermissionConfigDto)
  config?: PermissionConfigDto;
}

/**
 * 批量权限项 DTO
 */
export class BatchPermissionItemDto implements IBatchPermissionItemDto {
  @ApiProperty({ description: '能力类型', enum: CapabilityType })
  @IsEnum(CapabilityType)
  @IsNotEmpty()
  capabilityType: CapabilityType;

  @ApiProperty({ description: '是否启用' })
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @ApiProperty({ description: '速率限制（次/分钟）', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimit?: number;

  @ApiProperty({ description: '配额限制', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  quotaLimit?: number;
}

/**
 * 批量更新权限 DTO
 */
export class BatchUpdatePermissionsDto implements IBatchUpdatePermissionsDto {
  @ApiProperty({ description: '权限列表', type: [BatchPermissionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchPermissionItemDto)
  permissions: BatchPermissionItemDto[];
}
