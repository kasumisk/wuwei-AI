'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { DailySummaryRecord } from '@/types/food';

interface WeeklyTrendCardProps {
  summaries: DailySummaryRecord[];
}

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return DAY_LABELS[d.getDay()];
}

export function WeeklyTrendCard({ summaries }: WeeklyTrendCardProps) {
  const [activeBar, setActiveBar] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // 点击图表外部时关闭 tooltip
  const handleClickOutside = useCallback((e: MouseEvent | TouchEvent) => {
    if (chartRef.current && !chartRef.current.contains(e.target as Node)) {
      setActiveBar(null);
    }
  }, []);

  useEffect(() => {
    if (activeBar) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
      };
    }
  }, [activeBar, handleClickOutside]);

  // 不够数据不展示
  if (!summaries || summaries.length < 2) return null;

  // 按日期排序（升序）
  const sorted = [...summaries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 计算统计
  const totalCals = sorted.reduce((s, d) => s + d.totalCalories, 0);
  const avgCals = Math.round(totalCals / sorted.length);
  const maxCals = Math.max(...sorted.map((d) => d.totalCalories));
  const totalMeals = sorted.reduce((s, d) => s + d.mealCount, 0);

  // 计算趋势方向（前半 vs 后半）
  const mid = Math.floor(sorted.length / 2);
  const firstHalfAvg =
    sorted.slice(0, mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(mid, 1);
  const secondHalfAvg =
    sorted.slice(mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(sorted.length - mid, 1);
  const trendUp = secondHalfAvg > firstHalfAvg * 1.05;
  const trendDown = secondHalfAvg < firstHalfAvg * 0.95;

  // 柱状图的最大高度基准
  const chartMax = maxCals > 0 ? maxCals : 2000;

  return (
    <section className="bg-card rounded-2xl p-4 mb-6 border border-(--color-outline-variant)/10">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5">近 {sorted.length} 天趋势</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            日均 <strong className="text-foreground">{avgCals}</strong> kcal
          </span>
          {trendUp && (
            <span className="text-orange-500 font-medium flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              偏高
            </span>
          )}
          {trendDown && (
            <span className="text-green-500 font-medium flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              下降
            </span>
          )}
          {!trendUp && !trendDown && <span className="text-blue-500 font-medium">稳定</span>}
        </div>
      </div>

      {/* 简易柱状图 */}
      <div ref={chartRef} className="flex items-end gap-1.5 h-20 mb-2">
        {sorted.map((day) => {
          const heightPercent = chartMax > 0 ? (day.totalCalories / chartMax) * 100 : 0;
          const isToday = new Date(day.date).toDateString() === new Date().toDateString();
          const goal = day.calorieGoal ?? 2000;
          const overBudget = day.totalCalories > goal;
          const isActive = activeBar === day.date;

          const toggleBar = () => {
            setActiveBar(isActive ? null : day.date);
          };

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center gap-1 group relative cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${getDayLabel(day.date)}，${day.totalCalories} 千卡${overBudget ? '，超出目标' : ''}`}
              onClick={toggleBar}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleBar();
                }
              }}
            >
              {/* Tooltip: 点击/触摸时固定显示，桌面端也保留 hover */}
              <div
                className={`absolute -top-8 left-1/2 -translate-x-1/2 transition-opacity bg-foreground text-background text-[10px] px-2 py-0.5 rounded-md whitespace-nowrap pointer-events-none z-10 ${
                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {day.totalCalories} kcal
              </div>
              <div
                className={`w-full rounded-t-md transition-all duration-300 ${
                  isToday ? 'bg-primary' : overBudget ? 'bg-orange-400' : 'bg-primary/30'
                } ${isActive ? 'ring-2 ring-primary/50' : ''}`}
                style={{
                  height: `${Math.max(heightPercent, 4)}%`,
                  minHeight: '3px',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* 日期标签 */}
      <div className="flex gap-1.5">
        {sorted.map((day) => {
          const isToday = new Date(day.date).toDateString() === new Date().toDateString();
          return (
            <div
              key={`label-${day.date}`}
              className={`flex-1 text-center text-[10px] ${
                isToday ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
            >
              {isToday ? '今' : getDayLabel(day.date)}
            </div>
          );
        })}
      </div>

      {/* 底部统计 */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
        <span>共 {totalMeals} 餐</span>
        <span>累计 {totalCals.toLocaleString()} kcal</span>
      </div>
    </section>
  );
}
