'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { useToast } from '@/lib/hooks/use-toast';

/**
 * DecisionFeedback — 决策反馈闭环组件
 *
 * 放在 DecisionCard 底部，让用户反馈：
 * - "听取了建议" (followed: true)
 * - "还是吃了" (followed: false)
 * 然后追加反馈评价 (helpful / unhelpful / wrong)
 *
 * 调用 POST /api/app/food/decision-feedback
 */

interface DecisionFeedbackProps {
  /** 如果有 requestId 则保存后传入 recordId；否则需要外部传 */
  recordId?: string;
  decision: string;
}

type FeedbackStep = 'initial' | 'rating' | 'done';
type FeedbackType = 'helpful' | 'unhelpful' | 'wrong';

export function DecisionFeedback({ recordId, decision }: DecisionFeedbackProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<FeedbackStep>('initial');
  const [followed, setFollowed] = useState<boolean | null>(null);

  const feedbackMutation = useMutation({
    mutationFn: ({ followed, feedback }: { followed: boolean; feedback: FeedbackType }) => {
      if (!recordId) {
        return Promise.reject(new Error('缺少记录ID'));
      }
      return foodRecordService.decisionFeedback(recordId, followed, feedback);
    },
    onSuccess: () => {
      setStep('done');
    },
    onError: (err) => {
      toast({
        title: err instanceof Error ? err.message : '反馈提交失败',
        variant: 'destructive',
      });
    },
  });

  const handleFollowChoice = useCallback((didFollow: boolean) => {
    setFollowed(didFollow);
    setStep('rating');
  }, []);

  const handleRating = useCallback(
    (feedback: FeedbackType) => {
      if (followed === null) return;
      feedbackMutation.mutate({ followed, feedback });
    },
    [followed, feedbackMutation]
  );

  // 不显示对 SAFE 决策的反馈（太正面了不需要反馈）
  if (decision === 'SAFE') return null;

  // 无 recordId 时：保存记录后才能提交反馈，显示禁用状态避免静默丢失数据
  if (!recordId) {
    return (
      <div className="bg-white/60  p-3 space-y-2">
        <p className="text-xs font-bold text-muted-foreground">这个建议有帮助吗？</p>
        <div className="flex gap-2">
          <button
            disabled
            className="flex-1 py-2 rounded-lg text-xs font-bold bg-muted text-muted-foreground opacity-50 cursor-not-allowed flex items-center justify-center gap-1"
          >
            <span className="text-base">👍</span> 有帮助
          </button>
          <button
            disabled
            className="flex-1 py-2 rounded-lg text-xs font-bold bg-muted text-muted-foreground opacity-50 cursor-not-allowed flex items-center justify-center gap-1"
          >
            <span className="text-base">👎</span> 不准确
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground text-center">保存记录后即可提交反馈</p>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="bg-white/60  p-3 text-center">
        <p className="text-sm font-medium text-primary">感谢你的反馈，AI 会越来越懂你</p>
      </div>
    );
  }

  if (step === 'rating') {
    return (
      <div className="bg-white/60  p-3 space-y-2">
        <p className="text-xs font-bold text-muted-foreground">
          {followed ? '很棒！觉得这次建议怎么样？' : '了解，觉得 AI 建议有帮助吗？'}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleRating('helpful')}
            disabled={feedbackMutation.isPending}
            className="flex-1 py-2 rounded-lg text-xs font-bold bg-green-500/10 text-green-700 hover:bg-green-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            有帮助
          </button>
          <button
            onClick={() => handleRating('unhelpful')}
            disabled={feedbackMutation.isPending}
            className="flex-1 py-2 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            一般
          </button>
          <button
            onClick={() => handleRating('wrong')}
            disabled={feedbackMutation.isPending}
            className="flex-1 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-700 hover:bg-red-500/20 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            不准确
          </button>
        </div>
      </div>
    );
  }

  // step === 'initial'
  return (
    <div className="bg-white/60  p-3 space-y-2">
      <p className="text-xs font-bold text-muted-foreground">你后来怎么做的？</p>
      <div className="flex gap-2">
        <button
          onClick={() => handleFollowChoice(true)}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.97] transition-all flex items-center justify-center gap-1"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
          </svg>
          听取了建议
        </button>
        <button
          onClick={() => handleFollowChoice(false)}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 active:scale-[0.97] transition-all flex items-center justify-center gap-1"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2z" />
          </svg>
          还是吃了
        </button>
      </div>
    </div>
  );
}
