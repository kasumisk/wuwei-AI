'use client';

import { useState, useCallback, useMemo } from 'react';
import { usePlanAdjust } from '@/features/home/hooks/use-plan-adjust';
import { foodPlanService } from '@/lib/api/food-plan';
import { useToast } from '@/lib/hooks/use-toast';
import { LocalizedLink } from '@/components/common/localized-link';
import { MEAL_LABELS, GOAL_LABELS } from '@/lib/constants/food';
import type { MealSuggestion, DailySummary } from '@/types/food';
import type { UserProfile } from '@/types/user';

/* ─── 常量 ─── */

const DISLIKE_REASONS = [
  { key: 'taste', label: '不喜欢这类食物' },
  { key: 'no_ingredient', label: '手边没有食材' },
  { key: 'want_other', label: '想吃别的' },
] as const;

/* ─── 推荐原因计算（纯前端，基于已有数据） ─── */

function buildRecommendationReason(summary: DailySummary, profile: UserProfile | null): string[] {
  const reasons: string[] = [];
  const goal = profile?.goal || 'health';

  // 1. 目标驱动
  const goalLabel = GOAL_LABELS[goal] || '健康维持';
  reasons.push(`基于你的${goalLabel}目标`);

  // 2. 宏量素达标率
  if (summary.proteinGoal && summary.proteinGoal > 0) {
    const proteinPct = Math.round(((summary.totalProtein || 0) / summary.proteinGoal) * 100);
    if (proteinPct < 80) {
      reasons.push(`蛋白质今日达标 ${proteinPct}%，本餐侧重高蛋白补充`);
    }
  }

  if (summary.calorieGoal && summary.calorieGoal > 0) {
    const calPct = Math.round((summary.totalCalories / summary.calorieGoal) * 100);
    if (goal === 'fat_loss' && calPct > 70) {
      reasons.push(`热量已用 ${calPct}%，推荐低热量高饱腹食物`);
    } else if (goal === 'muscle_gain' && calPct < 50) {
      reasons.push(`热量仅用 ${calPct}%，可选择热量充足的搭配`);
    }
  }

  // 3. 生活方式
  if (profile?.canCook === false) {
    reasons.push('优先推荐外卖/便利店可获取的选项');
  }

  // 保底：至少有一个原因
  if (reasons.length <= 1) {
    reasons.push('综合你的营养需求和饮食偏好');
  }

  return reasons;
}

/* ─── 组件 ─── */

interface MealRecommendationCardProps {
  suggestion: MealSuggestion;
  summary: DailySummary;
  profile: UserProfile | null;
}

export function MealRecommendationCard({
  suggestion,
  summary,
  profile,
}: MealRecommendationCardProps) {
  const { adjustPlan, isAdjusting } = usePlanAdjust();
  const { toast } = useToast();

  const [activeScenario, setActiveScenario] = useState(0);
  const [showReason, setShowReason] = useState(false);
  const [showDislikeOptions, setShowDislikeOptions] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'like' | 'dislike' | null>(null);

  // 推荐原因
  const reasons = useMemo(() => buildRecommendationReason(summary, profile), [summary, profile]);

  // 当前展示的推荐内容
  const currentContent = useMemo(() => {
    if (suggestion.scenarios && suggestion.scenarios.length > 0) {
      const s = suggestion.scenarios[activeScenario];
      return s ? { foods: s.foods, calories: s.calories, tip: s.tip } : suggestion.suggestion;
    }
    return suggestion.suggestion;
  }, [suggestion, activeScenario]);

  // 喜欢 → 提交 accepted 反馈
  const handleLike = useCallback(() => {
    setFeedbackGiven('like');
    setShowDislikeOptions(false);
    toast({ title: '已记录偏好，会推荐更多类似食物' });
    // fire-and-forget：不阻塞 UI
    foodPlanService
      .submitFeedback({
        mealType: suggestion.mealType,
        foodName: currentContent.foods,
        action: 'accepted',
        goalType: profile?.goal,
      })
      .catch(() => {
        /* 静默失败 — 不影响用户体验 */
      });
  }, [toast, suggestion.mealType, currentContent.foods, profile?.goal]);

  // 换一个
  const handleSwap = useCallback(
    async (reason?: string) => {
      try {
        const adjustReason = reason || '用户不想吃当前推荐，请换一个';
        await adjustPlan(adjustReason);
        setFeedbackGiven(null);
        setShowDislikeOptions(false);
        toast({ title: '已为你换了新推荐' });
      } catch {
        toast({ title: '换一个失败，请稍后再试', variant: 'destructive' });
      }
    },
    [adjustPlan, toast]
  );

  // 不想吃 → 展开原因
  const handleDislike = useCallback(() => {
    setFeedbackGiven('dislike');
    setShowDislikeOptions(true);
  }, []);

  // 选择不喜欢的原因 → 提交 skipped 反馈 → 自动换一个
  const handleDislikeReason = useCallback(
    (reason: string) => {
      // fire-and-forget：提交反馈
      foodPlanService
        .submitFeedback({
          mealType: suggestion.mealType,
          foodName: currentContent.foods,
          action: 'skipped',
          goalType: profile?.goal,
        })
        .catch(() => {
          /* 静默失败 */
        });
      handleSwap(`用户不想吃：${reason}`);
    },
    [handleSwap, suggestion.mealType, currentContent.foods, profile?.goal]
  );

  const mealLabel = MEAL_LABELS[suggestion.mealType] || '下一餐';

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low rounded-2xl p-5">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🍽️</span>
          <h3 className="font-bold text-sm">{mealLabel}推荐</h3>
        </div>

        {/* 场景切换 */}
        {suggestion.scenarios && suggestion.scenarios.length > 0 && (
          <div className="flex gap-2 mb-3">
            {suggestion.scenarios.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveScenario(i)}
                className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all ${
                  activeScenario === i
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.scenario}
              </button>
            ))}
          </div>
        )}

        {/* 推荐内容 */}
        {isAdjusting ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-muted-foreground">正在为你换推荐...</p>
          </div>
        ) : (
          <>
            <p className="text-base font-medium">{currentContent.foods}</p>
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-primary font-bold">
                ≈ {currentContent.calories} kcal
              </span>
              <span className="text-xs text-muted-foreground">💡 {currentContent.tip}</span>
            </div>
            {/* 关联菜谱入口 */}
            <LocalizedLink
              href={`/recipes?q=${encodeURIComponent(currentContent.foods.split('、')[0].split('，')[0].trim())}`}
              className="mt-2 flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
            >
              <span>🍳</span>
              <span className="underline underline-offset-2">查看相关菜谱</span>
            </LocalizedLink>
          </>
        )}

        {/* 推荐原因（可折叠） */}
        <button
          onClick={() => setShowReason((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>💡</span>
          <span className="underline underline-offset-2">
            {showReason ? '收起' : '为什么推荐这个？'}
          </span>
        </button>

        {showReason && (
          <div className="mt-2 bg-card rounded-xl p-3 space-y-1">
            {reasons.map((r, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {i === 0 ? '🎯' : '•'} {r}
              </p>
            ))}
          </div>
        )}

        {/* 反馈按钮 */}
        <div className="flex gap-2 mt-4 pt-3 border-t border-border/30">
          <button
            onClick={handleLike}
            disabled={isAdjusting}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97] ${
              feedbackGiven === 'like'
                ? 'bg-green-100 text-green-700 border border-green-300'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {feedbackGiven === 'like' ? '✅ 已选' : '👍 喜欢'}
          </button>
          <button
            onClick={() => handleSwap()}
            disabled={isAdjusting}
            className="flex-1 py-2 rounded-xl text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 transition-all active:scale-[0.97] disabled:opacity-50"
          >
            🔄 换一个
          </button>
          <button
            onClick={handleDislike}
            disabled={isAdjusting}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97] ${
              feedbackGiven === 'dislike'
                ? 'bg-red-50 text-red-600 border border-red-200'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            👎 不想吃
          </button>
        </div>

        {/* 不想吃的原因选择 */}
        {showDislikeOptions && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">告诉我们原因，推荐会更准：</p>
            {DISLIKE_REASONS.map((r) => (
              <button
                key={r.key}
                onClick={() => handleDislikeReason(r.label)}
                disabled={isAdjusting}
                className="w-full text-left px-3 py-2 rounded-lg bg-card text-xs text-foreground hover:bg-muted/60 transition-colors active:scale-[0.98] disabled:opacity-50"
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
