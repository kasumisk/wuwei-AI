'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendationService } from '@/lib/api/recommendation';

/**
 * 计划调整 hook
 * 调用 adjustDailyPlan API，成功后刷新推荐和计划数据
 */
export function usePlanAdjust() {
  const queryClient = useQueryClient();

  const adjustMutation = useMutation({
    mutationFn: ({
      reason,
      mealType,
    }: {
      reason: string;
      mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    }) => recommendationService.adjustDailyPlan(reason, mealType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
    },
  });

  return {
    adjustPlan: adjustMutation.mutateAsync,
    isAdjusting: adjustMutation.isPending,
    adjustError: adjustMutation.error,
  };
}
