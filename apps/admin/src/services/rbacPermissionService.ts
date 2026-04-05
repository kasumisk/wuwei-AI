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
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
  RbacPermissionInfoDto,
  RbacPermissionsListResponseDto,
  UserPermissionsResponseDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
  RbacPermissionInfoDto,
  RbacPermissionsListResponseDto,
  UserPermissionsResponseDto,
};

// 查询键工厂
export const rbacPermissionQueryKeys = {
  permissions: ['rbacPermissions'] as const,
  permissionList: (params?: RbacPermissionQueryDto) =>
    [...rbacPermissionQueryKeys.permissions, 'list', params] as const,
  permission: (id: string) => [...rbacPermissionQueryKeys.permissions, 'detail', id] as const,
  permissionTree: () => [...rbacPermissionQueryKeys.permissions, 'tree'] as const,
  modules: () => [...rbacPermissionQueryKeys.permissions, 'modules'] as const,
};

// RBAC Permission API 服务
export const rbacPermissionApi = {
  /**
   * 获取权限列表
   * @param params 查询参数
   */
  getRbacPermissions: (
    params?: RbacPermissionQueryDto
  ): Promise<RbacPermissionsListResponseDto> => {
    return request.get(PATH.ADMIN.RBAC_PERMISSIONS, params);
  },

  /**
   * 获取权限详情
   * @param id 权限ID
   */
  getPermissionById: (id: string): Promise<RbacPermissionInfoDto> => {
    return request.get(`${PATH.ADMIN.RBAC_PERMISSIONS}/${id}`);
  },

  /**
   * 获取权限树
   */
  getPermissionTree: (): Promise<RbacPermissionInfoDto[]> => {
    return request.get(`${PATH.ADMIN.RBAC_PERMISSIONS}/tree`);
  },

  /**
   * 获取所有模块（用于展开通配符）
   */
  getModules: (): Promise<string[]> => {
    return request.get(`${PATH.ADMIN.RBAC_PERMISSIONS}/modules`);
  },

  /**
   * 获取当前用户权限
   */
  getUserPermissions: (): Promise<UserPermissionsResponseDto> => {
    return request.get(`${PATH.ADMIN.RBAC_PERMISSIONS}/user/permissions`);
  },

  /**
   * 创建权限
   * @param data 创建权限参数
   */
  createPermission: (data: CreateRbacPermissionDto): Promise<RbacPermissionInfoDto> => {
    return request.post(PATH.ADMIN.RBAC_PERMISSIONS, data);
  },

  /**
   * 更新权限
   * @param id 权限ID
   * @param data 更新权限参数
   */
  updatePermission: (id: string, data: UpdateRbacPermissionDto): Promise<RbacPermissionInfoDto> => {
    return request.put(`${PATH.ADMIN.RBAC_PERMISSIONS}/${id}`, data);
  },

  /**
   * 删除权限
   * @param id 权限ID
   */
  deletePermission: (id: string): Promise<{ message: string }> => {
    return request.delete(`${PATH.ADMIN.RBAC_PERMISSIONS}/${id}`);
  },
};

// ==================== React Query Hooks ====================

// 获取权限列表
export const useRbacPermissions = (
  params?: RbacPermissionQueryDto,
  options?: Omit<UseQueryOptions<RbacPermissionsListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: rbacPermissionQueryKeys.permissionList(params),
    queryFn: () => rbacPermissionApi.getRbacPermissions(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

// 获取权限详情
export const useRbacPermission = (
  id: string,
  options?: Omit<UseQueryOptions<RbacPermissionInfoDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: rbacPermissionQueryKeys.permission(id),
    queryFn: () => rbacPermissionApi.getPermissionById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 获取权限树
export const useRbacPermissionTree = (
  options?: Omit<UseQueryOptions<RbacPermissionInfoDto[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: rbacPermissionQueryKeys.permissionTree(),
    queryFn: () => rbacPermissionApi.getPermissionTree(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 获取模块列表
export const useModules = (options?: Omit<UseQueryOptions<string[]>, 'queryKey' | 'queryFn'>) => {
  return useQuery({
    queryKey: rbacPermissionQueryKeys.modules(),
    queryFn: () => rbacPermissionApi.getModules(),
    staleTime: 10 * 60 * 1000,
    ...options,
  });
};

// 创建权限
export const useCreateRbacPermission = (
  options?: UseMutationOptions<RbacPermissionInfoDto, Error, CreateRbacPermissionDto>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => rbacPermissionApi.createPermission(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rbacPermissionQueryKeys.permissions });
    },
    ...options,
  });
};

// 更新权限
export const useUpdateRbacPermission = (
  options?: UseMutationOptions<
    RbacPermissionInfoDto,
    Error,
    { id: string; data: UpdateRbacPermissionDto }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rbacPermissionApi.updatePermission(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: rbacPermissionQueryKeys.permissions });
      queryClient.invalidateQueries({
        queryKey: rbacPermissionQueryKeys.permission(variables.id),
      });
    },
    ...options,
  });
};

// 删除权限
export const useDeleteRbacPermission = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => rbacPermissionApi.deletePermission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rbacPermissionQueryKeys.permissions });
    },
    ...options,
  });
};

// 工具函数：手动更新缓存
export const useRbacPermissionMutations = () => {
  const queryClient = useQueryClient();

  return {
    refetchPermissions: (params?: RbacPermissionQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: rbacPermissionQueryKeys.permissionList(params),
      });
    },
    refetchPermission: (id: string) => {
      return queryClient.invalidateQueries({
        queryKey: rbacPermissionQueryKeys.permission(id),
      });
    },
    refetchPermissionTree: () => {
      return queryClient.invalidateQueries({
        queryKey: rbacPermissionQueryKeys.permissionTree(),
      });
    },
  };
};

export default rbacPermissionApi;
