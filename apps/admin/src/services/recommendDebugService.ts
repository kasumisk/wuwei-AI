import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface SimulateRecommendDto {
  userId: string;
  mealType: string;
  goalType?: string;
  consumedCalories?: number;
  consumedProtein?: number;
}

export interface SimulateRecommendResult {
  userId: string;
  mealType: string;
  goalType: string;
  input: {
    consumed: { calories: number; protein: number };
    target: { calories: number; protein: number; fat: number; carbs: number };
    dailyTarget: { calories: number; protein: number };
    userProfile: {
      allergens: string[];
      dietaryRestrictions: string[];
      healthConditions: string[];
      regionCode: string;
    };
  };
  result: Record<string, unknown>;
  performance: { elapsedMs: number };
  note: string;
}

export interface WhyNotDto {
  userId: string;
  foodName: string;
  mealType: string;
  goalType?: string;
}

export interface WhyNotResult {
  userId: string;
  queryFoodName: string;
  mealType: string;
  goalType: string;
  foodName: string;
  found: boolean;
  score: number;
  reason: string;
  alternatives: Array<{
    foodId: string;
    name: string;
    category: string;
    score: number;
    servingCalories: number;
    servingProtein: number;
  }>;
}

export interface UserStrategyResult {
  userId: string;
  goalType: string;
  hasProfile: boolean;
  resolvedStrategy: {
    strategyId: string;
    strategyName: string;
    sources: string[];
    config: Record<string, unknown>;
    resolvedAt: number;
  };
  experimentAssignment: {
    experimentId: string;
    experimentName: string;
    groupName: string;
    scoreWeightOverrides: Record<string, number[]> | null;
    mealWeightOverrides: Record<string, Record<string, number>> | null;
  } | null;
  experimentStrategy: {
    config: Record<string, unknown>;
    experimentId: string;
    groupName: string;
  } | null;
}

export interface QualityOverview {
  dateRange: { from: string; to: string };
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  skipRate: number;
  activeUsers: number;
  avgDailyFeedbacks: number;
}

export interface AcceptanceByDimension {
  dimension: string;
  total: number;
  accepted: number;
  rate: number;
}

export interface DailyTrend {
  date: string;
  total: number;
  accepted: number;
  replaced: number;
  skipped: number;
  acceptanceRate: number;
}

export interface PlanCoverage {
  dateRange: { from: string; to: string };
  totalPlans: number;
  adjustedPlans: number;
  avgPlanCalories: number;
  uniqueUsers: number;
}

export interface QualityDashboard {
  days: number;
  overview: QualityOverview;
  byGoal: AcceptanceByDimension[];
  byMeal: AcceptanceByDimension[];
  trend: DailyTrend[];
  planCoverage: PlanCoverage;
}

// ==================== Query Keys ====================

const _all = ['recommendation-debug'] as const;

export const recommendDebugQueryKeys = {
  all: _all,
  userStrategy: (userId: string, goalType?: string) =>
    [..._all, 'user-strategy', userId, goalType] as const,
  qualityDashboard: (days?: number) => [..._all, 'quality-dashboard', days] as const,
};

// ==================== API ====================

export const recommendDebugApi = {
  /** 模拟推荐 */
  simulateRecommend: (data: SimulateRecommendDto): Promise<SimulateRecommendResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/simulate`, data),

  /** 反向解释 */
  whyNot: (data: WhyNotDto): Promise<WhyNotResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/why-not`, data),

  /** 获取用户当前策略 */
  getUserStrategy: (userId: string, goalType?: string): Promise<UserStrategyResult> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/user-strategy/${userId}`, {
      ...(goalType ? { goalType } : {}),
    }),

  /** 推荐质量仪表盘 */
  getQualityDashboard: (days?: number): Promise<QualityDashboard> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/quality-dashboard`, {
      ...(days ? { days } : {}),
    }),
};

// ==================== React Query Hooks ====================

export const useUserStrategy = (
  userId: string,
  goalType?: string,
  options?: Omit<UseQueryOptions<UserStrategyResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.userStrategy(userId, goalType),
    queryFn: () => recommendDebugApi.getUserStrategy(userId, goalType),
    enabled: !!userId,
    staleTime: 30 * 1000,
    ...options,
  });

export const useQualityDashboard = (
  days?: number,
  options?: Omit<UseQueryOptions<QualityDashboard>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.qualityDashboard(days),
    queryFn: () => recommendDebugApi.getQualityDashboard(days),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useSimulateRecommend = (
  options?: UseMutationOptions<SimulateRecommendResult, Error, SimulateRecommendDto>
) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.simulateRecommend(data),
    ...options,
  });

export const useWhyNot = (options?: UseMutationOptions<WhyNotResult, Error, WhyNotDto>) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.whyNot(data),
    ...options,
  });
