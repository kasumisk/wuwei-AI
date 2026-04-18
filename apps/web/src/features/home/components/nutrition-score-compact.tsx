'use client';

import { useState } from 'react';
import type { NutritionScoreResult } from '@/types/food';

function ringColor(score: number) {
  if (score >= 80) return 'stroke-green-500';
  if (score >= 60) return 'stroke-yellow-500';
  return 'stroke-red-500';
}
function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

const DIM_LABELS: Record<string, { label: string; icon: string }> = {
  energy: { label: '能量', icon: '⚡' },
  proteinRatio: { label: '蛋白质', icon: '🥩' },
  macroBalance: { label: '宏量素均衡', icon: '⚖️' },
  foodQuality: { label: '食物质量', icon: '🌿' },
  satiety: { label: '饱腹感', icon: '😌' },
  stability: { label: '血糖稳定', icon: '📈' },
  glycemicImpact: { label: '血糖影响', icon: '🩸' },
};

interface NutritionScoreCompactProps {
  scoreData: NutritionScoreResult | null;
}

export function NutritionScoreCompact({ scoreData }: NutritionScoreCompactProps) {
  const [expanded, setExpanded] = useState(false);

  if (!scoreData) return null;

  const { totalScore, breakdown, feedback } = scoreData;
  const score = Math.round(totalScore);

  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <section className="bg-card rounded-2xl p-4 shadow-sm mb-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        {/* Mini ring */}
        <div className="relative w-12 h-12 shrink-0">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
            <circle
              cx="26"
              cy="26"
              r={r}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              className={`${ringColor(score)} transition-all duration-700`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-sm font-extrabold tabular-nums ${scoreColor(score)}`}>
              {score}
            </span>
          </div>
        </div>

        {/* text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold">今日营养评分</span>
            <svg
              className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
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
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{feedback}</p>
        </div>
      </button>

      {/* 展开：六维条形 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(breakdown).map(([key, raw]) => {
            const dim = DIM_LABELS[key];
            if (!dim) return null;
            const v = Math.round(Number(raw) || 0);
            const barCls = v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-yellow-500' : 'bg-red-500';
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="text-xs">{dim.icon}</span>
                <span className="text-[11px] text-muted-foreground w-14 truncate">{dim.label}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barCls} transition-all duration-500`}
                    style={{ width: `${Math.min(v, 100)}%` }}
                  />
                </div>
                <span
                  className={`text-[11px] font-bold w-7 text-right tabular-nums ${v >= 80 ? 'text-green-600' : v >= 60 ? 'text-yellow-600' : 'text-red-500'}`}
                >
                  {v}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
