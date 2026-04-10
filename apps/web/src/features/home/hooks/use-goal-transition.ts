'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';

/**
 * 目标迁移建议 hook
 * 调用 getGoalTransition API 获取 AI 的目标迁移建议
 * 提供 acceptTransition 方法一键接受新目标
 */
export function useGoalTransition() {
  const queryClient = useQueryClient();

  const transitionQuery = useQuery({
    queryKey: ['goal-transition'],
    queryFn: () => profileService.getGoalTransition(),
    staleTime: 30 * 60 * 1000, // 30 分钟，不需要频繁刷新
  });

  const acceptMutation = useMutation({
    mutationFn: (newGoal: string) => profileService.saveProfile({ goal: newGoal as any }),
    onSuccess: () => {
      // 接受新目标后，刷新所有相关数据
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['goal-transition'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['summary', 'today'] });
    },
  });

  return {
    transition: transitionQuery.data ?? null,
    isLoading: transitionQuery.isLoading,
    acceptTransition: acceptMutation.mutateAsync,
    isAccepting: acceptMutation.isPending,
  };
}
