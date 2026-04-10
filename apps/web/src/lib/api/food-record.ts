'use client';

/**
 * 食物记录 API 服务
 * 从 food.ts 拆分，负责食物分析、记录的 CRUD
 */

import { clientGet, clientPost, clientPut, clientDelete, clientUpload } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  FoodItem,
  AnalysisResult,
  FoodRecord,
  PaginatedRecords,
  DailySummary,
  DailySummaryRecord,
  NutritionScoreResult,
  AnalyzeTextRequest,
  SaveAnalysisRequest,
  AnalysisHistoryItem,
  AnalysisHistoryResponse,
} from '@/types/food';

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

export const foodRecordService = {
  /** 上传食物图片 AI 分析 */
  analyzeImage: async (file: File, mealType?: string): Promise<AnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (mealType) formData.append('mealType', mealType);
    return unwrap(clientUpload<AnalysisResult>('/app/food/analyze', formData));
  },

  /** 保存饮食记录 */
  saveRecord: async (data: {
    requestId?: string;
    imageUrl?: string;
    foods: FoodItem[];
    totalCalories: number;
    mealType?: string;
    advice?: string;
    isHealthy?: boolean;
    recordedAt?: string;
    decision?: string;
    riskLevel?: string;
    reason?: string;
    suggestion?: string;
    insteadOptions?: string[];
    compensation?: { diet?: string; activity?: string; nextMeal?: string };
    contextComment?: string;
    encouragement?: string;
    totalProtein?: number;
    totalFat?: number;
    totalCarbs?: number;
    avgQuality?: number;
    avgSatiety?: number;
    nutritionScore?: number;
    source?: string;
  }): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/records', data));
  },

  /** 获取今日记录 */
  getTodayRecords: async (): Promise<FoodRecord[]> => {
    return unwrap(clientGet<FoodRecord[]>('/app/food/records/today'));
  },

  /** 分页查询历史记录 */
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
    return unwrap(clientGet<PaginatedRecords>(`/app/food/records${qs ? `?${qs}` : ''}`));
  },

  /** 更新饮食记录 */
  updateRecord: async (
    id: string,
    data: {
      foods?: FoodItem[];
      totalCalories?: number;
      mealType?: string;
      advice?: string;
      isHealthy?: boolean;
    }
  ): Promise<FoodRecord> => {
    return unwrap(clientPut<FoodRecord>(`/app/food/records/${id}`, data));
  },

  /** 删除饮食记录 */
  deleteRecord: async (id: string): Promise<void> => {
    await unwrap(clientDelete<null>(`/app/food/records/${id}`));
  },

  /** 获取今日汇总 */
  getTodaySummary: async (): Promise<DailySummary> => {
    return unwrap(clientGet<DailySummary>('/app/food/summary/today'));
  },

  /** 获取最近 N 天汇总 */
  getRecentSummaries: async (days: number = 7): Promise<DailySummaryRecord[]> => {
    return unwrap(clientGet<DailySummaryRecord[]>(`/app/food/summary/recent?days=${days}`));
  },

  /** 获取今日营养评分详情 */
  getNutritionScore: async (): Promise<NutritionScoreResult> => {
    return unwrap(clientGet<NutritionScoreResult>('/app/food/nutrition-score'));
  },

  /** AI 决策反馈 */
  decisionFeedback: async (
    recordId: string,
    followed: boolean,
    feedback: 'helpful' | 'unhelpful' | 'wrong'
  ): Promise<void> => {
    await unwrap(clientPost<null>('/app/food/decision-feedback', { recordId, followed, feedback }));
  },

  // ── Phase 2: 文字分析 + 分析历史 ──

  /** 文字描述分析食物 */
  analyzeText: async (data: AnalyzeTextRequest): Promise<AnalysisResult> => {
    return unwrap(clientPost<AnalysisResult>('/app/food/analyze-text', data));
  },

  /** 将分析结果保存为饮食记录（简化版，只需 analysisId） */
  saveAnalysis: async (data: SaveAnalysisRequest): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/analyze-save', data));
  },

  /** 获取分析历史（分页 + 类型筛选） */
  getAnalysisHistory: async (params?: {
    page?: number;
    pageSize?: number;
    inputType?: 'text' | 'image';
  }): Promise<AnalysisHistoryResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.inputType) searchParams.set('inputType', params.inputType);
    const qs = searchParams.toString();
    return unwrap(
      clientGet<AnalysisHistoryResponse>(`/app/food/analysis/history${qs ? `?${qs}` : ''}`)
    );
  },

  /** 获取单个分析详情 */
  getAnalysisDetail: async (analysisId: string): Promise<AnalysisResult> => {
    return unwrap(clientGet<AnalysisResult>(`/app/food/analysis/${analysisId}`));
  },
};
