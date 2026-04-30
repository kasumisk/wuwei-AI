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
  importMode: FoodImportMode;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  matchedUpdated: number;
  matchedSkipped: number;
  conflictCreated: number;
  detailGroups: {
    system: string[];
    matchedUpdated: string[];
    matchedSkipped: string[];
    conflicts: string[];
    errors: string[];
  };
  details: string[];
}

export interface ImportPreviewResult {
  importMode: FoodImportMode;
  total: number;
  cleaned: number;
  discarded: number;
  estimatedCreated: number;
  estimatedMatchedUpdated: number;
  estimatedMatchedSkipped: number;
  estimatedConflictCount: number;
  samples: {
    created: Array<{ name: string; sourceId: string }>;
    matchedUpdated: Array<{ name: string; existingName: string; fields: string[] }>;
    matchedSkipped: Array<{ name: string; existingName: string; reason: string }>;
    conflicts: Array<{ name: string; existingName: string; fields: string[] }>;
  };
  detailGroups: {
    system: string[];
    matchedUpdated: string[];
    matchedSkipped: string[];
    conflicts: string[];
  };
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

export interface UsdaImportPreset {
  key: string;
  label: string;
  description: string;
  queryCount: number;
  coverage: string[];
}

export interface UsdaCategoryOption {
  value: string;
  label: string;
  mappedCategory: string;
}

export interface UsdaImportJobAccepted {
  jobId: string;
  status: string;
}

export interface UsdaImportJobStatus {
  id: string;
  name: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'waiting-children' | 'unknown';
  data: Record<string, any>;
  result: ImportResult | null;
  failedReason: string | null;
  attemptsMade: number;
  processedOn: number | null;
  finishedOn: number | null;
  timestamp: number;
}

export type FoodImportMode = 'conservative' | 'fill_missing_only' | 'create_only';

export interface RulesApplyResult {
  processed: number;
}

export interface BackfillNutrientScoresResult {
  total: number;
  updated: number;
  errors: number;
}

export interface CandidatePromoteResult {
  total: number;
  promoted: number;
  skipped: number;
  duplicates: number;
  errors: number;
  details: string[];
}

export interface BatchEnrichByStageResult {
  processed: number;
  totalEnriched: number;
  totalFailed: number;
  details: Array<{
    foodId: string;
    foodName: string;
    enriched: number;
    failed: number;
  }>;
}

export interface ConsistencyCheckResult {
  foodId: string;
  foodName: string;
  category: string;
  peerCount: number;
  outliers: Array<{
    field: string;
    value: number;
    q1: number;
    q3: number;
    iqr: number;
    lowerBound: number;
    upperBound: number;
    severity: 'warning' | 'critical';
  }>;
}

export interface EnrichmentStatisticsResult {
  total: number;
  directApplied: number;
  staged: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  avgConfidence: number;
  dailyStats: Array<{
    date: string;
    count: number;
    action: string;
  }>;
  stageStats: Array<{
    stage: number;
    stageName: string;
    totalFields: number;
    avgSuccessRate: number;
  }>;
}

export interface QualityReport {
  timestamp: Date;
  /** 食物总数（顶层，无 summary 包装） */
  totalFoods: number;
  byStatus: Record<string, number>;
  byCategory: Array<{ category: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  completeness: {
    total: number;
    withProtein: number;
    withMicronutrients: number;
    withGI: number;
    withAllergens: number;
    withCompatibility: number;
    withTags: number;
    withImage: number;
  };
  quality: {
    verified: number;
    unverified: number;
    avgConfidence: number;
    lowConfidence: number;
    macroInconsistent: number;
  };
  conflicts: {
    total: number;
    pending: number;
    resolved: number;
    needsReview: number;
  };
  translations: {
    total: number;
    locales: Array<{ locale: string; count: number }>;
    foodsWithTranslation: number;
    foodsWithoutTranslation: number;
  };
  recentChanges: number;
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
  usdaImportJob: (jobId: string) => [..._all, 'usdaImportJob', jobId] as const,
  usdaPresets: [..._all, 'usdaPresets'] as const,
  usdaCategories: [..._all, 'usdaCategories'] as const,
  offSearch: (query: string) => [..._all, 'offSearch', query] as const,
};

// ==================== API ====================

export const foodPipelineApi = {
  // USDA
  importUsda: (data: {
    query: string;
    maxItems?: number;
    importMode?: FoodImportMode;
  }): Promise<UsdaImportJobAccepted> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/import/usda`, data, {
      timeout: 180_000,
      silentError: true,
    }),

  previewUsda: (data: {
    query: string;
    maxItems?: number;
    importMode?: FoodImportMode;
  }): Promise<ImportPreviewResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/preview/usda`, data, {
      timeout: 120_000,
      silentError: true,
    }),

  getUsdaPresets: (): Promise<UsdaImportPreset[]> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/usda/presets`),

  getUsdaCategories: (): Promise<UsdaCategoryOption[]> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/usda/categories`),

  importUsdaPreset: (data: {
    presetKey: string;
    maxItemsPerQuery?: number;
    importMode?: FoodImportMode;
  }): Promise<UsdaImportJobAccepted> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/import/usda-preset`, data, {
      timeout: 240_000,
      silentError: true,
    }),

  previewUsdaPreset: (data: {
    presetKey: string;
    maxItemsPerQuery?: number;
    importMode?: FoodImportMode;
  }): Promise<ImportPreviewResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/preview/usda-preset`, data, {
      timeout: 180_000,
      silentError: true,
    }),

  importUsdaCategory: (data: {
    foodCategory: string;
    pageSize?: number;
    maxPages?: number;
    importMode?: FoodImportMode;
  }): Promise<UsdaImportJobAccepted> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/import/usda-category`, data, {
      timeout: 240_000,
      silentError: true,
    }),

  previewUsdaCategory: (data: {
    foodCategory: string;
    pageSize?: number;
    maxPages?: number;
    importMode?: FoodImportMode;
  }): Promise<ImportPreviewResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/preview/usda-category`, data, {
      timeout: 180_000,
      silentError: true,
    }),

  searchUsda: (query: string, pageSize = 20): Promise<UsdaSearchResult> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/usda/search`, { query, pageSize }, { timeout: 30_000 }),

  getUsdaImportJob: (jobId: string): Promise<UsdaImportJobStatus> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/usda/jobs/${encodeURIComponent(jobId)}`),

  // OpenFoodFacts
  lookupBarcode: (barcode: string): Promise<any> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/barcode/${barcode}`),

  searchOff: (query: string, pageSize = 20): Promise<any> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/openfoodfacts/search`, { query, pageSize }),

  // 规则引擎
  batchApplyRules: (data: { limit?: number; recalcAll?: boolean }): Promise<RulesApplyResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/rules/apply`, data),

  backfillNutrientScores: (data: { batchSize?: number }): Promise<BackfillNutrientScoresResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/rules/backfill-nutrient-scores`, data),

  promoteCandidates: (data: {
    minConfidence?: number;
    limit?: number;
  }): Promise<CandidatePromoteResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/candidates/promote`, data),

  batchEnrichByStage: (data: {
    stages?: number[];
    limit?: number;
    category?: string;
  }): Promise<BatchEnrichByStageResult> =>
    request.post(`${PATH.ADMIN.FOOD_PIPELINE}/enrichment/batch-stage`, data),

  checkConsistency: (foodId: string): Promise<ConsistencyCheckResult> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/quality/consistency/${foodId}`),

  getEnrichmentStatistics: (): Promise<EnrichmentStatisticsResult> =>
    request.get(`${PATH.ADMIN.FOOD_PIPELINE}/enrichment/statistics`),

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
  options?: UseMutationOptions<
    UsdaImportJobAccepted,
    Error,
    { query: string; maxItems?: number; importMode?: FoodImportMode }
  >
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

export const useUsdaPresets = () =>
  useQuery({
    queryKey: foodPipelineQueryKeys.usdaPresets,
    queryFn: () => foodPipelineApi.getUsdaPresets(),
    staleTime: 10 * 60 * 1000,
  });

export const useUsdaCategories = () =>
  useQuery({
    queryKey: foodPipelineQueryKeys.usdaCategories,
    queryFn: () => foodPipelineApi.getUsdaCategories(),
    staleTime: 10 * 60 * 1000,
  });

export const useUsdaImportJob = (jobId?: string) =>
  useQuery({
    queryKey: foodPipelineQueryKeys.usdaImportJob(jobId || ''),
    queryFn: () => foodPipelineApi.getUsdaImportJob(jobId!),
    enabled: Boolean(jobId),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as UsdaImportJobStatus | undefined;
      return data && (data.status === 'completed' || data.status === 'failed')
        ? false
        : 3000;
    },
    refetchIntervalInBackground: true,
  });

export const useImportUsdaPreset = (
  options?: UseMutationOptions<
    UsdaImportJobAccepted,
    Error,
    { presetKey: string; maxItemsPerQuery?: number; importMode?: FoodImportMode }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.importUsdaPreset(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useImportUsdaCategory = (
  options?: UseMutationOptions<
    UsdaImportJobAccepted,
    Error,
    { foodCategory: string; pageSize?: number; maxPages?: number; importMode?: FoodImportMode }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.importUsdaCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useBatchApplyRules = (
  options?: UseMutationOptions<RulesApplyResult, Error, { limit?: number; recalcAll?: boolean }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.batchApplyRules(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useBackfillNutrientScores = (
  options?: UseMutationOptions<BackfillNutrientScoresResult, Error, { batchSize?: number }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.backfillNutrientScores(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useResolveAllConflicts = (options?: UseMutationOptions<any, Error, void>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => foodPipelineApi.resolveAllConflicts(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const usePromoteCandidates = (
  options?: UseMutationOptions<CandidatePromoteResult, Error, { minConfidence?: number; limit?: number }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.promoteCandidates(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useBatchEnrichByStage = (
  options?: UseMutationOptions<
    BatchEnrichByStageResult,
    Error,
    { stages?: number[]; limit?: number; category?: string }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodPipelineApi.batchEnrichByStage(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      queryClient.invalidateQueries({ queryKey: foodPipelineQueryKeys.qualityReport });
    },
    ...options,
  });
};

export const useCheckConsistency = (
  options?: UseMutationOptions<ConsistencyCheckResult, Error, string>
) =>
  useMutation({
    mutationFn: (foodId) => foodPipelineApi.checkConsistency(foodId),
    ...options,
  });

export const useEnrichmentStatistics = (
  options?: UseMutationOptions<EnrichmentStatisticsResult, Error, void>
) =>
  useMutation({
    mutationFn: () => foodPipelineApi.getEnrichmentStatistics(),
    ...options,
  });

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
  | 'cooking_methods'
  | 'popularity'
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
  | 'is_processed'
  | 'is_fried'
  | 'aliases'
  | 'standard_serving_g'
  | 'ingredient_list'
  | 'texture_tags'
  | 'dish_type'
  | 'prep_time_minutes'
  | 'cook_time_minutes'
  | 'skill_required'
  | 'estimated_cost_level'
  | 'serving_temperature'
  | 'compatibility'
  | 'available_channels'
  | 'required_equipment'
  | 'availableChannels'
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
  locales?: string[] | null;
  region: string | null;
  status: 'pending' | 'completed' | 'failed';
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}

/** V8.4: getJobs 接口改为分页结构 */
export interface EnrichmentJobsResponse {
  list: EnrichmentJob[];
  total: number;
  page: number;
  pageSize: number;
  offset: number;
  hasMore: boolean;
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
  /** V8.1: 当前值为 null → 新增字段 */
  isNew: boolean;
  /** V8.1: 当前值与建议值不同（对于非 null 当前值） */
  isModified: boolean;
  /** V8.1: AI 置信度级别 */
  confidenceLevel: 'high' | 'medium' | 'low';
  /** V8.1: AI 原始置信度分数 (0-1) */
  fieldConfidence: number;
}

/** 单条补全预览数据 */
export interface EnrichmentPreview {
  food: {
    id: string;
    name: string;
    nameZh: string | null;
    category: string | null;
    subCategory: string | null;
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

/** V8.4: 审核细粒度报表 */
export interface ReviewStats {
  /** 当前待审核（staged）数量 */
  pendingReview: number;
  /** 历史已通过数 */
  approved: number;
  /** 历史已拒绝数 */
  rejected: number;
  /** 已审核总数 */
  reviewed: number;
  /** 通过率 % */
  approvalRate: number;
  /** 拒绝率 % */
  rejectionRate: number;
  /** 所有已审核记录的整体平均置信度 */
  avgConfidenceAll: number;
  /** 已通过记录的平均置信度 */
  avgConfidenceApproved: number;
  /** 已拒绝记录的平均置信度 */
  avgConfidenceRejected: number;
  /** 置信度区间分布（5个桶） */
  confidenceBuckets: Array<{
    bucket: string;
    approved: number;
    rejected: number;
  }>;
  /** 最近 30 天按日趋势 */
  dailyTrend: Array<{
    date: string;
    approved: number;
    rejected: number;
  }>;
  /** 积压概要：最近入队但仍待审核的 staged 记录（最多 20 条） */
  pendingList: Array<{
    logId: string;
    foodId: string;
    foodName: string;
    enrichedFields: string[];
    confidence: number | null;
    createdAt: string;
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
    locales?: string[];
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
  }): Promise<EnrichmentJobsResponse> => request.get(`${ENRICHMENT_BASE}/jobs`, params),

  clean: (data?: {
    grace?: number;
    type?: 'completed' | 'failed' | 'all';
    limit?: number;
  }): Promise<{ cleaned: number; type: string }> =>
    request.post(`${ENRICHMENT_BASE}/clean`, data ?? {}),

  drain: (): Promise<void> => request.post(`${ENRICHMENT_BASE}/drain`, {}),

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

  /** V8.2: 批量审核拒绝 */
  batchReject: (
    ids: string[],
    reason: string
  ): Promise<{ success: number; failed: number; errors: string[] }> =>
    request.post(`${ENRICHMENT_BASE}/staged/batch-reject`, { ids, reason }),

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

  /** V8.4: 审核细粒度报表（通过率/拒绝率/置信度分布/按日趋势/积压列表） */
  getReviewStats: (): Promise<ReviewStats> => request.get(`${ENRICHMENT_BASE}/review-stats`),

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

  /** V8.9: 强制按指定字段重新入队（忽略字段是否已有值，支持全库或按条件筛选） */
  reEnqueue: (data: ReEnqueueParams): Promise<ReEnqueueResult> =>
    request.post(`${ENRICHMENT_BASE}/re-enqueue`, data),
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
  reviewStats: ['enrichment', 'reviewStats'] as const,
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
      // V8.4: getJobs 返回分页结构 { list, total, ... }，不再是数组
      const d = query.state.data as EnrichmentJobsResponse | undefined;
      return d?.list?.some((j) => j.status === 'pending') ? 10000 : 15000;
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
      locales?: string[];
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
      // FIX: 审核通过后刷新进度面板和完整度分布数据
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.completenessDistribution });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
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
      // FIX: 审核拒绝后刷新进度面板数据
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
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
      // FIX: 批量审核通过后刷新进度面板和完整度分布数据
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.completenessDistribution });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
    },
    ...options,
  });
};

/** V8.2/V8.7: 批量审核拒绝（FIX-5 新增 hook） */
export const useBatchRejectStaged = (
  options?: UseMutationOptions<
    { success: number; failed: number; errors: string[] },
    Error,
    { ids: string[]; reason: string }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }) => enrichmentApi.batchReject(ids, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.staged() });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.history() });
      queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
      // 批量拒绝后刷新进度面板（状态从 staged → rejected，影响计数）
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
    },
    ...options,
  });
};

export const useCleanEnrichmentJobs = (
  options?: UseMutationOptions<
    { cleaned: number },
    Error,
    { type?: 'completed' | 'failed' | 'all' }
  >
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

/** 清空 waiting 队列（drain） */
export const useDrainEnrichmentQueue = (options?: UseMutationOptions<void, Error, void>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => enrichmentApi.drain(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};

// ==================== V7.9/V8.0 Enrichment Hooks ====================

/** 全库补全进度（按字段维度统计填充率） */
export const useEnrichmentProgress = () => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: enrichmentQueryKeys.progress,
    queryFn: () => enrichmentApi.getProgress(),
    staleTime: 15 * 1000, // FIX: 降低缓存时间，确保进度面板数据更及时
    // FIX: 当补全队列有活跃任务时，自动轮询进度面板
    refetchInterval: () => {
      const statsData = queryClient.getQueryData<EnrichmentStatsResponse>(
        enrichmentQueryKeys.stats
      );
      const q = statsData?.queue;
      return q && (q.waiting > 0 || q.active > 0) ? 15000 : false;
    },
    refetchIntervalInBackground: false,
  });
};

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
      // OPT-3 FIX: 入队后同步刷新进度面板，确保"待补全"计数即时更新
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.completenessDistribution });
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
      // FIX: 补全完成后刷新进度面板和完整度分布数据
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.progress });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.completenessDistribution });
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

/** V8.4: 审核细粒度报表（通过率/拒绝率/置信度分布/按日趋势/积压列表） */
export const useReviewStats = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.reviewStats,
    queryFn: () => enrichmentApi.getReviewStats(),
    staleTime: 60 * 1000,
  });

// ==================== V8.9: 强制重新补全类型 & Hook ====================

export interface ReEnqueueParams {
  /** 要重新补全的字段列表（必填） */
  fields: EnrichableField[];
  /** 最多入队食物数（0 或不传 = 全部） */
  limit?: number;
  /** 按食物分类筛选 */
  category?: string;
  /** 按数据来源筛选 */
  primarySource?: string;
  /** 入队前先清空指定字段（默认 false，设为 true 则强制让 AI 重新生成） */
  clearFields?: boolean;
  /** 是否 staging 模式（默认 false） */
  staged?: boolean;
}

export interface ReEnqueueResult {
  enqueued: number;
  fields: string[];
  cleared: number;
  staged: boolean;
  foodNames: string[];
}

/** V8.9: 强制按指定字段重新入队 */
export const useReEnqueueEnrichment = (
  options?: UseMutationOptions<ReEnqueueResult, Error, ReEnqueueParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => enrichmentApi.reEnqueue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.stats });
      queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.jobs() });
    },
    ...options,
  });
};
