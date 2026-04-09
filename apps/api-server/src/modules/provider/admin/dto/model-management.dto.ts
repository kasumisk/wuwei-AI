import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  GetModelsQueryDto as IGetModelsQueryDto,
  CreateModelDto as ICreateModelDto,
  UpdateModelDto as IUpdateModelDto,
  ModelInfoDto as IModelInfoDto,
  ModelsListResponseDto as IModelsListResponseDto,
  TestModelDto as ITestModelDto,
  TestModelResponseDto as ITestModelResponseDto,
  ModelPricingDto as IModelPricingDto,
  ModelLimitsDto as IModelLimitsDto,
  ModelFeaturesDto as IModelFeaturesDto,
  ModelConfigOverrideDto as IModelConfigOverrideDto,
} from '@ai-platform/shared';
import { ModelStatus, Currency, CapabilityType } from '@ai-platform/shared';

/**
 * 模型定价配置 DTO
 */
export class ModelPricingDto implements IModelPricingDto {
  @ApiProperty({ description: '输入每1k tokens成本', example: 0.01 })
  @IsNumber()
  @Min(0)
  inputCostPer1kTokens: number;

  @ApiProperty({ description: '输出每1k tokens成本', example: 0.03 })
  @IsNumber()
  @Min(0)
  outputCostPer1kTokens: number;

  @ApiProperty({ enum: Currency, description: '货币', example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;
}

/**
 * 模型限制配置 DTO
 */
export class ModelLimitsDto implements IModelLimitsDto {
  @ApiProperty({ description: '最大 tokens 数', example: 4096 })
  @IsNumber()
  @Min(1)
  maxTokens: number;

  @ApiPropertyOptional({
    description: '每分钟最大请求数',
    example: 60,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxRequestsPerMinute?: number;

  @ApiProperty({ description: '上下文窗口大小', example: 8192 })
  @IsNumber()
  @Min(1)
  contextWindow: number;
}

/**
 * 模型功能配置 DTO
 */
export class ModelFeaturesDto implements IModelFeaturesDto {
  @ApiProperty({ description: '是否支持流式输出' })
  @IsBoolean()
  streaming: boolean;

  @ApiProperty({ description: '是否支持函数调用' })
  @IsBoolean()
  functionCalling: boolean;

  @ApiProperty({ description: '是否支持视觉' })
  @IsBoolean()
  vision: boolean;
}

/**
 * 模型配置覆盖 DTO
 */
export class ModelConfigOverrideDto implements IModelConfigOverrideDto {
  @ApiPropertyOptional({ description: '自定义端点' })
  @IsOptional()
  @IsString()
  endpoint?: string;

  @ApiPropertyOptional({ description: '自定义 API Key' })
  @IsOptional()
  @IsString()
  customApiKey?: string;

  @ApiPropertyOptional({ description: '自定义超时时间' })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  customTimeout?: number;

  @ApiPropertyOptional({ description: '自定义重试次数' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  customRetries?: number;

  @ApiPropertyOptional({ description: '额外配置元数据' })
  @IsOptional()
  @IsObject()
  configMetadata?: Record<string, any>;
}

/**
 * 获取模型列表查询参数
 */
export class GetModelsQueryDto implements IGetModelsQueryDto {
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

  @ApiPropertyOptional({ description: '提供商 ID' })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    enum: CapabilityType,
    description: '能力类型',
  })
  @IsOptional()
  @IsEnum(CapabilityType)
  capabilityType?: CapabilityType;

  @ApiPropertyOptional({
    enum: ModelStatus,
    description: '模型状态',
  })
  @IsOptional()
  @IsEnum(ModelStatus)
  status?: ModelStatus;
}

/**
 * 创建模型 DTO
 */
export class CreateModelDto implements ICreateModelDto {
  @ApiProperty({ description: '提供商 ID' })
  @IsUUID()
  providerId: string;

  @ApiProperty({ description: '模型名称', example: 'gpt-4-turbo' })
  @IsString()
  modelName: string;

  @ApiProperty({ description: '显示名称', example: 'GPT-4 Turbo' })
  @IsString()
  displayName: string;

  @ApiProperty({
    enum: CapabilityType,
    description: '能力类型',
    example: CapabilityType.TEXT_GENERATION,
  })
  @IsEnum(CapabilityType)
  capabilityType: CapabilityType;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '优先级（越小越优先）', example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @ApiProperty({ type: ModelPricingDto, description: '定价配置' })
  @ValidateNested()
  @Type(() => ModelPricingDto)
  pricing: ModelPricingDto;

  @ApiProperty({ type: ModelLimitsDto, description: '限制配置' })
  @ValidateNested()
  @Type(() => ModelLimitsDto)
  limits: ModelLimitsDto;

  @ApiProperty({ type: ModelFeaturesDto, description: '功能配置' })
  @ValidateNested()
  @Type(() => ModelFeaturesDto)
  features: ModelFeaturesDto;

  @ApiPropertyOptional({
    type: ModelConfigOverrideDto,
    description: '配置覆盖',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelConfigOverrideDto)
  configOverride?: ModelConfigOverrideDto;

  @ApiPropertyOptional({ description: '元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 更新模型 DTO
 */
export class UpdateModelDto implements IUpdateModelDto {
  @ApiPropertyOptional({ description: '显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '优先级（越小越优先）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ type: ModelPricingDto, description: '定价配置' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelPricingDto)
  pricing?: ModelPricingDto;

  @ApiPropertyOptional({ type: ModelLimitsDto, description: '限制配置' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelLimitsDto)
  limits?: ModelLimitsDto;

  @ApiPropertyOptional({ type: ModelFeaturesDto, description: '功能配置' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelFeaturesDto)
  features?: ModelFeaturesDto;

  @ApiPropertyOptional({
    type: ModelConfigOverrideDto,
    description: '配置覆盖',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelConfigOverrideDto)
  configOverride?: ModelConfigOverrideDto;

  @ApiPropertyOptional({ description: '元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 模型信息 DTO
 */
export class ModelInfoDto implements IModelInfoDto {
  @ApiProperty({ description: '模型 ID' })
  id: string;

  @ApiProperty({ description: '提供商 ID' })
  providerId: string;

  @ApiProperty({ description: '提供商名称' })
  providerName: string;

  @ApiProperty({ description: '模型名称' })
  modelName: string;

  @ApiProperty({ description: '显示名称' })
  displayName: string;

  @ApiProperty({ enum: CapabilityType, description: '能力类型' })
  capabilityType: CapabilityType;

  @ApiProperty({ description: '是否启用' })
  enabled: boolean;

  @ApiProperty({ description: '优先级' })
  priority: number;

  @ApiProperty({ enum: ModelStatus, description: '模型状态' })
  status: ModelStatus;

  @ApiProperty({ type: ModelPricingDto, description: '定价配置' })
  pricing: ModelPricingDto;

  @ApiProperty({ type: ModelLimitsDto, description: '限制配置' })
  limits: ModelLimitsDto;

  @ApiProperty({ type: ModelFeaturesDto, description: '功能配置' })
  features: ModelFeaturesDto;

  @ApiPropertyOptional({
    type: ModelConfigOverrideDto,
    description: '配置覆盖',
  })
  configOverride?: ModelConfigOverrideDto;

  @ApiPropertyOptional({ description: '元数据' })
  metadata?: Record<string, any>;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/**
 * 模型列表响应 DTO
 */
export class ModelsListResponseDto implements IModelsListResponseDto {
  @ApiProperty({ type: [ModelInfoDto], description: '模型列表' })
  list: ModelInfoDto[];

  @ApiProperty({ description: '总数' })
  total: number;

  @ApiProperty({ description: '当前页码' })
  page: number;

  @ApiProperty({ description: '每页数量' })
  pageSize: number;
}

/**
 * 测试模型 DTO
 */
export class TestModelDto implements ITestModelDto {
  @ApiProperty({ description: '模型 ID' })
  @IsUUID()
  modelId: string;

  @ApiProperty({
    description: '测试输入',
    example: { prompt: 'Hello, world!' },
  })
  input: any;
}

/**
 * 测试模型响应 DTO
 */
export class TestModelResponseDto implements ITestModelResponseDto {
  @ApiProperty({ description: '是否成功' })
  success: boolean;

  @ApiPropertyOptional({ description: '输出结果' })
  output?: any;

  @ApiPropertyOptional({ description: '延迟（毫秒）' })
  latency?: number;

  @ApiPropertyOptional({ description: '使用量统计' })
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };

  @ApiPropertyOptional({ description: '错误信息' })
  error?: string;
}
