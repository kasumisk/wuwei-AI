'use client';

import { useQuery } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { MEAL_LABELS } from '@/lib/constants/food';
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
  onReset: () => void;
  onGoHome: () => void;
  onGoToPlan: () => void;
}

export function SavedImpact({ mealType, onReset, onGoHome, onGoToPlan }: SavedImpactProps) {
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
