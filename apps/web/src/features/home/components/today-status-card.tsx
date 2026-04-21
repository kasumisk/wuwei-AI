'use client';

import { useState } from 'react';
import type { DailySummary, NutritionScoreResult, NutritionScoreBreakdown } from '@/types/food';
import type { UserProfile } from '@/types/user';

/* ── helpers ── */

function scoreMeta(score: number) {
  if (score >= 85)
    return {
      label: '优秀',
      color: 'text-emerald-600',
      ring: 'stroke-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    };
  if (score >= 70)
    return {
      label: '良好',
      color: 'text-blue-600',
      ring: 'stroke-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
    };
  if (score >= 55)
    return {
      label: '一般',
      color: 'text-amber-600',
      ring: 'stroke-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
    };
  return {
    label: '需改善',
    color: 'text-red-500',
    ring: 'stroke-red-500',
    bg: 'bg-red-50 dark:bg-red-950/30',
  };
}

function dimLabel(key: string): { label: string; icon: string } | null {
  const map: Record<string, { label: string; icon: string }> = {
    energy: { label: '能量', icon: '⚡' },
    proteinRatio: { label: '蛋白质', icon: '🥩' },
    macroBalance: { label: '均衡度', icon: '⚖️' },
    foodQuality: { label: '食物质量', icon: '🌿' },
    satiety: { label: '饱腹感', icon: '😌' },
    stability: { label: '血糖稳定', icon: '📈' },
    glycemicImpact: { label: '血糖影响', icon: '🩸' },
    mealQuality: { label: '餐次质量', icon: '🍽️' },
  };
  return map[key] ?? null;
}

function slotColor(status: string | undefined): string {
  if (status === 'deficit') return 'bg-amber-400';
  if (status === 'excess' || status === 'surplus') return 'bg-red-500';
  return 'bg-primary';
}

const GOAL_LABELS: Record<string, string> = {
  fat_loss: '🔥 减脂',
  muscle_gain: '💪 增肌',
  health: '🧘 健康维持',
  habit: '🌱 改善习惯',
};

/* ── component ── */

interface TodayStatusCardProps {
  summary: DailySummary | undefined;
  profile: UserProfile | null;
  scoreData?: NutritionScoreResult | null;
}

export function TodayStatusCard({ summary, profile, scoreData }: TodayStatusCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!summary) return null;

  const goalType = profile?.goal || 'health';
  const score =
    scoreData?.totalScore != null
      ? Math.round(Number(scoreData.totalScore))
      : Math.round(Number(summary.nutritionScore || 0));
  const meta = scoreMeta(score);

  /* calorie budget */
  const calorieGoal = scoreData?.goals?.calories || summary.calorieGoal || 2000;
  const consumed = scoreData?.intake?.calories ?? summary.totalCalories ?? 0;
  const remaining = Math.max(0, calorieGoal - consumed);
  const pctRaw = calorieGoal > 0 ? (consumed / calorieGoal) * 100 : 0;
  const pct = Math.min(100, Math.max(0, pctRaw));
  const over = pctRaw > 100;

  /* daily progress */
  const dp = scoreData?.dailyProgress;

  /* score ring */
  const r = 24;
  const circ = 2 * Math.PI * r;
  const ringPct = Math.min(score / 100, 1);

  /* macros from scoreData or summary */
  const macros = buildMacroList(summary, scoreData, goalType);

  /* behavior bonus */
  const streak = scoreData?.behaviorBonus?.streakDays;

  /* issue highlights (top 2) */
  const issues = (scoreData?.issueHighlights ?? []).slice(0, 2);

  /* status explanation segments */
  const segments = scoreData?.statusExplanation?.segments ?? [];

  return (
    <section className="mb-5">
      <div className="bg-card rounded-md overflow-hidden">
        {/* ─── Header: goal + streak + score ring ─── */}
        <div className="px-5 pt-5 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-muted-foreground tracking-wide">
              {GOAL_LABELS[goalType] || '🧘 健康维持'}
            </span>
            {streak != null && streak > 0 && (
              <span className="text-[10px] font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-md">
                🔥 {streak}天连续
              </span>
            )}
          </div>
          {score > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="relative w-12 h-12">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 56 56">
                  <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="4"
                    className="stroke-muted"
                  />
                  <circle
                    cx="28"
                    cy="28"
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
                  <span className={`text-sm font-extrabold tabular-nums ${meta.color}`}>
                    {score}
                  </span>
                </div>
              </div>
              <span className={`text-[11px] font-bold ${meta.color}`}>{meta.label}</span>
            </div>
          )}
        </div>

        {/* ─── Hero: remaining calories ─── */}
        <div className="px-5 pt-3">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-[42px] font-extrabold font-headline tracking-tighter leading-none ${over ? 'text-red-500' : 'text-primary'}`}
            >
              {remaining.toLocaleString('zh-CN')}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-muted-foreground">kcal 剩余</span>
              <span className="text-[11px] text-muted-foreground">
                目标 {Math.round(calorieGoal).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Calorie progress bar */}
          <div className="mt-3 h-2 w-full bg-muted  overflow-hidden">
            <div
              className={`h-full  transition-all duration-500 ${over ? 'bg-red-500' : pct > 80 ? 'bg-orange-400' : 'bg-primary'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Sub stats row: consumed + meals + daily progress */}
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>
              已摄入 <strong className="text-foreground">{Math.round(consumed)}</strong> kcal
            </span>
            <div className="flex items-center gap-3">
              <span>
                记录 <strong className="text-foreground">{summary.mealCount ?? 0}</strong> 餐
              </span>
              {dp?.isOnTrack != null && (
                <span className={dp.isOnTrack ? 'text-emerald-600' : 'text-amber-600'}>
                  {dp.isOnTrack ? '✓ 进度正常' : '⚠ 进度偏离'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ─── Goal-specific key metric highlight ─── */}
        <div className="px-5 mt-4 pt-4 border-t border-border/40">
          {(() => {
            const insight = buildGoalInsight(summary, scoreData, goalType);
            if (!insight) return null;
            return (
              <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-[11px] font-medium ${insight.cls}`}>
                <span>{insight.icon}</span>
                <span>{insight.text}</span>
              </div>
            );
          })()}
          <div className="space-y-2.5">
            {macros.map((m) => {
              const mPct = m.goal > 0 ? Math.min(100, Math.round((m.val / m.goal) * 100)) : 0;
              const color = slotColor(m.slotStatus);
              return (
                <div key={m.key} className="flex items-center gap-2">
                  <div className="flex items-center gap-1 w-16 shrink-0">
                    <span className="text-xs font-medium text-foreground">{m.label}</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted  overflow-hidden">
                      <div
                        className={`h-full  transition-all duration-500 ${color}`}
                        style={{ width: `${mPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {Math.round(m.val)}
                      <span className="text-muted-foreground/60">
                        /{Math.round(m.goal)}
                        {m.unit}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Status insights: segments + issues ─── */}
        {(segments.length > 0 || issues.length > 0) && (
          <div className="px-5 mt-4 pt-3 border-t border-border/40 space-y-2">
            {/* Explanation segments as inline tags */}
            {segments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {segments.map((seg, i) => {
                  const tone = seg.tone;
                  const cls =
                    tone === 'positive'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      : tone === 'negative'
                        ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                        : 'bg-muted text-muted-foreground';
                  return (
                    <span key={i} className={`text-[11px] font-medium px-2 py-1 rounded-md ${cls}`}>
                      {seg.label && <span className="font-bold">{seg.label}: </span>}
                      {seg.value}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Issue highlights */}
            {issues.map((issue, i) => (
              <div
                key={i}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg ${
                  issue.severity === 'high'
                    ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                }`}
              >
                {issue.severity === 'high' ? '⚠️' : '💡'} {issue.message}
              </div>
            ))}
          </div>
        )}

        {/* ─── Strength / Weakness chips ─── */}
        {(scoreData?.topStrength || scoreData?.topWeakness) && (
          <div className="px-5 mt-3 flex items-center gap-2 flex-wrap">
            {scoreData?.topStrength?.dimension && (
              <span className="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">
                ✦ 最强:{' '}
                {dimLabel(scoreData.topStrength.dimension)?.label ??
                  scoreData.topStrength.dimension}
                {scoreData.topStrength.score != null &&
                  ` ${Math.round(scoreData.topStrength.score)}`}
              </span>
            )}
            {scoreData?.topWeakness?.dimension && (
              <span className="text-[10px] font-bold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md">
                ▼ 最弱:{' '}
                {dimLabel(scoreData.topWeakness.dimension)?.label ??
                  scoreData.topWeakness.dimension}
                {scoreData.topWeakness.score != null &&
                  ` ${Math.round(scoreData.topWeakness.score)}`}
              </span>
            )}
          </div>
        )}

        {/* ─── Expandable: 8-dimension breakdown ─── */}
        <div className="px-5 mt-3 pb-1">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={expanded}
          >
            <span>{expanded ? '收起详情' : '查看评分详情'}</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
          </button>
        </div>

        {expanded && scoreData?.breakdown && (
          <div className="px-5 pb-5 pt-1 border-t border-border/40">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {Object.entries(scoreData.breakdown).map(([key, raw]) => {
                const dim = dimLabel(key);
                if (!dim) return null;
                const v = Math.round(Number(raw) || 0);
                const barCls = v >= 80 ? 'bg-emerald-500' : v >= 60 ? 'bg-amber-400' : 'bg-red-500';
                const textCls =
                  v >= 80 ? 'text-emerald-600' : v >= 60 ? 'text-amber-600' : 'text-red-500';
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className="text-xs">{dim.icon}</span>
                    <span className="text-[11px] text-muted-foreground w-14 truncate">
                      {dim.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted  overflow-hidden">
                      <div
                        className={`h-full  ${barCls} transition-all duration-500`}
                        style={{ width: `${Math.min(v, 100)}%` }}
                      />
                    </div>
                    <span
                      className={`text-[11px] font-bold w-7 text-right tabular-nums ${textCls}`}
                    >
                      {v}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Feedback text */}
            {scoreData.feedback && (
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                {scoreData.feedback}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── goal insight builder ── */

interface GoalInsight {
  icon: string;
  text: string;
  cls: string;
}

function buildGoalInsight(
  summary: DailySummary,
  scoreData: NutritionScoreResult | null | undefined,
  goalType: string
): GoalInsight | null {
  const intake = scoreData?.intake;
  const goals = scoreData?.goals;
  const slots = scoreData?.macroSlotStatus;
  const compliance = scoreData?.complianceInsight;
  const mealSignals = scoreData?.mealSignals;

  if (goalType === 'fat_loss') {
    // Key: calorie deficit adherence
    const cal = intake?.calories ?? summary.totalCalories ?? 0;
    const calGoal = goals?.calories ?? summary.calorieGoal ?? 2000;
    const deficit = calGoal - cal;
    if (deficit > 0) {
      return {
        icon: '🎯',
        text: `热量缺口 ${Math.round(deficit)} kcal，减脂进度正常`,
        cls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400',
      };
    }
    return {
      icon: '⚠️',
      text: `已超出目标 ${Math.round(-deficit)} kcal，注意控制下一餐`,
      cls: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400',
    };
  }

  if (goalType === 'muscle_gain') {
    // Key: protein adherence
    const prot = intake?.protein ?? Number(summary.totalProtein) ?? 0;
    const protGoal = goals?.protein ?? Number(summary.proteinGoal) ?? 0;
    if (protGoal > 0) {
      const pctProtein = Math.round((prot / protGoal) * 100);
      if (pctProtein >= 80) {
        return {
          icon: '💪',
          text: `蛋白质已达 ${pctProtein}%，增肌补给充足`,
          cls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400',
        };
      }
      return {
        icon: '🥩',
        text: `蛋白质仅 ${pctProtein}%，还需 ${Math.round(protGoal - prot)}g 达标`,
        cls: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400',
      };
    }
    // protGoal unknown — show raw intake
    return {
      icon: '🥩',
      text: `今日蛋白质摄入 ${Math.round(prot)}g，继续保持`,
      cls: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400',
    };
  }

  if (goalType === 'habit') {
    // Key: meal consistency
    const meals = mealSignals?.totalMeals ?? summary.mealCount ?? 0;
    const healthyRatio = mealSignals?.healthyRatio;
    if (healthyRatio != null) {
      const rPct = Math.round(healthyRatio * 100);
      return {
        icon: rPct >= 70 ? '🌱' : '📝',
        text: `今日 ${meals} 餐中 ${rPct}% 为健康餐${rPct >= 70 ? '，习惯养成中' : '，继续加油'}`,
        cls: rPct >= 70
          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400',
      };
    }
    if (meals >= 3) {
      return {
        icon: '🌱',
        text: `已记录 ${meals} 餐，坚持记录是好习惯`,
        cls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400',
      };
    }
  }

  // health / default: macro balance
  if (slots?.dominantDeficit) {
    const deficitLabels: Record<string, string> = {
      protein: '蛋白质',
      fat: '脂肪',
      carbs: '碳水',
      calories: '热量',
    };
    return {
      icon: '⚖️',
      text: `${deficitLabels[slots.dominantDeficit] ?? slots.dominantDeficit}摄入偏低，建议下一餐补充`,
      cls: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400',
    };
  }

  return null;
}

/* ── macro list builder ── */

interface MacroItem {
  key: string;
  label: string;
  val: number;
  goal: number;
  unit: string;
  slotStatus?: string;
}

function buildMacroList(
  summary: DailySummary,
  scoreData: NutritionScoreResult | null | undefined,
  goalType: string
): MacroItem[] {
  const intake = scoreData?.intake;
  const goals = scoreData?.goals;
  const slots = scoreData?.macroSlotStatus;

  const protein: MacroItem = {
    key: 'protein',
    label: '蛋白质',
    val: (intake?.protein ?? Number(summary.totalProtein)) || 0,
    goal: (goals?.protein ?? Number(summary.proteinGoal)) || 0,
    unit: 'g',
    slotStatus: slots?.protein,
  };
  const fat: MacroItem = {
    key: 'fat',
    label: '脂肪',
    val: (intake?.fat ?? Number(summary.totalFat)) || 0,
    goal: (goals?.fat ?? Number(summary.fatGoal)) || 0,
    unit: 'g',
    slotStatus: slots?.fat,
  };
  const carbs: MacroItem = {
    key: 'carbs',
    label: '碳水',
    val: (intake?.carbs ?? Number(summary.totalCarbs)) || 0,
    goal: (goals?.carbs ?? Number(summary.carbsGoal)) || 0,
    unit: 'g',
    slotStatus: slots?.carbs,
  };

  // Order by goal type priority and include goal-specific extra metrics
  if (goalType === 'fat_loss') {
    // Fat loss: protein first (preserve muscle), then carbs (limit), then fat
    return [protein, carbs, fat];
  }
  if (goalType === 'muscle_gain') {
    // Muscle gain: protein is king, then calories (surplus), then carbs
    return [protein, carbs, fat];
  }
  if (goalType === 'habit') {
    // Habit: simplified — just the big 3 in standard order
    return [protein, fat, carbs];
  }
  // health: balanced
  return [protein, fat, carbs];
}
