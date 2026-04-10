'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { foodPlanService } from '@/lib/api/food-plan';
import { recommendationService } from '@/lib/api/recommendation';
import { useAuth } from '@/features/auth/hooks/use-auth';

/** 推荐页数据 hook */
export function usePlanData() {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  // 今日计划
  const {
    data: dailyPlan,
    isLoading: dailyLoading,
    error: dailyError,
  } = useQuery({
    queryKey: ['daily-plan'],
    queryFn: () => recommendationService.getDailyPlan(),
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });

  // 周计划
  const {
    data: weeklyPlan,
    isLoading: weeklyLoading,
    error: weeklyError,
  } = useQuery({
    queryKey: ['weeklyPlan'],
    queryFn: () => foodPlanService.getWeeklyPlan(),
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
  });

  // 下一餐推荐
  const { data: suggestion, isLoading: suggestionLoading } = useQuery({
    queryKey: ['meal-suggestion'],
    queryFn: () => recommendationService.getMealSuggestion(),
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });

  // 重新生成今日计划
  const regenerateMutation = useMutation({
    mutationFn: (mealType?: string) => foodPlanService.regenerateDailyPlan(mealType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyPlan'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
    },
  });

  // 调整计划
  const adjustMutation = useMutation({
    mutationFn: (reason: string) => recommendationService.adjustDailyPlan(reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
    },
  });

  // "为什么不推荐"
  const explainMutation = useMutation({
    mutationFn: ({ foodName, mealType }: { foodName: string; mealType: string }) =>
      foodPlanService.explainWhyNot(foodName, mealType),
  });

  // 推荐反馈
  const feedbackMutation = useMutation({
    mutationFn: foodPlanService.submitFeedback,
  });

  return {
    // data
    dailyPlan: dailyPlan ?? null,
    weeklyPlan: weeklyPlan ?? null,
    suggestion: suggestion ?? null,
    // loading
    isLoading: dailyLoading || weeklyLoading || suggestionLoading,
    dailyLoading,
    weeklyLoading,
    // errors
    dailyError,
    weeklyError,
    // mutations
    regeneratePlan: regenerateMutation.mutateAsync,
    isRegenerating: regenerateMutation.isPending,
    adjustPlan: adjustMutation.mutateAsync,
    isAdjusting: adjustMutation.isPending,
    explainWhyNot: explainMutation.mutateAsync,
    isExplaining: explainMutation.isPending,
    explainResult: explainMutation.data ?? null,
    submitFeedback: feedbackMutation.mutateAsync,
  };
}
