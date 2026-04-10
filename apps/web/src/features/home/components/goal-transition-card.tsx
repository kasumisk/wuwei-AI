'use client';

import { useState, useCallback } from 'react';
import { useGoalTransition } from '@/features/home/hooks/use-goal-transition';
import { useToast } from '@/lib/hooks/use-toast';
import { GOAL_LABELS } from '@/lib/constants/food';

/* ─── 常量 ─── */

const GOAL_EMOJI: Record<string, string> = {
  fat_loss: '🔥',
  muscle_gain: '💪',
  health: '🌿',
  habit: '🎯',
};

/* ─── 组件 ─── */

interface GoalTransitionCardProps {
  onDismiss: () => void;
}

export function GoalTransitionCard({ onDismiss }: GoalTransitionCardProps) {
  const { transition, isLoading, acceptTransition, isAccepting } = useGoalTransition();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);

  const handleAccept = useCallback(async () => {
    if (!transition) return;
    try {
      await acceptTransition(transition.suggestedGoal);
      setAccepted(true);
      const goalLabel = GOAL_LABELS[transition.suggestedGoal] || transition.suggestedGoal;
      toast({ title: `目标已调整为"${goalLabel}"，推荐将重新计算` });
    } catch {
      toast({ title: '目标调整失败，请稍后再试', variant: 'destructive' });
    }
  }, [transition, acceptTransition, toast]);

  // 无数据或正在加载时不渲染
  if (isLoading || !transition) return null;

  // 已接受后短暂展示成功状态
  if (accepted) {
    return (
      <section className="mb-6">
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-5">
          <p className="text-sm font-bold text-green-700">
            ✅ 目标已更新为「{GOAL_LABELS[transition.suggestedGoal] || transition.suggestedGoal}」
          </p>
          <p className="text-xs text-muted-foreground mt-1">推荐和计划正在重新生成...</p>
        </div>
      </section>
    );
  }

  const emoji = GOAL_EMOJI[transition.suggestedGoal] || '🎯';
  const goalLabel = GOAL_LABELS[transition.suggestedGoal] || transition.suggestedGoal;

  return (
    <section className="mb-6">
      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-2xl p-5">
        {/* 标题 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧭</span>
            <h3 className="font-bold text-sm">AI 建议调整目标</h3>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 text-muted-foreground/50 text-xs ml-3 mt-0.5"
          >
            稍后
          </button>
        </div>

        {/* 建议目标 */}
        <div className="mt-3 bg-card rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            <div>
              <p className="text-sm font-bold text-foreground">建议切换到「{goalLabel}」</p>
            </div>
          </div>
        </div>

        {/* 原因 */}
        <p className="text-xs text-foreground mt-3">{transition.reason}</p>

        {/* 影响说明 */}
        {transition.impact && (
          <p className="text-xs text-muted-foreground mt-2">💡 切换后：{transition.impact}</p>
        )}

        {/* 行动按钮 */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleAccept}
            disabled={isAccepting}
            className="flex-1 bg-primary text-primary-foreground text-sm font-bold py-2.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {isAccepting ? '调整中...' : `调整为${goalLabel}`}
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm font-bold active:scale-[0.98] transition-all"
          >
            暂不
          </button>
        </div>
      </div>
    </section>
  );
}
