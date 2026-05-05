import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface FoodLibraryDto {
  id: string;
  code: string;
  name: string;
  aliases?: string;
  barcode?: string;
  status: string;
  category: string;
  subCategory?: string;
  foodGroup?: string;
  // 宏量营养素
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  addedSugar?: number;
  naturalSugar?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;
  // 微量营养素
  sodium?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  vitaminE?: number;
  vitaminB12?: number;
  folate?: number;
  zinc?: number;
  magnesium?: number;
  phosphorus?: number;
  purine?: number;
  // V7.9 新增微量营养素
  vitaminB6?: number;
  omega3?: number;
  omega6?: number;
  solubleFiber?: number;
  insolubleFiber?: number;
  waterContentPercent?: number;
  // 健康评估
  glycemicIndex?: number;
  glycemicLoad?: number;
  fodmapLevel?: string;
  oxalateLevel?: string;
  isProcessed: boolean;
  isFried: boolean;
  processingLevel: number;
  allergens: string[];
  // 决策引擎
  qualityScore?: number;
  satietyScore?: number;
  nutrientDensity?: number;
  commonalityScore?: number;
  mealTypes: string[];
  tags: string[];
  mainIngredient?: string;
  compatibility: Record<string, string[]>;
  acquisitionDifficulty?: number;
  // 烹饪 & 风味
  cuisine?: string;
  cookingMethods?: string[];
  flavorProfile?: Record<string, any>;
  textureTags?: string[];
  dishType?: string;
  servingTemperature?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  skillRequired?: string;
  estimatedCostLevel?: number;
  shelfLifeDays?: number;
  requiredEquipment?: string[];
  // 原料 & 渠道
  ingredientList?: string[];
  availableChannels?: string[];
  dishPriority?: number;
  // 形态
  foodForm?: string;
  // 份量
  standardServingG: number;
  standardServingDesc?: string;
  commonPortions: Array<{ name: string; grams: number }>;
  // 媒体
  imageUrl?: string;
  thumbnailUrl?: string;
  // 数据溯源
  primarySource: string;
  primarySourceId?: string;
  dataVersion: number;
  confidence: number;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  // 搜索优化
  searchWeight: number;
  popularity: number;
  // 时间戳
  createdAt: string;
  updatedAt: string;
  // V8.0 补全元数据
  dataCompleteness?: number;
  enrichmentStatus?: string;
  lastEnrichedAt?: string;
  fieldSources?: Record<string, string>;
  fieldConfidence?: Record<string, number>;
  // V8.1 enrichmentMeta (内嵌，仅 findOne 时返回)
  enrichmentMeta?: {
    completeness: {
      score: number;
      groups: { core: number; micro: number; health: number; usage: number; extended: number };
    };
    fieldDetails: Array<{
      field: string;
      label: string;
      unit: string;
      filled: boolean;
      value: any;
      source: string | null;
      confidence: number | null;
      failed: any;
    }>;
    missingFields: string[];
    failedFieldCount: number;
    sourceDistribution: Record<string, number>;
    enrichmentHistory: {
      lastEnrichedAt: string | null;
      enrichmentStatus: string | null;
      reviewStatus: string | null;
      reviewedBy: string | null;
      reviewedAt: string | null;
      dataVersion: number;
    };
  };
  // 关联
  translations?: FoodTranslationDto[];
  sources?: FoodSourceDto[];
  conflicts?: FoodConflictDto[];
  regionalInfo?: FoodRegionalInfoDto[];
}

export interface FoodTranslationDto {
  id: string;
  foodId: string;
  locale: string;
  name: string;
  aliases?: string;
  description?: string;
  servingDesc?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FoodRegionalInfoDto {
  id: string;
  foodId: string;
  countryCode: string;
  regionCode?: string | null;
  cityCode?: string | null;
  localPopularity: number;
  priceMin?: number | string | null;
  priceMax?: number | string | null;
  currencyCode?: string | null;
  priceUnit?: string | null;
  availability: string;
  monthWeights?: number[] | null;
  seasonalityConfidence?: number | null;
  regulatoryInfo?: Record<string, any> | null;
  source?: string | null;
  sourceUrl?: string | null;
  sourceUpdatedAt?: string | null;
  confidence?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FoodSourceDto {
  id: string;
  foodId: string;
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  rawData: Record<string, any>;
  mappedData?: Record<string, any>;
  confidence: number;
  isPrimary: boolean;
  priority: number;
  fetchedAt: string;
  createdAt: string;
}

export interface FoodConflictDto {
  id: string;
  foodId: string;
  field: string;
  sources: Array<{ source: string; value: any }>;
  resolution?: string;
  resolvedValue?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  food?: Partial<FoodLibraryDto>;
}

export interface FoodChangeLogDto {
  id: string;
  foodId: string;
  version: number;
  action: string;
  changes: Record<string, any>;
  reason?: string;
  operator?: string;
  createdAt: string;
}

export interface GetFoodLibraryQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  /** ProTable 列搜索直接传 name，后端单独模糊匹配 */
  name?: string;
  /** 编码独立模糊搜索 */
  code?: string;
  category?: string;
  status?: string;
  isVerified?: boolean;
  /** 是否有图片地址（基于 imageUrl） */
  hasImageUrl?: boolean;
  primarySource?: string;
  /** V8.0: 最小数据完整度（0-100） */
  minCompleteness?: number;
  /** V8.0: 最大数据完整度（0-100） */
  maxCompleteness?: number;
  /** V8.0: 补全状态筛选 */
  enrichmentStatus?: string;
}

export interface FoodLibraryListResponse {
  list: FoodLibraryDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateFoodLibraryDto {
  code: string;
  name: string;
  category: string;
  calories: number;
  [key: string]: any;
}

export interface FoodLibraryStatistics {
  total: number;
  verified: number;
  unverified: number;
  byCategory: Array<{ category: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  pendingConflicts: number;
  /** V8.5: 全库平均完整度（仅含已补全食物，0-100） */
  avgCompleteness: number;
  /** V8.4: 补全状态分布 */
  enrichmentStatus: {
    pending: number;
    completed: number;
    partial: number;
    failed: number;
    staged: number;
    rejected: number;
  };
  /** V8.4: 完整度分布（low <30 / mid 30-79 / high >=80） */
  completenessDistribution: {
    low: number;
    mid: number;
    high: number;
  };
  /** V8.4: 审核状态分布 */
  reviewStatusCounts: {
    pending: number;
    approved: number;
    rejected: number;
  };
}

// ==================== Query Keys ====================

const _all = ['foodLibrary'] as const;

export const foodLibraryQueryKeys = {
  all: _all,
  list: (params?: GetFoodLibraryQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: [..._all, 'statistics'] as const,
  categories: [..._all, 'categories'] as const,
  translations: (foodId: string) => [..._all, 'translations', foodId] as const,
  regionalInfo: (foodId: string) => [..._all, 'regionalInfo', foodId] as const,
  sources: (foodId: string) => [..._all, 'sources', foodId] as const,
  changeLogs: (foodId: string) => [..._all, 'changeLogs', foodId] as const,
  conflicts: (params?: any) => [..._all, 'conflicts', params] as const,
};

// ==================== API ====================

export const foodLibraryApi = {
  // 食物 CRUD
  getList: (params?: GetFoodLibraryQuery): Promise<FoodLibraryListResponse> =>
    request.get(PATH.ADMIN.FOOD_LIBRARY, params),

  getDetail: (id: string): Promise<FoodLibraryDto> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`),

  getStatistics: (): Promise<FoodLibraryStatistics> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/statistics`),

  getCategories: (): Promise<string[]> => request.get(`${PATH.ADMIN.FOOD_LIBRARY}/categories`),

  create: (data: CreateFoodLibraryDto): Promise<FoodLibraryDto> =>
    request.post(PATH.ADMIN.FOOD_LIBRARY, data),

  update: (id: string, data: Partial<CreateFoodLibraryDto>): Promise<FoodLibraryDto> =>
    request.put(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`, data),

  remove: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`),

  toggleVerified: (id: string): Promise<FoodLibraryDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/${id}/toggle-verified`, {}),

  updateStatus: (id: string, status: string): Promise<FoodLibraryDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/${id}/status`, { status }),

  batchImport: (
    foods: CreateFoodLibraryDto[]
  ): Promise<{ imported: number; skipped: number; errors: string[] }> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/batch-import`, { foods }),

  // 翻译
  getTranslations: (foodId: string): Promise<FoodTranslationDto[]> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/translations`),

  getRegionalInfo: (foodId: string): Promise<FoodRegionalInfoDto[]> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/regional-info`),

  createTranslation: (
    foodId: string,
    data: Partial<FoodTranslationDto>
  ): Promise<FoodTranslationDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/translations`, data),

  updateTranslation: (
    translationId: string,
    data: Partial<FoodTranslationDto>
  ): Promise<FoodTranslationDto> =>
    request.put(`${PATH.ADMIN.FOOD_LIBRARY}/translations/${translationId}`, data),

  deleteTranslation: (translationId: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.FOOD_LIBRARY}/translations/${translationId}`),

  // 数据来源
  getSources: (foodId: string): Promise<FoodSourceDto[]> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/sources`),

  createSource: (foodId: string, data: Partial<FoodSourceDto>): Promise<FoodSourceDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/sources`, data),

  deleteSource: (sourceId: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.FOOD_LIBRARY}/sources/${sourceId}`),

  // 变更日志
  getChangeLogs: (
    foodId: string,
    params?: { page?: number; pageSize?: number }
  ): Promise<{ list: FoodChangeLogDto[]; total: number; page: number; pageSize: number }> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${foodId}/change-logs`, params),

  // 冲突
  getConflicts: (params?: {
    foodId?: string;
    resolution?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ list: FoodConflictDto[]; total: number }> =>
    request.get(PATH.ADMIN.FOOD_LIBRARY_CONFLICTS, params),

  resolveConflict: (
    conflictId: string,
    data: { resolution: string; resolvedValue: string }
  ): Promise<FoodConflictDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/conflicts/${conflictId}/resolve`, data),
};

// ==================== React Query Hooks ====================

export const useFoodLibraryStatistics = (
  options?: Omit<UseQueryOptions<FoodLibraryStatistics>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: foodLibraryQueryKeys.statistics,
    queryFn: () => foodLibraryApi.getStatistics(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useFoodLibraryCategories = () =>
  useQuery({
    queryKey: foodLibraryQueryKeys.categories,
    queryFn: () => foodLibraryApi.getCategories(),
    staleTime: 10 * 60 * 1000,
  });

export const useFoodDetail = (id: string, enabled = true) =>
  useQuery({
    queryKey: foodLibraryQueryKeys.detail(id),
    queryFn: () => foodLibraryApi.getDetail(id),
    enabled,
  });

export const useFoodTranslations = (foodId: string, enabled = true) =>
  useQuery({
    queryKey: foodLibraryQueryKeys.translations(foodId),
    queryFn: () => foodLibraryApi.getTranslations(foodId),
    enabled,
  });

export const useFoodRegionalInfo = (foodId: string, enabled = true) =>
  useQuery({
    queryKey: foodLibraryQueryKeys.regionalInfo(foodId),
    queryFn: () => foodLibraryApi.getRegionalInfo(foodId),
    enabled,
  });

export const useFoodSources = (foodId: string, enabled = true) =>
  useQuery({
    queryKey: foodLibraryQueryKeys.sources(foodId),
    queryFn: () => foodLibraryApi.getSources(foodId),
    enabled,
  });

export const useFoodChangeLogs = (
  foodId: string,
  params?: { page?: number; pageSize?: number },
  enabled = true
) =>
  useQuery({
    queryKey: [...foodLibraryQueryKeys.changeLogs(foodId), params],
    queryFn: () => foodLibraryApi.getChangeLogs(foodId, params),
    enabled,
  });

export const useCreateFood = (
  options?: UseMutationOptions<FoodLibraryDto, Error, CreateFoodLibraryDto>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodLibraryApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useUpdateFood = (
  options?: UseMutationOptions<
    FoodLibraryDto,
    Error,
    { id: string; data: Partial<CreateFoodLibraryDto> }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => foodLibraryApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useDeleteFood = (options?: UseMutationOptions<{ message: string }, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => foodLibraryApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useToggleFoodVerified = (
  options?: UseMutationOptions<FoodLibraryDto, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => foodLibraryApi.toggleVerified(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};
