import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface ChurnDistribution {
  windowDays: number;
  totalUsers: number;
  distribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  avgRisk: number;
  highRiskUsers: Array<{
    userId: string;
    churnRisk: number;
    topRiskFactors: string[];
  }>;
}

export type ChurnRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ChurnFeature {
  name: string;
  rawValue: number;
  riskScore: number;
  weight: number;
  weightedScore: number;
}

export interface ChurnPrediction {
  userId: string;
  churnRisk: number;
  confidence: number;
  riskLevel: ChurnRiskLevel;
  features: ChurnFeature[];
  topRiskFactors: string[];
  computedAt: string;
}

// ==================== Query Keys ====================

const _all = ['churn-prediction'] as const;

export const churnQueryKeys = {
  all: _all,
  distribution: (topN?: number) => [..._all, 'distribution', topN] as const,
  predict: (userId: string) => [..._all, 'predict', userId] as const,
};

// ==================== API Functions ====================

export const churnApi = {
  getDistribution: (topN = 20): Promise<ChurnDistribution> =>
    request.get(`${PATH.ADMIN.CHURN_PREDICTION}/distribution`, { topN }),

  predictUser: (userId: string): Promise<ChurnPrediction> =>
    request.get(`${PATH.ADMIN.CHURN_PREDICTION}/predict/${userId}`),
};

// ==================== React Query Hooks ====================

export const useChurnDistribution = (
  topN = 20,
  options?: Omit<UseQueryOptions<ChurnDistribution>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: churnQueryKeys.distribution(topN),
    queryFn: () => churnApi.getDistribution(topN),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useChurnPrediction = (
  userId: string,
  options?: Omit<UseQueryOptions<ChurnPrediction>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: churnQueryKeys.predict(userId),
    queryFn: () => churnApi.predictUser(userId),
    enabled: !!userId,
    staleTime: 30 * 60 * 1000, // backend TTL is 30 min
    ...options,
  });
