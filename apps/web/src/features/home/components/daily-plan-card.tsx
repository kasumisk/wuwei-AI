'use client';

import { useState, useCallback } from 'react';
import { usePlanAdjust } from '@/features/home/hooks/use-plan-adjust';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { useToast } from '@/lib/hooks/use-toast';
import type { DailyPlanData, MealPlan } from '@/types/food';

/* ─── 餐次→mealType 映射 ─── */

const MEAL_TYPE_MAP: Record<string, string> = {
  morningPlan: 'breakfast',
  lunchPlan: 'lunch',
  dinnerPlan: 'dinner',
  snackPlan: 'snack',
};

/* ─── 常量 ─── */

const MEAL_SLOTS = [
  { key: 'morningPlan' as const, label: '早餐', emoji: '🌅' },
  { key: 'lunchPlan' as const, label: '午餐', emoji: '☀️' },
  { key: 'dinnerPlan' as const, label: '晚餐', emoji: '🌙' },
  { key: 'snackPlan' as const, label: '加餐', emoji: '🍪' },
];

/* ─── 宏量素小条 ─── */

function MacroBar({ protein, fat, carbs }: { protein: number; fat: number; carbs: number }) {
  const total = protein + fat + carbs;
  if (total === 0) return null;
  const pPct = Math.round((protein / total) * 100);
  const fPct = Math.round((fat / total) * 100);
  const cPct = 100 - pPct - fPct;

  return (
    <div className="mt-2">
      <div className="flex h-1.5 rounded-full overflow-hidden">
        <div className="bg-blue-400" style={{ width: `${pPct}%` }} />
        <div className="bg-yellow-400" style={{ width: `${fPct}%` }} />
        <div className="bg-green-400" style={{ width: `${cPct}%` }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-blue-600">蛋白{protein}g</span>
        <span className="text-[9px] text-yellow-600">脂肪{fat}g</span>
        <span className="text-[9px] text-green-600">碳水{carbs}g</span>
      </div>
    </div>
  );
}

/* ─── 单餐卡片 ─── */

function MealSlotCard({
  label,
  emoji,
  plan,
  onSwap,
  isSwapping,
  onLog,
  isLogging,
}: {
  label: string;
  emoji: string;
  plan: MealPlan;
  onSwap: () => void;
  isSwapping: boolean;
  onLog: () => void;
  isLogging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card rounded-xl p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-muted-foreground">
            {emoji} {label}
          </span>
          <p className="text-xs mt-1 line-clamp-2">{plan.foods}</p>
          <span className="text-[10px] text-primary font-bold">{plan.calories} kcal</span>
        </div>
      </div>

      {plan.tip && (
        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">💡 {plan.tip}</p>
      )}

      {/* 宏量素（点击展开） */}
      {(plan.protein > 0 || plan.fat > 0 || plan.carbs > 0) && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-muted-foreground mt-1 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {expanded ? '收起营养' : '查看营养'}
          </button>
          {expanded && <MacroBar protein={plan.protein} fat={plan.fat} carbs={plan.carbs} />}
        </>
      )}

      {/* 操作按钮行 */}
      <div className="flex gap-1.5 mt-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLog();
          }}
          disabled={isLogging}
          className="flex-1 px-2 py-1 rounded-lg bg-primary/10 text-[10px] font-bold text-primary hover:bg-primary/20 transition-all active:scale-[0.95] disabled:opacity-50"
        >
          {isLogging ? '...' : '记为已吃'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSwap();
          }}
          disabled={isSwapping}
          className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold text-muted-foreground hover:bg-muted/80 transition-all active:scale-[0.95] disabled:opacity-50 flex-shrink-0"
        >
          {isSwapping ? '...' : '换'}
        </button>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */

interface DailyPlanCardProps {
  dailyPlan: DailyPlanData;
}

export function DailyPlanCard({ dailyPlan }: DailyPlanCardProps) {
  const { adjustPlan, isAdjusting } = usePlanAdjust();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [swappingSlot, setSwappingSlot] = useState<string | null>(null);
  const [loggingSlot, setLoggingSlot] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // 一键记录 mutation
  const logMutation = useMutation({
    mutationFn: (data: {
      foods: { name: string; calories: number; protein?: number; fat?: number; carbs?: number }[];
      totalCalories: number;
      mealType: string;
      totalProtein?: number;
      totalFat?: number;
      totalCarbs?: number;
      avgQuality?: number;
      avgSatiety?: number;
      source?: string;
    }) => foodRecordService.saveRecord(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
    },
  });

  const handleSwapMeal = useCallback(
    async (slotLabel: string, foods: string) => {
      setSwappingSlot(slotLabel);
      try {
        await adjustPlan(`${slotLabel}不想吃"${foods}"，请推荐替代方案`);
        toast({ title: `${slotLabel}已更新` });
      } catch {
        toast({ title: `${slotLabel}更换失败，请稍后再试`, variant: 'destructive' });
      } finally {
        setSwappingSlot(null);
      }
    },
    [adjustPlan, toast]
  );

  /** 一键记录计划餐为已吃 */
  const handleLogMeal = useCallback(
    async (slotKey: string, slotLabel: string, plan: MealPlan) => {
      setLoggingSlot(slotLabel);
      try {
        const mealType = MEAL_TYPE_MAP[slotKey] || 'lunch';
        // 将计划的 foods 字符串拆分为简单 FoodItem 列表
        // 计划中 foods 是逗号分隔的食物名
        const foodNames = plan.foods
          .split(/[、，,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const perFoodCalories =
          foodNames.length > 0 ? Math.round(plan.calories / foodNames.length) : plan.calories;
        const foods = foodNames.map((name) => ({
          name,
          calories: perFoodCalories,
          protein: plan.protein > 0 ? Math.round(plan.protein / foodNames.length) : undefined,
          fat: plan.fat > 0 ? Math.round(plan.fat / foodNames.length) : undefined,
          carbs: plan.carbs > 0 ? Math.round(plan.carbs / foodNames.length) : undefined,
        }));

        await logMutation.mutateAsync({
          foods,
          totalCalories: plan.calories,
          mealType,
          totalProtein: plan.protein > 0 ? plan.protein : undefined,
          totalFat: plan.fat > 0 ? plan.fat : undefined,
          totalCarbs: plan.carbs > 0 ? plan.carbs : undefined,
          avgQuality: 5,
          avgSatiety: 5,
          source: 'manual',
        });
        toast({ title: `${slotLabel}已记录` });
      } catch {
        toast({ title: `记录失败，请稍后再试`, variant: 'destructive' });
      } finally {
        setLoggingSlot(null);
      }
    },
    [logMutation, toast]
  );

  const adjustments = dailyPlan.adjustments || [];

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low rounded-2xl p-5">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📅</span>
            <h3 className="font-bold text-sm">今日饮食计划</h3>
          </div>
          {dailyPlan.totalBudget > 0 && (
            <span className="text-[11px] text-muted-foreground">
              总预算 {dailyPlan.totalBudget} kcal
            </span>
          )}
        </div>

        {/* 策略说明 */}
        {dailyPlan.strategy && (
          <p className="text-xs text-muted-foreground mb-3">💡 {dailyPlan.strategy}</p>
        )}

        {/* 四餐卡片 */}
        <div className="grid grid-cols-2 gap-2">
          {MEAL_SLOTS.map(
            ({ key, label, emoji }) =>
              dailyPlan[key] && (
                <MealSlotCard
                  key={key}
                  label={label}
                  emoji={emoji}
                  plan={dailyPlan[key]!}
                  onSwap={() => handleSwapMeal(label, dailyPlan[key]!.foods)}
                  isSwapping={isAdjusting && swappingSlot === label}
                  onLog={() => handleLogMeal(key, label, dailyPlan[key]!)}
                  isLogging={logMutation.isPending && loggingSlot === label}
                />
              )
          )}
        </div>

        {/* 调整历史 */}
        {adjustments.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>📝</span>
              <span className="underline underline-offset-2">
                {showHistory ? '收起调整记录' : `今日已调整 ${adjustments.length} 次`}
              </span>
            </button>

            {showHistory && (
              <div className="mt-2 space-y-2">
                {adjustments.map((adj, i) => (
                  <div key={i} className="bg-card rounded-lg p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(adj.time).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground mt-1">{adj.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
