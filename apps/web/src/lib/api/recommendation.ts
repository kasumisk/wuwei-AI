'use client';

/**
 * 推荐/计划 API 服务
 * 从 food.ts 拆分，负责餐食推荐、每日计划
 */

import { clientGet, clientPost } from './client-api';
import type { ApiResponse } from './http-client';
import type { MealSuggestion, DailyPlanData, ProactiveReminder } from '@/types/food';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const recommendationService = {
  /** 获取下一餐推荐。forceRefresh=true 时跳过服务端粘性缓存 */
  getMealSuggestion: async (forceRefresh = false): Promise<MealSuggestion> => {
    const qs = forceRefresh ? '?refresh=1' : '';
    return unwrap(clientGet<MealSuggestion>(`/app/food/meal-suggestion${qs}`));
  },

  /** 获取今日饮食计划 */
  getDailyPlan: async (): Promise<DailyPlanData> => {
    return unwrap(clientGet<DailyPlanData>('/app/food/daily-plan'));
  },

  /** 触发计划调整 */
  adjustDailyPlan: async (
    reason: string,
    mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  ): Promise<DailyPlanData & { adjustmentNote?: string }> => {
    return unwrap(
      clientPost<DailyPlanData & { adjustmentNote?: string }>('/app/food/daily-plan/adjust', {
        reason,
        mealType,
      })
    );
  },

  /** 仅替换下一餐推荐，不影响 daily-plan */
  adjustMealSuggestion: async (
    reason: string,
    mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  ): Promise<MealSuggestion> => {
    return unwrap(
      clientPost<MealSuggestion>('/app/food/meal-suggestion/adjust', {
        reason,
        mealType,
      })
    );
  },

  /** 主动提醒检查 */
  proactiveCheck: async (): Promise<{ reminder: ProactiveReminder | null }> => {
    return unwrap(clientGet<{ reminder: ProactiveReminder | null }>('/app/food/proactive-check'));
  },
};
