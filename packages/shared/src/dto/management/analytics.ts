/**
 * 统计分析相关的 DTO
 */

import { CapabilityType } from './types';

/**
 * 时间间隔类型
 */
export enum TimeInterval {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

/**
 * 分组维度
 */
export enum GroupBy {
  CLIENT = 'client',
  CAPABILITY = 'capability',
  PROVIDER = 'provider',
  MODEL = 'model',
}

/**
 * 获取总览数据查询参数
 */
export interface GetOverviewQueryDto {
  startDate: string;
  endDate: string;
}

/**
 * 总览数据 DTO
 */
export interface OverviewStatsDto {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  totalCost: number;
  totalTokens: number;
  uniqueClients: number;
}

/**
 * 获取客户端排行查询参数
 */
export interface GetTopClientsQueryDto {
  startDate: string;
  endDate: string;
  limit?: number;
}

/**
 * 客户端排行项 DTO
 */
export interface TopClientDto {
  clientId: string;
  clientName: string;
  requestCount: number;
  successRate: number;
  totalCost: number;
  totalTokens: number;
}

/**
 * 客户端排行响应 DTO
 */
export interface TopClientsResponseDto {
  clients: TopClientDto[];
}

/**
 * 获取能力使用统计查询参数
 */
export interface GetCapabilityUsageQueryDto {
  startDate: string;
  endDate: string;
  capabilityType?: CapabilityType;
}

/**
 * 能力使用统计项 DTO
 */
export interface CapabilityUsageDto {
  capabilityType: CapabilityType;
  requestCount: number;
  successRate: number;
  avgResponseTime: number;
  totalCost: number;
  totalTokens: number;
}

/**
 * 能力使用统计响应 DTO
 */
export interface CapabilityUsageResponseDto {
  usage: CapabilityUsageDto[];
}

/**
 * 获取时间序列数据查询参数
 */
export interface GetTimeSeriesQueryDto {
  startDate: string;
  endDate: string;
  interval: TimeInterval;
  metric?: 'requests' | 'cost' | 'tokens' | 'responseTime';
}

/**
 * 时间序列数据点 DTO
 */
export interface TimeSeriesDataPointDto {
  timestamp: string;
  value: number;
}

/**
 * 时间序列数据响应 DTO
 */
export interface TimeSeriesResponseDto {
  data: TimeSeriesDataPointDto[];
  metric: string;
  interval: TimeInterval;
}

/**
 * 获取成本分析查询参数
 */
export interface GetCostAnalysisQueryDto {
  startDate: string;
  endDate: string;
  groupBy: GroupBy;
}

/**
 * 成本分析项 DTO
 */
export interface CostAnalysisItemDto {
  name: string;
  id: string;
  cost: number;
  requests: number;
  tokens: number;
  percentage: number;
}

/**
 * 成本分析响应 DTO
 */
export interface CostAnalysisResponseDto {
  items: CostAnalysisItemDto[];
  totalCost: number;
  groupBy: GroupBy;
}

/**
 * 获取错误分析查询参数
 */
export interface GetErrorAnalysisQueryDto {
  startDate: string;
  endDate: string;
  limit?: number;
}

/**
 * 错误类型统计 DTO
 */
export interface ErrorTypeDto {
  errorType: string;
  errorMessage: string;
  count: number;
  percentage: number;
  lastOccurrence: Date;
}

/**
 * 错误分析响应 DTO
 */
export interface ErrorAnalysisResponseDto {
  errors: ErrorTypeDto[];
  totalErrors: number;
}

/**
 * 导出报表查询参数
 */
export interface ExportReportQueryDto {
  startDate: string;
  endDate: string;
  format: 'csv' | 'xlsx';
  includeDetails?: boolean;
}

/**
 * 仪表盘统计数据（聚合）
 */
export interface DashboardStatsDto {
  overview: OverviewStatsDto;
  topClients: TopClientDto[];
  capabilityUsage: CapabilityUsageDto[];
  recentErrors: ErrorTypeDto[];
}
