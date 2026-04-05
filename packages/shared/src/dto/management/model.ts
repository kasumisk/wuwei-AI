/**
 * 模型管理相关的 DTO 定义
 */

import { CapabilityType } from './types';

/**
 * 模型状态枚举
 */
export enum ModelStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

/**
 * 货币类型枚举
 */
export enum Currency {
  USD = 'USD',
  CNY = 'CNY',
}

/**
 * 模型定价配置
 */
export interface ModelPricingDto {
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  currency: Currency;
}

/**
 * 模型限制配置
 */
export interface ModelLimitsDto {
  maxTokens: number;
  maxRequestsPerMinute?: number;
  contextWindow: number;
}

/**
 * 模型功能配置
 */
export interface ModelFeaturesDto {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
}

/**
 * 获取模型列表查询参数
 */
export interface GetModelsQueryDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  providerId?: string;
  capabilityType?: CapabilityType;
  status?: ModelStatus;
}

/**
 * 模型配置覆盖（可选）
 * 用于覆盖 Provider 级别的配置
 */
export interface ModelConfigOverrideDto {
  endpoint?: string;
  customApiKey?: string;
  customTimeout?: number;
  customRetries?: number;
  configMetadata?: Record<string, any>;
}

/**
 * 创建模型 DTO
 */
export interface CreateModelDto {
  providerId: string;
  modelName: string;
  displayName: string;
  capabilityType: CapabilityType;
  enabled?: boolean;
  priority?: number;
  pricing: ModelPricingDto;
  limits: ModelLimitsDto;
  features: ModelFeaturesDto;
  configOverride?: ModelConfigOverrideDto;
  metadata?: Record<string, any>;
}

/**
 * 更新模型 DTO
 */
export interface UpdateModelDto {
  displayName?: string;
  enabled?: boolean;
  priority?: number;
  pricing?: ModelPricingDto;
  limits?: ModelLimitsDto;
  features?: ModelFeaturesDto;
  configOverride?: ModelConfigOverrideDto;
  metadata?: Record<string, any>;
}

/**
 * 模型信息 DTO
 */
export interface ModelInfoDto {
  id: string;
  providerId: string;
  providerName: string;
  modelName: string;
  displayName: string;
  capabilityType: CapabilityType;
  enabled: boolean;
  priority: number;
  status: ModelStatus;
  pricing: ModelPricingDto;
  limits: ModelLimitsDto;
  features: ModelFeaturesDto;
  configOverride?: ModelConfigOverrideDto;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 模型列表响应 DTO
 */
export interface ModelsListResponseDto {
  list: ModelInfoDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 测试模型 DTO
 */
export interface TestModelDto {
  modelId: string;
  input: any;
}

/**
 * 测试模型响应 DTO
 */
export interface TestModelResponseDto {
  success: boolean;
  output?: any;
  latency?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
  error?: string;
}
