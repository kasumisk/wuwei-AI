'use client';

/**
 * 游戏化（成就/挑战）API 服务
 * 从 food.ts 拆分，负责成就、挑战、连胜
 */

import { clientGet, clientPost, clientPut } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  Achievement,
  UserAchievement,
  ChallengeItem,
  UserChallengeItem,
  StreakStatus,
} from '@/types/food';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const gamificationService = {
  /** 获取成就列表 */
  getAchievements: async (): Promise<{ all: Achievement[]; unlocked: UserAchievement[] }> => {
    return unwrap(
      clientGet<{ all: Achievement[]; unlocked: UserAchievement[] }>('/app/achievements')
    );
  },

  /** 获取挑战列表 */
  getChallenges: async (): Promise<{ available: ChallengeItem[]; active: UserChallengeItem[] }> => {
    return unwrap(
      clientGet<{ available: ChallengeItem[]; active: UserChallengeItem[] }>('/app/challenges')
    );
  },

  /** 参加挑战 */
  joinChallenge: async (challengeId: string): Promise<UserChallengeItem> => {
    return unwrap(clientPost<UserChallengeItem>(`/app/challenges/${challengeId}/join`, {}));
  },

  /** 获取连胜状态 */
  getStreak: async (): Promise<StreakStatus> => {
    return unwrap(clientGet<StreakStatus>('/app/streak'));
  },

  /** 切换教练风格 */
  updateCoachStyle: async (
    style: 'strict' | 'friendly' | 'data'
  ): Promise<{ coachStyle: string }> => {
    return unwrap(clientPut<{ coachStyle: string }>('/app/coach/style', { style }));
  },
};
