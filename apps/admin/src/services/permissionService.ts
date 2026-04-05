import request from '@/utils/request';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
  PermissionInfoDto,
  PermissionsListResponseDto,
  BatchUpdateResultDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
  PermissionInfoDto,
  PermissionsListResponseDto,
  BatchUpdateResultDto,
};

// 查询键工厂
export const permissionQueryKeys = {
  permissions: ['permissions'] as const,
  permissionList: (clientId: string) =>
    [...permissionQueryKeys.permissions, 'list', clientId] as const,
};

// Permission API 服务
export const permissionApi = {
  /**
   * 获取客户端权限列表
   * @param clientId 客户端ID
   */
  getPermissionsByClient: (clientId: string): Promise<PermissionsListResponseDto> => {
    return request.get(`/admin/clients/${clientId}/permissions`);
  },

  /**
   * 创建权限
   * @param clientId 客户端ID
   * @param data 创建权限参数
   */
  createPermission: (clientId: string, data: CreatePermissionDto): Promise<PermissionInfoDto> => {
    return request.post(`/admin/clients/${clientId}/permissions`, data);
  },

  /**
   * 更新权限
   * @param clientId 客户端ID
   * @param permissionId 权限ID
   * @param data 更新权限参数
   */
  updatePermission: (
    clientId: string,
    permissionId: string,
    data: UpdatePermissionDto
  ): Promise<PermissionInfoDto> => {
    return request.put(`/admin/clients/${clientId}/permissions/${permissionId}`, data);
  },

  /**
   * 删除权限
   * @param clientId 客户端ID
   * @param permissionId 权限ID
   */
  deletePermission: (clientId: string, permissionId: string): Promise<{ message: string }> => {
    return request.delete(`/admin/clients/${clientId}/permissions/${permissionId}`);
  },

  /**
   * 批量更新权限
   * @param clientId 客户端ID
   * @param data 批量更新参数
   */
  batchUpdatePermissions: (
    clientId: string,
    data: BatchUpdatePermissionsDto
  ): Promise<BatchUpdateResultDto> => {
    return request.post(`/admin/clients/${clientId}/permissions/batch`, data);
  },
};

// ==================== React Query Hooks ====================

// 获取客户端权限列表
export const usePermissions = (
  clientId: string,
  options?: Omit<UseQueryOptions<PermissionsListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: permissionQueryKeys.permissionList(clientId),
    queryFn: () => permissionApi.getPermissionsByClient(clientId),
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

// 创建权限
export const useCreatePermission = (
  options?: UseMutationOptions<
    PermissionInfoDto,
    Error,
    { clientId: string; data: CreatePermissionDto }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, data }) => permissionApi.createPermission(clientId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionQueryKeys.permissionList(variables.clientId),
      });
    },
    ...options,
  });
};

// 更新权限
export const useUpdatePermission = (
  options?: UseMutationOptions<
    PermissionInfoDto,
    Error,
    { clientId: string; permissionId: string; data: UpdatePermissionDto }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, permissionId, data }) =>
      permissionApi.updatePermission(clientId, permissionId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionQueryKeys.permissionList(variables.clientId),
      });
    },
    ...options,
  });
};

// 删除权限
export const useDeletePermission = (
  options?: UseMutationOptions<
    { message: string },
    Error,
    { clientId: string; permissionId: string }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, permissionId }) =>
      permissionApi.deletePermission(clientId, permissionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionQueryKeys.permissionList(variables.clientId),
      });
    },
    ...options,
  });
};

// 批量更新权限
export const useBatchUpdatePermissions = (
  options?: UseMutationOptions<
    BatchUpdateResultDto,
    Error,
    { clientId: string; data: BatchUpdatePermissionsDto }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, data }) => permissionApi.batchUpdatePermissions(clientId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: permissionQueryKeys.permissionList(variables.clientId),
      });
    },
    ...options,
  });
};

// 工具函数：手动更新缓存
export const usePermissionMutations = () => {
  const queryClient = useQueryClient();

  return {
    refetchPermissions: (clientId: string) => {
      return queryClient.invalidateQueries({
        queryKey: permissionQueryKeys.permissionList(clientId),
      });
    },
  };
};

export default permissionApi;
