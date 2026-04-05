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
  GetUsersQueryDto,
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
  UserInfoDto,
  UsersListResponseDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  GetUsersQueryDto,
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
  UserInfoDto,
  UsersListResponseDto,
};

// 查询键工厂
export const userQueryKeys = {
  users: ['users'] as const,
  userList: (params?: GetUsersQueryDto) => [...userQueryKeys.users, 'list', params] as const,
  user: (id: string) => [...userQueryKeys.users, 'detail', id] as const,
};

// User API 服务
export const userApi = {
  /**
   * 获取用户列表
   * @param params 查询参数
   */
  getUsers: (params?: GetUsersQueryDto): Promise<UsersListResponseDto> => {
    return request.get(PATH.ADMIN.USERS, params);
  },

  /**
   * 获取用户详情
   * @param id 用户ID
   */
  getUserById: (id: string): Promise<UserInfoDto> => {
    return request.get(`${PATH.ADMIN.USERS}/${id}`);
  },

  /**
   * 创建用户
   * @param data 创建用户参数
   */
  createUser: (data: CreateUserDto): Promise<UserInfoDto> => {
    return request.post(PATH.ADMIN.USERS, data);
  },

  /**
   * 更新用户
   * @param id 用户ID
   * @param data 更新用户参数
   */
  updateUser: (id: string, data: UpdateUserDto): Promise<UserInfoDto> => {
    return request.put(`${PATH.ADMIN.USERS}/${id}`, data);
  },

  /**
   * 删除用户
   * @param id 用户ID
   */
  deleteUser: (id: string): Promise<{ message: string }> => {
    return request.delete(`${PATH.ADMIN.USERS}/${id}`);
  },

  /**
   * 重置用户密码
   * @param id 用户ID
   * @param data 重置密码参数
   */
  resetPassword: (id: string, data: ResetPasswordDto): Promise<{ message: string }> => {
    return request.post(`${PATH.ADMIN.USERS}/${id}/reset-password`, data);
  },

  /**
   * 获取用户角色
   * @param id 用户ID
   */
  getUserRoles: (
    id: string
  ): Promise<{ userId: string; roles: { id: string; code: string; name: string }[] }> => {
    return request.get(`${PATH.ADMIN.USERS}/${id}/roles`);
  },

  /**
   * 分配用户角色
   * @param id 用户ID
   * @param roleIds 角色ID列表
   */
  assignRoles: (id: string, roleIds: string[]): Promise<{ message: string }> => {
    return request.post(`${PATH.ADMIN.USERS}/${id}/roles`, { roleIds });
  },
};

// ==================== React Query Hooks ====================

// 获取用户列表
export const useUsers = (
  params?: GetUsersQueryDto,
  options?: Omit<UseQueryOptions<UsersListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: userQueryKeys.userList(params),
    queryFn: () => userApi.getUsers(params),
    staleTime: 2 * 60 * 1000, // 2分钟缓存
    ...options,
  });
};

// 获取用户详情
export const useUser = (
  id: string,
  options?: Omit<UseQueryOptions<UserInfoDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: userQueryKeys.user(id),
    queryFn: () => userApi.getUserById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    ...options,
  });
};

// 创建用户
export const useCreateUser = (options?: UseMutationOptions<UserInfoDto, Error, CreateUserDto>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => userApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userQueryKeys.users });
    },
    ...options,
  });
};

// 更新用户
export const useUpdateUser = (
  options?: UseMutationOptions<UserInfoDto, Error, { id: string; data: UpdateUserDto }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => userApi.updateUser(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: userQueryKeys.users });
      queryClient.invalidateQueries({ queryKey: userQueryKeys.user(variables.id) });
    },
    ...options,
  });
};

// 删除用户
export const useDeleteUser = (options?: UseMutationOptions<{ message: string }, Error, string>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => userApi.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userQueryKeys.users });
    },
    ...options,
  });
};

// 重置密码
export const useResetPassword = (
  options?: UseMutationOptions<{ message: string }, Error, { id: string; data: ResetPasswordDto }>
) => {
  return useMutation({
    mutationFn: ({ id, data }) => userApi.resetPassword(id, data),
    ...options,
  });
};

// 获取用户角色
export const useUserRoles = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ userId: string; roles: { id: string; code: string; name: string }[] }>,
    'queryKey' | 'queryFn'
  >
) => {
  return useQuery({
    queryKey: [...userQueryKeys.user(id), 'roles'] as const,
    queryFn: () => userApi.getUserRoles(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
    ...options,
  });
};

// 分配用户角色
export const useAssignUserRoles = (
  options?: UseMutationOptions<{ message: string }, Error, { id: string; roleIds: string[] }>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, roleIds }) => userApi.assignRoles(id, roleIds),
    onSuccess: (_, variables) => {
      // 刷新用户角色
      queryClient.invalidateQueries({ queryKey: [...userQueryKeys.user(variables.id), 'roles'] });
      // 刷新用户列表
      queryClient.invalidateQueries({ queryKey: userQueryKeys.users });
      // 刷新用户详情
      queryClient.invalidateQueries({ queryKey: userQueryKeys.user(variables.id) });
    },
    ...options,
  });
};

// 工具函数：手动更新缓存
export const useUserMutations = () => {
  const queryClient = useQueryClient();

  return {
    // 刷新用户列表
    refetchUsers: (params?: GetUsersQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: userQueryKeys.userList(params),
      });
    },

    // 刷新用户详情
    refetchUser: (id: string) => {
      return queryClient.invalidateQueries({
        queryKey: userQueryKeys.user(id),
      });
    },
  };
};

export default userApi;
