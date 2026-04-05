/**
 * 提供商管理服务
 * 使用 React Query 进行状态管理
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  GetProvidersQueryDto,
  CreateProviderDto,
  UpdateProviderDto,
  TestProviderDto,
  ProviderInfoDto,
  ProvidersListResponseDto,
  TestProviderResponseDto,
  ProviderType,
  ProviderStatus,
} from '@ai-platform/shared';
import request from '../utils/request';
import { PATH } from './path';

// 重新导出共享类型供页面使用
export type {
  ProviderInfoDto,
  ProviderType,
  ProviderStatus,
  GetProvidersQueryDto,
  CreateProviderDto,
  UpdateProviderDto,
};

// ==================== Query Keys ====================

export const providerQueryKeys = {
  providers: ['providers'] as const,
  providerList: (params?: GetProvidersQueryDto) =>
    [...providerQueryKeys.providers, 'list', params] as const,
  provider: (id: string) => [...providerQueryKeys.providers, 'detail', id] as const,
  health: (id: string) => [...providerQueryKeys.providers, 'health', id] as const,
};

// ==================== API Functions ====================

export const providerApi = {
  /**
   * 获取提供商列表
   */
  getProviders: async (params?: GetProvidersQueryDto): Promise<ProvidersListResponseDto> => {
    return await request.get<ProvidersListResponseDto>(PATH.ADMIN.PROVIDERS, params);
  },

  /**
   * 获取提供商详情
   */
  getProviderById: async (id: string): Promise<ProviderInfoDto> => {
    return await request.get<ProviderInfoDto>(`${PATH.ADMIN.PROVIDERS}/${id}`);
  },

  /**
   * 创建提供商
   */
  createProvider: async (data: CreateProviderDto): Promise<ProviderInfoDto> => {
    return await request.post<ProviderInfoDto>(`${PATH.ADMIN.PROVIDERS}`, data);
  },

  /**
   * 更新提供商
   */
  updateProvider: async (id: string, data: UpdateProviderDto): Promise<ProviderInfoDto> => {
    return await request.put<ProviderInfoDto>(`${PATH.ADMIN.PROVIDERS}/${id}`, data);
  },

  /**
   * 删除提供商
   */
  deleteProvider: async (id: string): Promise<void> => {
    await request.delete(`${PATH.ADMIN.PROVIDERS}/${id}`);
  },

  /**
   * 测试提供商连接
   */
  testProvider: async (data: TestProviderDto): Promise<TestProviderResponseDto> => {
    return await request.post<TestProviderResponseDto>(`${PATH.ADMIN.PROVIDERS}/test`, data);
  },

  /**
   * 获取提供商健康状态
   */
  getProviderHealth: async (id: string): Promise<any> => {
    return await request.get<any>(`${PATH.ADMIN.PROVIDERS}/${id}/health`);
  },

  /**
   * 批量检查所有提供商健康状态
   */
  checkAllHealth: async (): Promise<any> => {
    return await request.post<any>(`${PATH.ADMIN.PROVIDERS}/health/check-all`);
  },
};

// ==================== React Query Hooks ====================

/**
 * 获取提供商列表
 */
export const useProviders = (params?: GetProvidersQueryDto, options?: any) => {
  return useQuery({
    queryKey: providerQueryKeys.providerList(params),
    queryFn: () => providerApi.getProviders(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取提供商详情
 */
export const useProvider = (id: string, options?: any) => {
  return useQuery({
    queryKey: providerQueryKeys.provider(id),
    queryFn: () => providerApi.getProviderById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5分钟
    ...options,
  });
};

/**
 * 获取提供商健康状态
 */
export const useProviderHealth = (id: string, options?: any) => {
  return useQuery({
    queryKey: providerQueryKeys.health(id),
    queryFn: () => providerApi.getProviderHealth(id),
    enabled: !!id,
    refetchInterval: 60 * 1000, // 每分钟自动刷新
    ...options,
  });
};

/**
 * 创建提供商
 */
export const useCreateProvider = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: providerApi.createProvider,
    onSuccess: () => {
      // 创建成功后，使提供商列表缓存失效
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.providers,
      });
    },
    ...options,
  });
};

/**
 * 更新提供商
 */
export const useUpdateProvider = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProviderDto }) =>
      providerApi.updateProvider(id, data),
    onSuccess: (_, variables) => {
      // 更新成功后，使相关缓存失效
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.provider(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.providers,
      });
    },
    ...options,
  });
};

/**
 * 删除提供商
 */
export const useDeleteProvider = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: providerApi.deleteProvider,
    onSuccess: () => {
      // 删除成功后，使提供商列表缓存失效
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.providers,
      });
    },
    ...options,
  });
};

/**
 * 测试提供商连接
 */
export const useTestProvider = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: providerApi.testProvider,
    onSuccess: (_, variables: TestProviderDto) => {
      // 测试成功后，刷新健康状态
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.health(variables.providerId),
      });
    },
    ...options,
  });
};

/**
 * 批量检查健康状态
 */
export const useCheckAllHealth = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: providerApi.checkAllHealth,
    onSuccess: () => {
      // 刷新所有健康状态
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.providers,
      });
    },
    ...options,
  });
};

// ==================== Utility Hooks ====================

/**
 * 提供商变更工具 Hook
 * 用于手动触发缓存刷新
 */
export const useProviderMutations = () => {
  const queryClient = useQueryClient();

  return {
    invalidateProviders: () => {
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.providers,
      });
    },
    invalidateProvider: (id: string) => {
      queryClient.invalidateQueries({
        queryKey: providerQueryKeys.provider(id),
      });
    },
  };
};
