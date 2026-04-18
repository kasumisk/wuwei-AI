'use client';

import type { DailySummary } from '@/types/food';

interface MacroItem {
  key: string;
  label: string;
  val: number;
  goal: number;
  unit: string;
  /** 对于减脂/控制类指标，超出是负面的 */
  inverse?: boolean;
  weight?: string;
}

function buildMacros(summary: DailySummary, goalType: string): MacroItem[] {
  const cal = summary.totalCalories || 0;
  const calGoal = summary.calorieGoal || 2000;
  const protein = Number(summary.totalProtein) || 0;
  const proteinGoal = Number(summary.proteinGoal) || 0;
  const carbs = Number(summary.totalCarbs) || 0;
  const carbsGoal = Number(summary.carbsGoal) || 0;
  const fat = Number(summary.totalFat) || 0;
  const fatGoal = Number(summary.fatGoal) || 0;

  if (goalType === 'fat_loss')
    return [
      {
        key: 'cal',
        label: '热量',
        val: cal,
        goal: calGoal,
        unit: 'kcal',
        inverse: true,
        weight: '最重要',
      },
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        weight: '重要',
      },
      {
        key: 'carbs',
        label: '碳水',
        val: carbs,
        goal: carbsGoal,
        unit: 'g',
        inverse: true,
        weight: '控制',
      },
    ];
  if (goalType === 'muscle_gain')
    return [
      {
        key: 'protein',
        label: '蛋白质',
        val: protein,
        goal: proteinGoal,
        unit: 'g',
        weight: '最重要',
      },
      { key: 'cal', label: '热量', val: cal, goal: calGoal, unit: 'kcal', weight: '重要' },
      { key: 'carbs', label: '碳水', val: carbs, goal: carbsGoal, unit: 'g', weight: '辅助' },
    ];
  // health / habit / default
  return [
    { key: 'protein', label: '蛋白质', val: protein, goal: proteinGoal, unit: 'g' },
    { key: 'fat', label: '脂肪', val: fat, goal: fatGoal, unit: 'g', inverse: true },
    { key: 'carbs', label: '碳水', val: carbs, goal: carbsGoal, unit: 'g' },
  ];
}

function barColor(pct: number, inverse: boolean): string {
  if (inverse) {
    if (pct > 110) return 'bg-red-500';
    if (pct > 90) return 'bg-orange-400';
    return 'bg-primary';
  }
  if (pct > 110) return 'bg-red-500';
  if (pct < 60) return 'bg-amber-400';
  return 'bg-primary';
}

interface MacroProgressBarsProps {
  summary: DailySummary;
  goalType: string;
  /** 是否展示权重标签 */
  showWeight?: boolean;
}

export function MacroProgressBars({
  summary,
  goalType,
  showWeight = true,
}: MacroProgressBarsProps) {
  const macros = buildMacros(summary, goalType);

  return (
    <div className="space-y-2.5">
      {macros.map((m) => {
        const pct = m.goal > 0 ? Math.min(100, Math.round((m.val / m.goal) * 100)) : 0;
        const color = barColor(pct, !!m.inverse);
        return (
          <div key={m.key} className="flex items-center gap-2">
            <div className="flex items-center gap-1 w-28 shrink-0">
              <span className="text-xs font-medium text-foreground">{m.label}</span>
              {showWeight && m.weight && (
                <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap">
                  {m.weight}
                </span>
              )}
            </div>
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${color}`}
                  style={{ width: `${pct}%` }}
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
  );
}
