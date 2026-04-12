import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

/** AI 能力 analytics/overview 响应（精简版，仅 dashboard 需要的字段） */
export interface AnalyticsOverviewSnapshot {
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  period: string;
}

/** 订阅总览 */
export interface SubscriptionOverviewSnapshot {
  totalSubscriptions: number;
  activeSubscriptions: number;
  byTier: Record<string, number>;
  byChannel: Record<string, number>;
  mrr: number;
  currency: string;
}

/** 用户活跃快照 */
export interface ActiveStatsSnapshot {
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  dauWauRatio: number;
  wauMauRatio: number;
  dailyActiveTrend: Array<{ date: string; count: number }>;
}

/** 用户增长快照 */
export interface GrowthSnapshot {
  totalUsers: number;
  periodNewUsers: number;
  trend: Array<{ date: string; count: number; cumulative: number }>;
}

/** 聚合仪表盘数据 */
export interface DashboardSummary {
  activeStats: ActiveStatsSnapshot;
  subscriptionOverview: SubscriptionOverviewSnapshot;
  growth: GrowthSnapshot;
  analyticsOverview: AnalyticsOverviewSnapshot | null;
}

/** 分析统计（来自 analysis-records/statistics） */
export interface AnalysisStatisticsSnapshot {
  total: number;
  byInputType: { text: number; image: number };
  byReviewStatus: { pending: number; approved: number; rejected: number };
  avgConfidence: number;
  todayCount: number;
}

/** 推荐质量概览（来自 recommendation-debug/quality-dashboard） */
export interface RecommendQualitySnapshot {
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  skipRate: number;
  activeUsers: number;
  avgDailyFeedbacks: number;
}

/** 转化漏斗摘要（来自 analytics/funnel） */
export interface ConversionSummarySnapshot {
  totalRegistered: number;
  totalPaid: number;
  overallConversionRate: number;
}

// ==================== Query Keys ====================

const _all = ['dashboard'] as const;

export const dashboardQueryKeys = {
  all: _all,
  activeStats: [..._all, 'active-stats'] as const,
  subscriptionOverview: [..._all, 'subscription-overview'] as const,
  growth: (days: number) => [..._all, 'growth', days] as const,
  analyticsOverview: (startDate: string, endDate: string) =>
    [..._all, 'analytics-overview', startDate, endDate] as const,
  analysisStatistics: [..._all, 'analysis-statistics'] as const,
  recommendQuality: (days: number) => [..._all, 'recommend-quality', days] as const,
  conversionSummary: (startDate: string, endDate: string) =>
    [..._all, 'conversion-summary', startDate, endDate] as const,
};

// ==================== API Functions ====================

export const dashboardApi = {
  /** 活跃用户统计 */
  getActiveStats: (): Promise<ActiveStatsSnapshot> =>
    request.get(`${PATH.ADMIN.USER_DASHBOARD}/active-stats`),

  /** 用户增长趋势（近 N 天） */
  getGrowthTrend: (days = 30): Promise<GrowthSnapshot> =>
    request.get(`${PATH.ADMIN.USER_DASHBOARD}/growth-trend`, { days, granularity: 'day' }),

  /** 订阅总览 */
  getSubscriptionOverview: (): Promise<SubscriptionOverviewSnapshot> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/overview`),

  /** AI 能力 analytics 总览（7 天窗口） */
  getAnalyticsOverview: (startDate: string, endDate: string): Promise<AnalyticsOverviewSnapshot> =>
    request.get(`${PATH.ADMIN.ANALYTICS}/overview`, { startDate, endDate }),

  /** 分析统计（总量/今日/分类/置信度） */
  getAnalysisStatistics: (): Promise<AnalysisStatisticsSnapshot> =>
    request.get(`${PATH.ADMIN.ANALYSIS_RECORDS}/statistics`),

  /** 推荐质量概览 */
  getRecommendQuality: (days = 7): Promise<{ overview: RecommendQualitySnapshot }> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/quality-dashboard`, { days }),

  /** 转化漏斗摘要 */
  getConversionSummary: (
    startDate: string,
    endDate: string
  ): Promise<{ summary: ConversionSummarySnapshot }> =>
    request.get(PATH.ADMIN.CONVERSION_FUNNEL, { startDate, endDate }),
};

// ==================== React Query Hooks ====================

export const useDashboardActiveStats = (
  options?: Omit<UseQueryOptions<ActiveStatsSnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.activeStats,
    queryFn: () => dashboardApi.getActiveStats(),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    ...options,
  });

export const useDashboardGrowth = (
  days = 30,
  options?: Omit<UseQueryOptions<GrowthSnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.growth(days),
    queryFn: () => dashboardApi.getGrowthTrend(days),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useDashboardSubscriptionOverview = (
  options?: Omit<UseQueryOptions<SubscriptionOverviewSnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.subscriptionOverview,
    queryFn: () => dashboardApi.getSubscriptionOverview(),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    ...options,
  });

export const useDashboardAnalyticsOverview = (
  startDate: string,
  endDate: string,
  options?: Omit<UseQueryOptions<AnalyticsOverviewSnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.analyticsOverview(startDate, endDate),
    queryFn: () => dashboardApi.getAnalyticsOverview(startDate, endDate),
    staleTime: 3 * 60 * 1000,
    ...options,
  });

/** 分析统计：总量/今日/置信度 */
export const useDashboardAnalysisStatistics = (
  options?: Omit<UseQueryOptions<AnalysisStatisticsSnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.analysisStatistics,
    queryFn: () => dashboardApi.getAnalysisStatistics(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    ...options,
  });

/** 推荐质量：接受率/替换率/跳过率 */
export const useDashboardRecommendQuality = (
  days = 7,
  options?: Omit<UseQueryOptions<RecommendQualitySnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.recommendQuality(days),
    queryFn: async () => {
      const res = await dashboardApi.getRecommendQuality(days);
      return res.overview;
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });

/** 转化漏斗：注册→付费转化率 */
export const useDashboardConversionSummary = (
  startDate: string,
  endDate: string,
  options?: Omit<UseQueryOptions<ConversionSummarySnapshot>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: dashboardQueryKeys.conversionSummary(startDate, endDate),
    queryFn: async () => {
      const res = await dashboardApi.getConversionSummary(startDate, endDate);
      return res.summary;
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
