'use client';

import { LocalizedLink } from '@/components/common/localized-link';
import { MealRecordCard } from './meal-record-card';
import type { FoodRecord } from '@/types/food';

interface TodayMealListProps {
  meals: FoodRecord[];
  /** 默认展示行数，超出折叠，0 = 展示全部 */
  defaultVisible?: number;
}

export function TodayMealList({ meals, defaultVisible = 3 }: TodayMealListProps) {
  const showAll = defaultVisible === 0 || meals.length <= defaultVisible;
  const visible = showAll ? meals : meals.slice(0, defaultVisible);
  const hidden = showAll ? 0 : meals.length - defaultVisible;

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
        /* 空状态占位 */
        <div className="rounded-2xl border-2 border-dashed border-border/50 py-10 text-center space-y-1.5">
          <p className="text-2xl">🍽️</p>
          <p className="text-sm font-medium text-muted-foreground">今天还没有饮食记录</p>
          <p className="text-xs text-muted-foreground/70">拍照或输入文字描述开始记录吧</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((meal) => (
            <MealRecordCard key={meal.id} meal={meal} />
          ))}
          {hidden > 0 && (
            <LocalizedLink
              href="/history"
              className="block w-full text-center py-2.5 rounded-xl bg-muted text-xs font-bold text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              还有 {hidden} 条记录 →
            </LocalizedLink>
          )}
        </div>
      )}
    </section>
  );
}
