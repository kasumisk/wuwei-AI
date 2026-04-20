'use client';

import type { DailySummaryRecord } from '@/types/food';

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 按热量达标率返回柱子色阶 */
function barColorByAdherence(cal: number, goal: number, isToday: boolean): string {
  if (isToday) return 'bg-primary';
  if (goal <= 0) return 'bg-primary/30';
  const pct = cal / goal;
  if (pct > 1.1) return 'bg-red-400';
  if (pct > 0.85) return 'bg-emerald-500/70';
  if (pct > 0.5) return 'bg-amber-400/80';
  return 'bg-muted-foreground/20';
}

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
  // 使用有效天数（有摄入记录的天）计算达标率
  const activeDays = sorted.filter((d) => d.totalCalories > 0).length;
  const goalDays = sorted.filter((d) => {
    const g = d.calorieGoal ?? 2000;
    const pct = d.totalCalories / g;
    return pct >= 0.85 && pct <= 1.1;
  }).length;
  const adherenceRate = activeDays > 0 ? Math.round((goalDays / activeDays) * 100) : 0;

  const mid = Math.floor(sorted.length / 2);
  const firstAvg = sorted.slice(0, mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(mid, 1);
  const lastAvg =
    sorted.slice(mid).reduce((s, d) => s + d.totalCalories, 0) / Math.max(sorted.length - mid, 1);
  const trend = lastAvg > firstAvg * 1.05 ? 'up' : lastAvg < firstAvg * 0.95 ? 'down' : 'stable';

  // 图表高度基准：包含柱子区域(48px) + 标签(12px)
  const CHART_H = 48;
  // 用于计算目标线位置：以 maxCals 为基准
  const maxCals = Math.max(...sorted.map((d) => d.totalCalories), 1);
  // 取各天目标的中位值作为"目标线"
  const goals = sorted.map((d) => d.calorieGoal ?? 2000).filter(Boolean);
  const medianGoal = goals.length > 0 ? goals[Math.floor(goals.length / 2)] : 2000;
  // 目标线距底部百分比
  const goalLinePct = Math.min(100, (medianGoal / maxCals) * 100);

  return (
    <section className="mb-5 bg-card rounded-md px-4 pt-4 pb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-muted-foreground">近 {sorted.length} 天趋势</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            日均 <strong className="text-foreground">{avgCals}</strong> kcal
          </span>
          <span
            className={`font-semibold ${
              adherenceRate >= 70
                ? 'text-emerald-600'
                : adherenceRate >= 50
                  ? 'text-amber-600'
                  : 'text-red-500'
            }`}
          >
            达标 {adherenceRate}%
          </span>
          {trend === 'up' && <span className="text-orange-500 font-semibold">↑ 偏高</span>}
          {trend === 'down' && <span className="text-emerald-600 font-semibold">↓ 下降</span>}
          {trend === 'stable' && <span className="text-blue-500 font-semibold">— 稳定</span>}
        </div>
      </div>

      {/* Bar chart with goal line */}
      <div className="relative" style={{ height: `${CHART_H + 14}px` }}>
        {/* Goal line (dashed) */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/30 pointer-events-none"
          style={{ bottom: `${14 + (goalLinePct / 100) * CHART_H}px` }}
        />

        {/* Bars + labels */}
        <div className="absolute inset-0 flex items-end gap-1">
          {sorted.map((day) => {
            const h = maxCals > 0 ? (day.totalCalories / maxCals) * CHART_H : 2;
            const isToday = new Date(day.date).toDateString() === new Date().toDateString();
            const goal = day.calorieGoal ?? 2000;
            const dayLabel = DAY_LABELS[new Date(day.date).getDay()];
            const barColor = barColorByAdherence(day.totalCalories, goal, isToday);

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className={`w-full rounded-sm transition-all duration-500 ${barColor}`}
                  style={{ height: `${Math.max(h, 2)}px` }}
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
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-0.5 border-t border-dashed border-muted-foreground/50 inline-block" />
          目标线
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" />
          达标
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
          超标
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-400/80 inline-block" />
          偏低
        </span>
      </div>
    </section>
  );
}
