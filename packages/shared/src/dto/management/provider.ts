/**
 * 提供商管理相关的 DTO 定义
 */

/**
 * 提供商类型枚举
 */
export enum ProviderType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  DEEPSEEK = 'deepseek',
  QWEN = 'qwen',
  GOOGLE = 'google',
  BAIDU = 'baidu',
  ALIBABA = 'alibaba',
  TENCENT = 'tencent',
  CUSTOM = 'custom',
}

/**
 * 提供商状态枚举
 */
export enum ProviderStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

/**
 * 获取提供商列表查询参数
 */
export interface GetProvidersQueryDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: ProviderType;
  status?: ProviderStatus;
}

/**
 * 创建提供商 DTO
 */
export interface CreateProviderDto {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
  healthCheckUrl?: string;
  timeout?: number;
  retryCount?: number;
  metadata?: Record<string, any>;
}

/**
 * 更新提供商 DTO
 */
export interface UpdateProviderDto {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  healthCheckUrl?: string;
  timeout?: number;
  retryCount?: number;
  metadata?: Record<string, any>;
}

/**
 * 提供商信息 DTO
 */
export interface ProviderInfoDto {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  enabled: boolean;
  healthCheckUrl?: string;
  timeout: number;
  retryCount: number;
  status: ProviderStatus;
  lastHealthCheck?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 提供商列表响应 DTO
 */
export interface ProvidersListResponseDto {
  list: ProviderInfoDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 测试提供商连接 DTO
 */
export interface TestProviderDto {
  providerId: string;
  testEndpoint?: string;
}

/**
 * 测试提供商连接响应 DTO
 */
export interface TestProviderResponseDto {
  success: boolean;
  message?: string;
  latency?: number;
  error?: string;
}

/**
 * 提供商健康状态 DTO
 */
export interface ProviderHealthDto {
  providerId: string;
  status: ProviderStatus;
  lastCheck: Date;
  latency?: number;
  error?: string;
}
