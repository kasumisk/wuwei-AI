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
  name: string;
  aliases?: string;
  category: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  sodiumPer100g?: number;
  glycemicIndex?: number;
  isProcessed: boolean;
  isFried: boolean;
  mealTypes: string[];
  mainIngredient?: string;
  subCategory?: string;
  qualityScore?: number;
  satietyScore?: number;
  standardServingG: number;
  standardServingDesc?: string;
  searchWeight: number;
  isVerified: boolean;
  tags: string[];
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface GetFoodLibraryQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  isVerified?: boolean;
  source?: string;
}

export interface FoodLibraryListResponse {
  list: FoodLibraryDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateFoodLibraryDto {
  name: string;
  category: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  sodiumPer100g?: number;
  glycemicIndex?: number;
  isProcessed?: boolean;
  isFried?: boolean;
  mealTypes?: string[];
  mainIngredient?: string;
  subCategory?: string;
  qualityScore?: number;
  satietyScore?: number;
  standardServingG?: number;
  standardServingDesc?: string;
  searchWeight?: number;
  isVerified?: boolean;
  tags?: string[];
  source?: string;
  confidence?: number;
  aliases?: string;
}

export interface FoodLibraryStatistics {
  total: number;
  verified: number;
  unverified: number;
  byCategory: Array<{ category: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
}

// ==================== Query Keys ====================

const _all = ['foodLibrary'] as const;

export const foodLibraryQueryKeys = {
  all: _all,
  list: (params?: GetFoodLibraryQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  statistics: [..._all, 'statistics'] as const,
  categories: [..._all, 'categories'] as const,
};

// ==================== API ====================

export const foodLibraryApi = {
  getList: (params?: GetFoodLibraryQuery): Promise<FoodLibraryListResponse> =>
    request.get(PATH.ADMIN.FOOD_LIBRARY, params),

  getDetail: (id: string): Promise<FoodLibraryDto> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`),

  getStatistics: (): Promise<FoodLibraryStatistics> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/statistics`),

  getCategories: (): Promise<string[]> =>
    request.get(`${PATH.ADMIN.FOOD_LIBRARY}/categories`),

  create: (data: CreateFoodLibraryDto): Promise<FoodLibraryDto> =>
    request.post(PATH.ADMIN.FOOD_LIBRARY, data),

  update: (id: string, data: Partial<CreateFoodLibraryDto>): Promise<FoodLibraryDto> =>
    request.put(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`, data),

  remove: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.FOOD_LIBRARY}/${id}`),

  toggleVerified: (id: string): Promise<FoodLibraryDto> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/${id}/toggle-verified`, {}),

  batchImport: (foods: CreateFoodLibraryDto[]): Promise<{ imported: number; skipped: number; errors: string[] }> =>
    request.post(`${PATH.ADMIN.FOOD_LIBRARY}/batch-import`, { foods }),
};

// ==================== React Query Hooks ====================

export const useFoodLibraryStatistics = (
  options?: Omit<UseQueryOptions<FoodLibraryStatistics>, 'queryKey' | 'queryFn'>,
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

export const useCreateFood = (
  options?: UseMutationOptions<FoodLibraryDto, Error, CreateFoodLibraryDto>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => foodLibraryApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useUpdateFood = (
  options?: UseMutationOptions<FoodLibraryDto, Error, { id: string; data: Partial<CreateFoodLibraryDto> }>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => foodLibraryApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useDeleteFood = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => foodLibraryApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};

export const useToggleFoodVerified = (
  options?: UseMutationOptions<FoodLibraryDto, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => foodLibraryApi.toggleVerified(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodLibraryQueryKeys.all }),
    ...options,
  });
};
