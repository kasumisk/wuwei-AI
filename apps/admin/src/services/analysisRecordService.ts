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

export type AnalysisInputType = 'text' | 'image';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AnalysisRecordDto {
  id: string;
  userId: string;
  user?: {
    id: string;
    nickname?: string;
    email?: string;
    avatar?: string;
  };
  inputType: AnalysisInputType;
  rawInput?: string;
  imageUrl?: string;
  confidenceScore: number;
  recognizedPayload?: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;
  nutritionPayload?: Record<string, unknown>;
  decisionPayload?: Record<string, unknown>;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetAnalysisRecordsQuery {
  page?: number;
  pageSize?: number;
  inputType?: AnalysisInputType | '';
  reviewStatus?: ReviewStatus | '';
  minConfidence?: number;
  maxConfidence?: number;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AnalysisRecordsListResponse {
  list: AnalysisRecordDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReviewAnalysisRecordDto {
  reviewStatus: ReviewStatus;
  reviewNote?: string;
}

export interface AnalysisStatistics {
  total: number;
  byInputType: { text: number; image: number };
  byReviewStatus: { pending: number; approved: number; rejected: number };
  avgConfidence: number;
  todayCount: number;
}

export interface PopularFood {
  foodName: string;
  count: number;
  avgConfidence: number;
}

// ==================== Query Keys ====================

const _all = ['analysisRecords'] as const;

export const analysisRecordQueryKeys = {
  all: _all,
  list: (params?: GetAnalysisRecordsQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: [..._all, 'statistics'] as const,
  popularFoods: (params?: { limit?: number; days?: number }) =>
    [..._all, 'popularFoods', params] as const,
};

// ==================== API ====================

export const analysisRecordApi = {
  /** 获取分析记录列表 */
  getRecords: (params?: GetAnalysisRecordsQuery): Promise<AnalysisRecordsListResponse> =>
    request.get(PATH.ADMIN.ANALYSIS_RECORDS, params),

  /** 获取分析记录详情 */
  getRecordById: (id: string): Promise<AnalysisRecordDto> =>
    request.get(`${PATH.ADMIN.ANALYSIS_RECORDS}/${id}`),

  /** 审核分析记录 */
  reviewRecord: (id: string, data: ReviewAnalysisRecordDto): Promise<AnalysisRecordDto> =>
    request.put(`${PATH.ADMIN.ANALYSIS_RECORDS}/${id}/review`, data),

  /** 获取分析统计 */
  getStatistics: (): Promise<AnalysisStatistics> =>
    request.get(`${PATH.ADMIN.ANALYSIS_RECORDS}/statistics`),

  /** 获取热门分析食物 */
  getPopularFoods: (params?: { limit?: number; days?: number }): Promise<PopularFood[]> =>
    request.get(`${PATH.ADMIN.ANALYSIS_RECORDS}/popular-foods`, params),
};

// ==================== React Query Hooks ====================

export const useAnalysisRecords = (
  params?: GetAnalysisRecordsQuery,
  options?: Omit<UseQueryOptions<AnalysisRecordsListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: analysisRecordQueryKeys.list(params),
    queryFn: () => analysisRecordApi.getRecords(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useAnalysisRecordDetail = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<AnalysisRecordDto>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: analysisRecordQueryKeys.detail(id),
    queryFn: () => analysisRecordApi.getRecordById(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useAnalysisStatistics = (
  options?: Omit<UseQueryOptions<AnalysisStatistics>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: analysisRecordQueryKeys.statistics,
    queryFn: () => analysisRecordApi.getStatistics(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const usePopularFoods = (
  params?: { limit?: number; days?: number },
  options?: Omit<UseQueryOptions<PopularFood[]>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: analysisRecordQueryKeys.popularFoods(params),
    queryFn: () => analysisRecordApi.getPopularFoods(params),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useReviewAnalysisRecord = (
  options?: UseMutationOptions<
    AnalysisRecordDto,
    Error,
    { id: string; data: ReviewAnalysisRecordDto }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => analysisRecordApi.reviewRecord(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: analysisRecordQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: analysisRecordQueryKeys.detail(id) });
    },
    ...options,
  });
};

export default analysisRecordApi;
