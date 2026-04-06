'use client';

/**
 * 饮食记录 + AI 分析 + 用户档案 API 服务
 * 对接 api-server 的 /api/app/food/* 端点
 */

import { clientGet, clientPost, clientPut, clientDelete, clientUpload } from './client-api';
import type { ApiResponse } from './http-client';

// ==================== 辅助函数 ====================

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ==================== 类型定义 ====================

export interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
}

export interface AnalysisResult {
  requestId: string;
  foods: FoodItem[];
  totalCalories: number;
  mealType: string;
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
}

export interface FoodRecord {
  id: string;
  userId: string;
  imageUrl?: string;
  source: 'screenshot' | 'camera' | 'manual';
  recognizedText?: string;
  foods: FoodItem[];
  totalCalories: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  advice?: string;
  isHealthy?: boolean;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailySummary {
  totalCalories: number;
  calorieGoal: number | null;
  mealCount: number;
  remaining: number;
}

export interface DailySummaryRecord {
  id: string;
  userId: string;
  date: string;
  totalCalories: number;
  calorieGoal?: number;
  mealCount: number;
}

export interface UserProfile {
  id: string;
  userId: string;
  gender?: string;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;
  activityLevel: string;
  dailyCalorieGoal?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedRecords {
  items: FoodRecord[];
  total: number;
  page: number;
  limit: number;
}

// ==================== API 服务 ====================

export const foodService = {
  /**
   * 上传食物图片 AI 分析
   */
  analyzeImage: async (file: File, mealType?: string): Promise<AnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (mealType) formData.append('mealType', mealType);
    return unwrap(clientUpload<AnalysisResult>('/app/food/analyze', formData));
  },

  /**
   * 保存饮食记录
   */
  saveRecord: async (data: {
    requestId?: string;
    imageUrl?: string;
    foods: FoodItem[];
    totalCalories: number;
    mealType?: string;
    advice?: string;
    isHealthy?: boolean;
    recordedAt?: string;
  }): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/records', data));
  },

  /**
   * 获取今日记录
   */
  getTodayRecords: async (): Promise<FoodRecord[]> => {
    return unwrap(clientGet<FoodRecord[]>('/app/food/records/today'));
  },

  /**
   * 分页查询历史记录
   */
  getRecords: async (params?: {
    page?: number;
    limit?: number;
    date?: string;
  }): Promise<PaginatedRecords> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.date) searchParams.set('date', params.date);
    const qs = searchParams.toString();
    return unwrap(
      clientGet<PaginatedRecords>(`/app/food/records${qs ? `?${qs}` : ''}`),
    );
  },

  /**
   * 更新饮食记录
   */
  updateRecord: async (
    id: string,
    data: {
      foods?: FoodItem[];
      totalCalories?: number;
      mealType?: string;
      advice?: string;
      isHealthy?: boolean;
    },
  ): Promise<FoodRecord> => {
    return unwrap(clientPut<FoodRecord>(`/app/food/records/${id}`, data));
  },

  /**
   * 删除饮食记录
   */
  deleteRecord: async (id: string): Promise<void> => {
    await unwrap(clientDelete<null>(`/app/food/records/${id}`));
  },

  /**
   * 获取今日汇总
   */
  getTodaySummary: async (): Promise<DailySummary> => {
    return unwrap(clientGet<DailySummary>('/app/food/summary/today'));
  },

  /**
   * 获取最近 N 天汇总
   */
  getRecentSummaries: async (days: number = 7): Promise<DailySummaryRecord[]> => {
    return unwrap(
      clientGet<DailySummaryRecord[]>(`/app/food/summary/recent?days=${days}`),
    );
  },

  /**
   * 获取用户健康档案
   */
  getProfile: async (): Promise<UserProfile | null> => {
    return unwrap(clientGet<UserProfile | null>('/app/food/profile'));
  },

  /**
   * 保存用户健康档案
   */
  saveProfile: async (data: {
    gender?: string;
    birthYear?: number;
    heightCm?: number;
    weightKg?: number;
    targetWeightKg?: number;
    activityLevel?: string;
    dailyCalorieGoal?: number;
  }): Promise<UserProfile> => {
    return unwrap(clientPut<UserProfile>('/app/food/profile', data));
  },
};

export default foodService;
