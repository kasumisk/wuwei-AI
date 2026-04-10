import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface GrowthTrendItem {
  date: string;
  count: number;
  cumulative: number;
  byAuthType: Record<string, number>;
}

export interface GrowthTrendResult {
  days: number;
  granularity: string;
  totalUsers: number;
  periodNewUsers: number;
  trend: GrowthTrendItem[];
}

export interface DistributionItem {
  [key: string]: string | number;
}

export interface ProfileDistributionResult {
  days: number;
  distributions: {
    authType: Array<{ authType: string; count: number }>;
    goal: Array<{ goal: string; count: number }>;
    activityLevel: Array<{ activityLevel: string; count: number }>;
    gender: Array<{ gender: string; count: number }>;
    churnRisk: Array<{ segment: string; count: number }>;
    compliance: Array<{ segment: string; count: number }>;
  };
  onboarding: {
    totalProfiles: number;
    completedOnboarding: number;
    completionRate: number;
  };
  behaviorStats: {
    totalWithBehavior: number;
    avgComplianceRate: number;
    avgStreakDays: number;
    maxLongestStreak: number;
    avgTotalRecords: number;
  };
  inferredStats: {
    totalWithInferred: number;
    avgBMR: number;
    avgTDEE: number;
    avgRecommendedCalories: number;
    avgChurnRisk: number;
  };
}

export interface ActiveStatsResult {
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  dauWauRatio: number;
  wauMauRatio: number;
  dailyActiveTrend: Array<{ date: string; count: number }>;
}

// ==================== Query Keys ====================

const _all = ['user-dashboard'] as const;

export const userDashboardQueryKeys = {
  all: _all,
  growthTrend: (days?: number, granularity?: string) =>
    [..._all, 'growth-trend', days, granularity] as const,
  profileDistribution: (days?: number) => [..._all, 'profile-distribution', days] as const,
  activeStats: (days?: number) => [..._all, 'active-stats', days] as const,
};

// ==================== API ====================

export const userDashboardApi = {
  /** 用户增长趋势 */
  getGrowthTrend: (params?: { days?: number; granularity?: string }): Promise<GrowthTrendResult> =>
    request.get(`${PATH.ADMIN.USER_DASHBOARD}/growth-trend`, params),

  /** 用户画像分布 */
  getProfileDistribution: (params?: { days?: number }): Promise<ProfileDistributionResult> =>
    request.get(`${PATH.ADMIN.USER_DASHBOARD}/profile-distribution`, params),

  /** 活跃用户统计 */
  getActiveStats: (days?: number): Promise<ActiveStatsResult> =>
    request.get(`${PATH.ADMIN.USER_DASHBOARD}/active-stats`, {
      ...(days ? { days } : {}),
    }),
};

// ==================== React Query Hooks ====================

export const useGrowthTrend = (
  days?: number,
  granularity?: string,
  options?: Omit<UseQueryOptions<GrowthTrendResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: userDashboardQueryKeys.growthTrend(days, granularity),
    queryFn: () => userDashboardApi.getGrowthTrend({ days, granularity }),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useProfileDistribution = (
  days?: number,
  options?: Omit<UseQueryOptions<ProfileDistributionResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: userDashboardQueryKeys.profileDistribution(days),
    queryFn: () => userDashboardApi.getProfileDistribution({ days }),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useActiveStats = (
  days?: number,
  options?: Omit<UseQueryOptions<ActiveStatsResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: userDashboardQueryKeys.activeStats(days),
    queryFn: () => userDashboardApi.getActiveStats(days),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
