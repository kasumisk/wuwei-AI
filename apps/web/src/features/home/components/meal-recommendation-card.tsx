'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlanAdjust } from '@/features/home/hooks/use-plan-adjust';
import { foodPlanService } from '@/lib/api/food-plan';
import { foodRecordService } from '@/lib/api/food-record';
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

/* ─── 推荐原因计算 ─── */

const CUISINE_LABELS: Record<string, string> = {
  chinese: '中餐', sichuan: '川菜', cantonese: '粤菜',
  japanese: '日料', korean: '韩餐', western: '西餐',
  thai: '泰国菜', indian: '印度菜', mediterranean: '地中海菜', fast_food: '快餐',
};

const COOKING_SKILL_LABELS: Record<string, string> = {
  beginner: '新手', basic: '基础', intermediate: '中级', advanced: '高级',
};

function buildRecommendationReason(summary: DailySummary, profile: UserProfile | null): string[] {
  const reasons: string[] = [];
  const goal = profile?.goal || 'health';
  reasons.push(`基于你的${GOAL_LABELS[goal] || '健康维持'}目标`);

  if (summary.proteinGoal && summary.proteinGoal > 0) {
    const pct = Math.round(((summary.totalProtein || 0) / summary.proteinGoal) * 100);
    if (pct < 80) reasons.push(`蛋白质今日达标 ${pct}%，本餐侧重高蛋白补充`);
  }
  if (summary.calorieGoal && summary.calorieGoal > 0) {
    const calPct = Math.round((summary.totalCalories / summary.calorieGoal) * 100);
    if (goal === 'fat_loss' && calPct > 70) reasons.push(`热量已用 ${calPct}%，推荐低热量高饱腹食物`);
    else if (goal === 'muscle_gain' && calPct < 50) reasons.push(`热量仅用 ${calPct}%，可选择热量充足的搭配`);
  }

  const cuisines = (profile as any)?.cuisinePreferences as string[] | undefined;
  if (cuisines?.length) {
    reasons.push(`符合你偏好的 ${cuisines.slice(0, 2).map((k) => CUISINE_LABELS[k] || k).join('、')} 风格`);
  }

  const skill = (profile as any)?.cookingSkillLevel as string | undefined;
  if (skill && skill !== 'basic') {
    const lbl = COOKING_SKILL_LABELS[skill] || skill;
    if (skill === 'beginner') reasons.push(`根据你的${lbl}水平，优先推荐易操作食谱`);
    else reasons.push(`匹配你的${lbl}烹饪水平`);
  }

  const hc = (profile as any)?.healthConditions as string[] | undefined;
  if (hc?.length) reasons.push('已规避对你健康状况有影响的食材');
  if (profile?.canCook === false) reasons.push('优先推荐外卖/便利店可获取的选项');
  if (reasons.length <= 1) reasons.push('综合你的营养需求和饮食偏好');
  return reasons;
}

/* ─── 类型 ─── */

interface MealRecommendationCardProps {
  suggestion: MealSuggestion;
  summary: DailySummary;
  profile: UserProfile | null;
}

/* ─── 组件 ─── */

export function MealRecommendationCard({
  suggestion,
  summary,
  profile,
}: MealRecommendationCardProps) {
  const { adjustPlan, isAdjusting } = usePlanAdjust();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const hasScenarios = !!(suggestion.scenarios && suggestion.scenarios.length > 0);

  // 当前选中的场景索引（-1 = 无场景 / 主推荐）
  const [activeScenario, setActiveScenario] = useState(hasScenarios ? 0 : -1);
  const [showReason, setShowReason] = useState(false);
  const [showDislikeOptions, setShowDislikeOptions] = useState(false);
  // 按场景独立追踪已吃状态：key 为场景索引（-1 = 主推荐）
  const [eatenScenarios, setEatenScenarios] = useState<Set<number>>(new Set());
  const [isLoggingEaten, setIsLoggingEaten] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'like' | 'dislike' | null>(null);

  const reasons = useMemo(() => buildRecommendationReason(summary, profile), [summary, profile]);

  // 当前场景的内容（场景切换时实时更新）
  const currentContent = useMemo(() => {
    if (hasScenarios && activeScenario >= 0) {
      const s = suggestion.scenarios![activeScenario];
      return s ? { foods: s.foods, calories: s.calories, tip: s.tip, scenarioLabel: s.scenario } : null;
    }
    return { ...suggestion.suggestion, scenarioLabel: null as string | null };
  }, [suggestion, activeScenario, hasScenarios]);

  // 当前场景是否已吃
  const isCurrentEaten = eatenScenarios.has(activeScenario);

  // 刷新首页相关数据
  const refreshHomeData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['summary', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['records', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
    queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
    queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
  }, [queryClient]);

  // 切换场景时重置 dislike 展开状态
  const handleScenarioChange = useCallback((idx: number) => {
    setActiveScenario(idx);
    setShowDislikeOptions(false);
    setFeedbackGiven(null);
  }, []);

  // ✅ 已吃 → 按当前选中场景记录
  const handleEaten = useCallback(async () => {
    if (isLoggingEaten || isCurrentEaten || !currentContent) return;
    setIsLoggingEaten(true);
    try {
      // 拆解食物文本为多个 FoodItem（格式：A + B + C 或 A、B、C）
      const foodNames = currentContent.foods
        .split(/[+，、]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const perCalories = Math.round(currentContent.calories / Math.max(foodNames.length, 1));
      const foods = foodNames.map((name) => ({ name, calories: perCalories }));

      // 场景上下文备注（外卖/便利店/自己做等）
      const contextComment = currentContent.scenarioLabel
        ? `推荐场景：${currentContent.scenarioLabel}`
        : '来自推荐';

      // 并行：保存记录 + 提交反馈（反馈失败不阻断）
      await Promise.all([
        foodRecordService.saveRecord({
          foods,
          totalCalories: currentContent.calories,
          mealType: suggestion.mealType,
          source: 'manual',
          advice: currentContent.tip,
          contextComment,
        }),
        foodPlanService
          .submitFeedback({
            mealType: suggestion.mealType,
            foodName: currentContent.foods,
            action: 'accepted',
            goalType: profile?.goal,
          })
          .catch(() => {}),
      ]);

      // 标记当前场景已吃（其他场景不受影响）
      setEatenScenarios((prev) => new Set(prev).add(activeScenario));
      setShowDislikeOptions(false);

      const scenarioTip = currentContent.scenarioLabel ? `（${currentContent.scenarioLabel}）` : '';
      toast({ title: `✅ 已记录${scenarioTip}，今日摄入已更新` });
      refreshHomeData();
    } catch {
      toast({ title: '记录失败，请稍后重试', variant: 'destructive' });
    } finally {
      setIsLoggingEaten(false);
    }
  }, [
    isLoggingEaten,
    isCurrentEaten,
    currentContent,
    activeScenario,
    suggestion.mealType,
    profile?.goal,
    toast,
    refreshHomeData,
  ]);

  // 👍 喜欢（只提交反馈，不记录饮食）
  const handleLike = useCallback(() => {
    if (feedbackGiven || isCurrentEaten) return;
    setFeedbackGiven('like');
    setShowDislikeOptions(false);
    toast({ title: '已记录偏好，会推荐更多类似食物' });
    foodPlanService
      .submitFeedback({
        mealType: suggestion.mealType,
        foodName: currentContent?.foods ?? '',
        action: 'accepted',
        goalType: profile?.goal,
      })
      .catch(() => {});
  }, [feedbackGiven, isCurrentEaten, toast, suggestion.mealType, currentContent, profile?.goal]);

  // 🔄 换一个
  const handleSwap = useCallback(
    async (reason?: string) => {
      try {
        await adjustPlan({
          reason: reason || '用户不想吃当前推荐，请换一个',
          mealType: suggestion.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
        });
        setFeedbackGiven(null);
        setShowDislikeOptions(false);
        setEatenScenarios(new Set());
        toast({ title: '已为你换了新推荐' });
      } catch {
        toast({ title: '换一个失败，请稍后再试', variant: 'destructive' });
      }
    },
    [adjustPlan, toast, suggestion.mealType]
  );

  // 👎 不想吃
  const handleDislike = useCallback(() => {
    setFeedbackGiven('dislike');
    setShowDislikeOptions(true);
  }, []);

  // 选不喜欢原因 → 换一个
  const handleDislikeReason = useCallback(
    (reason: string) => {
      foodPlanService
        .submitFeedback({
          mealType: suggestion.mealType,
          foodName: currentContent?.foods ?? '',
          action: 'skipped',
          goalType: profile?.goal,
        })
        .catch(() => {});
      handleSwap(`用户不想吃：${reason}`);
    },
    [handleSwap, suggestion.mealType, currentContent, profile?.goal]
  );

  const mealLabel = MEAL_LABELS[suggestion.mealType] || '下一餐';

  if (!currentContent) return null;

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low rounded-2xl p-5">

        {/* 标题 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🍽️</span>
          <h3 className="font-bold text-sm">{mealLabel}推荐</h3>
        </div>

        {/* 场景切换 Tab */}
        {hasScenarios && suggestion.scenarios && (
          <div className="flex gap-2 mb-3">
            {suggestion.scenarios.map((s, i) => (
              <button
                key={i}
                onClick={() => handleScenarioChange(i)}
                className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all relative ${
                  activeScenario === i
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.scenario}
                {/* 已吃标记 */}
                {eatenScenarios.has(i) && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full text-[8px] text-white flex items-center justify-center leading-none">
                    ✓
                  </span>
                )}
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
            <LocalizedLink
              href={`/recipes?q=${encodeURIComponent(
                currentContent.foods.split(/[、，+]/)[0].trim()
              )}`}
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

        {/* 操作区 */}
        <div className="mt-4 pt-3 border-t border-border/30 space-y-2">

          {/* 主操作：✅ 已吃（按当前场景） */}
          <button
            onClick={handleEaten}
            disabled={isAdjusting || isLoggingEaten || isCurrentEaten}
            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-60 ${
              isCurrentEaten
                ? 'bg-green-100 text-green-700 border border-green-300'
                : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15'
            }`}
          >
            {isLoggingEaten ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />
                记录中...
              </span>
            ) : isCurrentEaten ? (
              `✅ 已记录${currentContent.scenarioLabel ? `（${currentContent.scenarioLabel}）` : ''}到今日摄入`
            ) : (
              `✅ 我吃了${currentContent.scenarioLabel ? `「${currentContent.scenarioLabel}」` : '这个'} — 记录摄入`
            )}
          </button>

          {/* 次操作：👍 喜欢 / 🔄 换一个 / 👎 不想吃 */}
          <div className="flex gap-2">
            <button
              onClick={handleLike}
              disabled={isAdjusting || isCurrentEaten}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97] disabled:opacity-50 ${
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
              disabled={isAdjusting || isCurrentEaten}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97] disabled:opacity-50 ${
                feedbackGiven === 'dislike'
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              👎 不想吃
            </button>
          </div>
        </div>

        {/* 不想吃原因 */}
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
