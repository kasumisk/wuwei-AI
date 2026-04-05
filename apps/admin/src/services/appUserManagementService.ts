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

export type AppUserAuthType = 'anonymous' | 'google' | 'email';
export type AppUserStatus = 'active' | 'inactive' | 'banned';

export interface AppUserDto {
  id: string;
  authType: AppUserAuthType;
  email?: string;
  nickname?: string;
  avatar?: string;
  status: AppUserStatus;
  emailVerified: boolean;
  googleId?: string;
  deviceId?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetAppUsersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  authType?: AppUserAuthType | '';
  status?: AppUserStatus | '';
}

export interface AppUsersListResponse {
  list: AppUserDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UpdateAppUserDto {
  nickname?: string;
  avatar?: string;
  status?: AppUserStatus;
  email?: string;
}

export interface AppUserStatistics {
  total: number;
  byAuthType: { anonymous: number; google: number; email: number };
  byStatus: { active: number; banned: number };
}

// ==================== Query Keys ====================

const _all = ['appUsers'] as const;
const _statistics = [..._all, 'statistics'] as const;

export const appUserQueryKeys = {
  all: _all,
  list: (params?: GetAppUsersQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: _statistics,
};

// ==================== API ====================

export const appUserApi = {
  getAppUsers: (params?: GetAppUsersQuery): Promise<AppUsersListResponse> =>
    request.get(PATH.ADMIN.APP_USERS, params),

  getAppUserById: (id: string): Promise<AppUserDto> =>
    request.get(`${PATH.ADMIN.APP_USERS}/${id}`),

  getStatistics: (): Promise<AppUserStatistics> =>
    request.get(`${PATH.ADMIN.APP_USERS}/statistics`),

  updateAppUser: (id: string, data: UpdateAppUserDto): Promise<AppUserDto> =>
    request.put(`${PATH.ADMIN.APP_USERS}/${id}`, data),

  banAppUser: (id: string): Promise<{ message: string }> =>
    request.post(`${PATH.ADMIN.APP_USERS}/${id}/ban`, {}),

  unbanAppUser: (id: string): Promise<{ message: string }> =>
    request.post(`${PATH.ADMIN.APP_USERS}/${id}/unban`, {}),

  deleteAppUser: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.APP_USERS}/${id}`),
};

// ==================== React Query Hooks ====================

export const useAppUsers = (
  params?: GetAppUsersQuery,
  options?: Omit<UseQueryOptions<AppUsersListResponse>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: appUserQueryKeys.list(params),
    queryFn: () => appUserApi.getAppUsers(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useAppUserStatistics = (
  options?: Omit<UseQueryOptions<AppUserStatistics>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: appUserQueryKeys.statistics,
    queryFn: () => appUserApi.getStatistics(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useUpdateAppUser = (
  options?: UseMutationOptions<AppUserDto, Error, { id: string; data: UpdateAppUserDto }>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => appUserApi.updateAppUser(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: appUserQueryKeys.detail(id) });
    },
    ...options,
  });
};

export const useBanAppUser = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.banAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export const useUnbanAppUser = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.unbanAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export const useDeleteAppUser = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.deleteAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export default appUserApi;
