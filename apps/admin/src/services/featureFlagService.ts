import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export type FeatureFlagType = 'boolean' | 'percentage' | 'user_list' | 'segment';

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  type: FeatureFlagType;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export interface UpsertFeatureFlagDto {
  key: string;
  name: string;
  description?: string;
  type?: FeatureFlagType;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

// ==================== Query Keys ====================

const _all = ['feature-flags'] as const;

export const featureFlagQueryKeys = {
  all: _all,
  list: [..._all, 'list'] as const,
};

// ==================== API Functions ====================

export const featureFlagApi = {
  getAll: (): Promise<FeatureFlag[]> => request.get(PATH.ADMIN.FEATURE_FLAGS),

  upsert: (data: UpsertFeatureFlagDto): Promise<FeatureFlag> =>
    request.post(PATH.ADMIN.FEATURE_FLAGS, data),

  toggle: (key: string): Promise<FeatureFlag> =>
    request.put(`${PATH.ADMIN.FEATURE_FLAGS}/${key}/toggle`, {}),

  delete: (key: string): Promise<null> => request.delete(`${PATH.ADMIN.FEATURE_FLAGS}/${key}`),
};

// ==================== React Query Hooks ====================

export const useFeatureFlags = (
  options?: Omit<UseQueryOptions<FeatureFlag[]>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: featureFlagQueryKeys.list,
    queryFn: () => featureFlagApi.getAll(),
    staleTime: 30 * 1000, // server TTL is 30s
    ...options,
  });

export const useUpsertFeatureFlag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertFeatureFlagDto) => featureFlagApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: featureFlagQueryKeys.list });
    },
  });
};

export const useToggleFeatureFlag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => featureFlagApi.toggle(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: featureFlagQueryKeys.list });
    },
  });
};

export const useDeleteFeatureFlag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => featureFlagApi.delete(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: featureFlagQueryKeys.list });
    },
  });
};
