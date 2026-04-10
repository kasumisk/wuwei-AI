import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface ExperimentGroup {
  name: string;
  trafficRatio: number;
  scoreWeightOverrides?: Record<string, number[]> | null;
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
}

export interface ExperimentDto {
  id: string;
  name: string;
  description: string | null;
  goalType: string;
  status: ExperimentStatus;
  groups: ExperimentGroup[];
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  // 详情接口额外字段
  groupCount?: number;
  totalTraffic?: number;
}

export interface GetExperimentsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: ExperimentStatus | '';
  goalType?: string;
}

export interface ExperimentsListResponse {
  list: ExperimentDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateExperimentDto {
  name: string;
  description?: string;
  goalType?: string;
  groups: ExperimentGroup[];
  startDate?: string;
  endDate?: string;
}

export interface UpdateExperimentDto {
  name?: string;
  description?: string;
  goalType?: string;
  groups?: ExperimentGroup[];
  startDate?: string;
  endDate?: string;
}

export interface ExperimentOverview {
  total: number;
  draft: number;
  running: number;
  paused: number;
  completed: number;
}

// 指标
export interface ExperimentMetric {
  experimentId: string;
  groupId: string;
  totalRecommendations: number;
  acceptedCount: number;
  replacedCount: number;
  skippedCount: number;
  acceptanceRate: number;
  avgNutritionScore: number;
  sampleSize: number;
}

export interface ExperimentMetricsResponse {
  experimentId: string;
  experimentName: string;
  status: ExperimentStatus;
  groups: ExperimentGroup[];
  metrics: ExperimentMetric[];
}

// 分析报告
export interface SignificanceResult {
  significant: boolean;
  pValue: number;
  chiSquared: number;
  df: number;
}

export interface ExperimentComparison {
  controlGroup: string;
  treatmentGroup: string;
  significance: SignificanceResult;
  acceptanceRateLift: number;
}

export interface ExperimentAnalysis {
  experimentId: string;
  experimentName: string;
  metrics: ExperimentMetric[];
  comparisons: ExperimentComparison[];
  winner: string | null;
  canConclude: boolean;
  conclusion: string;
}

// ==================== Query Keys ====================

const _all = ['ab-experiments'] as const;

export const abExperimentQueryKeys = {
  all: _all,
  list: (params?: GetExperimentsQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  overview: [..._all, 'overview'] as const,
  metrics: (id: string) => [..._all, 'metrics', id] as const,
  analysis: (id: string) => [..._all, 'analysis', id] as const,
};

// ==================== API ====================

export const abExperimentApi = {
  /** 获取实验列表 */
  getExperiments: (params?: GetExperimentsQuery): Promise<ExperimentsListResponse> =>
    request.get(PATH.ADMIN.AB_EXPERIMENTS, params),

  /** 获取实验详情 */
  getExperimentById: (id: string): Promise<ExperimentDto> =>
    request.get(`${PATH.ADMIN.AB_EXPERIMENTS}/${id}`),

  /** 创建实验 */
  createExperiment: (data: CreateExperimentDto): Promise<ExperimentDto> =>
    request.post(PATH.ADMIN.AB_EXPERIMENTS, data),

  /** 更新实验 */
  updateExperiment: (id: string, data: UpdateExperimentDto): Promise<ExperimentDto> =>
    request.put(`${PATH.ADMIN.AB_EXPERIMENTS}/${id}`, data),

  /** 更新实验状态 */
  updateExperimentStatus: (id: string, status: ExperimentStatus): Promise<ExperimentDto> =>
    request.post(`${PATH.ADMIN.AB_EXPERIMENTS}/${id}/status`, { status }),

  /** 获取统计概览 */
  getOverview: (): Promise<ExperimentOverview> =>
    request.get(`${PATH.ADMIN.AB_EXPERIMENTS}/overview`),

  /** 获取实验指标 */
  getMetrics: (id: string): Promise<ExperimentMetricsResponse> =>
    request.get(`${PATH.ADMIN.AB_EXPERIMENTS}/${id}/metrics`),

  /** 获取实验分析报告 */
  getAnalysis: (id: string): Promise<ExperimentAnalysis> =>
    request.get(`${PATH.ADMIN.AB_EXPERIMENTS}/${id}/analysis`),
};

// ==================== React Query Hooks ====================

export const useExperiments = (
  params?: GetExperimentsQuery,
  options?: Omit<UseQueryOptions<ExperimentsListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: abExperimentQueryKeys.list(params),
    queryFn: () => abExperimentApi.getExperiments(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useExperimentDetail = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<ExperimentDto>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: abExperimentQueryKeys.detail(id),
    queryFn: () => abExperimentApi.getExperimentById(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useExperimentOverview = (
  options?: Omit<UseQueryOptions<ExperimentOverview>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: abExperimentQueryKeys.overview,
    queryFn: () => abExperimentApi.getOverview(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useExperimentMetrics = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<ExperimentMetricsResponse>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: abExperimentQueryKeys.metrics(id),
    queryFn: () => abExperimentApi.getMetrics(id),
    enabled,
    staleTime: 60 * 1000,
    ...options,
  });

export const useExperimentAnalysis = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<ExperimentAnalysis>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: abExperimentQueryKeys.analysis(id),
    queryFn: () => abExperimentApi.getAnalysis(id),
    enabled,
    staleTime: 60 * 1000,
    ...options,
  });

export const useCreateExperiment = (
  options?: UseMutationOptions<ExperimentDto, Error, CreateExperimentDto>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => abExperimentApi.createExperiment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.all });
    },
    ...options,
  });
};

export const useUpdateExperiment = (
  options?: UseMutationOptions<ExperimentDto, Error, { id: string; data: UpdateExperimentDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => abExperimentApi.updateExperiment(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.detail(id) });
    },
    ...options,
  });
};

export const useUpdateExperimentStatus = (
  options?: UseMutationOptions<ExperimentDto, Error, { id: string; status: ExperimentStatus }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => abExperimentApi.updateExperimentStatus(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: abExperimentQueryKeys.metrics(id) });
    },
    ...options,
  });
};
