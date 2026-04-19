'use client';

import { useState } from 'react';
import { LocalizedLink } from '@/components/common/localized-link';
import { MealRecordCard } from './meal-record-card';
import type { FoodRecord } from '@/types/food';

const MEAL_ORDER: FoodRecord['mealType'][] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_META: Record<FoodRecord['mealType'], { label: string; icon: string }> = {
  breakfast: { label: '早餐', icon: '🌅' },
  lunch: { label: '午餐', icon: '☀️' },
  dinner: { label: '晚餐', icon: '🌙' },
  snack: { label: '加餐', icon: '🍎' },
};

interface TodayMealListProps {
  meals: FoodRecord[];
  /** 默认展示行数，0 = 展示全部 */
  defaultVisible?: number;
}

export function TodayMealList({ meals, defaultVisible = 3 }: TodayMealListProps) {
  const [showAll, setShowAll] = useState(false);

  // 按餐次分组
  const groups = MEAL_ORDER.map((type) => ({
    type,
    meta: MEAL_META[type],
    items: meals.filter((m) => m.mealType === type),
  })).filter((g) => g.items.length > 0);

  // 扁平化以支持 defaultVisible 截断
  const allItems = groups.flatMap((g) => g.items);
  const visibleCount = showAll || defaultVisible === 0 ? allItems.length : defaultVisible;
  const hiddenCount = Math.max(0, allItems.length - visibleCount);

  // 重建可见分组
  let remaining = visibleCount;
  const visibleGroups = groups
    .map((g) => {
      const take = Math.min(g.items.length, remaining);
      remaining -= take;
      return { ...g, items: g.items.slice(0, take) };
    })
    .filter((g) => g.items.length > 0);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-base font-headline font-bold">今日记录</h3>
        <LocalizedLink
          href="/history"
          className="text-xs text-primary font-medium flex items-center gap-0.5 hover:opacity-80"
        >
          全部历史
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </LocalizedLink>
      </div>

      {meals.length === 0 ? (
        <div className=" border-2 border-dashed border-border/50 py-10 text-center space-y-1.5">
          <p className="text-2xl">🍽️</p>
          <p className="text-sm font-medium text-muted-foreground">今天还没有饮食记录</p>
          <p className="text-xs text-muted-foreground/70">拍照或输入文字描述开始记录吧</p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleGroups.map((group) => {
            const groupCal = group.items.reduce((s, m) => s + m.totalCalories, 0);
            return (
              <div key={group.type}>
                {/* 餐次标题行 */}
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                    <span>{group.meta.icon}</span>
                    <span>{group.meta.label}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    <strong className="text-foreground">{groupCal}</strong> kcal
                  </span>
                </div>
                <div className="space-y-2.5">
                  {group.items.map((meal) => (
                    <MealRecordCard key={meal.id} meal={meal} />
                  ))}
                </div>
              </div>
            );
          })}

          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="block w-full text-center py-2.5  bg-muted text-xs font-bold text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              还有 {hiddenCount} 条记录，点击展开
            </button>
          )}
        </div>
      )}
    </section>
  );
}
