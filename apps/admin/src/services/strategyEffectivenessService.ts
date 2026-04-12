import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface StrategyEffectivenessReport {
  strategyId: string | null;
  strategyVersion: string | null;
  period: { from: string; to: string };
  totalRecommendations: number;
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  skipRate: number;
  avgPoolSize: number;
  avgDurationMs: number;
  channelDistribution: Record<string, number>;
  goalTypeDistribution: Record<string, number>;
}

export interface ExperimentGroupResult {
  groupId: string;
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  skipRate: number;
  avgDurationMs: number;
}

export interface ExperimentComparisonResult {
  experimentId: string;
  groups: ExperimentGroupResult[];
}

export interface ChannelEffectivenessResult {
  channel: string;
  totalRecommendations: number;
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  avgPoolSize: number;
  avgDurationMs: number;
}

// ==================== Query Keys ====================

const _all = ['strategy-effectiveness'] as const;

export const strategyEffectivenessQueryKeys = {
  all: _all,
  report: (strategyId?: string, days?: number) => [..._all, 'report', strategyId, days] as const,
  experimentCompare: (experimentId: string, days?: number) =>
    [..._all, 'experiment-compare', experimentId, days] as const,
  channelAnalysis: (days?: number) => [..._all, 'channel-analysis', days] as const,
};

// ==================== API Functions ====================

export const strategyEffectivenessApi = {
  getReport: (params?: {
    strategyId?: string;
    days?: number;
  }): Promise<StrategyEffectivenessReport> =>
    request.get(`${PATH.ADMIN.STRATEGY_EFFECTIVENESS}/report`, params),

  getExperimentCompare: (params: {
    experimentId: string;
    days?: number;
  }): Promise<ExperimentComparisonResult> =>
    request.get(`${PATH.ADMIN.STRATEGY_EFFECTIVENESS}/experiment-compare`, params),

  getChannelAnalysis: (params?: { days?: number }): Promise<ChannelEffectivenessResult[]> =>
    request.get(`${PATH.ADMIN.STRATEGY_EFFECTIVENESS}/channel-analysis`, params),
};

// ==================== React Query Hooks ====================

export const useStrategyReport = (
  params?: { strategyId?: string; days?: number },
  options?: Omit<UseQueryOptions<StrategyEffectivenessReport>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyEffectivenessQueryKeys.report(params?.strategyId, params?.days),
    queryFn: () => strategyEffectivenessApi.getReport(params),
    staleTime: 3 * 60 * 1000,
    ...options,
  });

export const useExperimentCompare = (
  experimentId: string,
  days?: number,
  options?: Omit<UseQueryOptions<ExperimentComparisonResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyEffectivenessQueryKeys.experimentCompare(experimentId, days),
    queryFn: () => strategyEffectivenessApi.getExperimentCompare({ experimentId, days }),
    enabled: !!experimentId,
    staleTime: 3 * 60 * 1000,
    ...options,
  });

export const useChannelAnalysis = (
  days?: number,
  options?: Omit<UseQueryOptions<ChannelEffectivenessResult[]>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyEffectivenessQueryKeys.channelAnalysis(days),
    queryFn: () => strategyEffectivenessApi.getChannelAnalysis({ days }),
    staleTime: 3 * 60 * 1000,
    ...options,
  });
