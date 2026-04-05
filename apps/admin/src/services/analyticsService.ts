/**
 * 统计分析服务
 * 使用 React Query 进行状态管理
 */

import { useQuery } from '@tanstack/react-query';
import type {
  GetOverviewQueryDto,
  OverviewStatsDto,
  GetTopClientsQueryDto,
  TopClientsResponseDto,
  GetCapabilityUsageQueryDto,
  CapabilityUsageResponseDto,
  GetTimeSeriesQueryDto,
  TimeSeriesResponseDto,
  GetCostAnalysisQueryDto,
  CostAnalysisResponseDto,
  GetErrorAnalysisQueryDto,
  ErrorAnalysisResponseDto,
  DashboardStatsDto,
} from '@ai-platform/shared';
import request from '../utils/request';
import { PATH } from './path';

// ==================== Query Keys ====================

export const analyticsQueryKeys = {
  analytics: ['analytics'] as const,
  overview: (params: GetOverviewQueryDto) =>
    [...analyticsQueryKeys.analytics, 'overview', params] as const,
  topClients: (params: GetTopClientsQueryDto) =>
    [...analyticsQueryKeys.analytics, 'topClients', params] as const,
  capabilityUsage: (params: GetCapabilityUsageQueryDto) =>
    [...analyticsQueryKeys.analytics, 'capabilityUsage', params] as const,
  timeSeries: (params: GetTimeSeriesQueryDto) =>
    [...analyticsQueryKeys.analytics, 'timeSeries', params] as const,
  costAnalysis: (params: GetCostAnalysisQueryDto) =>
    [...analyticsQueryKeys.analytics, 'costAnalysis', params] as const,
  errorAnalysis: (params: GetErrorAnalysisQueryDto) =>
    [...analyticsQueryKeys.analytics, 'errorAnalysis', params] as const,
  dashboard: (params: GetOverviewQueryDto) =>
    [...analyticsQueryKeys.analytics, 'dashboard', params] as const,
};

// ==================== API Functions ====================

export const analyticsApi = {
  /**
   * 获取总览数据
   */
  getOverview: async (params: GetOverviewQueryDto): Promise<OverviewStatsDto> => {
    return await request.get<OverviewStatsDto>(`${PATH.ADMIN.ANALYTICS}/overview`, params);
  },

  /**
   * 获取客户端排行
   */
  getTopClients: async (params: GetTopClientsQueryDto): Promise<TopClientsResponseDto> => {
    return await request.get<TopClientsResponseDto>(`${PATH.ADMIN.ANALYTICS}/top-clients`, params);
  },

  /**
   * 获取能力使用统计
   */
  getCapabilityUsage: async (
    params: GetCapabilityUsageQueryDto
  ): Promise<CapabilityUsageResponseDto> => {
    return await request.get<CapabilityUsageResponseDto>(
      `${PATH.ADMIN.ANALYTICS}/capability-usage`,
      params
    );
  },

  /**
   * 获取时间序列数据
   */
  getTimeSeries: async (params: GetTimeSeriesQueryDto): Promise<TimeSeriesResponseDto> => {
    return await request.get<TimeSeriesResponseDto>(`${PATH.ADMIN.ANALYTICS}/time-series`, params);
  },

  /**
   * 获取成本分析
   */
  getCostAnalysis: async (params: GetCostAnalysisQueryDto): Promise<CostAnalysisResponseDto> => {
    return await request.get<CostAnalysisResponseDto>(
      `${PATH.ADMIN.ANALYTICS}/cost-analysis`,
      params
    );
  },

  /**
   * 获取错误分析
   */
  getErrorAnalysis: async (params: GetErrorAnalysisQueryDto): Promise<ErrorAnalysisResponseDto> => {
    return await request.get<ErrorAnalysisResponseDto>(
      `${PATH.ADMIN.ANALYTICS}/error-analysis`,
      params
    );
  },

  /**
   * 获取仪表盘聚合数据
   */
  getDashboard: async (params: GetOverviewQueryDto): Promise<DashboardStatsDto> => {
    return await request.get<DashboardStatsDto>(`${PATH.ADMIN.ANALYTICS}/dashboard`, params);
  },

  /**
   * 导出报表
   */
  exportReport: async (params: any): Promise<Blob> => {
    return await request.get<Blob>(`${PATH.ADMIN.ANALYTICS}/export`, params, {
      responseType: 'blob',
    });
  },
};

// ==================== React Query Hooks ====================

/**
 * 获取总览数据
 */
export const useOverview = (params: GetOverviewQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.overview(params),
    queryFn: () => analyticsApi.getOverview(params),
    staleTime: 1 * 60 * 1000, // 1分钟
    ...options,
  });
};

/**
 * 获取客户端排行
 */
export const useTopClients = (params: GetTopClientsQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.topClients(params),
    queryFn: () => analyticsApi.getTopClients(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取能力使用统计
 */
export const useCapabilityUsage = (params: GetCapabilityUsageQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.capabilityUsage(params),
    queryFn: () => analyticsApi.getCapabilityUsage(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取时间序列数据
 */
export const useTimeSeries = (params: GetTimeSeriesQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.timeSeries(params),
    queryFn: () => analyticsApi.getTimeSeries(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取成本分析
 */
export const useCostAnalysis = (params: GetCostAnalysisQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.costAnalysis(params),
    queryFn: () => analyticsApi.getCostAnalysis(params),
    staleTime: 5 * 60 * 1000, // 5分钟
    ...options,
  });
};

/**
 * 获取错误分析
 */
export const useErrorAnalysis = (params: GetErrorAnalysisQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.errorAnalysis(params),
    queryFn: () => analyticsApi.getErrorAnalysis(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取仪表盘聚合数据
 */
export const useDashboard = (params: GetOverviewQueryDto, options?: any) => {
  return useQuery({
    queryKey: analyticsQueryKeys.dashboard(params),
    queryFn: () => analyticsApi.getDashboard(params),
    staleTime: 1 * 60 * 1000, // 1分钟
    refetchInterval: 5 * 60 * 1000, // 每5分钟自动刷新
    ...options,
  });
};

// ==================== Helper Functions ====================

/**
 * 导出报表
 * 这是一个普通函数，不是 Hook
 */
export const downloadReport = async (params: any, filename: string) => {
  try {
    const blob = await analyticsApi.exportReport(params);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('导出报表失败:', error);
    throw error;
  }
};

/**
 * 格式化日期范围为查询参数
 */
export const formatDateRange = (
  startDate: Date | string,
  endDate: Date | string
): { startDate: string; endDate: string } => {
  const format = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
  };

  return {
    startDate: format(startDate),
    endDate: format(endDate),
  };
};

/**
 * 获取预设日期范围
 */
export const getPresetDateRange = (preset: 'today' | 'week' | 'month' | 'year') => {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];

  let startDate: string;
  const date = new Date();

  switch (preset) {
    case 'today':
      startDate = endDate;
      break;
    case 'week':
      date.setDate(date.getDate() - 7);
      startDate = date.toISOString().split('T')[0];
      break;
    case 'month':
      date.setMonth(date.getMonth() - 1);
      startDate = date.toISOString().split('T')[0];
      break;
    case 'year':
      date.setFullYear(date.getFullYear() - 1);
      startDate = date.toISOString().split('T')[0];
      break;
    default:
      startDate = endDate;
  }

  return { startDate, endDate };
};
