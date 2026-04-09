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
  /** 获取下一餐推荐 */
  getMealSuggestion: async (): Promise<MealSuggestion> => {
    return unwrap(clientGet<MealSuggestion>('/app/food/meal-suggestion'));
  },

  /** 获取今日饮食计划 */
  getDailyPlan: async (): Promise<DailyPlanData> => {
    return unwrap(clientGet<DailyPlanData>('/app/food/daily-plan'));
  },

  /** 触发计划调整 */
  adjustDailyPlan: async (
    reason: string
  ): Promise<{ updatedPlan: DailyPlanData; adjustmentNote: string }> => {
    return unwrap(
      clientPost<{ updatedPlan: DailyPlanData; adjustmentNote: string }>(
        '/app/food/daily-plan/adjust',
        { reason }
      )
    );
  },

  /** 主动提醒检查 */
  proactiveCheck: async (): Promise<{ reminder: ProactiveReminder | null }> => {
    return unwrap(clientGet<{ reminder: ProactiveReminder | null }>('/app/food/proactive-check'));
  },
};
