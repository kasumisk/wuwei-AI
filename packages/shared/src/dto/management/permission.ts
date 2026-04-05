/**
 * 客户端能力权限管理相关的 DTO
 */

import { CapabilityType } from './types';

/**
 * 权限配置
 */
export interface PermissionConfigDto {
  /** 最大并发请求数 */
  maxConcurrentRequests?: number;
  /** 允许故障转移 */
  fallbackEnabled?: boolean;
  /** 单次请求最大成本（美元） */
  costLimit?: number;
  /** 自定义参数 */
  customParams?: any;
  /** 其他配置 */
  [key: string]: any;
}

/**
 * 创建权限
 */
export interface CreatePermissionDto {
  /** 客户端ID */
  clientId: string;
  /** 能力类型 */
  capabilityType: CapabilityType;
  /** 是否启用 */
  enabled?: boolean;
  /** 速率限制（次/分钟） */
  rateLimit?: number;
  /** 配额限制（文本: token数, 图像: 图片数） */
  quotaLimit?: number;
  /** 首选提供商 */
  preferredProvider?: string;
  /** 允许的提供商列表 */
  allowedProviders?: string[];
  /** 允许的模型列表 */
  allowedModels?: string[];
  /** 配置 */
  config?: PermissionConfigDto;
}

/**
 * 更新权限
 */
export interface UpdatePermissionDto {
  /** 是否启用 */
  enabled?: boolean;
  /** 速率限制（次/分钟） */
  rateLimit?: number;
  /** 配额限制（文本: token数, 图像: 图片数） */
  quotaLimit?: number;
  /** 首选提供商 */
  preferredProvider?: string;
  /** 允许的提供商列表 */
  allowedProviders?: string[];
  /** 允许的模型列表 */
  allowedModels?: string[];
  /** 配置 */
  config?: PermissionConfigDto;
}

/**
 * 批量权限项
 */
export interface BatchPermissionItemDto {
  /** 能力类型 */
  capabilityType: CapabilityType;
  /** 是否启用 */
  enabled: boolean;
  /** 速率限制（次/分钟） */
  rateLimit?: number;
  /** 配额限制 */
  quotaLimit?: number;
}

/**
 * 批量更新权限
 */
export interface BatchUpdatePermissionsDto {
  /** 权限列表 */
  permissions: BatchPermissionItemDto[];
}

/**
 * 权限信息（响应）
 */
export interface PermissionInfoDto {
  /** 权限ID */
  id: string;
  /** 客户端ID */
  clientId: string;
  /** 能力类型 */
  capabilityType: CapabilityType;
  /** 是否启用 */
  enabled: boolean;
  /** 速率限制（次/分钟） */
  rateLimit: number;
  /** 配额限制（文本: token数, 图像: 图片数） */
  quotaLimit?: number;
  /** 首选提供商 */
  preferredProvider?: string;
  /** 允许的提供商列表 */
  allowedProviders?: string[];
  /** 允许的模型列表 */
  allowedModels?: string[];
  /** 配置 */
  config?: PermissionConfigDto;
  /** 创建时间 */
  createdAt: Date | string;
}

/**
 * 批量更新结果项
 */
export interface BatchUpdateResultItemDto {
  /** 能力类型 */
  capabilityType: CapabilityType;
  /** 操作类型 */
  action: 'created' | 'updated' | 'failed';
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 批量更新权限响应
 */
export interface BatchUpdatePermissionsResponseDto {
  /** 总数 */
  total: number;
  /** 成功数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 详细结果 */
  details: BatchUpdateResultItemDto[];
}

/**
 * 权限列表响应
 */
export interface PermissionsListResponseDto {
  /** 权限列表 */
  list: PermissionInfoDto[];
}

// 为兼容性导出别名
export type BatchUpdateResultDto = BatchUpdatePermissionsResponseDto;
