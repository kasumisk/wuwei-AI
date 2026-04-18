'use client';

import type { DailySummaryRecord } from '@/types/food';

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

interface WeeklyTrendMiniProps {
  summaries: DailySummaryRecord[];
}

export function WeeklyTrendMini({ summaries }: WeeklyTrendMiniProps) {
  if (!summaries || summaries.length < 2) return null;

  const sorted = [...summaries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const totalCals = sorted.reduce((s, d) => s + d.totalCalories, 0);
  const avgCals = Math.round(totalCals / sorted.length);
  const maxCals = Math.max(...sorted.map((d) => d.totalCalories), 1);

  const mid = Math.floor(sorted.length / 2);
  const firstAvg = sorted.slice(0, mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(mid, 1);
  const lastAvg =
    sorted.slice(mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(sorted.length - mid, 1);
  const trend = lastAvg > firstAvg * 1.05 ? 'up' : lastAvg < firstAvg * 0.95 ? 'down' : 'stable';

  return (
    <section className="mb-5 rounded-[28px] border border-border/60 bg-card/90 px-4 pt-4 pb-3 shadow-sm backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-muted-foreground">近 {sorted.length} 天趋势</span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            日均 <strong className="text-foreground">{avgCals}</strong> kcal
          </span>
          {trend === 'up' && <span className="text-orange-500 font-semibold">↑ 偏高</span>}
          {trend === 'down' && <span className="text-green-600 font-semibold">↓ 下降</span>}
          {trend === 'stable' && <span className="text-blue-500 font-semibold">— 稳定</span>}
        </div>
      </div>

      {/* Mini bar chart — 40px tall */}
      <div className="flex items-end gap-1 h-10">
        {sorted.map((day) => {
          const h = maxCals > 0 ? (day.totalCalories / maxCals) * 100 : 4;
          const isToday = new Date(day.date).toDateString() === new Date().toDateString();
          const goal = day.calorieGoal ?? 2000;
          const over = day.totalCalories > goal;
          const dayLabel = DAY_LABELS[new Date(day.date).getDay()];

          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-t transition-all duration-300 ${
                  isToday ? 'bg-primary' : over ? 'bg-orange-400' : 'bg-primary/30'
                }`}
                style={{ height: `${Math.max(h, 4)}%`, minHeight: '3px' }}
                title={`${day.totalCalories} kcal`}
              />
              <span
                className={`text-[9px] leading-none ${
                  isToday ? 'text-primary font-bold' : 'text-muted-foreground'
                }`}
              >
                {isToday ? '今' : dayLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
