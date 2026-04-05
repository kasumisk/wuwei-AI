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
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  RoleInfoDto,
  RolesListResponseDto,
  AssignPermissionsDto,
  ApplyTemplateDto,
  RolePermissionsResponseDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  RoleInfoDto,
  RolesListResponseDto,
  AssignPermissionsDto,
  ApplyTemplateDto,
  RolePermissionsResponseDto,
};

// 查询键工厂
export const roleQueryKeys = {
  roles: ['roles'] as const,
  roleList: (params?: RoleQueryDto) => [...roleQueryKeys.roles, 'list', params] as const,
  role: (id: string) => [...roleQueryKeys.roles, 'detail', id] as const,
  roleTree: () => [...roleQueryKeys.roles, 'tree'] as const,
  rolePermissions: (id: string) => [...roleQueryKeys.roles, id, 'permissions'] as const,
};

// Role API 服务
export const roleApi = {
  /**
   * 获取角色列表
   * @param params 查询参数
   */
  getRoles: (params?: RoleQueryDto): Promise<RolesListResponseDto> => {
    return request.get(PATH.ADMIN.ROLES, params);
  },

  /**
   * 获取角色详情
   * @param id 角色ID
   */
  getRoleById: (id: string): Promise<RoleInfoDto> => {
    return request.get(`${PATH.ADMIN.ROLES}/${id}`);
  },

  /**
   * 获取角色树（含继承关系）
   */
  getRoleTree: (): Promise<RoleInfoDto[]> => {
    return request.get(`${PATH.ADMIN.ROLES}/tree`);
  },

  /**
   * 创建角色
   * @param data 创建角色参数
   */
  createRole: (data: CreateRoleDto): Promise<RoleInfoDto> => {
    return request.post(PATH.ADMIN.ROLES, data);
  },

  /**
   * 更新角色
   * @param id 角色ID
   * @param data 更新角色参数
   */
  updateRole: (id: string, data: UpdateRoleDto): Promise<RoleInfoDto> => {
    return request.put(`${PATH.ADMIN.ROLES}/${id}`, data);
  },

  /**
   * 删除角色
   * @param id 角色ID
   */
  deleteRole: (id: string): Promise<{ message: string }> => {
    return request.delete(`${PATH.ADMIN.ROLES}/${id}`);
  },

  /**
   * 获取角色权限（包含继承的权限）
   * @param id 角色ID
   */
  getRolePermissions: (id: string): Promise<RolePermissionsResponseDto> => {
    return request.get(`${PATH.ADMIN.ROLES}/${id}/permissions`);
  },

  /**
   * 为角色分配权限
   * @param id 角色ID
   * @param data 权限ID列表
   */
  assignPermissions: (id: string, data: AssignPermissionsDto): Promise<void> => {
    return request.post(`${PATH.ADMIN.ROLES}/${id}/permissions`, data);
  },

  /**
   * 应用权限模板到角色
   * @param id 角色ID
   * @param data 模板参数
   */
  applyTemplate: (id: string, data: ApplyTemplateDto): Promise<void> => {
    return request.post(`${PATH.ADMIN.ROLES}/${id}/apply-template`, data);
  },
};

// ==================== React Query Hooks ====================

// 获取角色列表
export const useRoles = (
  params?: RoleQueryDto,
  options?: Omit<UseQueryOptions<RolesListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: roleQueryKeys.roleList(params),
    queryFn: () => roleApi.getRoles(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

// 获取角色详情
export const useRole = (
  id: string,
  options?: Omit<UseQueryOptions<RoleInfoDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: roleQueryKeys.role(id),
    queryFn: () => roleApi.getRoleById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 获取角色树
export const useRoleTree = (
  options?: Omit<UseQueryOptions<RoleInfoDto[]>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: roleQueryKeys.roleTree(),
    queryFn: () => roleApi.getRoleTree(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 获取角色权限
export const useRolePermissions = (
  id: string,
  options?: Omit<UseQueryOptions<RolePermissionsResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: roleQueryKeys.rolePermissions(id),
    queryFn: () => roleApi.getRolePermissions(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

// 创建角色
export const useCreateRole = (options?: UseMutationOptions<RoleInfoDto, Error, CreateRoleDto>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => roleApi.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.roles });
    },
    ...options,
  });
};

// 更新角色
export const useUpdateRole = (
  options?: UseMutationOptions<RoleInfoDto, Error, { id: string; data: UpdateRoleDto }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => roleApi.updateRole(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.roles });
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.role(variables.id) });
    },
    ...options,
  });
};

// 删除角色
export const useDeleteRole = (options?: UseMutationOptions<{ message: string }, Error, string>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => roleApi.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.roles });
    },
    ...options,
  });
};

// 分配权限
export const useAssignPermissions = (
  options?: UseMutationOptions<void, Error, { id: string; data: AssignPermissionsDto }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => roleApi.assignPermissions(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.rolePermissions(variables.id) });
    },
    ...options,
  });
};

// 应用模板
export const useApplyTemplate = (
  options?: UseMutationOptions<void, Error, { id: string; data: ApplyTemplateDto }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => roleApi.applyTemplate(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: roleQueryKeys.rolePermissions(variables.id) });
    },
    ...options,
  });
};

// 工具函数：手动更新缓存
export const useRoleMutations = () => {
  const queryClient = useQueryClient();

  return {
    refetchRoles: (params?: RoleQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: roleQueryKeys.roleList(params),
      });
    },
    refetchRole: (id: string) => {
      return queryClient.invalidateQueries({
        queryKey: roleQueryKeys.role(id),
      });
    },
    refetchRoleTree: () => {
      return queryClient.invalidateQueries({
        queryKey: roleQueryKeys.roleTree(),
      });
    },
  };
};

export default roleApi;
