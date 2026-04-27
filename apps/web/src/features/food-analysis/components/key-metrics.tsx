'use client';

import type { AnalysisResult } from '@/types/food';

interface KeyMetricsProps {
  result: AnalysisResult;
}

export function KeyMetrics({ result }: KeyMetricsProps) {
  const metrics = [
    { label: '热量', value: result.totalCalories, unit: 'kcal', color: 'text-orange-500' },
    result.totalProtein != null && {
      label: '蛋白质',
      value: Math.round(result.totalProtein),
      unit: 'g',
      color: 'text-blue-500',
    },
    result.totalFat != null && {
      label: '脂肪',
      value: Math.round(result.totalFat),
      unit: 'g',
      color: 'text-amber-500',
    },
    result.totalCarbs != null && {
      label: '碳水',
      value: Math.round(result.totalCarbs),
      unit: 'g',
      color: 'text-violet-500',
    },
  ].filter(Boolean) as { label: string; value: number; unit: string; color: string }[];

  return (
    <div className="grid grid-cols-4 gap-2">
      {metrics.map((m) => (
        <div key={m.label} className="bg-card rounded-md border border-border p-3 text-center">
          <p className={`text-lg font-extrabold tabular-nums ${m.color}`}>{m.value}</p>
          <p className="text-[11px] text-muted-foreground">
            {m.label}
            <span className="text-[10px] ml-0.5">{m.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
