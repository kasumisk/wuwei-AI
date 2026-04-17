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
  NutritionScoreBreakdown,
} from '@/types/food';

type RawV61 = {
  analysisId?: string;
  inputType?: 'text' | 'image';
  inputSnapshot?: {
    mealType?: string;
    imageUrl?: string;
    rawText?: string;
  };
  foods?: Array<{
    name?: string;
    quantity?: string;
    category?: string;
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
  }>;
  totals?: {
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
  };
  score?: {
    nutritionScore?: number;
    breakdown?: Record<string, number>;
  };
  decision?: {
    recommendation?: 'recommend' | 'caution' | 'avoid';
    shouldEat?: boolean;
    riskLevel?: string;
    reason?: string;
  };
  alternatives?: Array<{ name?: string }>;
  explanation?: {
    summary?: string;
    primaryReason?: string;
    userContextImpact?: string[];
  };
  summary?: {
    encouragement?: string;
    keyReasons?: string[];
    personalizedSummary?: string;
  };
  shouldEatAction?: {
    compensation?: {
      diet?: string;
      activity?: string;
      nextMeal?: string;
    };
  };
};

type RawAnalyzePollResponse = {
  requestId?: string;
  status?: 'processing' | 'completed' | 'failed';
  error?: string;
  v61?: RawV61;
  foods?: FoodItem[];
  totalCalories?: number;
  mealType?: string;
  advice?: string;
  isHealthy?: boolean;
  imageUrl?: string;
  decision?: string;
  riskLevel?: string;
  reason?: string;
  suggestion?: string;
  insteadOptions?: string[];
  compensation?: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment?: string;
  encouragement?: string;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  nutritionScore?: number;
  scoreBreakdown?: Record<string, number>;
  highlights?: string[];
};

function mapRecommendationToDecision(recommendation?: string): AnalysisResult['decision'] {
  if (recommendation === 'recommend') return 'SAFE';
  if (recommendation === 'avoid') return 'AVOID';
  if (recommendation === 'caution') return 'LIMIT';
  return 'OK';
}

function normalizeScoreBreakdown(
  breakdown?: Record<string, number>
): NutritionScoreBreakdown | undefined {
  if (!breakdown) return undefined;
  return {
    energy: Number(breakdown.energy ?? 0),
    proteinRatio: Number(breakdown.proteinRatio ?? 0),
    macroBalance: Number(breakdown.macroBalance ?? 0),
    foodQuality: Number(breakdown.foodQuality ?? 0),
    satiety: Number(breakdown.satiety ?? 0),
    stability: Number(breakdown.stability ?? 0),
    glycemicImpact: Number(breakdown.glycemicImpact ?? 0),
  };
}

function mapV61ToAnalysisResult(v61: RawV61): AnalysisResult {
  const foods: FoodItem[] = (v61.foods ?? []).map((f) => ({
    name: f.name || '未识别食物',
    calories: Number(f.calories ?? 0),
    quantity: f.quantity,
    category: f.category,
    protein: f.protein,
    fat: f.fat,
    carbs: f.carbs,
  }));

  return {
    requestId: v61.analysisId || '',
    foods,
    totalCalories: Number(v61.totals?.calories ?? 0),
    mealType: v61.inputSnapshot?.mealType || 'lunch',
    advice: v61.explanation?.summary || '',
    isHealthy: v61.decision?.shouldEat ?? true,
    imageUrl: v61.inputSnapshot?.imageUrl,
    decision: mapRecommendationToDecision(v61.decision?.recommendation),
    riskLevel: v61.decision?.riskLevel || 'medium',
    reason: v61.decision?.reason || '',
    suggestion: v61.explanation?.primaryReason || '',
    insteadOptions: (v61.alternatives ?? [])
      .map((a) => a.name)
      .filter((name): name is string => !!name),
    compensation: {
      diet: v61.shouldEatAction?.compensation?.diet,
      activity: v61.shouldEatAction?.compensation?.activity,
      nextMeal: v61.shouldEatAction?.compensation?.nextMeal,
    },
    contextComment:
      v61.summary?.personalizedSummary || v61.explanation?.userContextImpact?.[0] || '',
    encouragement: v61.summary?.encouragement || '',
    totalProtein: v61.totals?.protein,
    totalFat: v61.totals?.fat,
    totalCarbs: v61.totals?.carbs,
    nutritionScore: v61.score?.nutritionScore,
    scoreBreakdown: normalizeScoreBreakdown(v61.score?.breakdown),
    highlights: v61.summary?.keyReasons,
  };
}

function normalizeAnalysisResult(raw: unknown): AnalysisResult {
  const data = (raw || {}) as RawAnalyzePollResponse;

  if (data.v61) {
    const mapped = mapV61ToAnalysisResult(data.v61);
    return {
      ...mapped,
      requestId: data.requestId || mapped.requestId,
      imageUrl: data.imageUrl || mapped.imageUrl,
    };
  }

  const foods = Array.isArray(data.foods) ? data.foods : [];
  return {
    requestId: data.requestId || '',
    foods,
    totalCalories: Number(data.totalCalories ?? 0),
    mealType: data.mealType || 'lunch',
    advice: data.advice || '',
    isHealthy: data.isHealthy ?? true,
    imageUrl: data.imageUrl,
    decision: (data.decision as AnalysisResult['decision']) || 'OK',
    riskLevel: data.riskLevel || 'medium',
    reason: data.reason || '',
    suggestion: data.suggestion || '',
    insteadOptions: data.insteadOptions || [],
    compensation: data.compensation || {},
    contextComment: data.contextComment || '',
    encouragement: data.encouragement || '',
    totalProtein: data.totalProtein,
    totalFat: data.totalFat,
    totalCarbs: data.totalCarbs,
    nutritionScore: data.nutritionScore,
    scoreBreakdown: normalizeScoreBreakdown(data.scoreBreakdown),
    highlights: data.highlights,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollAnalyzeResult(requestId: string): Promise<AnalysisResult> {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await clientGet<RawAnalyzePollResponse>(`/app/food/analyze/${requestId}`);
    if (!res.success) {
      const failData = (res.data || {}) as RawAnalyzePollResponse;
      if (failData.status === 'failed') {
        throw new Error(failData.error || res.message || 'AI 分析失败');
      }
      throw new Error(res.message || 'AI 分析失败');
    }

    const data = (res.data || {}) as RawAnalyzePollResponse;
    if (data.status === 'completed') {
      return normalizeAnalysisResult({ ...data, requestId });
    }
    if (data.status === 'failed') {
      throw new Error(data.error || 'AI 分析失败');
    }

    await sleep(1500);
  }

  throw new Error('分析超时，请稍后在历史记录中查看结果');
}

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

    // 后端返回异步任务 requestId，前端在 API 层自动轮询并统一返回分析结果。
    const submitRes = await clientUpload<RawAnalyzePollResponse>('/app/food/analyze', formData);
    if (!submitRes.success) {
      throw new Error(submitRes.message || '提交分析任务失败');
    }

    const requestId = submitRes.data?.requestId;
    if (!requestId) {
      throw new Error('分析任务创建失败，请重试');
    }

    return pollAnalyzeResult(requestId);
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
    source?: 'screenshot' | 'camera' | 'manual' | 'text_analysis' | 'image_analysis';
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

  /** 删除分析记录（分析历史） */
  deleteAnalysis: async (analysisId: string): Promise<void> => {
    await unwrap(clientDelete<null>(`/app/food/analysis/${analysisId}`));
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
    const raw = await unwrap(clientPost<unknown>('/app/food/analyze-text', data));
    return normalizeAnalysisResult(raw);
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
    const raw = await unwrap<{
      items: Array<{
        analysisId: string;
        inputType: 'text' | 'image';
        mealType?: string;
        createdAt: string;
        summary?: {
          foodNames?: string[];
          totalCalories?: number;
          recommendation?: 'recommend' | 'caution' | 'avoid';
        };
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(clientGet(`/app/food/analysis/history${qs ? `?${qs}` : ''}`));

    const mappedItems: AnalysisHistoryItem[] = (raw.items || []).map((item) => ({
      id: item.analysisId,
      inputType: item.inputType,
      inputText: item.summary?.foodNames?.join('、') || undefined,
      imageUrl: undefined,
      mealType: item.mealType,
      totalCalories: Number(item.summary?.totalCalories ?? 0),
      foodCount: item.summary?.foodNames?.length || 0,
      decision: mapRecommendationToDecision(item.summary?.recommendation),
      isHealthy: item.summary?.recommendation !== 'avoid',
      createdAt: item.createdAt,
    }));

    return {
      items: mappedItems,
      total: raw.total,
      page: raw.page,
      pageSize: raw.pageSize,
    };
  },

  /** 获取单个分析详情 */
  getAnalysisDetail: async (analysisId: string): Promise<AnalysisResult> => {
    const raw = await unwrap<unknown>(clientGet(`/app/food/analysis/${analysisId}`));
    return normalizeAnalysisResult(raw);
  },
};
