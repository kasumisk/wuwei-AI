/**
 * 客户端管理相关的 DTO
 */

export enum ClientStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

/**
 * 配额配置
 */
export interface QuotaConfigDto {
  /** 月配额（美元） */
  monthlyQuota?: number;
  /** 日配额（美元） */
  dailyQuota?: number;
  /** 速率限制（次/分钟） */
  rateLimit?: number;
  /** 是否自动充值 */
  enableAutoRecharge?: boolean;
  /** 告警阈值（百分比） */
  alertThreshold?: number;
}

/**
 * 客户端元数据
 */
export interface ClientMetadataDto {
  /** 公司名称 */
  company?: string;
  /** 联系邮箱 */
  email?: string;
  /** 联系电话 */
  phone?: string;
  /** Webhook URL */
  webhookUrl?: string;
  /** IP 白名单 */
  allowedIps?: string[];
}

/**
 * 获取客户端列表查询参数
 */
export interface GetClientsQueryDto {
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 搜索关键词 */
  keyword?: string;
  /** 状态筛选 */
  status?: ClientStatus;
}

/**
 * 创建客户端
 */
export interface CreateClientDto {
  /** 客户端名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 配额配置 */
  quotaConfig?: QuotaConfigDto;
  /** 元数据 */
  metadata?: ClientMetadataDto;
}

/**
 * 更新客户端
 */
export interface UpdateClientDto {
  /** 客户端名称 */
  name?: string;
  /** 描述 */
  description?: string;
  /** 状态 */
  status?: ClientStatus;
  /** 配额配置 */
  quotaConfig?: QuotaConfigDto;
  /** 元数据 */
  metadata?: ClientMetadataDto;
}

/**
 * 客户端信息（响应）
 */
export interface ClientInfoDto {
  /** 客户端ID */
  id: string;
  /** 客户端名称 */
  name: string;
  /** API Key */
  apiKey: string;
  /** API Secret（隐藏） */
  apiSecret: string;
  /** 状态 */
  status: ClientStatus;
  /** 描述 */
  description?: string;
  /** 配额配置 */
  quotaConfig?: QuotaConfigDto;
  /** 元数据 */
  metadata?: ClientMetadataDto;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
}

/**
 * 客户端列表响应
 */
export interface ClientsListResponseDto {
  /** 客户端列表 */
  list: ClientInfoDto[];
  /** 总数 */
  total: number;
  /** 当前页 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}

/**
 * 创建客户端响应（包含明文密钥）
 */
export interface CreateClientResponseDto {
  /** 客户端信息 */
  client: ClientInfoDto;
  /** API Key */
  apiKey: string;
  /** API Secret（仅创建时返回） */
  apiSecret: string;
}

/**
 * 重新生成密钥响应
 */
export interface RegenerateSecretResponseDto {
  /** API Key */
  apiKey: string;
  /** API Secret（新生成的） */
  apiSecret: string;
  /** 提示消息 */
  message: string;
}

/**
 * 获取客户端使用统计查询参数
 */
export interface GetClientUsageQueryDto {
  /** 开始日期 */
  startDate: string;
  /** 结束日期 */
  endDate: string;
}

/**
 * 客户端使用统计响应
 */
export interface ClientUsageStatsDto {
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率 */
  successRate: number;
  /** 平均响应时间（毫秒） */
  avgResponseTime: number;
  /** 总成本（美元） */
  totalCost: number;
  /** 总输入 Tokens */
  totalInputTokens: number;
  /** 总输出 Tokens */
  totalOutputTokens: number;
  /** 总 Tokens */
  totalTokens: number;
  /** 按能力类型统计 */
  byCapability: Array<{
    capabilityType: string;
    requestCount: number;
    cost: number;
    tokens: number;
  }>;
  /** 时间序列数据（按天） */
  timeSeries: Array<{
    date: string;
    requests: number;
    cost: number;
    tokens: number;
  }>;
}
