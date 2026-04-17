'use client';

import type { DailySummary } from '@/types/food';
import type { NutritionScoreResult } from '@/types/food';
import type { UserProfile } from '@/types/user';

function getScoreLabel(score: number) {
  if (score >= 85)
    return { label: '优秀', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300' };
  if (score >= 70)
    return { label: '良好', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-300' };
  if (score >= 55)
    return { label: '一般', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-300' };
  return { label: '需改善', color: 'text-red-600', bg: 'bg-red-50 border-red-300' };
}

function buildMetrics(summary: DailySummary, goal: string) {
  const cal = summary.totalCalories || 0;
  const calGoal = summary.calorieGoal || 2000;
  const protein = Number(summary.totalProtein) || 0;
  const proteinGoal = Number(summary.proteinGoal) || 0;
  const carbs = Number(summary.totalCarbs) || 0;
  const carbsGoal = Number(summary.carbsGoal) || 0;
  const fat = Number(summary.totalFat) || 0;
  const fatGoal = Number(summary.fatGoal) || 0;
  const quality = Number(summary.avgQuality) || 0;

  const pct = (v: number, g: number) => (g > 0 ? Math.min(100, Math.round((v / g) * 100)) : 0);
  const status = (v: number, g: number, inverse = false) => {
    const r = g > 0 ? v / g : 0;
    if (inverse) return r < 0.9 ? '✅' : r < 1.1 ? '⚠️' : '🔴';
    return r < 0.7 ? '⚠️' : r <= 1.1 ? '✅' : '🔴';
  };

  if (goal === 'fat_loss')
    return [
      {
        key: 'cal',
        label: '热量',
        val: cal,
        goal: calGoal,
        unit: 'kcal',
        pct: pct(cal, calGoal),
        icon: status(cal, calGoal, true),
        weight: '最重要',
      },
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        pct: pct(protein, proteinGoal),
        icon: status(protein, proteinGoal),
        weight: '重要',
      },
      {
        key: 'carbs',
        label: '碳水',
        val: carbs,
        goal: carbsGoal,
        unit: 'g',
        pct: pct(carbs, carbsGoal),
        icon: status(carbs, carbsGoal, true),
        weight: '控制',
      },
    ];
  if (goal === 'muscle_gain')
    return [
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        pct: pct(protein, proteinGoal),
        icon: status(protein, proteinGoal),
        weight: '最重要',
      },
      {
        key: 'cal',
        label: '热量',
        val: cal,
        goal: calGoal,
        unit: 'kcal',
        pct: pct(cal, calGoal),
        icon: status(cal, calGoal),
        weight: '重要',
      },
      {
        key: 'carbs',
        label: '碳水',
        val: carbs,
        goal: carbsGoal,
        unit: 'g',
        pct: pct(carbs, carbsGoal),
        icon: status(carbs, carbsGoal),
        weight: '辅助',
      },
    ];
  return [
    {
      key: 'quality',
      label: '食物质量',
      val: quality,
      goal: 10,
      unit: '分',
      pct: pct(quality, 10),
      icon: quality >= 7 ? '✅' : '⚠️',
      weight: '优先',
    },
    {
      key: 'cal',
      label: '热量均衡',
      val: cal,
      goal: calGoal,
      unit: 'kcal',
      pct: pct(cal, calGoal),
      icon: status(cal, calGoal, true),
      weight: '',
    },
    {
      key: 'fat',
      label: '脂肪',
      val: fat,
      goal: fatGoal,
      unit: 'g',
      pct: pct(fat, fatGoal),
      icon: status(fat, fatGoal, true),
      weight: '',
    },
  ];
}

interface TodayStatusProps {
  summary: DailySummary;
  profile: UserProfile | null;
  scoreData?: NutritionScoreResult | null;
}

export function TodayStatus({ summary, profile, scoreData }: TodayStatusProps) {
  const calorieGoal = summary.calorieGoal || 2000;
  const remaining = calorieGoal - summary.totalCalories;
  const caloriePercentRaw = Math.round((summary.totalCalories / calorieGoal) * 100);
  const caloriePercent = Math.min(100, Math.max(0, caloriePercentRaw));
  const goalType = profile?.goal || 'health';
  // 首页分数统一以 nutrition-score 接口为准，避免 summary 的异步汇总滞后。
  const score =
    scoreData?.totalScore != null
      ? Number(scoreData.totalScore)
      : Number(summary.nutritionScore || 0);
  const scoreInfo = getScoreLabel(score);
  const metrics = buildMetrics(summary, goalType);
  const goalTitleMap: Record<string, string> = {
    fat_loss: '🔥 减脂',
    muscle_gain: '💪 增肌',
    health: '🧘 健康维持',
    habit: '🌱 改善习惯',
  };

  return (
    <section className="mb-6">
      <div className="bg-card rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            🎯 今日状态
          </span>
          {score > 0 && (
            <div
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-extrabold ${scoreInfo.bg} ${scoreInfo.color}`}
            >
              <span>{score}</span>
              <span>分</span>
              <span>{scoreInfo.label}</span>
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-4xl font-headline font-extrabold text-primary tracking-tighter">
            {Math.max(0, remaining).toLocaleString()}
          </span>
          <span className="text-muted-foreground font-medium">
            / {calorieGoal.toLocaleString()} kcal
          </span>
        </div>
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">剩余热量预算</p>
        <div className="mt-4 h-2.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              caloriePercentRaw > 100
                ? 'bg-red-500'
                : caloriePercentRaw > 80
                  ? 'bg-orange-500'
                  : 'bg-primary'
            }`}
            style={{ width: `${Math.min(caloriePercent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-3 text-xs text-muted-foreground">
          <span>已摄入 {summary.totalCalories} kcal</span>
          <span>已记录 {summary.mealCount} 餐</span>
        </div>

        <div className="mt-4 pt-4 border-t border-border/40">
          <p className="text-xs font-bold text-muted-foreground mb-3">
            {goalTitleMap[goalType] || '🧘 健康维持'}用户关注
          </p>
          <div className="space-y-2.5">
            {metrics.map((m) => (
              <div key={m.key} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 w-28 shrink-0">
                  <span className="text-sm leading-none">{m.icon}</span>
                  <span className="text-xs font-medium text-foreground">{m.label}</span>
                  {m.weight && (
                    <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-md leading-none">
                      {m.weight}
                    </span>
                  )}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${m.pct}%`,
                        backgroundColor: m.pct > 100 ? '#ef4444' : '#16a34a',
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {Math.round(m.val)}/{Math.round(m.goal)}
                    {m.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
