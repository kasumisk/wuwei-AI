import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import request from '@/utils/request';
import { PATH } from './path';

export type FeedbackCategory = 'general' | 'bug' | 'suggestion' | 'account' | 'other';
export type FeedbackStatus = 'open' | 'reviewing' | 'resolved' | 'closed';

export interface FeedbackUserSummary {
  id: string;
  nickname?: string | null;
  email?: string | null;
  authType?: string | null;
  status?: string | null;
  createdAt?: string;
}

export interface FeedbackAdminNote {
  id: string;
  content: string;
  createdAt: string;
  operator?: {
    id?: string | null;
    username?: string | null;
    role?: string | null;
  } | null;
}

export interface AppFeedbackItem {
  id: string;
  userId: string;
  category: FeedbackCategory;
  content: string;
  contact?: string | null;
  status: FeedbackStatus;
  metadata?: {
    adminNotes?: FeedbackAdminNote[];
    [key: string]: unknown;
  } | null;
  createdAt: string;
  updatedAt: string;
  appUsers?: FeedbackUserSummary;
}

export interface FeedbackStatistics {
  total: number;
  byStatus: Record<FeedbackStatus, number>;
  byCategory: Array<{ category: FeedbackCategory; count: number }>;
  latest?: {
    id: string;
    status: FeedbackStatus;
    category: FeedbackCategory;
    createdAt: string;
  } | null;
}

export interface GetFeedbackListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: FeedbackCategory;
  status?: FeedbackStatus;
  userId?: string;
}

interface ListResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const _all = ['feedback-management'] as const;

export const feedbackManagementQueryKeys = {
  all: _all,
  list: (params?: GetFeedbackListQuery) => [..._all, 'list', params] as const,
  detail: (id?: string) => [..._all, 'detail', id] as const,
  statistics: [..._all, 'statistics'] as const,
};

export const feedbackManagementApi = {
  getList: (params?: GetFeedbackListQuery): Promise<ListResponse<AppFeedbackItem>> =>
    request.get(PATH.ADMIN.FEEDBACK, params),
  getDetail: (id: string): Promise<AppFeedbackItem> => request.get(PATH.ADMIN.FEEDBACK_DETAIL(id)),
  getStatistics: (): Promise<FeedbackStatistics> => request.get(PATH.ADMIN.FEEDBACK_STATISTICS),
  updateStatus: (id: string, status: FeedbackStatus): Promise<AppFeedbackItem> =>
    request.patch(PATH.ADMIN.FEEDBACK_STATUS(id), { status }),
  addNote: (id: string, content: string): Promise<AppFeedbackItem> =>
    request.patch(PATH.ADMIN.FEEDBACK_NOTES(id), { content }),
};

export const useFeedbackList = (
  params?: GetFeedbackListQuery,
  options?: Omit<UseQueryOptions<ListResponse<AppFeedbackItem>>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: feedbackManagementQueryKeys.list(params),
    queryFn: () => feedbackManagementApi.getList(params),
    ...options,
  });

export const useFeedbackDetail = (
  id?: string,
  options?: Omit<UseQueryOptions<AppFeedbackItem>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: feedbackManagementQueryKeys.detail(id),
    queryFn: () => feedbackManagementApi.getDetail(id as string),
    enabled: Boolean(id),
    ...options,
  });

export const useFeedbackStatistics = (
  options?: Omit<UseQueryOptions<FeedbackStatistics>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: feedbackManagementQueryKeys.statistics,
    queryFn: () => feedbackManagementApi.getStatistics(),
    staleTime: 30 * 1000,
    ...options,
  });

export const useUpdateFeedbackStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      feedbackManagementApi.updateStatus(id, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: feedbackManagementQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: feedbackManagementQueryKeys.detail(variables.id) });
    },
  });
};

export const useAddFeedbackNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      feedbackManagementApi.addNote(id, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: feedbackManagementQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: feedbackManagementQueryKeys.detail(variables.id) });
    },
  });
};
