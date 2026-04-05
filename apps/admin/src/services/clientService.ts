import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  GetClientsQueryDto,
  CreateClientDto,
  UpdateClientDto,
  ClientInfoDto,
  ClientsListResponseDto,
  CreateClientResponseDto,
  RegenerateSecretResponseDto,
  GetClientUsageQueryDto,
  ClientUsageStatsDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  GetClientsQueryDto,
  CreateClientDto,
  UpdateClientDto,
  ClientInfoDto,
  ClientsListResponseDto,
  CreateClientResponseDto,
  RegenerateSecretResponseDto,
  GetClientUsageQueryDto,
  ClientUsageStatsDto,
};

// 查询键工厂
export const clientQueryKeys = {
  clients: ['clients'] as const,
  clientList: (params?: GetClientsQueryDto) =>
    [...clientQueryKeys.clients, 'list', params] as const,
  client: (id: string) => [...clientQueryKeys.clients, 'detail', id] as const,
  clientUsage: (id: string, params: GetClientUsageQueryDto) =>
    [...clientQueryKeys.clients, 'usage', id, params] as const,
};

// Client API 服务
export const clientApi = {
  /**
   * 获取客户端列表
   * @param params 查询参数
   */
  getClients: (params?: GetClientsQueryDto): Promise<ClientsListResponseDto> => {
    return request.get(PATH.ADMIN.CLIENTS, params);
  },

  /**
   * 获取客户端详情
   * @param id 客户端ID
   */
  getClientById: (id: string): Promise<ClientInfoDto> => {
    return request.get(`${PATH.ADMIN.CLIENTS}/${id}`);
  },

  /**
   * 创建客户端
   * @param data 创建客户端参数
   */
  createClient: (data: CreateClientDto): Promise<CreateClientResponseDto> => {
    return request.post(PATH.ADMIN.CLIENTS, data);
  },

  /**
   * 更新客户端
   * @param id 客户端ID
   * @param data 更新客户端参数
   */
  updateClient: (id: string, data: UpdateClientDto): Promise<ClientInfoDto> => {
    return request.put(`${PATH.ADMIN.CLIENTS}/${id}`, data);
  },

  /**
   * 删除客户端
   * @param id 客户端ID
   */
  deleteClient: (id: string): Promise<{ message: string }> => {
    return request.delete(`${PATH.ADMIN.CLIENTS}/${id}`);
  },

  /**
   * 重新生成客户端密钥
   * @param id 客户端ID
   */
  regenerateSecret: (id: string): Promise<RegenerateSecretResponseDto> => {
    return request.post(`${PATH.ADMIN.CLIENTS}/${id}/regenerate-secret`);
  },

  /**
   * 获取客户端使用统计
   * @param id 客户端ID
   * @param params 查询参数
   */
  getClientUsageStats: (
    id: string,
    params: GetClientUsageQueryDto
  ): Promise<ClientUsageStatsDto> => {
    return request.get(`${PATH.ADMIN.CLIENTS}/${id}/usage`, params);
  },
};

// ==================== React Query Hooks ====================

// 获取客户端列表
export const useClients = (
  params?: GetClientsQueryDto,
  options?: Omit<UseQueryOptions<ClientsListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: clientQueryKeys.clientList(params),
    queryFn: () => clientApi.getClients(params),
    staleTime: 2 * 60 * 1000, // 2分钟缓存
    ...options,
  });
};

// 获取客户端详情
export const useClient = (
  id: string,
  options?: Omit<UseQueryOptions<ClientInfoDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: clientQueryKeys.client(id),
    queryFn: () => clientApi.getClientById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    ...options,
  });
};

// 创建客户端
export const useCreateClient = (
  options?: UseMutationOptions<CreateClientResponseDto, Error, CreateClientDto>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => clientApi.createClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.clients });
    },
    ...options,
  });
};

// 更新客户端
export const useUpdateClient = (
  options?: UseMutationOptions<ClientInfoDto, Error, { id: string; data: UpdateClientDto }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => clientApi.updateClient(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.clients });
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.client(variables.id) });
    },
    ...options,
  });
};

// 删除客户端
export const useDeleteClient = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clientApi.deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.clients });
    },
    ...options,
  });
};

// 重新生成密钥
export const useRegenerateSecret = (
  options?: UseMutationOptions<RegenerateSecretResponseDto, Error, string>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clientApi.regenerateSecret(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.client(id) });
    },
    ...options,
  });
};

// 获取客户端使用统计
export const useClientUsageStats = (
  id: string,
  params: GetClientUsageQueryDto,
  options?: Omit<UseQueryOptions<ClientUsageStatsDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: clientQueryKeys.clientUsage(id, params),
    queryFn: () => clientApi.getClientUsageStats(id, params),
    enabled: !!id && !!params.startDate && !!params.endDate,
    staleTime: 1 * 60 * 1000, // 1分钟缓存
    ...options,
  });
};

// 工具函数：手动更新缓存
export const useClientMutations = () => {
  const queryClient = useQueryClient();

  return {
    // 刷新客户端列表
    refetchClients: (params?: GetClientsQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: clientQueryKeys.clientList(params),
      });
    },

    // 刷新客户端详情
    refetchClient: (id: string) => {
      return queryClient.invalidateQueries({
        queryKey: clientQueryKeys.client(id),
      });
    },

    // 刷新客户端使用统计
    refetchClientUsage: (id: string, params: GetClientUsageQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: clientQueryKeys.clientUsage(id, params),
      });
    },
  };
};

export default clientApi;
