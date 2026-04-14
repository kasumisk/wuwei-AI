'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recipeService } from '@/lib/api/recipe';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { SearchRecipesParams } from '@/types/food';

/** 搜索/浏览菜谱 */
export function useRecipeSearch(params: SearchRecipesParams) {
  const { isLoggedIn } = useAuth();
  return useQuery({
    queryKey: ['recipes', 'search', params],
    queryFn: () => recipeService.search(params),
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });
}

/** 获取菜谱详情 */
export function useRecipeDetail(id: string) {
  const { isLoggedIn } = useAuth();
  return useQuery({
    queryKey: ['recipes', 'detail', id],
    queryFn: () => recipeService.getDetail(id),
    enabled: isLoggedIn && !!id,
    staleTime: 10 * 60 * 1000,
  });
}

/** 获取我的评分 */
export function useMyRecipeRating(recipeId: string) {
  const { isLoggedIn } = useAuth();
  return useQuery({
    queryKey: ['recipes', 'my-rating', recipeId],
    queryFn: () => recipeService.getMyRating(recipeId),
    enabled: isLoggedIn && !!recipeId,
    staleTime: 5 * 60 * 1000,
  });
}

/** 获取评分汇总 */
export function useRecipeRatingSummary(recipeId: string) {
  const { isLoggedIn } = useAuth();
  return useQuery({
    queryKey: ['recipes', 'rating-summary', recipeId],
    queryFn: () => recipeService.getRatingSummary(recipeId),
    enabled: isLoggedIn && !!recipeId,
    staleTime: 5 * 60 * 1000,
  });
}

/** 提交/删除评分 mutations */
export function useRecipeRatingMutations(recipeId: string) {
  const queryClient = useQueryClient();

  const rateMutation = useMutation({
    mutationFn: (data: { rating: number; comment?: string }) => recipeService.rate(recipeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', 'my-rating', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes', 'rating-summary', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes', 'detail', recipeId] });
    },
  });

  const deleteRatingMutation = useMutation({
    mutationFn: () => recipeService.deleteRating(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', 'my-rating', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes', 'rating-summary', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes', 'detail', recipeId] });
    },
  });

  return { rateMutation, deleteRatingMutation };
}
