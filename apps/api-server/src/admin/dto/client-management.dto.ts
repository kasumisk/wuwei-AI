import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetClientsQueryDto as IGetClientsQueryDto,
  CreateClientDto as ICreateClientDto,
  UpdateClientDto as IUpdateClientDto,
  QuotaConfigDto as IQuotaConfigDto,
  ClientMetadataDto as IClientMetadataDto,
  GetClientUsageQueryDto as IGetClientUsageQueryDto,
  ClientStatus,
} from '@ai-platform/shared';

/**
 * 配额配置 DTO
 */
export class QuotaConfigDto implements IQuotaConfigDto {
  @ApiProperty({ description: '月配额（美元）', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyQuota?: number;

  @ApiProperty({ description: '日配额（美元）', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyQuota?: number;

  @ApiProperty({ description: '速率限制（次/分钟）', required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  rateLimit?: number;

  @ApiProperty({ description: '是否自动充值', required: false })
  @IsOptional()
  @IsBoolean()
  enableAutoRecharge?: boolean;

  @ApiProperty({ description: '告警阈值（百分比）', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  alertThreshold?: number;
}

/**
 * 客户端元数据 DTO
 */
export class ClientMetadataDto implements IClientMetadataDto {
  @ApiProperty({ description: '公司名称', required: false })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiProperty({ description: '联系邮箱', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: '联系电话', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ description: 'Webhook URL', required: false })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiProperty({ description: 'IP 白名单', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedIps?: string[];
}

/**
 * 获取客户端列表查询参数
 */
export class GetClientsQueryDto implements IGetClientsQueryDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', required: false, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 10;

  @ApiProperty({ description: '搜索关键词', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ description: '状态筛选', enum: ClientStatus, required: false })
  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus;
}

/**
 * 创建客户端 DTO
 */
export class CreateClientDto implements ICreateClientDto {
  @ApiProperty({ description: '客户端名称', example: 'My Client' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '描述', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: '配额配置',
    type: QuotaConfigDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuotaConfigDto)
  quotaConfig?: QuotaConfigDto;

  @ApiProperty({
    description: '元数据',
    type: ClientMetadataDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientMetadataDto)
  metadata?: ClientMetadataDto;
}

/**
 * 更新客户端 DTO
 */
export class UpdateClientDto implements IUpdateClientDto {
  @ApiProperty({ description: '客户端名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '描述', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '状态', enum: ClientStatus, required: false })
  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus;

  @ApiProperty({
    description: '配额配置',
    type: QuotaConfigDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuotaConfigDto)
  quotaConfig?: QuotaConfigDto;

  @ApiProperty({
    description: '元数据',
    type: ClientMetadataDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Number)
  metadata?: ClientMetadataDto;
}

/**
 * 获取客户端使用统计查询参数
 */
export class GetClientUsageQueryDto implements IGetClientUsageQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsNotEmpty()
  @IsString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsNotEmpty()
  @IsString()
  endDate: string;
}
