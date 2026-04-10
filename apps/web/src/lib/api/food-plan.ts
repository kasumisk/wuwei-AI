'use client';

/**
 * 饮食计划 API 服务
 * 周计划、食物替代、"为什么不推荐" 等高级推荐功能
 */

import { clientGet, clientPost } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  WeeklyPlanData,
  DailyPlanData,
  SubstituteItem,
  ExplainWhyNotResult,
  FeedbackAction,
  FeedbackRatings,
  FeedbackStats,
} from '@/types/food';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const foodPlanService = {
  /** 获取本周饮食计划 */
  getWeeklyPlan: async (): Promise<WeeklyPlanData> => {
    return unwrap(clientGet<WeeklyPlanData>('/app/food/weekly-plan'));
  },

  /** 强制重新生成今日计划 */
  regenerateDailyPlan: async (mealType?: string): Promise<DailyPlanData> => {
    return unwrap(
      clientPost<DailyPlanData>('/app/food/daily-plan/regenerate', {
        mealType: mealType || undefined,
      })
    );
  },

  /** 获取食物替代建议 (Top 5) */
  getSubstitutes: async (foodId: string, mealType?: string): Promise<SubstituteItem[]> => {
    const params = new URLSearchParams({ foodId });
    if (mealType) params.append('mealType', mealType);
    return unwrap(clientGet<SubstituteItem[]>(`/app/food/substitutes?${params}`));
  },

  /** 查询 "为什么不推荐某食物" */
  explainWhyNot: async (foodName: string, mealType: string): Promise<ExplainWhyNotResult> => {
    return unwrap(
      clientPost<ExplainWhyNotResult>('/app/food/explain-why-not', {
        foodName,
        mealType,
      })
    );
  },

  /** 提交推荐反馈 */
  submitFeedback: async (params: {
    mealType: string;
    foodName: string;
    foodId?: string;
    action: FeedbackAction;
    replacementFood?: string;
    recommendationScore?: number;
    goalType?: string;
    ratings?: FeedbackRatings;
  }): Promise<void> => {
    await unwrap(clientPost<null>('/app/food/recommendation-feedback', params));
  },

  /** 获取反馈统计 */
  getFeedbackStats: async (days = 30): Promise<FeedbackStats> => {
    return unwrap(clientGet<FeedbackStats>(`/app/food/feedback-stats?days=${days}`));
  },
};
