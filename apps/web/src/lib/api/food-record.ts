'use client';

/**
 * 食物记录 API 服务
 * 直接对应后端 /app/food/* 接口，无 V61 封装层。
 */

import { clientGet, clientPost, clientPut, clientDelete, clientUpload } from './client-api';
import type { ApiResponse } from './http-client';
import { APIError } from './error-handler';
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

// ─────────────────────────────────────────────
// 原始 API 数据类型（直接对应后端 data 字段）
// ─────────────────────────────────────────────
type RawAnalysisData = {
  analysisId?: string;
  inputType?: 'text' | 'image';
  inputSnapshot?: { mealType?: string; imageUrl?: string; rawText?: string };
  foods?: Array<{
    name?: string;
    normalizedName?: string;
    foodLibraryId?: string;
    quantity?: string;
    estimatedWeightGrams?: number;
    category?: string;
    confidence?: number;
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    saturatedFat?: number;
    addedSugar?: number;
  }>;
  totals?: {
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    saturatedFat?: number;
    addedSugar?: number;
  };
  score?: {
    healthScore?: number;
    nutritionScore?: number;
    confidenceScore?: number;
    breakdown?: Record<string, number>;
  };
  decision?: {
    recommendation?: 'recommend' | 'caution' | 'avoid';
    shouldEat?: boolean;
    reason?: string;
    riskLevel?: string;
    advice?: string;
    decisionFactors?: Array<{
      dimension?: string;
      score?: number;
      impact?: string;
      message?: string;
    }>;
    nextMealAdvice?: {
      targetCalories?: number;
      targetProtein?: number;
      targetFat?: number;
      targetCarbs?: number;
      emphasis?: string;
      suggestion?: string;
    };
    optimalPortion?: { recommendedPercent?: number; recommendedCalories?: number };
    decisionChain?: Array<{ step?: string; input?: string; output?: string; confidence?: number }>;
    breakdownExplanations?: Array<{
      dimension?: string;
      label?: string;
      score?: number;
      impact?: string;
      message?: string;
      suggestion?: string;
    }>;
    issues?: Array<{ issue?: string; severity?: string; detail?: string }>;
  };
  alternatives?: Array<{ name?: string }>;
  explanation?: {
    summary?: string;
    primaryReason?: string;
    userContextImpact?: string[];
    upgradeTeaser?: string;
  };
  summary?: {
    headline?: string;
    topIssues?: string[];
    topStrengths?: string[];
    actionItems?: string[];
    quantitativeHighlight?: string;
    contextSignals?: string[];
    coachFocus?: string;
    alternativeSummary?: string;
    dynamicDecisionHint?: string;
    healthConstraintNote?: string;
    decisionGuardrails?: string[];
    encouragement?: string;
    keyReasons?: string[];
    personalizedSummary?: string;
  };
  shouldEatAction?: {
    primaryReason?: string;
    portionAction?: { suggestedPercent?: number; suggestedCalories?: number };
    replacementAction?: {
      strategy?: string;
      candidates?: Array<{
        name?: string;
        foodLibraryId?: string;
        source?: string;
        score?: number;
        reason?: string;
        comparison?: { caloriesDiff?: number; proteinDiff?: number; scoreDiff?: number };
        scenarioType?: string;
        rankScore?: number;
        rankReasons?: string[];
      }>;
    };
    recoveryAction?: { nextMealDirection?: string; todayAdjustment?: string };
    compensation?: { diet?: string; activity?: string; nextMeal?: string };
  };
  analysisState?: {
    projectedAfterMeal?: { completionRatio?: Record<string, number> };
  };
  contextualAnalysis?: {
    identifiedIssues?: Array<{
      type?: string;
      severity?: string;
      metric?: number;
      threshold?: number;
      implication?: string;
    }>;
  };
  confidenceDiagnostics?: {
    overallConfidence?: number;
    analysisQualityBand?: string;
    analysisCompletenessScore?: number;
  };
  /** 权益裁剪信息：后端按订阅等级 trim 结果后注入 */
  entitlement?: {
    tier: string;
    fieldsHidden: string[];
  };
  // 轮询专用
  status?: 'processing' | 'completed' | 'failed';
  error?: string;
  result?: RawAnalysisData;
};

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────
function mapRecommendation(r?: string): AnalysisResult['decision'] {
  if (r === 'recommend') return 'SAFE';
  if (r === 'avoid') return 'AVOID';
  if (r === 'caution') return 'LIMIT';
  return 'OK';
}

function normalizeScoreBreakdown(b?: Record<string, number>): NutritionScoreBreakdown | undefined {
  if (!b) return undefined;
  return {
    energy: Number(b.energy ?? 0),
    proteinRatio: Number(b.proteinRatio ?? 0),
    macroBalance: Number(b.macroBalance ?? 0),
    foodQuality: Number(b.foodQuality ?? 0),
    satiety: Number(b.satiety ?? 0),
    stability: Number(b.stability ?? 0),
    glycemicImpact: Number(b.glycemicImpact ?? 0),
  };
}

/**
 * 将 API 原始数据直接映射为前端 AnalysisResult
 */
function mapAnalysisData(raw: RawAnalysisData, overrideRequestId?: string): AnalysisResult {
  const foods: AnalysisResult['foods'] = (raw.foods ?? []).map((f) => ({
    name: f.name || '未识别食物',
    calories: Number(f.calories ?? 0),
    quantity: f.quantity,
    category: f.category,
    protein: f.protein,
    fat: f.fat,
    carbs: f.carbs,
    normalizedName: f.normalizedName,
    foodLibraryId: f.foodLibraryId,
    estimatedWeightGrams: f.estimatedWeightGrams,
    confidence: f.confidence,
    saturatedFat: f.saturatedFat,
    addedSugar: f.addedSugar,
  }));

  return {
    requestId: overrideRequestId || raw.analysisId || '',
    inputType: raw.inputType,
    mealType: raw.inputSnapshot?.mealType || 'lunch',
    imageUrl: raw.inputSnapshot?.imageUrl,
    isHealthy: raw.decision?.shouldEat ?? true,
    shouldEat: raw.decision?.shouldEat,

    foods,

    totalCalories: Number(raw.totals?.calories ?? 0),
    totalProtein: raw.totals?.protein,
    totalFat: raw.totals?.fat,
    totalCarbs: raw.totals?.carbs,
    totalSaturatedFat: raw.totals?.saturatedFat,
    totalAddedSugar: raw.totals?.addedSugar,

    healthScore: raw.score?.healthScore,
    nutritionScore: raw.score?.nutritionScore,
    confidenceScore: raw.score?.confidenceScore,
    scoreBreakdown: normalizeScoreBreakdown(raw.score?.breakdown),

    decision: mapRecommendation(raw.decision?.recommendation),
    riskLevel: raw.decision?.riskLevel || 'medium',
    reason: raw.decision?.reason || '',
    decisionAdvice: raw.decision?.advice,
    decisionFactors: raw.decision?.decisionFactors,
    decisionChain: raw.decision?.decisionChain,
    breakdownExplanations: raw.decision?.breakdownExplanations,
    optimalPortion: raw.decision?.optimalPortion,
    nextMealAdvice: raw.decision?.nextMealAdvice,

    advice: raw.explanation?.summary || '',
    headline: raw.summary?.headline,
    topIssues: raw.summary?.topIssues,
    topStrengths: raw.summary?.topStrengths,
    actionItems: raw.summary?.actionItems,
    quantitativeHighlight: raw.summary?.quantitativeHighlight,
    contextSignals: raw.summary?.contextSignals,
    alternativeSummary: raw.summary?.alternativeSummary,
    dynamicDecisionHint: raw.summary?.dynamicDecisionHint,
    healthConstraintNote: raw.summary?.healthConstraintNote,
    decisionGuardrails: raw.summary?.decisionGuardrails,
    coachFocus: raw.summary?.coachFocus,
    highlights: raw.summary?.keyReasons,
    encouragement: raw.summary?.encouragement || '',
    contextComment: raw.summary?.personalizedSummary || '',

    suggestion: raw.shouldEatAction?.primaryReason || '',
    insteadOptions: (raw.alternatives ?? []).map((a) => a.name).filter((n): n is string => !!n),
    replacementCandidates: (raw.shouldEatAction?.replacementAction?.candidates ?? [])
      .filter((c) => !!c.name)
      .map((c) => ({
        name: c.name!,
        foodLibraryId: c.foodLibraryId,
        source: c.source,
        score: c.score,
        reason: c.reason,
        comparison: c.comparison,
        scenarioType: c.scenarioType,
        rankScore: c.rankScore,
        rankReasons: c.rankReasons,
      })),
    portionAction: raw.shouldEatAction?.portionAction,
    recoveryAction: raw.shouldEatAction?.recoveryAction,
    compensation: {
      diet: raw.shouldEatAction?.compensation?.diet,
      activity: raw.shouldEatAction?.compensation?.activity,
      nextMeal: raw.shouldEatAction?.compensation?.nextMeal,
    },

    completionRatio: raw.analysisState?.projectedAfterMeal?.completionRatio,
    identifiedIssues: raw.contextualAnalysis?.identifiedIssues,

    confidenceDiagnostics: raw.confidenceDiagnostics
      ? {
          overallConfidence: raw.confidenceDiagnostics.overallConfidence,
          analysisQualityBand: raw.confidenceDiagnostics.analysisQualityBand,
          analysisCompletenessScore: raw.confidenceDiagnostics.analysisCompletenessScore,
        }
      : undefined,

    entitlement: raw.entitlement
      ? { tier: raw.entitlement.tier, fieldsHidden: raw.entitlement.fieldsHidden ?? [] }
      : undefined,
  };
}

// ─────────────────────────────────────────────
// 轮询
// ─────────────────────────────────────────────
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollAnalyzeResult(requestId: string): Promise<AnalysisResult> {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: ApiResponse<RawAnalysisData>;
    try {
      res = await clientGet<RawAnalysisData>(`/app/food/analyze/${requestId}`);
    } catch (err) {
      // Axios 遇到 4xx（含配额 403）时 reject，需透传 paywall
      rethrowWithPaywall(err);
    }
    if (!res.success) {
      const d = res.data as RawAnalysisData | undefined;
      if (d?.status === 'failed') throw new Error(d.error || res.message || 'AI 分析失败');
      // 轮询结果中同样可能携带 paywall（如配额在轮询期间被并发请求耗尽）
      throw buildApiError(res.message, res.data);
    }
    const data = res.data as RawAnalysisData;
    if (data.status === 'completed') {
      // 新协议: data.result 为统一结构；兜底兼容历史混合响应
      const payload = data.result ?? data;
      return mapAnalysisData(payload, requestId);
    }
    if (data.status === 'failed') throw new Error(data.error || 'AI 分析失败');
    await sleep(1500);
  }
  throw new Error('分析超时，请稍后在历史记录中查看结果');
}

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  try {
    const res = await promise;
    if (!res.success) {
      throw buildApiError(res.message, res.data);
    }
    return res.data;
  } catch (err) {
    rethrowWithPaywall(err);
  }
}

/**
 * 统一构建带 paywall 信息的错误对象
 *
 * 支持两种来源：
 * 1. 从 ApiResponse（!success）中提取：res.data = EnhancedPaywallDisplay = { paywall: {...}, type, benefits }
 * 2. 从 APIError（Axios 4xx reject）中透传：apiError.paywall 已由 fromResponse 提取
 *
 * handlePaywallError() 检查 err.paywall.code && err.paywall.recommendedTier，
 * 因此需要把 paywall 挂到 err.paywall 上。
 */
function buildApiError(message: string | undefined, data: unknown): Error & { paywall?: unknown } {
  // 如果入参本身是 APIError，透传已解析的 paywall
  if (data instanceof APIError) {
    const err = new Error(message || data.message || '请求失败') as Error & { paywall?: unknown };
    if (data.paywall) err.paywall = data.paywall;
    return err;
  }
  const err = new Error(message || '请求失败') as Error & { paywall?: unknown };
  const rawData = data as Record<string, unknown> | null | undefined;
  const rawPaywall = rawData?.paywall as Record<string, unknown> | undefined;
  if (
    rawPaywall &&
    typeof rawPaywall.code === 'string' &&
    typeof rawPaywall.recommendedTier === 'string'
  ) {
    err.paywall = rawPaywall;
  }
  return err;
}

/**
 * 将 APIError（Axios reject on 4xx/5xx）转为带 paywall 的错误对象并重新抛出
 * 在 try/catch 中拦截 Axios 错误，确保 paywall 信息传递给 handlePaywallError
 */
function rethrowWithPaywall(err: unknown): never {
  if (err instanceof APIError) {
    throw buildApiError(err.message, err);
  }
  throw err;
}

// ─────────────────────────────────────────────
// 导出服务
// ─────────────────────────────────────────────
export const foodRecordService = {
  /** 上传食物图片 AI 分析 */
  analyzeImage: async (file: File, mealType?: string): Promise<AnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (mealType) formData.append('mealType', mealType);
    let submitRes: ApiResponse<RawAnalysisData>;
    try {
      submitRes = await clientUpload<RawAnalysisData>('/app/food/analyze', formData);
    } catch (err) {
      // 上传阶段可能触发配额硬付费墙，Axios reject 时需透传 paywall
      rethrowWithPaywall(err);
    }
    if (!submitRes.success) {
      // 上传阶段也可能触发配额硬付费墙，需携带 paywall 信息
      throw buildApiError(submitRes.message, submitRes.data);
    }
    const d = submitRes.data as RawAnalysisData & { requestId?: string };
    const requestId = d?.requestId || d?.analysisId;
    if (!requestId) throw new Error('分析任务创建失败，请重试');
    return pollAnalyzeResult(requestId);
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
  getRecentSummaries: async (days = 7): Promise<DailySummaryRecord[]> => {
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

  /** 文字描述分析食物 */
  analyzeText: async (data: AnalyzeTextRequest): Promise<AnalysisResult> => {
    const raw = await unwrap(clientPost<RawAnalysisData>('/app/food/analyze-text', data));
    return mapAnalysisData(raw);
  },

  /** 将分析结果保存为饮食记录（只需 analysisId） */
  saveAnalysis: async (data: SaveAnalysisRequest): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/analyze-save', data));
  },

  /** 获取分析历史（分页 + 类型筛选） */
  getAnalysisHistory: async (params?: {
    page?: number;
    pageSize?: number;
    inputType?: 'text' | 'image';
  }): Promise<AnalysisHistoryResponse> => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
    if (params?.inputType) sp.set('inputType', params.inputType);
    const qs = sp.toString();
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

    const items: AnalysisHistoryItem[] = (raw.items || []).map((item) => ({
      id: item.analysisId,
      inputType: item.inputType,
      inputText: item.summary?.foodNames?.join('、') || undefined,
      imageUrl: undefined,
      mealType: item.mealType,
      totalCalories: Number(item.summary?.totalCalories ?? 0),
      foodCount: item.summary?.foodNames?.length || 0,
      decision: mapRecommendation(item.summary?.recommendation),
      isHealthy: item.summary?.recommendation !== 'avoid',
      createdAt: item.createdAt,
    }));

    return { items, total: raw.total, page: raw.page, pageSize: raw.pageSize };
  },

  /** 获取单个分析详情 */
  getAnalysisDetail: async (analysisId: string): Promise<AnalysisResult> => {
    const raw = await unwrap<RawAnalysisData>(clientGet(`/app/food/analysis/${analysisId}`));
    return mapAnalysisData(raw);
  },

  // ── V8: Food Log 统一接口 ──

  /** V8: 统一写入 Food Record */
  createRecord: async (data: {
    foods: FoodItem[];
    totalCalories: number;
    mealType: string;
    source: 'manual' | 'recommend' | 'decision' | 'text_analysis' | 'image_analysis';
    totalProtein?: number;
    totalFat?: number;
    totalCarbs?: number;
    avgQuality?: number;
    avgSatiety?: number;
    nutritionScore?: number;
    analysisId?: string;
    recommendationTraceId?: string;
    advice?: string;
    isHealthy?: boolean;
    imageUrl?: string;
    recordedAt?: string;
  }): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/records', data));
  },

  /** V8: 查询 Food Records（支持单日/日期范围） */
  queryRecords: async (params?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    source?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: FoodRecord[];
    total: number;
    page: number;
    limit: number;
    date?: string;
    startDate?: string;
    endDate?: string;
    summary?: {
      totalCalories: number;
      totalProtein: number;
      totalFat: number;
      totalCarbs: number;
      mealCount: number;
    };
  }> => {
    const sp = new URLSearchParams();
    if (params?.date) sp.set('date', params.date);
    if (params?.startDate) sp.set('startDate', params.startDate);
    if (params?.endDate) sp.set('endDate', params.endDate);
    if (params?.source) sp.set('source', params.source);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return unwrap(clientGet(`/app/food/records${qs ? `?${qs}` : ''}`));
  },
};
