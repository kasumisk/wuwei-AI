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
  | 'flavor_profile';

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
  }): Promise<EnrichEnqueueResult> => request.post(`${ENRICHMENT_BASE}/enqueue`, data),

  getStats: (): Promise<EnrichmentQueueStats> => request.get(`${ENRICHMENT_BASE}/stats`),

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

  approveStaged: (id: string): Promise<{ applied: boolean; detail: string }> =>
    request.post(`${ENRICHMENT_BASE}/staged/${id}/approve`, {}),

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
};

// ==================== Enrichment Query Keys ====================

export const enrichmentQueryKeys = {
  all: ['enrichment'] as const,
  stats: ['enrichment', 'stats'] as const,
  jobs: (status?: string) => ['enrichment', 'jobs', status] as const,
  staged: (params?: object) => ['enrichment', 'staged', params] as const,
  history: (params?: object) => ['enrichment', 'history', params] as const,
};

// ==================== Enrichment Hooks ====================

export const useEnrichmentStats = () =>
  useQuery({
    queryKey: enrichmentQueryKeys.stats,
    queryFn: () => enrichmentApi.getStats(),
    refetchInterval: (query) => {
      const data = query.state.data as EnrichmentQueueStats | undefined;
      return data && (data.waiting > 0 || data.active > 0) ? 10000 : 30000;
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
  options?: UseMutationOptions<{ applied: boolean; detail: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => enrichmentApi.approveStaged(id),
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
