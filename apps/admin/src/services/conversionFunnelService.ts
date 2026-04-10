import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface FunnelStep {
  step: number;
  name: string;
  count: number;
  conversionRate: number;
  dropoffRate: number;
  overallRate: number;
}

export interface ConversionFunnelData {
  period: { startDate: string; endDate: string };
  filters: { authType: string | null; triggerScene: string | null };
  funnelSteps: FunnelStep[];
  summary: {
    totalRegistered: number;
    totalPaid: number;
    overallConversionRate: number;
  };
}

export interface GetConversionFunnelQuery {
  startDate: string;
  endDate: string;
  authType?: string;
  triggerScene?: string;
}

export interface ConversionTrendItem {
  date: string;
  registered: number;
  triggered: number;
  paid: number;
  triggerRate: number;
  conversionRate: number;
}

export interface ConversionTrendData {
  period: { startDate: string; endDate: string };
  granularity: string;
  trend: ConversionTrendItem[];
}

export interface GetConversionTrendQuery {
  startDate: string;
  endDate: string;
  granularity?: 'day' | 'week' | 'month';
}

// ==================== Query Keys ====================

const _all = ['conversionFunnel'] as const;

export const conversionFunnelQueryKeys = {
  all: _all,
  funnel: (params: GetConversionFunnelQuery) => [..._all, 'funnel', params] as const,
  trend: (params: GetConversionTrendQuery) => [..._all, 'trend', params] as const,
};

// ==================== API ====================

export const conversionFunnelApi = {
  /** 获取转化漏斗数据 */
  getFunnel: (params: GetConversionFunnelQuery): Promise<ConversionFunnelData> =>
    request.get(PATH.ADMIN.CONVERSION_FUNNEL, params),

  /** 获取转化趋势数据 */
  getTrend: (params: GetConversionTrendQuery): Promise<ConversionTrendData> =>
    request.get(`${PATH.ADMIN.CONVERSION_FUNNEL}/trend`, params),
};

// ==================== React Query Hooks ====================

export const useConversionFunnel = (
  params: GetConversionFunnelQuery,
  options?: Omit<UseQueryOptions<ConversionFunnelData>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: conversionFunnelQueryKeys.funnel(params),
    queryFn: () => conversionFunnelApi.getFunnel(params),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useConversionTrend = (
  params: GetConversionTrendQuery,
  options?: Omit<UseQueryOptions<ConversionTrendData>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: conversionFunnelQueryKeys.trend(params),
    queryFn: () => conversionFunnelApi.getTrend(params),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export default conversionFunnelApi;
