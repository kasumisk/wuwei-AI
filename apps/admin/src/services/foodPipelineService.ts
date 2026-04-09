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
