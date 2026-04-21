'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { MealRecordCard } from '@/features/home/components/meal-record-card';
import { LocalizedLink } from '@/components/common/localized-link';
import type { FoodRecord } from '@/types/food';

type RangeType = '7d' | '30d';

const RANGE_LABELS: Record<RangeType, string> = {
  '7d': '最近 7 天',
  '30d': '最近 30 天',
};

const MEAL_ORDER: FoodRecord['mealType'][] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_META: Record<FoodRecord['mealType'], { label: string; icon: string }> = {
  breakfast: { label: '早餐', icon: '🌅' },
  lunch: { label: '午餐', icon: '☀️' },
  dinner: { label: '晚餐', icon: '🌙' },
  snack: { label: '加餐', icon: '🍎' },
};

function formatDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function RecordsPage() {
  const router = useRouter();
  const [range, setRange] = useState<RangeType>('7d');

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const end = toDateStr(now);
    const days = range === '7d' ? 6 : 29;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return { startDate: toDateStr(start), endDate: end };
  }, [range]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['records-history', startDate, endDate],
    queryFn: () => foodRecordService.queryRecords({ startDate, endDate, limit: 100 }),
  });

  const items = data?.items ?? [];
  const totalCount = data?.total ?? items.length;
  const isTruncated = items.length < totalCount;
  const summary = data?.summary;

  // 按日期分组，每天内按餐次分组
  const dayGroups = useMemo(() => {
    const map = new Map<string, FoodRecord[]>();
    for (const item of items) {
      const key = (item.recordedAt || item.createdAt).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    // 按日期降序
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, records]) => ({
        dateKey,
        dateLabel: formatDateKey(dateKey),
        dayCal: records.reduce((s, r) => s + r.totalCalories, 0),
        mealGroups: MEAL_ORDER.map((type) => ({
          type,
          meta: MEAL_META[type],
          items: records.filter((r) => r.mealType === type),
        })).filter((g) => g.items.length > 0),
      }));
  }, [items]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-4 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button
              onClick={() => router.back()}
              className="mr-4 text-foreground/70 hover:text-foreground"
              aria-label="返回"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">记录历史</h1>
          </div>
          <span className="text-xs text-muted-foreground">
            {totalCount > 0
              ? isTruncated
                ? `显示 ${items.length} / 共 ${totalCount} 条`
                : `共 ${totalCount} 条`
              : ''}
          </span>
        </div>
      </nav>

      <main className="px-4 py-4 max-w-lg mx-auto pb-32">
        {/* Range Tabs */}
        <div className="flex gap-2 mb-5">
          {(Object.entries(RANGE_LABELS) as [RangeType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-4 py-2 text-sm font-bold transition-all ${
                range === key
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Summary Bar */}
        {summary && items.length > 0 && (
          <div className="bg-card rounded-md p-3 mb-5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <span>
                总热量 <strong className="text-foreground text-sm">{summary.totalCalories}</strong>{' '}
                kcal
              </span>
              <span>
                蛋白{' '}
                <strong className="text-foreground">{Math.round(summary.totalProtein)}g</strong>
              </span>
              <span>
                脂肪 <strong className="text-foreground">{Math.round(summary.totalFat)}g</strong>
              </span>
              <span>
                碳水 <strong className="text-foreground">{Math.round(summary.totalCarbs)}g</strong>
              </span>
            </div>
            <span className="text-muted-foreground">{summary.mealCount} 餐</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card rounded-md p-4 space-y-3 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="w-20 h-5 bg-muted rounded" />
                  <div className="w-16 h-4 bg-muted rounded" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 bg-muted rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 bg-muted flex items-center justify-center rounded-md">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="28"
                height="28"
                className="text-muted-foreground"
              >
                <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">暂无饮食记录</p>
              <p className="text-xs text-muted-foreground mt-1">
                去分析页拍照或输入文字，记录你的饮食
              </p>
            </div>
            <LocalizedLink
              href="/analyze"
              className="mt-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-bold active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
              asButton
            >
              开始记录
            </LocalizedLink>
          </div>
        )}

        {/* Day Groups */}
        {!isLoading && dayGroups.length > 0 && (
          <div className="space-y-6">
            {dayGroups.map((day) => (
              <div key={day.dateKey}>
                {/* Day header */}
                <div className="flex items-center justify-between mb-3 px-0.5">
                  <span className="text-sm font-bold">{day.dateLabel}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <strong className="text-foreground">{day.dayCal}</strong> kcal
                  </span>
                </div>
                {/* Meal groups within day */}
                <div className="space-y-4">
                  {day.mealGroups.map((group) => (
                    <div key={group.type}>
                      <div className="flex items-center justify-between mb-2 px-0.5">
                        <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                          <span>{group.meta.icon}</span>
                          <span>{group.meta.label}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          <strong className="text-foreground">
                            {group.items.reduce((s, m) => s + m.totalCalories, 0)}
                          </strong>{' '}
                          kcal
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        {group.items.map((meal) => (
                          <MealRecordCard key={meal.id} meal={meal} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fetching indicator */}
        {isFetching && !isLoading && (
          <div className="flex justify-center mt-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </main>
    </div>
  );
}
