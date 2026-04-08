import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 成就类型 ====================

export interface AchievementDto {
  id: string;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  threshold: number;
  rewardType?: string;
  rewardValue: number;
  unlockCount?: number;
}

export interface CreateAchievementDto {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  threshold: number;
  rewardType?: string;
  rewardValue?: number;
}

export interface GetAchievementsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
}

// ==================== 挑战类型 ====================

export interface ChallengeDto {
  id: string;
  title: string;
  description?: string;
  type?: string;
  durationDays: number;
  rules?: Record<string, any>;
  isActive: boolean;
  participantCount?: number;
}

export interface CreateChallengeDto {
  title: string;
  description?: string;
  type?: string;
  durationDays: number;
  rules?: Record<string, any>;
}

export interface GetChallengesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
}

interface ListResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== Query Keys ====================

export const gamificationQueryKeys = {
  achievements: {
    all: ['achievements'] as const,
    list: (params?: GetAchievementsQuery) => ['achievements', 'list', params] as const,
  },
  challenges: {
    all: ['challenges'] as const,
    list: (params?: GetChallengesQuery) => ['challenges', 'list', params] as const,
  },
};

// ==================== API ====================

export const gamificationApi = {
  // 成就
  getAchievements: (params?: GetAchievementsQuery): Promise<ListResponse<AchievementDto>> =>
    request.get(PATH.ADMIN.GAMIFICATION_ACHIEVEMENTS, params),
  createAchievement: (data: CreateAchievementDto): Promise<AchievementDto> =>
    request.post(PATH.ADMIN.GAMIFICATION_ACHIEVEMENTS, data),
  updateAchievement: (id: string, data: Partial<CreateAchievementDto>): Promise<AchievementDto> =>
    request.put(`${PATH.ADMIN.GAMIFICATION_ACHIEVEMENTS}/${id}`, data),
  deleteAchievement: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.GAMIFICATION_ACHIEVEMENTS}/${id}`),

  // 挑战
  getChallenges: (params?: GetChallengesQuery): Promise<ListResponse<ChallengeDto>> =>
    request.get(PATH.ADMIN.GAMIFICATION_CHALLENGES, params),
  createChallenge: (data: CreateChallengeDto): Promise<ChallengeDto> =>
    request.post(PATH.ADMIN.GAMIFICATION_CHALLENGES, data),
  updateChallenge: (id: string, data: Partial<CreateChallengeDto>): Promise<ChallengeDto> =>
    request.put(`${PATH.ADMIN.GAMIFICATION_CHALLENGES}/${id}`, data),
  toggleChallengeActive: (id: string): Promise<ChallengeDto> =>
    request.post(`${PATH.ADMIN.GAMIFICATION_CHALLENGES}/${id}/toggle-active`, {}),
  deleteChallenge: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.GAMIFICATION_CHALLENGES}/${id}`),
};

// ==================== React Query Hooks ====================

export const useCreateAchievement = (
  options?: UseMutationOptions<AchievementDto, Error, CreateAchievementDto>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => gamificationApi.createAchievement(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.achievements.all }),
    ...options,
  });
};

export const useUpdateAchievement = (
  options?: UseMutationOptions<AchievementDto, Error, { id: string; data: Partial<CreateAchievementDto> }>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => gamificationApi.updateAchievement(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.achievements.all }),
    ...options,
  });
};

export const useDeleteAchievement = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => gamificationApi.deleteAchievement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.achievements.all }),
    ...options,
  });
};

export const useCreateChallenge = (
  options?: UseMutationOptions<ChallengeDto, Error, CreateChallengeDto>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => gamificationApi.createChallenge(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.challenges.all }),
    ...options,
  });
};

export const useUpdateChallenge = (
  options?: UseMutationOptions<ChallengeDto, Error, { id: string; data: Partial<CreateChallengeDto> }>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => gamificationApi.updateChallenge(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.challenges.all }),
    ...options,
  });
};

export const useToggleChallengeActive = (
  options?: UseMutationOptions<ChallengeDto, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => gamificationApi.toggleChallengeActive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.challenges.all }),
    ...options,
  });
};

export const useDeleteChallenge = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => gamificationApi.deleteChallenge(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gamificationQueryKeys.challenges.all }),
    ...options,
  });
};
