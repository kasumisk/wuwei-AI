'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlanAdjust } from '@/features/home/hooks/use-plan-adjust';
import { foodPlanService } from '@/lib/api/food-plan';
import { foodRecordService } from '@/lib/api/food-record';
import { useToast } from '@/lib/hooks/use-toast';
import { LocalizedLink } from '@/components/common/localized-link';
import { MEAL_LABELS } from '@/lib/constants/food';
import type { MealSuggestion, DailySummary } from '@/types/food';
import type { UserProfile } from '@/types/user';

function estimateMacros(calories: number, goal?: string) {
  const cal = Math.max(0, Number(calories) || 0);
  const r: Record<string, { p: number; f: number; c: number }> = {
    fat_loss: { p: 0.3, f: 0.3, c: 0.4 },
    muscle_gain: { p: 0.28, f: 0.22, c: 0.5 },
    health: { p: 0.2, f: 0.3, c: 0.5 },
  };
  const ratio = r[goal || 'health'] ?? r.health;
  return {
    protein: Math.round((cal * ratio.p) / 4),
    fat: Math.round((cal * ratio.f) / 9),
    carbs: Math.round((cal * ratio.c) / 4),
  };
}

const DISLIKE_REASONS = [
  { key: 'taste', label: '不喜欢这类食物' },
  { key: 'no_ingredient', label: '手边没有食材' },
  { key: 'want_other', label: '想吃别的' },
] as const;

interface NextMealCardProps {
  suggestion: MealSuggestion;
  summary: DailySummary | undefined;
  profile: UserProfile | null;
}

export function NextMealCard({ suggestion, summary: _summary, profile }: NextMealCardProps) {
  const { adjustSuggestion, isAdjustingSuggestion } = usePlanAdjust();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [eaten, setEaten] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [showDislike, setShowDislike] = useState(false);
  const [liked, setLiked] = useState(false);
  const [scenarioIdx, setScenarioIdx] = useState(0);

  // Reset scenario index and eaten state when suggestion prop changes
  useEffect(() => {
    setScenarioIdx(0);
    setEaten(false);
    setLiked(false);
    setShowDislike(false);
  }, [suggestion]);

  const scenarios = suggestion.scenarios ?? [];

  const content = useMemo(() => {
    if (scenarios.length > 0) {
      const s = scenarios[scenarioIdx] ?? scenarios[0];
      return {
        foods: s.foods,
        foodItems: s.foodItems,
        calories: s.calories,
        tip: s.tip,
        totalProtein: s.totalProtein,
        totalFat: s.totalFat,
        totalCarbs: s.totalCarbs,
      };
    }
    return suggestion.suggestion;
  }, [suggestion, scenarios, scenarioIdx]);

  const mealLabel = MEAL_LABELS[suggestion.mealType] || '下一餐';

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['summary', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['records', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
    queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
    queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
  }, [queryClient]);

  const handleEaten = useCallback(async () => {
    if (isLogging || eaten || !content) return;
    setIsLogging(true);
    try {
      // 优先使用真实宏量，无真实值时降级估算
      const macroFallback = estimateMacros(content.calories, profile?.goal);
      const macros = {
        totalProtein: content.totalProtein ?? macroFallback.protein,
        totalFat: content.totalFat ?? macroFallback.fat,
        totalCarbs: content.totalCarbs ?? macroFallback.carbs,
      };
      await Promise.all([
        foodRecordService.createRecord({
          foods: content.foodItems,
          totalCalories: content.calories,
          ...macros,
          mealType: suggestion.mealType,
          advice: content.tip,
          source: 'recommend',
        }),
        foodPlanService
          .submitFeedback({
            mealType: suggestion.mealType,
            foodName: content.foods,
            action: 'accepted',
            goalType: profile?.goal,
          })
          .catch(() => {}),
      ]);
      setEaten(true);
      toast({ title: '✅ 已记录到今日摄入' });
      refreshData();
    } catch {
      toast({ title: '记录失败，请稍后重试', variant: 'destructive' });
    } finally {
      setIsLogging(false);
    }
  }, [isLogging, eaten, content, profile?.goal, suggestion.mealType, toast, refreshData]);

  const handleSwap = useCallback(
    async (reason?: string) => {
        try {
        await adjustSuggestion({
          reason: reason || '用户不想吃当前推荐，请换一个',
          mealType: suggestion.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
        });
        setEaten(false);
        setLiked(false);
        setShowDislike(false);
        toast({ title: '已为你换了新推荐' });
      } catch {
        toast({ title: '换一个失败，请稍后再试', variant: 'destructive' });
      }
    },
    [adjustSuggestion, suggestion.mealType, toast]
  );

  if (!content) return null;

  return (
    <section className="mb-5">
      <div className="bg-surface-container-low rounded-md p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🍽️</span>
            <h3 className="font-bold text-sm">{mealLabel}推荐</h3>
          </div>
          <span className="text-xs font-bold text-primary">≈ {content.calories} kcal</span>
        </div>

        {/* Scenario tabs (if multiple scenarios) */}
        {scenarios.length > 1 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
            {scenarios.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setScenarioIdx(i);
                  setEaten(false);
                  setLiked(false);
                }}
                className={`px-2.5 py-1  text-[11px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                  i === scenarioIdx
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {s.scenario || `方案${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Food name */}
        {isAdjustingSuggestion ? (
          <div className="py-4 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-primary border-t-transparent  animate-spin inline-block" />
            <span className="text-xs text-muted-foreground">换推荐中...</span>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold leading-snug">{content.foods}</p>
            <p className="text-xs text-muted-foreground mt-1">💡 {content.tip}</p>
            {/* Macros row */}
            {(content.totalProtein != null ||
              content.totalFat != null ||
              content.totalCarbs != null) && (
              <div className="flex items-center gap-3 mt-1.5">
                {content.totalProtein != null && (
                  <span className="text-[10px] text-muted-foreground">
                    蛋白{' '}
                    <strong className="text-foreground">{Math.round(content.totalProtein)}g</strong>
                  </span>
                )}
                {content.totalFat != null && (
                  <span className="text-[10px] text-muted-foreground">
                    脂肪{' '}
                    <strong className="text-foreground">{Math.round(content.totalFat)}g</strong>
                  </span>
                )}
                {content.totalCarbs != null && (
                  <span className="text-[10px] text-muted-foreground">
                    碳水{' '}
                    <strong className="text-foreground">{Math.round(content.totalCarbs)}g</strong>
                  </span>
                )}
              </div>
            )}
            {content.foods && (
              <LocalizedLink
                href={`/recipes?q=${encodeURIComponent(content.foods.split(/[、，+]/)[0].trim())}`}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80"
              >
                🍳 <span className="underline underline-offset-2">查看菜谱</span>
              </LocalizedLink>
            )}
          </>
        )}

        {/* Actions */}
        <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
          {/* Primary: eaten */}
          <button
            onClick={handleEaten}
            disabled={isAdjustingSuggestion || isLogging || eaten}
            className={`w-full py-2.5  text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-60 ${
              eaten ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'
            }`}
          >
            {isLogging ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent  animate-spin inline-block" />
                记录中...
              </span>
            ) : eaten ? (
              '已记录到今日摄入'
            ) : (
              '我吃了 — 记录摄入'
            )}
          </button>

          {/* Secondary row */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setLiked(true);
                foodPlanService
                  .submitFeedback({
                    mealType: suggestion.mealType,
                    foodName: content.foods,
                    action: 'accepted',
                    goalType: profile?.goal,
                  })
                  .catch(() => {});
              }}
              disabled={isAdjustingSuggestion || eaten || liked}
              className={`flex-1 py-2  text-xs font-bold transition-all active:scale-[0.97] disabled:opacity-50 ${liked ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {liked ? '✅ 已选' : '👍 喜欢'}
            </button>
            <button
              onClick={() => handleSwap()}
              disabled={isAdjustingSuggestion || eaten}
              className="flex-1 py-2  text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 transition-all active:scale-[0.97] disabled:opacity-50"
            >
              🔄 换一个
            </button>
            <button
              onClick={() => setShowDislike(true)}
              disabled={isAdjustingSuggestion || eaten}
              className="flex-1 py-2  text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 transition-all active:scale-[0.97] disabled:opacity-50"
            >
              👎 不想吃
            </button>
          </div>

          {/* Dislike reasons */}
          {showDislike && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] text-muted-foreground">告诉我们原因，推荐会更准：</p>
              {DISLIKE_REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleSwap(`用户不想吃：${r.label}`)}
                  disabled={isAdjustingSuggestion}
                  className="w-full text-left px-3 py-2 rounded-lg bg-card text-xs text-foreground hover:bg-muted/60 transition-colors active:scale-[0.98] disabled:opacity-50"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
