import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

/** 食谱食材 */
export interface RecipeIngredient {
  id?: string;
  foodId?: string;
  ingredientName: string;
  amount?: number;
  unit?: string;
  isOptional?: boolean;
  sortOrder?: number;
  food?: {
    id: string;
    name: string;
    caloriesPer100g?: number;
  };
}

/** 食谱列表项 */
export interface RecipeListItem {
  id: string;
  name: string;
  description?: string;
  cuisine?: string;
  difficulty?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  tags?: string[];
  imageUrl?: string;
  source?: string;
  isActive: boolean;
  reviewStatus?: string;
  qualityScore?: number;
  caloriesPerServing?: number;
  proteinPerServing?: number;
  fatPerServing?: number;
  carbsPerServing?: number;
  fiberPerServing?: number;
  createdAt: string;
  updatedAt: string;
}

/** 食谱详情（包含食材和翻译） */
export interface RecipeDetail extends RecipeListItem {
  instructions?: any;
  ingredients?: RecipeIngredient[];
  translations?: RecipeTranslation[];
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

/** 食谱翻译 */
export interface RecipeTranslation {
  id?: string;
  locale: string;
  name: string;
  description?: string;
  instructions?: any;
}

/** 创建食谱参数 */
export interface CreateRecipeParams {
  name: string;
  description?: string;
  cuisine?: string;
  difficulty?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  tags?: string[];
  instructions?: any;
  imageUrl?: string;
  source?: string;
  caloriesPerServing?: number;
  proteinPerServing?: number;
  fatPerServing?: number;
  carbsPerServing?: number;
  fiberPerServing?: number;
  ingredients?: Omit<RecipeIngredient, 'id' | 'food'>[];
}

/** 更新食谱参数 */
export interface UpdateRecipeParams {
  name?: string;
  description?: string;
  cuisine?: string;
  difficulty?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  tags?: string[];
  instructions?: any;
  imageUrl?: string;
  isActive?: boolean;
  caloriesPerServing?: number;
  proteinPerServing?: number;
  fatPerServing?: number;
  carbsPerServing?: number;
  fiberPerServing?: number;
  ingredients?: Omit<RecipeIngredient, 'id' | 'food'>[];
}

/** AI生成食谱参数 */
export interface GenerateRecipesParams {
  cuisine: string;
  goalType: string; // fat_loss / muscle_gain / health
  count: number; // 1-30
  maxDifficulty?: number; // 1-5
  maxCookTime?: number;
  constraints?: string[];
}

/** AI生成食谱结果 */
export interface GenerateRecipesResult {
  recipes?: RecipeListItem[];
  taskId?: string;
  message?: string;
}

/** 导入外部食谱参数 */
export interface ImportExternalRecipesParams {
  sourceType: 'takeout' | 'canteen';
  regionCode?: string;
  platform?: string;
  items: CreateRecipeParams[];
}

/** 导入外部食谱结果 */
export interface ImportExternalResult {
  imported: number;
  failed: number;
  errors?: string[];
}

/** 审核食谱参数 */
export interface ReviewRecipeParams {
  action: 'approved' | 'rejected';
  note?: string;
}

/** 重算质量评分参数 */
export interface RecalculateScoresParams {
  onlyZero?: boolean;
  batchSize?: number; // 10-500
}

/** 重算质量评分结果 */
export interface RecalculateScoresResult {
  processed: number;
  updated: number;
}

/** 食谱统计 */
export interface RecipeStatistics {
  total: number;
  active: number;
  inactive: number;
  byCuisine: Record<string, number>;
  bySource: Record<string, number>;
  byDifficulty: Record<string, number>;
  avgQualityScore: number;
  pendingReview: number;
}

/** 食谱查询参数 */
export interface GetRecipesQuery {
  page?: number;
  pageSize?: number;
  cuisine?: string;
  difficulty?: number;
  source?: string;
  isActive?: boolean;
  keyword?: string;
  reviewStatus?: string;
}

/** 分页响应 */
export interface RecipeListResponse {
  list: RecipeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 翻译更新参数 */
export interface UpsertTranslationParams {
  name: string;
  description?: string;
  instructions?: any;
}

// ==================== Query Keys ====================

const _all = ['recipeManagement'] as const;

export const recipeQueryKeys = {
  all: _all,
  list: (query?: GetRecipesQuery) => [..._all, 'list', query] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: [..._all, 'statistics'] as const,
  translations: (id: string) => [..._all, 'translations', id] as const,
};

// ==================== API ====================

const BASE = PATH.ADMIN.RECIPES;

export const recipeApi = {
  /** 获取食谱列表（分页+筛选） */
  getList: (query?: GetRecipesQuery): Promise<RecipeListResponse> => request.get(BASE, query),

  /** 获取食谱统计 */
  getStatistics: (): Promise<RecipeStatistics> => request.get(`${BASE}/statistics`),

  /** 获取食谱详情 */
  getDetail: (id: string): Promise<RecipeDetail> => request.get(`${BASE}/${id}`),

  /** 创建食谱 */
  create: (data: CreateRecipeParams): Promise<RecipeDetail> => request.post(BASE, data),

  /** 更新食谱 */
  update: (id: string, data: UpdateRecipeParams): Promise<RecipeDetail> =>
    request.put(`${BASE}/${id}`, data),

  /** 删除食谱（软删除） */
  delete: (id: string): Promise<void> => request.delete(`${BASE}/${id}`),

  /** AI批量生成食谱 */
  generate: (data: GenerateRecipesParams): Promise<GenerateRecipesResult> =>
    request.post(`${BASE}/generate`, data),

  /** 导入外卖/食堂菜品 */
  importExternal: (data: ImportExternalRecipesParams): Promise<ImportExternalResult> =>
    request.post(`${BASE}/import-external`, data),

  /** 审核UGC食谱 */
  review: (id: string, data: ReviewRecipeParams): Promise<RecipeDetail> =>
    request.put(`${BASE}/${id}/review`, data),

  /** 批量重算质量评分（super_admin） */
  recalculateScores: (data: RecalculateScoresParams): Promise<RecalculateScoresResult> =>
    request.post(`${BASE}/recalculate-scores`, data),

  /** 获取翻译列表 */
  getTranslations: (id: string): Promise<RecipeTranslation[]> =>
    request.get(`${BASE}/${id}/translations`),

  /** 创建/更新翻译 */
  upsertTranslation: (
    id: string,
    locale: string,
    data: UpsertTranslationParams
  ): Promise<RecipeTranslation> => request.put(`${BASE}/${id}/translations/${locale}`, data),

  /** 删除翻译 */
  deleteTranslation: (id: string, locale: string): Promise<void> =>
    request.delete(`${BASE}/${id}/translations/${locale}`),
};

// ==================== React Query Hooks ====================

/** 食谱列表 */
export const useRecipeList = (query?: GetRecipesQuery) =>
  useQuery({
    queryKey: recipeQueryKeys.list(query),
    queryFn: () => recipeApi.getList(query),
    staleTime: 30 * 1000,
  });

/** 食谱详情 */
export const useRecipeDetail = (id: string) =>
  useQuery({
    queryKey: recipeQueryKeys.detail(id),
    queryFn: () => recipeApi.getDetail(id),
    enabled: !!id,
  });

/** 食谱统计 */
export const useRecipeStatistics = () =>
  useQuery({
    queryKey: recipeQueryKeys.statistics,
    queryFn: () => recipeApi.getStatistics(),
    staleTime: 60 * 1000,
  });

/** 食谱翻译列表 */
export const useRecipeTranslations = (id: string) =>
  useQuery({
    queryKey: recipeQueryKeys.translations(id),
    queryFn: () => recipeApi.getTranslations(id),
    enabled: !!id,
  });

/** 创建食谱 */
export const useCreateRecipe = (
  options?: UseMutationOptions<RecipeDetail, Error, CreateRecipeParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => recipeApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 更新食谱 */
export const useUpdateRecipe = (
  options?: UseMutationOptions<RecipeDetail, Error, { id: string; data: UpdateRecipeParams }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => recipeApi.update(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 删除食谱 */
export const useDeleteRecipe = (options?: UseMutationOptions<void, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => recipeApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** AI批量生成食谱 */
export const useGenerateRecipes = (
  options?: UseMutationOptions<GenerateRecipesResult, Error, GenerateRecipesParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => recipeApi.generate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 导入外部食谱 */
export const useImportExternalRecipes = (
  options?: UseMutationOptions<ImportExternalResult, Error, ImportExternalRecipesParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => recipeApi.importExternal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 审核UGC食谱 */
export const useReviewRecipe = (
  options?: UseMutationOptions<RecipeDetail, Error, { id: string; data: ReviewRecipeParams }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => recipeApi.review(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 批量重算质量评分 */
export const useRecalculateScores = (
  options?: UseMutationOptions<RecalculateScoresResult, Error, RecalculateScoresParams>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => recipeApi.recalculateScores(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all });
    },
    ...options,
  });
};

/** 创建/更新翻译 */
export const useUpsertTranslation = (
  options?: UseMutationOptions<
    RecipeTranslation,
    Error,
    { id: string; locale: string; data: UpsertTranslationParams }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locale, data }) => recipeApi.upsertTranslation(id, locale, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.translations(id) });
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.detail(id) });
    },
    ...options,
  });
};

/** 删除翻译 */
export const useDeleteTranslation = (
  options?: UseMutationOptions<void, Error, { id: string; locale: string }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locale }) => recipeApi.deleteTranslation(id, locale),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.translations(id) });
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.detail(id) });
    },
    ...options,
  });
};
