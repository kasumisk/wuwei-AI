import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: string[];
}

export interface UsdaSearchResult {
  foods: Array<{
    fdcId: number;
    description: string;
    foodCategory?: string;
    dataType?: string;
    brandOwner?: string;
  }>;
  totalHits: number;
}

export interface AiLabelResult {
  labeled: number;
  failed: number;
}

export interface AiTranslateResult {
  translated: number;
  failed: number;
}

export interface RulesApplyResult {
  processed: number;
}

export interface QualityReport {
  generatedAt: string;
  summary: {
    totalFoods: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
  };
  completeness: {
    hasMacros: number;
    hasMicros: number;
    hasAllergens: number;
    hasImage: number;
    hasBarcode: number;
    hasMealTypes: number;
    hasCompatibility: number;
  };
  quality: {
    verifiedCount: number;
    avgConfidence: number;
    macroConsistencyPass: number;
  };
  conflicts: {
    total: number;
    pending: number;
    resolved: number;
  };
  translations: {
    totalTranslations: number;
    byLocale: Record<string, number>;
    untranslatedCount: number;
  };
  recentChanges: Array<{
    date: string;
    count: number;
  }>;
  /** V7.9: AI 补全统计 */
  enrichment?: {
    directApplied: number;
    staged: number;
    approved: number;
    rejected: number;
    coreCoverage: number;
    microCoverage: number;
  };
  /** V8.0: 字段级完整度统计 */
  fieldCompleteness?: Array<{
    field: string;
    filledCount: number;
    totalCount: number;
    percentage: number;
  }>;
  /** V8.0: 补全覆盖率趋势（近30天，按天聚合） */
  enrichmentTrend?: Array<{
    date: string;
    enrichedCount: number;
    approvedCount: number;
    rejectedCount: number;
  }>;
}

export interface ImageRecognitionResult {
  foods: Array<{
    name: string;
    confidence: number;
    estimatedCalories?: number;
    estimatedPortion?: string;
  }>;
}

// ==================== Query Keys ====================

const _all = ['foodPipeline'] as const;

export const foodPipelineQueryKeys = {
  all: _all,
  qualityReport: [..._all, 'qualityReport'] as const,
  usdaSearch: (query: string) => [..._all, 'usdaSearch', query] as const,
  offSearch: (query: string) => [..._all, 'offSearch', query] as const,
};

// ==================== API ====================

export const foodPipelineApi = {
  // USDA
  importUsda: (data: { query: string; maxItems?: number }): Promise<ImportResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/import/usda`, data),

  searchUsda: (query: string, pageSize = 20): Promise<UsdaSearchResult> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/usda/search`, { query, pageSize }),

  // OpenFoodFacts
  lookupBarcode: (barcode: string): Promise<any> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/barcode/${barcode}`),

  searchOff: (query: string, pageSize = 20): Promise<any> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/openfoodfacts/search`, { query, pageSize }),

  // AI
  batchAiLabel: (data: {
    category?: string;
    unlabeled?: boolean;
    limit?: number;
  }): Promise<AiLabelResult> => request.post(`${PATH.ADMIN.FOOD_PIPELINE}/ai/label`, data),

  batchAiTranslate: (data: {
    targetLocale: string;
    limit?: number;
    untranslatedOnly?: boolean;
  }): Promise<AiTranslateResult> => request.post(`${PATH.ADMIN.FOOD_PIPELINE}/ai/translate`, data),

  // 规则引擎
  batchApplyRules: (data: { limit?: number; recalcAll?: boolean }): Promise<RulesApplyResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/rules/apply`, data),

  // 冲突
  resolveAllConflicts: (): Promise<any> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/conflicts/resolve-all`, {}),

  // 图片识别
  recognizeImage: (file: File): Promise<ImageRecognitionResult> => {
    const formData = new FormData();
    formData.append('image', file);
    return request.upload(`${PATH.ADMIN.FOOD_PIPELINE}/recognize/image`, formData);
  },

  recognizeImageByUrl: (imageUrl: string): Promise<ImageRecognitionResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/recognize/url`, { imageUrl }),

  // 质量报告
  getQualityReport: (): Promise<QualityReport> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/quality/report`),
};

// ==================== React Query Hooks ====================

export const useQualityReport = () =>
  useQuery({
    queryKey: foodPipelineQueryKeys.qualityReport,
    queryFn: () => foodPipelineApi.getQualityReport(),
    staleTime: 5 * 60 * 1000,
  });

export const useImportUsda = (
  options?: UseMutationOptions<ImportResult, Error, { query: string; maxItems?: number }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.importUsda(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useBatchAiLabel = (
  options?: UseMutationOptions<
    AiLabelResult,
    Error,
    { category?: string; unlabeled?: boolean; limit?: number }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.batchAiLabel(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodLibrary'] }),
    ...options,
  });
};

export const useBatchAiTranslate = (
  options?: UseMutationOptions<
    AiTranslateResult,
    Error,
    { targetLocale: string; limit?: number; untranslatedOnly?: boolean }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.batchAiTranslate(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodLibrary'] }),
    ...options,
  });
};

export const useBatchApplyRules = (
  options?: UseMutationOptions<RulesApplyResult, Error, { limit?: number; recalcAll?: boolean }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.batchApplyRules(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodLibrary'] }),
    ...options,
  });
};

export const useResolveAllConflicts = (options?: UseMutationOptions<any, Error, void>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => foodPipelineApi.resolveAllConflicts(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodLibrary'] }),
    ...options,
  });
};

export const useLookupBarcode = (options?: UseMutationOptions<any, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (barcode) => foodPipelineApi.lookupBarcode(barcode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodLibrary'] }),
    ...options,
  });
};

export const useRecognizeImage = (
  options?: UseMutationOptions<ImageRecognitionResult, Error, File>
) =>
  useMutation({
    mutationFn: (file) => foodPipelineApi.recognizeImage(file),
    ...options,
  });

export const useRecognizeImageByUrl = (
  options?: UseMutationOptions<ImageRecognitionResult, Error, string>
) =>
  useMutation({
    mutationFn: (url) => foodPipelineApi.recognizeImageByUrl(url),
    ...options,
  });

// ==================== Enrichment 类型 ====================

export type EnrichableField =
  | 'protein'
  | 'fat'
  | 'carbs'
  | 'fiber'
  | 'sugar'
  | 'added_sugar'
  | 'natural_sugar'
  | 'sodium'
  | 'calcium'
  | 'iron'
  | 'potassium'
  | 'cholesterol'
  | 'vitamin_a'
  | 'vitamin_c'
  | 'vitamin_d'
  | 'vitamin_e'
  | 'vitamin_b12'
  | 'folate'
  | 'zinc'
  | 'magnesium'
  | 'saturated_fat'
  | 'trans_fat'
  | 'purine'
  | 'phosphorus'
  // V8.0: V7.9 新增营养素字段
  | 'vitamin_b6'
  | 'omega3'
  | 'omega6'
  | 'soluble_fiber'
  | 'insoluble_fiber'
  | 'water_content_percent'
  | 'sub_category'
  | 'food_group'
  | 'cuisine'
  | 'cooking_method'
  | 'glycemic_index'
  | 'glycemic_load'
  | 'fodmap_level'
  | 'oxalate_level'
  | 'processing_level'
  | 'meal_types'
  | 'allergens'
  | 'tags'
  | 'common_portions'
  | 'quality_score'
  | 'satiety_score'
  | 'nutrient_density'
  | 'commonality_score'
  | 'standard_serving_desc'
  | 'main_ingredient'
  | 'flavor_profile'
  // V8.0: 扩展属性字段（Stage 5）
  | 'food_form'
  | 'dish_priority'
  | 'popularity_score'
  | 'acquisition_difficulty'
  | 'texture'
  | 'taste_profile'
  | 'suitable_diet_types'
  | 'health_benefits'
  | 'health_risks'
  | 'seasonal_availability'
  | 'storage_method'
  | 'shelf_life_days'
  | 'best_cooking_temp'
  | 'pairing_foods';

export type EnrichmentTarget = 'foods' | 'translations' | 'regional';

export interface MissingFieldStats {
  total: number;
  fields: Record<EnrichableField, number>;
  translationsMissing: number;
  regionalMissing: number;
}

export interface EnrichEnqueueResult {
  enqueued: number;
  target: EnrichmentTarget;
  staged: boolean;
  foodNames: string[];
}

export interface EnrichmentQueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/** V8.2: /stats 接口实际返回结构（含历史统计） */
export interface EnrichmentStatsResponse {
  queue: EnrichmentQueueStats;
  historical: {
    total: number;
    enriched: number;
    pending: number;
    failed: number;
    staged: number;
    rejected: number;
    avgCompleteness: number;
  };
}

export interface EnrichmentJob {
  id: string;
  foodId: string;
  fields: EnrichableField[];
  target: EnrichmentTarget;
  staged: boolean;
  locale: string | null;
  region: string | null;
  status: 'pending' | 'completed' | 'failed';
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}

export interface StagedEnrichment {
  id: string;
  foodId: string;
  foodName?: string;
  action: string;
  changes: Record<string, any>;
  reason: string | null;
  operator: string | null;
  version: number;
  createdAt: string;
}

export interface StagedEnrichmentPage {
  list: StagedEnrichment[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== V8.0: 补全预览类型 ====================

/** 单条补全预览的字段差异 */
export interface EnrichmentFieldDiff {
  field: string;
  label: string;
  currentValue: any;
  suggestedValue: any;
  unit: string;
  validRange: { min: number; max: number } | null;
}

/** 单条补全预览数据 */
export interface EnrichmentPreview {
  food: {
    id: string;
    name: string;
    name_zh: string | null;
    category: string | null;
    sub_category: string | null;
  };
  staged: {
    logId: string;
    changes: Record<string, any>;
    confidence: number;
    target: string;
    stage: number | null;
    createdAt: string;
  };
  diff: EnrichmentFieldDiff[];
  categoryAverage: Record<string, number> | null;
}

/** 批量预览结果 */
export interface BatchPreviewResult {
  results: Array<{
    logId: string;
    success: boolean;
    data?: EnrichmentPreview;
    error?: string;
  }>;
  summary: {
    total: number;
    success: number;
    failed: number;
    avgConfidence: number;
  };
}

/** 补全进度统计（V8.2: 与后端 getEnrichmentProgress 匹配） */
export interface EnrichmentProgress {
  totalFoods: number;
  fullyEnriched: number;
  partiallyEnriched: number;
  notEnriched: number;
  avgCompleteness: number;
  stagesCoverage: Array<{
    stage: number;
    name: string;
    coverageRate: number;
  }>;
  byStatus?: Record<string, number>;
}

/** 补全完整度评分 */
export interface FoodCompleteness {
  foodId: string;
  foodName: string;
  score: number;
  filledFields: string[];
  missingFields: string[];
  totalFields: number;
}

/** 补全统计（全局） */
export interface EnrichmentStatistics {
  directApplied: number;
  staged: number;
  approved: number;
  rejected: number;
  coreCoverage: number;
  microCoverage: number;
}

/** V8.0: 完整度分布统计 */
export interface CompletenessDistribution {
  total: number;
  distribution: Array<{
    range: string;
    min: number;
    max: number;
    count: number;
  }>;
  avgCompleteness: number;
}

/** V8.0: 运维统计 */
export interface OperationsStats {
  total: number;
  directApplied: number;
  staged: number;
  approved: number;
  rejected: number;
  /** 审核通过率（百分比） */
  approvalRate: number;
  /** 已入库补全的平均置信度 (0-1) */
  avgConfidence: number;
  /** 按日统计（最近 30 天） */
  dailyStats: Array<{
    date: string;
    count: number;
    action: string;
  }>;
}

// ==================== V7.9/V8.0: 分阶段入队相关类型 ====================

/** 分阶段入队参数 */
export interface EnqueueStagedBatchParams {
  stages?: number[];
  limit?: number;
  offset?: number;
  staged?: boolean;
  /** V8.0: 仅入队完整度 <= 此值的食物（0-100） */
  maxCompleteness?: number;
}

/** 分阶段入队结果 */
export interface EnqueueStagedBatchResult {
  enqueued: number;
  stages: number[];
  stageNames: string[];
  staged: boolean;
  foodNames: string[];
}

/** 重试失败任务结果 */
export interface RetryFailedResult {
  retried: number;
  failedToRetry: number;
  errors: string[];
}

// ==================== Enrichment API ====================

const ENRICHMENT_BASE = `${PATH.ADMIN.FOOD_PIPELINE}/enrichment`;

export const enrichmentApi = {
  scan: (): Promise<MissingFieldStats> => request.post(`${ENRICHMENT_BASE}/scan`, {}),

  enqueue: (data: {
    fields?: EnrichableField[];
    limit?: number;
    offset?: number;
    target?: EnrichmentTarget;
    locale?: string;
    region?: string;
    staged?: boolean;
    /** V8.0: 仅入队完整度 <= 此值的食物（0-100） */
    maxCompleteness?: number;
  }): Promise<EnrichEnqueueResult> => request.post(`${ENRICHMENT_BASE}/enqueue`, data),

  getStats: (): Promise<EnrichmentStatsResponse> => request.get(`${ENRICHMENT_BASE}/stats`),

  getJobs: (params?: {
    status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
    limit?: number;
    offset?: number;
  }): Promise<EnrichmentJob[]> => request.get(`${ENRICHMENT_BASE}/jobs`, params),

  clean: (data?: { grace?: number; type?: 'completed' | 'failed' }): Promise<{ cleaned: number }> =>
    request.post(`${ENRICHMENT_BASE}/clean`, data ?? {}),

  // Staging
  getStaged: (params?: {
    page?: number;
    pageSize?: number;
    foodId?: string;
    target?: EnrichmentTarget;
  }): Promise<StagedEnrichmentPage> => request.get(`${ENRICHMENT_BASE}/staged`, params),

  approveStaged: (
    id: string,
    selectedFields?: string[]
  ): Promise<{ applied: boolean; detail: string }> =>
    request.post(`${ENRICHMENT_BASE}/staged/${id}/approve`, {
      ...(selectedFields ? { selectedFields } : {}),
    }),

  rejectStaged: (id: string, reason: string): Promise<void> =>
    request.post(`${ENRICHMENT_BASE}/staged/${id}/reject`, { reason }),

  batchApprove: (ids: string[]): Promise<{ success: number; failed: number; errors: string[] }> =>
    request.post(`${ENRICHMENT_BASE}/staged/batch-approve`, { ids }),

  // History
  getHistory: (params?: {
    page?: number;
    pageSize?: number;
    foodId?: string;
    action?: string;
  }): Promise<StagedEnrichmentPage> => request.get(`${ENRICHMENT_BASE}/history`, params),

  // ---- V7.9 新增 ----

  /** 分阶段批量入队补全任务（支持按阶段1-4分批处理） */
  enqueueStagedBatch: (data: EnqueueStagedBatchParams): Promise<EnqueueStagedBatchResult> =>
    request.post(`${ENRICHMENT_BASE}/enqueue-staged`, data),

  /** 全库补全进度统计（按字段维度） */
  getProgress: (): Promise<EnrichmentProgress> => request.get(`${ENRICHMENT_BASE}/progress`),

  /** 批量重试失败的补全任务 */
  retryFailed: (data?: { limit?: number }): Promise<RetryFailedResult> =>
    request.post(`${ENRICHMENT_BASE}/retry-failed`, data ?? {}),

  /** 查询单个食物的数据完整度评分 */
  getCompleteness: (foodId: string): Promise<FoodCompleteness> =>
    request.get(`${ENRICHMENT_BASE}/completeness/${foodId}`),

  // ---- V8.0 新增 ----

  /** 预览暂存AI补全数据（对比当前值与建议值 + 同类均值） */
  getPreview: (logId: string): Promise<EnrichmentPreview> =>
    request.get(`${ENRICHMENT_BASE}/staged/${logId}/preview`),

  /** 批量预览暂存数据（最多50条，用于批量审核前对比） */
  getBatchPreview: (ids: string[]): Promise<BatchPreviewResult> =>
    request.post(`${ENRICHMENT_BASE}/staged/batch-preview`, { ids }),

  /** V8.0: 全库完整度分布统计（按0-20/20-40/40-60/60-80/80-100区间） */
  getCompletenessDistribution: (): Promise<CompletenessDistribution> =>
    request.get(`${ENRICHMENT_BASE}/completeness-distribution`),

  /** V8.0: 运维统计（补全成功率/通过率/平均置信度/按日趋势） */
  getOperationsStats: (): Promise<OperationsStats> =>
    request.get(`${ENRICHMENT_BASE}/operations-stats`),

  /** V8.0: 回退单条补全记录（清除已补全字段，使食物可重新补全） */
  rollbackEnrichment: (id: string): Promise<{ rolledBack: boolean; detail: string }> =>
    request.post(`${ENRICHMENT_BASE}/rollback/${id}`),

  /** V8.0: 批量回退补全记录 */
  batchRollbackEnrichment: (
    ids: string[]
  ): Promise<{ success: number; failed: number; errors: string[] }> =>
    request.post(`${ENRICHMENT_BASE}/rollback/batch`, { ids }),

  /** V8.0: 单条食物立即补全（同步执行，不走队列） */
  enrichNow: (
    foodId: string,
    data?: { stages?: number[]; fields?: string[]; staged?: boolean }
  ): Promise<any> =>
    // AI 分阶段补全需要 60-120s，搭载全局 10s 超时限制
    // silentError: 由调用方自行处理超时提示，避免全局 toast 与组件 toast 重叠
    request.post(`${ENRICHMENT_BASE}/${foodId}/enrich-now`, data ?? {}, {
      timeout: 180_000,
      silentError: true,
    }),
};

// ==================== Enrichment Query Keys ====================

export const enrichmentQueryKeys = {
  all: ['enrichment'] as const,
  stats: ['enrichment', 'stats'] as const,
  jobs: (status?: string) => ['enrichment', 'jobs', status] as const,
  staged: (params?: object) => ['enrichment', 'staged', params] as const,
  history: (params?: object) => ['enrichment', 'history', params] as const,
  // V7.9
  progress: ['enrichment', 'progress'] as const,
  completeness: (foodId: string) => ['enrichment', 'completeness', foodId] as const,
  // V8.0
  preview: (logId: string) => ['enrichment', 'preview', logId] as const,
  batchPreview: (ids: string[]) => ['enrichment', 'batchPreview', ids] as const,
  completenessDistribution: ['enrichment', 'completenessDistribution'] as const,
  operationsStats: ['enrichment', 'operationsStats'] as const,
};

// ==================== Enrichment Hooks ====================

export const useEnrichmentStats = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.stats,
    queryFn: () => enrichmentApi.getStats(),
    refetchInterval: (query) => {
      const data = query.state.data as EnrichmentStatsResponse | undefined;
      const q = data?.queue;
      return q && (q.waiting > 0 || q.active > 0) ? 10000 : 30000;
    },
    refetchIntervalInBackground: false,
  });

export const useEnrichmentJobs = (
  status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
  limit = 20
) =>
  useQuery({
    queryKey: enrichmentQueryKeys.jobs(status),
    queryFn: () => enrichmentApi.getJobs({ status, limit }),
    refetchInterval: (query) => {
      const d = query.state.data as EnrichmentJob[] | undefined;
      return d?.some((j) => j.status === 'pending') ? 10000 : 15000;
    },
    refetchIntervalInBackground: false,
  });

export const useStagedEnrichments = (params?: {
  page?: number;
  pageSize?: number;
  foodId?: string;
  target?: EnrichmentTarget;
}) =>
  useQuery({
    queryKey: enrichmentQueryKeys.staged(params),
    queryFn: () => enrichmentApi.getStaged(params),
    staleTime: 30000,
  });

export const useEnrichmentHistory = (params?: {
  page?: number;
  pageSize?: number;
  foodId?: string;
  action?: string;
}) =>
  useQuery({
    queryKey: enrichmentQueryKeys.history(params),
    queryFn: () => enrichmentApi.getHistory(params),
    staleTime: 60000,
  });

export const useScanEnrichment = (options?: UseMutationOptions<MissingFieldStats, Error, void>) =>
  useMutation({
    mutationFn: () => enrichmentApi.scan(),
    ...options,
  });

export const useEnqueueEnrichment = (
  options?: UseMutationOptions<
    EnrichEnqueueResult,
    Error,
    {
      fields?: EnrichableField[];
      limit?: number;
      offset?: number;
      target?: EnrichmentTarget;
      locale?: string;
      region?: string;
      staged?: boolean;
    }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => enrichmentApi.enqueue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};

export const useApproveStaged = (
  options?: UseMutationOptions<
    { applied: boolean; detail: string },
    Error,
    { id: string; selectedFields?: string[] }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, selectedFields }) => enrichmentApi.approveStaged(id, selectedFields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.staged() });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.history() });
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
    },
    ...options,
  });
};

export const useRejectStaged = (
  options?: UseMutationOptions<void, Error, { id: string; reason: string }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => enrichmentApi.rejectStaged(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.staged() });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.history() });
    },
    ...options,
  });
};

export const useBatchApproveStaged = (
  options?: UseMutationOptions<
    { success: number; failed: number; errors: string[] },
    Error,
    string[]
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids) => enrichmentApi.batchApprove(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.staged() });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.history() });
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
    },
    ...options,
  });
};

export const useCleanEnrichmentJobs = (
  options?: UseMutationOptions<{ cleaned: number }, Error, { type?: 'completed' | 'failed' }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => enrichmentApi.clean(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};

// ==================== V7.9/V8.0 Enrichment Hooks ====================

/** 全库补全进度（按字段维度统计填充率） */
export const useEnrichmentProgress = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.progress,
    queryFn: () => enrichmentApi.getProgress(),
    staleTime: 60 * 1000,
  });

/** 单食物完整度评分（详情页用） */
export const useFoodCompleteness = (foodId: string, enabled = true) =>
  useQuery({
    queryKey: enrichmentQueryKeys.completeness(foodId),
    queryFn: () => enrichmentApi.getCompleteness(foodId),
    enabled: !!foodId && enabled,
    staleTime: 30 * 1000,
  });

/** 暂存预览 — 查看当前值 vs AI建议值 vs 同类均值 */
export const useEnrichmentPreview = (logId: string, enabled = true) =>
  useQuery({
    queryKey: enrichmentQueryKeys.preview(logId),
    queryFn: () => enrichmentApi.getPreview(logId),
    enabled: !!logId && enabled,
    staleTime: 60 * 1000,
  });

/** 分阶段批量入队 */
export const useEnqueueStagedBatch = (
  options?: UseMutationOptions<EnqueueStagedBatchResult, Error, EnqueueStagedBatchParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => enrichmentApi.enqueueStagedBatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};

/** 批量重试失败任务 */
export const useRetryFailedEnrichment = (
  options?: UseMutationOptions<RetryFailedResult, Error, { limit?: number } | undefined>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => enrichmentApi.retryFailed(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};

/** 批量预览暂存数据（批量审核前对比用） */
export const useBatchPreviewStaged = (
  options?: UseMutationOptions<BatchPreviewResult, Error, string[]>
) =>
  useMutation({
    mutationFn: (ids) => enrichmentApi.getBatchPreview(ids),
    ...options,
  });

/** V8.0: 全库完整度分布统计 */
export const useCompletenessDistribution = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.completenessDistribution,
    queryFn: () => enrichmentApi.getCompletenessDistribution(),
    staleTime: 60 * 1000,
  });

/** V8.0: 运维统计（补全成功率/通过率/按日趋势） */
export const useOperationsStats = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.operationsStats,
    queryFn: () => enrichmentApi.getOperationsStats(),
    staleTime: 60 * 1000,
  });

/** V8.0: 单条食物立即补全（同步执行） */
export const useEnrichNow = (
  options?: UseMutationOptions<
    any,
    Error,
    { foodId: string; stages?: number[]; fields?: string[]; staged?: boolean }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ foodId, ...rest }) => enrichmentApi.enrichNow(foodId, rest),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
    },
    ...options,
  });
};

/** V8.0: 回退单条补全记录 */
export const useRollbackEnrichment = (
  options?: UseMutationOptions<{ rolledBack: boolean; detail: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => enrichmentApi.rollbackEnrichment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
    },
    ...options,
  });
};

/** V8.0: 批量回退补全记录 */
export const useBatchRollbackEnrichment = (
  options?: UseMutationOptions<
    { success: number; failed: number; errors: string[] },
    Error,
    string[]
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids) => enrichmentApi.batchRollbackEnrichment(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
    },
    ...options,
  });
};
