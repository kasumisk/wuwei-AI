'use client';

import { useQuery } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { MEAL_LABELS } from '@/lib/constants/food';
import { PostSaveRecommendation } from './post-save-recommendation';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { LocalizedLink } from '@/components/common/localized-link';
import type { DailySummary } from '@/types/food';

/* ─── 工具函数 ─── */

function pct(val: number, goal: number): number {
  return goal > 0 ? Math.min(100, Math.round((val / goal) * 100)) : 0;
}

function barColor(percent: number, inverse = false): string {
  if (inverse) {
    // 热量：越少越好（减脂场景）
    return percent > 100 ? 'bg-red-500' : percent > 85 ? 'bg-orange-500' : 'bg-green-500';
  }
  return percent >= 70 ? 'bg-green-500' : percent >= 40 ? 'bg-amber-500' : 'bg-red-400';
}

function buildNextMealTip(summary: DailySummary, mealType: string): string[] {
  const tips: string[] = [];
  const calGoal = summary.calorieGoal || 2000;
  const remaining = calGoal - summary.totalCalories;
  const mealsMap: Record<string, number> = {
    breakfast: 3,
    lunch: 2,
    dinner: 1,
    snack: 1,
  };
  const remainingMeals = Math.max(1, mealsMap[mealType] ?? 1);

  if (remaining <= 0) {
    tips.push('今日热量已达标，后续建议只吃少量蔬菜或水果');
  } else if (remaining < 300) {
    tips.push(`剩余仅 ${remaining} kcal，下一餐建议选择低热量高饱腹食物`);
  } else {
    const perMeal = Math.round(remaining / remainingMeals);
    tips.push(`下一餐建议控制在 ${perMeal} kcal 左右`);
  }

  // 蛋白质不足提示
  const proteinGoal = summary.proteinGoal || 0;
  const proteinCurrent = summary.totalProtein || 0;
  if (proteinGoal > 0) {
    const proteinPct = pct(proteinCurrent, proteinGoal);
    if (proteinPct < 60) {
      tips.push(`蛋白质仅达标 ${proteinPct}%，优先补充高蛋白食物`);
    }
  }

  // 碳水过多提示
  const carbsGoal = summary.carbsGoal || 0;
  const carbsCurrent = summary.totalCarbs || 0;
  if (carbsGoal > 0 && carbsCurrent > carbsGoal * 0.9) {
    tips.push('碳水已接近上限，后续建议减少主食');
  }

  return tips;
}

/* ─── 宏量素小行 ─── */

function MacroRow({
  label,
  current,
  goal,
  unit,
  color,
}: {
  label: string;
  current: number;
  goal: number;
  unit: string;
  color: string;
}) {
  const percent = pct(current, goal);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap w-20 text-right">
        {Math.round(current)}/{Math.round(goal)}
        {unit} ({percent}%)
      </span>
    </div>
  );
}

/* ─── 主组件 ─── */

interface SavedImpactProps {
  mealType: string;
  /** 保存前的 summary 快照，用于 before/after 动画对比 */
  beforeSummary?: DailySummary | null;
  onReset: () => void;
  onGoHome: () => void;
  onGoToPlan: () => void;
  onGoToCoach?: () => void;
}

export function SavedImpact({
  mealType,
  beforeSummary,
  onReset,
  onGoHome,
  onGoToPlan,
  onGoToCoach,
}: SavedImpactProps) {
  const { isFree } = useSubscription();

  // 保存后立即拉取最新 summary（不使用缓存）
  const { data: summary, isLoading } = useQuery({
    queryKey: ['summary', 'today', 'post-save'],
    queryFn: () => foodRecordService.getTodaySummary(),
    staleTime: 0, // 强制刷新
  });

  const mealLabel = MEAL_LABELS[mealType] || '这餐';

  if (isLoading || !summary) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">正在更新今日数据...</p>
      </div>
    );
  }

  const calGoal = summary.calorieGoal || 2000;
  const remaining = Math.max(0, calGoal - summary.totalCalories);
  const calPct = pct(summary.totalCalories, calGoal);
  const tips = buildNextMealTip(summary, mealType);

  const hasProteinGoal = (summary.proteinGoal || 0) > 0;
  const hasCarbsGoal = (summary.carbsGoal || 0) > 0;
  const hasFatGoal = (summary.fatGoal || 0) > 0;

  // Before/After delta
  const addedCalories = beforeSummary ? summary.totalCalories - beforeSummary.totalCalories : null;
  const addedProtein = beforeSummary
    ? (summary.totalProtein || 0) - (beforeSummary.totalProtein || 0)
    : null;
  const beforeCalPct = beforeSummary ? pct(beforeSummary.totalCalories, calGoal) : null;

  return (
    <div className="space-y-5">
      {/* 成功头部 */}
      <div className="flex flex-col items-center gap-3 pt-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="32"
            height="32"
            className="text-green-600"
          >
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-lg font-headline font-bold">{mealLabel}已记录</h2>
          <p className="text-muted-foreground text-xs mt-1">
            今日已记录 {summary.mealCount} 餐，共 {summary.totalCalories} kcal
          </p>
        </div>
      </div>

      {/* 今日预算卡片 */}
      <div className="bg-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground">📊 今日预算更新</span>
          {summary.nutritionScore != null && summary.nutritionScore > 0 && (
            <span className="text-xs font-bold text-primary">
              营养评分 {summary.nutritionScore}分
            </span>
          )}
        </div>

        {/* 热量总览 */}
        <div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold font-headline text-primary">
                {remaining.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">kcal 剩余</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {summary.totalCalories} / {calGoal} kcal
            </span>
          </div>
          <div className="mt-2 h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                calPct > 100 ? 'bg-red-500' : calPct > 85 ? 'bg-orange-500' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(calPct, 100)}%` }}
            />
          </div>

          {/* Before/After 进度对比动画 */}
          {beforeCalPct !== null && addedCalories !== null && (
            <div className="mt-3 space-y-1.5">
              <span className="text-[10px] font-bold text-muted-foreground">📊 本餐变化</span>
              <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                {/* Before bar */}
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/30 transition-all duration-700"
                  style={{ width: `${Math.min(beforeCalPct, 100)}%` }}
                />
                {/* After bar (animate on top) */}
                <div
                  className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 delay-300 ${
                    calPct > 100
                      ? 'bg-red-500/70'
                      : calPct > 85
                        ? 'bg-orange-500/70'
                        : 'bg-primary/70'
                  }`}
                  style={{ width: `${Math.min(calPct, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  本餐 +{addedCalories} kcal
                </span>
                {addedProtein !== null && addedProtein > 0 && (
                  <span className="text-[10px] text-blue-600">
                    +{Math.round(addedProtein)}g 蛋白质
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {beforeSummary!.totalCalories} → {summary.totalCalories} kcal
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 宏量素达标 */}
        {(hasProteinGoal || hasCarbsGoal || hasFatGoal) && (
          <div className="space-y-2 pt-2 border-t border-border/30">
            <span className="text-[10px] font-bold text-muted-foreground">宏量素达标率</span>
            {hasProteinGoal && (
              <MacroRow
                label="蛋白质"
                current={summary.totalProtein || 0}
                goal={summary.proteinGoal!}
                unit="g"
                color={barColor(pct(summary.totalProtein || 0, summary.proteinGoal!))}
              />
            )}
            {hasCarbsGoal && (
              <MacroRow
                label="碳水"
                current={summary.totalCarbs || 0}
                goal={summary.carbsGoal!}
                unit="g"
                color={barColor(pct(summary.totalCarbs || 0, summary.carbsGoal!), true)}
              />
            )}
            {hasFatGoal && (
              <MacroRow
                label="脂肪"
                current={summary.totalFat || 0}
                goal={summary.fatGoal!}
                unit="g"
                color={barColor(pct(summary.totalFat || 0, summary.fatGoal!), true)}
              />
            )}
          </div>
        )}
      </div>

      {/* 下一步建议 */}
      {tips.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-1.5">
          <span className="text-xs font-bold text-blue-800">💡 下一步建议</span>
          {tips.map((tip, i) => (
            <p key={i} className="text-sm text-blue-700">
              {tips.length > 1 ? `${i + 1}. ` : ''}
              {tip}
            </p>
          ))}
        </div>
      )}

      {/* 下一餐 AI 推荐（消除 "保存→结束" 死胡同） */}
      <PostSaveRecommendation />

      {/* 免费用户：保存后升级引导 — 强调趋势分析&周报价值 */}
      {isFree && (
        <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-violet-500/20 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold">坚持记录，升级查看趋势报告</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Pro 用户可查看周报月报、健康趋势和完整历史
            </p>
          </div>
          <LocalizedLink
            href="/pricing"
            className="text-xs text-primary font-bold shrink-0 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            了解更多
          </LocalizedLink>
        </div>
      )}

      {/* 分析→教练无缝衔接 */}
      {onGoToCoach && (
        <button
          onClick={onGoToCoach}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-card border border-border text-sm font-medium text-foreground hover:bg-muted active:scale-[0.98] transition-all"
        >
          <svg
            className="w-4 h-4 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          咨询 AI 教练：下一餐怎么搭配？
        </button>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 bg-muted text-foreground font-bold py-3 rounded-full active:scale-[0.98] transition-all text-sm"
        >
          继续记录
        </button>
        <button
          onClick={onGoToPlan}
          className="flex-1 bg-card border border-primary/30 text-primary font-bold py-3 rounded-full active:scale-[0.98] transition-all text-sm"
        >
          查看计划
        </button>
        <button
          onClick={onGoHome}
          className="flex-1 bg-primary text-primary-foreground font-bold py-3 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 text-sm"
        >
          返回首页
        </button>
      </div>
    </div>
  );
}
