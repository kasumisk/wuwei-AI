'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';

/**
 * 决策反馈 hook
 * 调用 decisionFeedback API，让用户对 AI 的饮食决策（SAFE/OK/LIMIT/AVOID）给出反馈
 */
export function useDecisionFeedback() {
  const queryClient = useQueryClient();

  const feedbackMutation = useMutation({
    mutationFn: ({
      recordId,
      followed,
      feedback,
    }: {
      recordId: string;
      followed: boolean;
      feedback: 'helpful' | 'unhelpful' | 'wrong';
    }) => foodRecordService.decisionFeedback(recordId, followed, feedback),
    onSuccess: () => {
      // 反馈成功后刷新今日记录（后端可能更新了推荐权重）
      queryClient.invalidateQueries({ queryKey: ['records', 'today'] });
    },
  });

  return {
    submitFeedback: feedbackMutation.mutateAsync,
    isSubmitting: feedbackMutation.isPending,
    feedbackError: feedbackMutation.error,
  };
}
