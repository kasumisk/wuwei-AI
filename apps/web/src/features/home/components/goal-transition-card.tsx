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

const GOAL_DESCRIPTION: Record<string, string> = {
  fat_loss: '优化热量缺口，加速体脂下降',
  muscle_gain: '增加蛋白质配额，支持肌肉增长',
  health: '均衡营养摄入，维持整体健康',
  habit: '建立稳定饮食习惯，培养自律',
};

/* ─── 组件 ─── */

interface GoalTransitionCardProps {
  onDismiss: () => void;
}

export function GoalTransitionCard({ onDismiss }: GoalTransitionCardProps) {
  const { transition, isLoading, acceptTransition, isAccepting } = useGoalTransition();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

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
      <section className="mb-6 animate-in fade-in duration-300">
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-green-700">
                目标已更新为「{GOAL_LABELS[transition.suggestedGoal] || transition.suggestedGoal}」
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">推荐和计划正在重新生成...</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const emoji = GOAL_EMOJI[transition.suggestedGoal] || '🎯';
  const goalLabel = GOAL_LABELS[transition.suggestedGoal] || transition.suggestedGoal;
  const goalDesc = GOAL_DESCRIPTION[transition.suggestedGoal] || '';

  return (
    <section className="mb-6 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-2xl overflow-hidden">
        {/* 标题行 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧭</span>
            <h3 className="font-bold text-sm">AI 建议调整目标</h3>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground p-1 -mr-1 transition-colors"
            aria-label="稍后再说"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 建议目标卡片 */}
        <div className="mx-5 bg-card rounded-xl p-3.5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xl">{emoji}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">建议切换到「{goalLabel}」</p>
              {goalDesc && <p className="text-xs text-muted-foreground mt-0.5">{goalDesc}</p>}
            </div>
          </div>
        </div>

        {/* 原因（始终显示） */}
        <p className="text-xs text-foreground mx-5 mt-3 leading-relaxed">{transition.reason}</p>

        {/* 影响详情（可折叠） */}
        {transition.impact && (
          <div className="mx-5 mt-2">
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-primary font-medium flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${showDetail ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              切换后会怎样
            </button>
            {showDetail && (
              <div className="mt-2 bg-card/50 rounded-lg p-3 animate-in slide-in-from-top-1 fade-in duration-200">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  💡 {transition.impact}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 行动按钮 */}
        <div className="flex gap-2 px-5 pb-4 mt-4">
          <button
            onClick={handleAccept}
            disabled={isAccepting}
            className="flex-1 bg-primary text-primary-foreground text-sm font-bold py-2.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm shadow-primary/20"
          >
            {isAccepting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                调整中...
              </span>
            ) : (
              `调整为${goalLabel}`
            )}
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
