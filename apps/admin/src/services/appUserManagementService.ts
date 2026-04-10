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

// ==================== 用户画像类型 ====================

export interface BehaviorProfileDto {
  id: string;
  userId: string;
  foodPreferences: { loves?: string[]; avoids?: string[]; frequentFoods?: string[] };
  bingeRiskHours: number[];
  failureTriggers: string[];
  avgComplianceRate: number;
  coachStyle: string;
  totalRecords: number;
  healthyRecords: number;
  streakDays: number;
  longestStreak: number;
  mealTimingPatterns: { breakfast?: string; lunch?: string; dinner?: string; snack?: string };
  portionTendency: string;
  replacementPatterns: Record<string, number>;
  updatedAt: string;
}

export interface DeclaredProfileDto {
  goal: string;
  goalSpeed: string;
  gender?: string;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;
  activityLevel: string;
  dailyCalorieGoal?: number;
  discipline: string;
  mealsPerDay: number;
  takeoutFrequency: string;
  canCook: boolean;
  foodPreferences: string[];
  dietaryRestrictions: string[];
  allergens: string[];
  healthConditions: string[];
  cuisinePreferences: string[];
  weakTimeSlots: string[];
  bingeTriggers: string[];
  dataCompleteness: number;
  onboardingCompleted: boolean;
}

export interface InferredProfileDto {
  id: string;
  userId: string;
  estimatedBMR?: number;
  estimatedTDEE?: number;
  recommendedCalories?: number;
  macroTargets: { proteinG?: number; carbG?: number; fatG?: number };
  userSegment?: string;
  churnRisk: number;
  optimalMealCount?: number;
  tastePrefVector: number[];
  nutritionGaps: string[];
  goalProgress: {
    startWeight?: number;
    currentWeight?: number;
    targetWeight?: number;
    progressPercent?: number;
    trend?: string;
    estimatedWeeksLeft?: number;
    weeklyRateKg?: number;
  };
  confidenceScores: Record<string, number>;
  preferenceWeights?: Record<string, unknown>;
  lastComputedAt?: string;
  updatedAt: string;
}

export interface ProfileChangeLogDto {
  id: string;
  userId: string;
  version: number;
  changeType: string;
  source: string;
  changedFields: string[];
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  triggerEvent?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface BehaviorProfileResponse {
  user: { id: string; nickname?: string; authType: string; status: string; createdAt: string };
  behaviorProfile: BehaviorProfileDto | null;
  declaredProfile: DeclaredProfileDto | null;
  recentChangeLogs: ProfileChangeLogDto[];
}

export interface InferredProfileResponse {
  user: { id: string; nickname?: string; authType: string; status: string; createdAt: string };
  inferredProfile: InferredProfileDto | null;
  recentChangeLogs: ProfileChangeLogDto[];
}

// ==================== Query Keys ====================

const _all = ['appUsers'] as const;
const _statistics = [..._all, 'statistics'] as const;

export const appUserQueryKeys = {
  all: _all,
  list: (params?: GetAppUsersQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: _statistics,
  behaviorProfile: (id: string) => [..._all, 'behaviorProfile', id] as const,
  inferredProfile: (id: string) => [..._all, 'inferredProfile', id] as const,
};

// ==================== API ====================

export const appUserApi = {
  getAppUsers: (params?: GetAppUsersQuery): Promise<AppUsersListResponse> =>
    request.get(PATH.ADMIN.APP_USERS, params),

  getAppUserById: (id: string): Promise<AppUserDto> => request.get(`${PATH.ADMIN.APP_USERS}/${id}`),

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

  /** 获取用户行为画像 */
  getBehaviorProfile: (id: string): Promise<BehaviorProfileResponse> =>
    request.get(`${PATH.ADMIN.APP_USERS}/${id}/behavior-profile`),

  /** 获取用户推断画像 */
  getInferredProfile: (id: string): Promise<InferredProfileResponse> =>
    request.get(`${PATH.ADMIN.APP_USERS}/${id}/inferred-profile`),
};

// ==================== React Query Hooks ====================

export const useAppUsers = (
  params?: GetAppUsersQuery,
  options?: Omit<UseQueryOptions<AppUsersListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: appUserQueryKeys.list(params),
    queryFn: () => appUserApi.getAppUsers(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useAppUserStatistics = (
  options?: Omit<UseQueryOptions<AppUserStatistics>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: appUserQueryKeys.statistics,
    queryFn: () => appUserApi.getStatistics(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useUpdateAppUser = (
  options?: UseMutationOptions<AppUserDto, Error, { id: string; data: UpdateAppUserDto }>
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

export const useBanAppUser = (options?: UseMutationOptions<{ message: string }, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.banAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export const useUnbanAppUser = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.unbanAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export const useDeleteAppUser = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => appUserApi.deleteAppUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appUserQueryKeys.all }),
    ...options,
  });
};

export const useBehaviorProfile = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<BehaviorProfileResponse>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: appUserQueryKeys.behaviorProfile(id),
    queryFn: () => appUserApi.getBehaviorProfile(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useInferredProfile = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<InferredProfileResponse>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: appUserQueryKeys.inferredProfile(id),
    queryFn: () => appUserApi.getInferredProfile(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export default appUserApi;
