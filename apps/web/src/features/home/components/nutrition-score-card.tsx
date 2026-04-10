'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import type { NutritionScoreResult } from '@/types/food';

const DIMENSION_LABELS: Record<string, { label: string; icon: string }> = {
  energy: { label: '能量', icon: '⚡' },
  proteinRatio: { label: '蛋白质', icon: '🥩' },
  macroBalance: { label: '宏量素均衡', icon: '⚖️' },
  foodQuality: { label: '食物质量', icon: '🌿' },
  satiety: { label: '饱腹感', icon: '😌' },
  stability: { label: '血糖稳定', icon: '📈' },
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function barColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function ringColor(score: number): string {
  if (score >= 80) return 'stroke-green-500';
  if (score >= 60) return 'stroke-yellow-500';
  return 'stroke-red-500';
}

export function NutritionScoreCard() {
  const [expanded, setExpanded] = useState(false);

  const { data: scoreData, isLoading } = useQuery<NutritionScoreResult>({
    queryKey: ['nutrition-score'],
    queryFn: () => foodRecordService.getNutritionScore(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="bg-card rounded-2xl p-5 shadow-sm mb-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </div>
        </div>
      </section>
    );
  }

  if (!scoreData) return null;

  const { totalScore, breakdown, highlights, feedback, goals, intake } = scoreData;

  // 环形进度参数
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const progress = (totalScore / 100) * circumference;

  const macros = [
    { label: '热量', intake: intake.calories, goal: goals.calories, unit: 'kcal' },
    { label: '蛋白质', intake: intake.protein, goal: goals.protein, unit: 'g' },
    { label: '脂肪', intake: intake.fat, goal: goals.fat, unit: 'g' },
    { label: '碳水', intake: intake.carbs, goal: goals.carbs, unit: 'g' },
  ];

  return (
    <section className="bg-card rounded-2xl p-5 shadow-sm mb-6">
      {/* 头部：总分 + 反馈 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 text-left"
      >
        {/* 环形分数 */}
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="5"
              className="stroke-muted"
            />
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              className={`${ringColor(totalScore)} transition-all duration-700`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-extrabold ${scoreColor(totalScore)}`}>{totalScore}</span>
          </div>
        </div>

        {/* 文字 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">今日营养评分</h3>
            <svg
              className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{feedback}</p>
        </div>
      </button>

      {/* 高亮标签 */}
      {highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {highlights.map((h, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary"
            >
              {h}
            </span>
          ))}
        </div>
      )}

      {/* 展开详情 */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          {/* 六维评分 */}
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">六维评分</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {Object.entries(breakdown).map(([key, value]) => {
                const dim = DIMENSION_LABELS[key];
                if (!dim) return null;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs w-4 text-center">{dim.icon}</span>
                    <span className="text-[11px] text-muted-foreground w-16 truncate">
                      {dim.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor(value)}`}
                        style={{ width: `${Math.min(value, 100)}%` }}
                      />
                    </div>
                    <span className={`text-[11px] font-bold w-6 text-right ${scoreColor(value)}`}>
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 目标 vs 实际摄入 */}
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">目标 vs 实际</h4>
            <div className="space-y-2">
              {macros.map((m) => {
                const pct = m.goal > 0 ? Math.round((m.intake / m.goal) * 100) : 0;
                const over = pct > 110;
                const under = pct < 50;
                return (
                  <div key={m.label}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span
                        className={`font-medium ${over ? 'text-red-500' : under ? 'text-yellow-500' : 'text-foreground'}`}
                      >
                        {Math.round(m.intake)} / {Math.round(m.goal)} {m.unit}
                        <span className="text-muted-foreground ml-1">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          over ? 'bg-red-500' : under ? 'bg-yellow-500' : 'bg-primary'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
