'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { foodPlanService } from '@/lib/api/food-plan';
import type {
  WeeklyPlanData,
  DailyPlanSummary,
  MealPlanDetailed,
  MealFoodItem,
  SubstituteItem,
} from '@/types/food';

/* ─── 日期工具 ─── */

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function formatDate(dateStr: string): { dayNum: string; weekday: string; isToday: boolean } {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return {
    dayNum: String(d.getDate()),
    weekday: WEEKDAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1],
    isToday,
  };
}

/* ─── 宏量素条 ─── */

function MacroBar({ protein, fat, carbs }: { protein: number; fat: number; carbs: number }) {
  const total = protein + fat + carbs;
  if (total === 0) return null;
  const pPct = Math.round((protein / total) * 100);
  const fPct = Math.round((fat / total) * 100);
  const cPct = 100 - pPct - fPct;

  return (
    <div className="mt-2">
      <div className="flex h-1.5  overflow-hidden">
        <div className="bg-blue-400" style={{ width: `${pPct}%` }} />
        <div className="bg-yellow-400" style={{ width: `${fPct}%` }} />
        <div className="bg-green-400" style={{ width: `${cPct}%` }} />
      </div>
      <div className="flex justify-between mt-1 text-[9px]">
        <span className="text-blue-600">蛋白{protein}g</span>
        <span className="text-yellow-600">脂肪{fat}g</span>
        <span className="text-green-600">碳水{carbs}g</span>
      </div>
    </div>
  );
}

/* ─── 食物替代弹窗 ─── */

function SubstitutePanel({
  foodItem,
  mealType,
  onClose,
}: {
  foodItem: MealFoodItem;
  mealType: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery<SubstituteItem[]>({
    queryKey: ['substitutes', foodItem.foodId, mealType],
    queryFn: () => foodPlanService.getSubstitutes(foodItem.foodId, mealType),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="mt-2 bg-primary/5  p-3 space-y-2 border border-primary/10 animate-in slide-in-from-top-1 duration-200">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-primary">「{foodItem.name}」的替代推荐</p>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground p-0.5"
        >
          收起
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent  animate-spin" />
          <span className="text-xs text-muted-foreground">搜索替代中...</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 py-1">
          {error instanceof Error ? error.message : '加载失败'}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">暂无替代建议</p>
      )}

      {data && data.length > 0 && (
        <div className="space-y-1.5">
          {data.slice(0, 5).map((sub) => (
            <div
              key={sub.foodId}
              className="flex items-center justify-between bg-card rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{sub.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {sub.servingDesc} · {sub.servingCalories} kcal
                </p>
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">匹配</span>
                  <span className="text-xs font-bold text-primary">
                    {Math.round(sub.substituteScore * 100)}%
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  P{sub.servingProtein}g F{sub.servingFat}g C{sub.servingCarbs}g
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 单个食物条目（可展开替代） ─── */

function FoodItemRow({ food, mealType }: { food: MealFoodItem; mealType: string }) {
  const [showSubs, setShowSubs] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between py-1.5">
        <div className="flex-1 min-w-0">
          <span className="text-[11px]">{food.name}</span>
          <span className="text-[9px] text-muted-foreground ml-1">{food.servingDesc}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-primary font-bold">{food.calories}kcal</span>
          <button
            onClick={() => setShowSubs((v) => !v)}
            className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-all active:scale-[0.95] ${
              showSubs
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            换
          </button>
        </div>
      </div>
      {showSubs && (
        <SubstitutePanel foodItem={food} mealType={mealType} onClose={() => setShowSubs(false)} />
      )}
    </div>
  );
}

/* ─── 单天详情面板 ─── */

const MEAL_KEYS = [
  { key: 'morning' as const, label: '早餐', emoji: '🌅', mealType: 'breakfast' },
  { key: 'lunch' as const, label: '午餐', emoji: '☀️', mealType: 'lunch' },
  { key: 'dinner' as const, label: '晚餐', emoji: '🌙', mealType: 'dinner' },
  { key: 'snack' as const, label: '加餐', emoji: '🍪', mealType: 'snack' },
];

function DayDetail({ day }: { day: DailyPlanSummary }) {
  return (
    <div className="space-y-2">
      {MEAL_KEYS.map(({ key, label, emoji, mealType }) => {
        const meal = day.meals[key] as MealPlanDetailed | null;
        if (!meal) return null;
        const hasFoodItems = meal.foodItems && meal.foodItems.length > 0;

        return (
          <div key={key} className="bg-card  p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-muted-foreground">
                  {emoji} {label}
                </span>
                {/* 如果有结构化食物列表，逐个展示（可换）；否则展示 foods 文本 */}
                {hasFoodItems ? (
                  <div className="mt-1 divide-y divide-border/30">
                    {meal.foodItems!.map((food) => (
                      <FoodItemRow key={food.foodId} food={food} mealType={mealType} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs mt-1 line-clamp-2">{meal.foods}</p>
                )}
                <span className="text-[10px] text-primary font-bold">{meal.calories} kcal</span>
              </div>
            </div>
            {meal.tip && (
              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">💡 {meal.tip}</p>
            )}
            {!hasFoodItems && <MacroBar protein={meal.protein} fat={meal.fat} carbs={meal.carbs} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── 主组件 ─── */

interface WeeklyPlanCardProps {
  weeklyPlan: WeeklyPlanData;
}

export function WeeklyPlanCard({ weeklyPlan }: WeeklyPlanCardProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(() => {
    // 默认选中今天
    const todayIdx = weeklyPlan.plans.findIndex((p) => formatDate(p.date).isToday);
    return todayIdx >= 0 ? todayIdx : 0;
  });

  const selectedDay = weeklyPlan.plans[selectedIdx];
  const { weeklyNutrition } = weeklyPlan;

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low  p-5">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">📆</span>
            <h3 className="font-bold text-sm">本周计划</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            日均 {Math.round(weeklyNutrition.avgCalories)} kcal
          </span>
        </div>

        {/* 日期选择条 */}
        <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-none -mx-1 px-1">
          {weeklyPlan.plans.map((plan, idx) => {
            const { dayNum, weekday, isToday } = formatDate(plan.date);
            const isSelected = idx === selectedIdx;
            return (
              <button
                key={plan.date}
                onClick={() => setSelectedIdx(idx)}
                className={`flex flex-col items-center min-w-[2.75rem] py-2 px-1.5  transition-all duration-200
                  ${
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : isToday
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted'
                  }`}
              >
                <span className="text-[10px] font-medium">{weekday}</span>
                <span className="text-sm font-bold">{dayNum}</span>
                <span className="text-[9px] mt-0.5">{plan.totalCalories}cal</span>
              </button>
            );
          })}
        </div>

        {/* 选中日期的详情 */}
        {selectedDay && <DayDetail day={selectedDay} />}

        {/* 周统计摘要 */}
        <div className="mt-4 pt-3 border-t border-border/30">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground">日均蛋白</p>
              <p className="text-xs font-bold">{Math.round(weeklyNutrition.avgProtein)}g</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">日均脂肪</p>
              <p className="text-xs font-bold">{Math.round(weeklyNutrition.avgFat)}g</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">日均碳水</p>
              <p className="text-xs font-bold">{Math.round(weeklyNutrition.avgCarbs)}g</p>
            </div>
          </div>
          {weeklyNutrition.uniqueFoodCount > 0 && (
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              本周包含 {weeklyNutrition.uniqueFoodCount} 种不同食物
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
