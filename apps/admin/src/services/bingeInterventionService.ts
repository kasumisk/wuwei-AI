/**
 * 暴食干预效果追踪服务
 * 使用 React Query 进行状态管理
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '../utils/request';
import { PATH } from './path';

// ==================== 类型定义 ====================

export interface HourlyInterventionStat {
  hour: number;
  count: number;
  effectiveCount: number;
  effectiveRate: number;
}

export interface InterventionEffectivenessStats {
  windowDays: number;
  totalInterventions: number;
  evaluatedCount: number;
  effectiveCount: number;
  effectiveRate: number;
  postRecordRate: number;
  avgCalorieReduction: number | null;
  hourlyBreakdown: HourlyInterventionStat[];
  activeUserCount: number;
}

export interface InterventionRecord {
  id: string;
  userId: string;
  triggerHour: number;
  message: string;
  preCalories: number | null;
  postCalories: number | null;
  effective: boolean | null;
  hadPostRecord: boolean | null;
  evaluatedAt: string | null;
  createdAt: string;
}

export interface UserInterventionOverview {
  userId: string;
  totalInterventions: number;
  effectiveCount: number;
  effectiveRate: number;
  recentInterventions: InterventionRecord[];
}

export interface GetEffectivenessQuery {
  days?: number;
}

// ==================== Query Keys ====================

export const bingeInterventionQueryKeys = {
  all: ['binge-intervention'] as const,
  effectiveness: (params?: GetEffectivenessQuery) =>
    [...bingeInterventionQueryKeys.all, 'effectiveness', params] as const,
  userEffectiveness: (userId: string, params?: GetEffectivenessQuery) =>
    [...bingeInterventionQueryKeys.all, 'user', userId, params] as const,
};

// ==================== API ====================

export const bingeInterventionApi = {
  getEffectiveness: (params?: GetEffectivenessQuery): Promise<InterventionEffectivenessStats> =>
    request.get(`${PATH.ADMIN.BINGE_INTERVENTION}/effectiveness`, params),

  getUserEffectiveness: (
    userId: string,
    params?: GetEffectivenessQuery
  ): Promise<UserInterventionOverview> =>
    request.get(`${PATH.ADMIN.BINGE_INTERVENTION}/effectiveness/${userId}`, params),

  triggerEvaluation: (): Promise<{ evaluatedCount: number }> =>
    request.post(`${PATH.ADMIN.BINGE_INTERVENTION}/evaluate`, {}),
};

// ==================== React Query Hooks ====================

export const useEffectiveness = (params?: GetEffectivenessQuery, options?: any) => {
  return useQuery({
    queryKey: bingeInterventionQueryKeys.effectiveness(params),
    queryFn: () => bingeInterventionApi.getEffectiveness(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

export const useUserEffectiveness = (
  userId: string,
  params?: GetEffectivenessQuery,
  options?: any
) => {
  return useQuery({
    queryKey: bingeInterventionQueryKeys.userEffectiveness(userId, params),
    queryFn: () => bingeInterventionApi.getUserEffectiveness(userId, params),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

export const useTriggerEvaluation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => bingeInterventionApi.triggerEvaluation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bingeInterventionQueryKeys.all });
    },
  });
};
