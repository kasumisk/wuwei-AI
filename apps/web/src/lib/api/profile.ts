'use client';

/**
 * 用户档案 API 服务
 * 从 food.ts 拆分，负责用户档案的 CRUD 和引导流
 */

import { clientGet, clientPut, clientPost, clientPatch } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  UserProfile,
  BehaviorProfile,
  CollectionReminder,
  RecommendationPreferences,
  UpdateRecommendationPreferencesDto,
} from '@/types/user';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const profileService = {
  /**
   * 获取用户完整档案（declared + observed + inferred + meta）
   * 替代旧的 GET /app/food/profile，包含所有新字段
   */
  getFullProfile: async (): Promise<{
    declared: UserProfile | null;
    observed: unknown;
    inferred: unknown;
    meta: { completeness: number; onboardingStep: number; profileVersion: number };
  }> => {
    return unwrap(clientGet('/app/user-profile/full'));
  },

  /**
   * 获取用户健康档案（取 full 接口的 declared 层）
   * 旧的 /app/food/profile fallback 已移除，所有字段以新接口为准
   */
  getProfile: async (): Promise<UserProfile | null> => {
    const full = await profileService.getFullProfile();
    return full.declared;
  },

  /** 保存用户健康档案（兼容老代码调用，内部用新端点） */
  saveProfile: async (data: Partial<UserProfile>): Promise<UserProfile> => {
    return profileService.updateDeclaredProfile(data);
  },

  /**
   * 获取行为画像
   * 优先从 /app/user-profile/full 的 observed 层取（减少请求）
   * 若 full 接口失败则 fallback 到旧接口
   */
  getBehaviorProfile: async (): Promise<BehaviorProfile> => {
    try {
      const full = await profileService.getFullProfile();
      if (full.observed) return full.observed as BehaviorProfile;
    } catch {
      // fallback
    }
    return unwrap(clientGet<BehaviorProfile>('/app/food/behavior-profile'));
  },

  // ── 引导流 API（对接后端分步 onboarding）──

  /** 分步保存引导数据 */
  saveOnboardingStep: async (
    step: number,
    data: Record<string, unknown>
  ): Promise<{
    nextStep: number | null;
    completeness: number;
    computed?: { bmr?: number; tdee?: number; recommendedCalories?: number };
  }> => {
    return unwrap(clientPost(`/app/user-profile/onboarding/step/${step}`, data));
  },

  /** 跳过某步 */
  skipOnboardingStep: async (
    step: number
  ): Promise<{
    nextStep: number | null;
    completeness: number;
  }> => {
    return unwrap(clientPost(`/app/user-profile/onboarding/skip/${step}`, {}));
  },

  /** 获取补全建议 */
  getCompletionSuggestions: async (): Promise<{
    currentCompleteness: number;
    suggestions: Array<{
      field: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
      estimatedImpact: string;
    }>;
  }> => {
    return unwrap(clientGet('/app/user-profile/completion-suggestions'));
  },

  /** 获取目标迁移建议 */
  getGoalTransition: async (): Promise<{
    suggestedGoal: string;
    reason: string;
    impact: string;
  } | null> => {
    return unwrap(clientGet('/app/user-profile/goal-transition'));
  },

  /** 获取画像收集提醒（打开首页时调用） */
  getCollectionTriggers: async (): Promise<CollectionReminder[]> => {
    return unwrap(clientGet<CollectionReminder[]>('/app/user-profile/collection-triggers'));
  },

  /** 获取推荐偏好设置 */
  getRecommendationPreferences: async (): Promise<RecommendationPreferences> => {
    return unwrap(
      clientGet<RecommendationPreferences>('/app/user-profile/recommendation-preferences')
    );
  },

  /** 更新推荐偏好设置 */
  updateRecommendationPreferences: async (
    data: UpdateRecommendationPreferencesDto
  ): Promise<RecommendationPreferences> => {
    return unwrap(
      clientPut<RecommendationPreferences>('/app/user-profile/recommendation-preferences', data)
    );
  },

  /** 更新声明数据（部分更新，支持 kitchenProfile / 生活方式等扩展字段） */
  updateDeclaredProfile: async (data: Partial<UserProfile>): Promise<UserProfile> => {
    return unwrap(clientPatch<UserProfile>('/app/user-profile/declared', data));
  },
};
