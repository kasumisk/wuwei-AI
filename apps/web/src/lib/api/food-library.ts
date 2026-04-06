import { serverGet } from './server-api';
import { clientGet, clientPost } from './client-api';
import type { ApiResponse } from './http-client';

// ==================== 类型定义 ====================

export interface FoodLibraryItem {
  id: string;
  name: string;
  aliases?: string;
  category: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  standardServingG: number;
  standardServingDesc?: string;
  searchWeight: number;
  isVerified: boolean;
}

export interface FoodCategory {
  category: string;
  count: number;
}

export interface FrequentFood {
  name: string;
  count: number;
  food?: FoodLibraryItem;
}

// ==================== 辅助函数 ====================

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ==================== 服务端 API（SSR） ====================

export const foodLibraryServerAPI = {
  search: async (q: string, limit = 20): Promise<FoodLibraryItem[]> => {
    return unwrap(serverGet<FoodLibraryItem[]>(`/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`));
  },

  getPopular: async (category?: string, limit = 20): Promise<FoodLibraryItem[]> => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return unwrap(serverGet<FoodLibraryItem[]>(`/foods/popular${qs ? `?${qs}` : ''}`));
  },

  getCategories: async (): Promise<FoodCategory[]> => {
    return unwrap(serverGet<FoodCategory[]>('/foods/categories'));
  },

  getByName: async (name: string): Promise<{ food: FoodLibraryItem; related: FoodLibraryItem[] }> => {
    return unwrap(serverGet<{ food: FoodLibraryItem; related: FoodLibraryItem[] }>(`/foods/by-name/${encodeURIComponent(name)}`));
  },

  getAll: async (limit = 200): Promise<FoodLibraryItem[]> => {
    return unwrap(serverGet<FoodLibraryItem[]>(`/foods?limit=${limit}`));
  },
};

// ==================== 客户端 API ====================

export const foodLibraryClientAPI = {
  search: async (q: string, limit = 20): Promise<FoodLibraryItem[]> => {
    return unwrap(clientGet<FoodLibraryItem[]>(`/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`));
  },

  getPopular: async (category?: string, limit = 20): Promise<FoodLibraryItem[]> => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return unwrap(clientGet<FoodLibraryItem[]>(`/foods/popular${qs ? `?${qs}` : ''}`));
  },

  getCategories: async (): Promise<FoodCategory[]> => {
    return unwrap(clientGet<FoodCategory[]>('/foods/categories'));
  },

  addFromLibrary: async (foodLibraryId: string, servingGrams: number, mealType: string): Promise<unknown> => {
    return unwrap(clientPost('/app/food/records/from-library', {
      foodLibraryId,
      servingGrams,
      mealType,
    }));
  },

  getFrequentFoods: async (limit = 10): Promise<FrequentFood[]> => {
    return unwrap(clientGet<FrequentFood[]>(`/app/food/frequent-foods?limit=${limit}`));
  },
};
