'use client';

import type { DailySummary } from '@/types/food';
import type { NutritionScoreResult } from '@/types/food';
import type { UserProfile } from '@/types/user';
import { MacroProgressBars } from './macro-progress-bars';

function scoreMeta(score: number) {
  if (score >= 85) return { label: '优秀', color: 'text-emerald-600', ring: 'stroke-emerald-500' };
  if (score >= 70) return { label: '良好', color: 'text-blue-600', ring: 'stroke-blue-500' };
  if (score >= 55) return { label: '一般', color: 'text-amber-600', ring: 'stroke-amber-500' };
  return { label: '需改善', color: 'text-red-500', ring: 'stroke-red-500' };
}

interface HeroBudgetCardProps {
  summary: DailySummary;
  profile: UserProfile | null;
  scoreData?: NutritionScoreResult | null;
}

export function HeroBudgetCard({ summary, profile, scoreData }: HeroBudgetCardProps) {
  const calorieGoal = summary.calorieGoal || 2000;
  const consumed = summary.totalCalories || 0;
  const remaining = Math.max(0, calorieGoal - consumed);
  const pctRaw = calorieGoal > 0 ? (consumed / calorieGoal) * 100 : 0;
  const pct = Math.min(100, Math.max(0, pctRaw));
  const over = pctRaw > 100;

  const score =
    scoreData?.totalScore != null
      ? Math.round(Number(scoreData.totalScore))
      : Math.round(Number(summary.nutritionScore || 0));
  const meta = scoreMeta(score);

  // Ring params
  const r = 18;
  const circ = 2 * Math.PI * r;
  const ringPct = Math.min(score / 100, 1);

  const goalType = profile?.goal || 'health';
  const goalLabel: Record<string, string> = {
    fat_loss: '🔥 减脂',
    muscle_gain: '💪 增肌',
    health: '🧘 健康维持',
    habit: '🌱 改善习惯',
  };

  return (
    <section className="mb-5">
      <div className="bg-card rounded-2xl p-5 shadow-sm">
        {/* Row 1: goal tag + score ring */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold text-muted-foreground tracking-wide">
            {goalLabel[goalType] || '🧘 健康维持'}
          </span>
          {score > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="relative w-9 h-9">
                <svg className="w-9 h-9 -rotate-90" viewBox="0 0 44 44">
                  <circle
                    cx="22"
                    cy="22"
                    r={r}
                    fill="none"
                    strokeWidth="4"
                    className="stroke-muted"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r={r}
                    fill="none"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={circ - ringPct * circ}
                    className={`${meta.ring} transition-all duration-700`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-[10px] font-extrabold tabular-nums ${meta.color}`}>
                    {score}
                  </span>
                </div>
              </div>
              <span className={`text-[11px] font-bold ${meta.color}`}>{meta.label}</span>
            </div>
          )}
        </div>

        {/* Row 2: remaining calorie hero number */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[42px] font-extrabold font-headline tracking-tighter leading-none ${
              over ? 'text-red-500' : 'text-primary'
            }`}
          >
            {remaining.toLocaleString()}
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-muted-foreground">kcal 剩余</span>
            <span className="text-[11px] text-muted-foreground">
              目标 {calorieGoal.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              over ? 'bg-red-500' : pct > 80 ? 'bg-orange-400' : 'bg-primary'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Row 3: consumed + meal count */}
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>
            已摄入 <strong className="text-foreground">{consumed}</strong> kcal
          </span>
          <span>
            记录 <strong className="text-foreground">{summary.mealCount ?? 0}</strong> 餐
          </span>
        </div>

        {/* Macro bars */}
        <div className="mt-4 pt-4 border-t border-border/40">
          <MacroProgressBars summary={summary} goalType={goalType} />
        </div>
      </div>
    </section>
  );
}
