/**
 * Thompson Sampling 收敛分析服务
 * 使用 React Query 进行状态管理
 */

import { useQuery } from '@tanstack/react-query';
import request from '../utils/request';
import { PATH } from './path';

// ==================== 类型定义 ====================

export interface FoodBetaDistribution {
  foodName: string;
  accepted: number;
  rejected: number;
  alpha: number;
  beta: number;
  mean: number;
  variance: number;
  convergence: number;
  totalInteractions: number;
}

export interface PhaseDistribution {
  exploring: number;
  converging: number;
  converged: number;
}

export interface GlobalConvergenceStats {
  activeUserCount: number;
  avgConvergence: number;
  phaseDistribution: PhaseDistribution;
  mostConverged: FoodBetaDistribution[];
  leastConverged: FoodBetaDistribution[];
}

export interface UserConvergenceOverview {
  userId: string;
  foodCount: number;
  avgConvergence: number;
  totalInteractions: number;
  phase: 'exploring' | 'converging' | 'converged';
  distributions: FoodBetaDistribution[];
}

export interface GetConvergenceQuery {
  days?: number;
  topN?: number;
}

export interface GetUserConvergenceQuery {
  days?: number;
}

// ==================== Query Keys ====================

export const thompsonSamplingQueryKeys = {
  all: ['thompson-sampling'] as const,
  convergence: (params?: GetConvergenceQuery) =>
    [...thompsonSamplingQueryKeys.all, 'convergence', params] as const,
  userConvergence: (userId: string, params?: GetUserConvergenceQuery) =>
    [...thompsonSamplingQueryKeys.all, 'user', userId, params] as const,
};

// ==================== API ====================

export const thompsonSamplingApi = {
  getConvergence: (params?: GetConvergenceQuery): Promise<GlobalConvergenceStats> =>
    request.get(`${PATH.ADMIN.THOMPSON_SAMPLING}/convergence`, params),

  getUserConvergence: (
    userId: string,
    params?: GetUserConvergenceQuery
  ): Promise<UserConvergenceOverview> =>
    request.get(`${PATH.ADMIN.THOMPSON_SAMPLING}/convergence/${userId}`, params),
};

// ==================== React Query Hooks ====================

export const useConvergence = (params?: GetConvergenceQuery, options?: any) => {
  return useQuery({
    queryKey: thompsonSamplingQueryKeys.convergence(params),
    queryFn: () => thompsonSamplingApi.getConvergence(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

export const useUserConvergence = (
  userId: string,
  params?: GetUserConvergenceQuery,
  options?: any
) => {
  return useQuery({
    queryKey: thompsonSamplingQueryKeys.userConvergence(userId, params),
    queryFn: () => thompsonSamplingApi.getUserConvergence(userId, params),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};
