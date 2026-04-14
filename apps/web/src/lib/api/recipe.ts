'use client';

/**
 * 菜谱 API 服务
 * 对接后端 /app/food/recipes 相关端点
 */

import { clientGet, clientPost, clientDelete } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  RecipeSummary,
  RecipeDetail,
  RecipeRating,
  RecipeRatingSummary,
  SearchRecipesParams,
} from '@/types/food';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const recipeService = {
  /** 搜索菜谱 */
  search: async (
    params?: SearchRecipesParams
  ): Promise<{ items: RecipeSummary[]; total: number }> => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.cuisine) searchParams.set('cuisine', params.cuisine);
    if (params?.difficulty) searchParams.set('difficulty', String(params.difficulty));
    if (params?.tags) searchParams.set('tags', params.tags);
    if (params?.maxCookTime) searchParams.set('maxCookTime', String(params.maxCookTime));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return unwrap(
      clientGet<{ items: RecipeSummary[]; total: number }>(`/app/food/recipes${qs ? `?${qs}` : ''}`)
    );
  },

  /** 获取菜谱详情 */
  getDetail: async (id: string): Promise<RecipeDetail> => {
    return unwrap(clientGet<RecipeDetail>(`/app/food/recipes/${id}`));
  },

  /** 提交用户菜谱（待审核） */
  submit: async (data: {
    name: string;
    description?: string;
    cuisine?: string;
    difficulty?: number;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    servings?: number;
    tags?: string[];
    instructions?: Record<string, unknown>;
    imageUrl?: string;
    caloriesPerServing?: number;
    proteinPerServing?: number;
    fatPerServing?: number;
    carbsPerServing?: number;
    fiberPerServing?: number;
    ingredients?: Array<{
      foodId?: string;
      ingredientName: string;
      amount?: number;
      unit?: string;
      isOptional?: boolean;
      sortOrder?: number;
    }>;
  }): Promise<RecipeDetail> => {
    return unwrap(clientPost<RecipeDetail>('/app/food/recipes/submit', data));
  },

  /** 提交菜谱评分 */
  rate: async (
    recipeId: string,
    data: { rating: number; comment?: string }
  ): Promise<RecipeRating> => {
    return unwrap(clientPost<RecipeRating>(`/app/food/recipes/${recipeId}/rate`, data));
  },

  /** 获取我的评分 */
  getMyRating: async (recipeId: string): Promise<RecipeRating | null> => {
    return unwrap(clientGet<RecipeRating | null>(`/app/food/recipes/${recipeId}/my-rating`));
  },

  /** 获取菜谱评分汇总 */
  getRatingSummary: async (recipeId: string): Promise<RecipeRatingSummary> => {
    return unwrap(clientGet<RecipeRatingSummary>(`/app/food/recipes/${recipeId}/ratings`));
  },

  /** 删除我的评分 */
  deleteRating: async (recipeId: string): Promise<{ deleted: boolean }> => {
    return unwrap(clientDelete<{ deleted: boolean }>(`/app/food/recipes/${recipeId}/rate`));
  },
};
