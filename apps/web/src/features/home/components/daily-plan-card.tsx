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
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden">
        <div className="bg-blue-400" style={{ width: `${pPct}%` }} />
        <div className="bg-yellow-400" style={{ width: `${fPct}%` }} />
        <div className="bg-green-400" style={{ width: `${cPct}%` }} />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-blue-600">蛋白 {protein}g</span>
        <span className="text-[10px] text-yellow-600">脂肪 {fat}g</span>
        <span className="text-[10px] text-green-600">碳水 {carbs}g</span>
      </div>
    </div>
  );
}

/* ─── 单餐详情面板 ─── */

function MealPanel({
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
  const [showMacro, setShowMacro] = useState(false);
  const hasMacro = plan.protein > 0 || plan.fat > 0 || plan.carbs > 0;

  return (
    <div className="bg-card rounded-xl p-4">
      {/* 餐次标题行 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold">
          {emoji} {label}
        </span>
        <span className="text-sm font-bold text-primary">{plan.calories} kcal</span>
      </div>

      {/* 食物列表 */}
      <p className="text-sm leading-relaxed">{plan.foods}</p>

      {/* 小贴士 */}
      {plan.tip && <p className="text-xs text-muted-foreground mt-2">💡 {plan.tip}</p>}

      {/* 宏量素（点击展开） */}
      {hasMacro && (
        <>
          <button
            onClick={() => setShowMacro((v) => !v)}
            className="text-xs text-muted-foreground mt-2 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {showMacro ? '收起营养' : '查看营养'}
          </button>
          {showMacro && <MacroBar protein={plan.protein} fat={plan.fat} carbs={plan.carbs} />}
        </>
      )}

      {/* 操作按钮行 */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLog();
          }}
          disabled={isLogging}
          className="flex-1 px-3 py-1.5 rounded-lg bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {isLogging ? '记录中…' : '记为已吃'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSwap();
          }}
          disabled={isSwapping}
          className="px-4 py-1.5 rounded-lg bg-muted text-xs font-bold text-muted-foreground hover:bg-muted/80 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {isSwapping ? '换餐中…' : '换一换'}
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

  // 默认选中第一个有数据的餐次
  const firstAvailable = MEAL_SLOTS.find(({ key }) => dailyPlan[key] != null)?.key ?? 'morningPlan';
  const [activeTab, setActiveTab] = useState<(typeof MEAL_SLOTS)[number]['key']>(firstAvailable);

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
    async (slotKey: string, slotLabel: string, foods: string) => {
      setSwappingSlot(slotLabel);
      try {
        await adjustPlan({
          reason: `${slotLabel}不想吃"${foods}"，请推荐替代方案`,
          mealType: (MEAL_TYPE_MAP[slotKey] || 'lunch') as
            | 'breakfast'
            | 'lunch'
            | 'dinner'
            | 'snack',
        });
        toast({ title: `${slotLabel}已更新` });
      } catch {
        toast({ title: `${slotLabel}更换失败，请稍后再试`, variant: 'destructive' });
      } finally {
        setSwappingSlot(null);
      }
    },
    [adjustPlan, toast]
  );

  const handleLogMeal = useCallback(
    async (slotKey: string, slotLabel: string, plan: MealPlan) => {
      setLoggingSlot(slotLabel);
      try {
        const mealType = MEAL_TYPE_MAP[slotKey] || 'lunch';
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
  const activePlan = dailyPlan[activeTab];

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low rounded-2xl p-5">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-3">
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

        {/* 最近调整说明 */}
        {dailyPlan.adjustmentNote && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-xs text-blue-600 dark:text-blue-400">
              🔄 {dailyPlan.adjustmentNote}
            </p>
          </div>
        )}

        {/* Tab 栏 */}
        <div className="flex gap-1 mb-3 bg-muted/50 rounded-xl p-1">
          {MEAL_SLOTS.map(({ key, label, emoji }) => {
            const plan = dailyPlan[key];
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                disabled={!plan}
                className={[
                  'flex-1 flex flex-col items-center py-1.5 rounded-lg text-[10px] font-medium transition-all',
                  isActive
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  !plan ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                <span className="text-sm leading-none mb-0.5">{emoji}</span>
                <span>{label}</span>
                {plan && (
                  <span className={isActive ? 'text-primary font-bold' : ''}>{plan.calories}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 当前餐次面板 */}
        {activePlan ? (
          (() => {
            const slot = MEAL_SLOTS.find((s) => s.key === activeTab)!;
            return (
              <MealPanel
                key={activeTab}
                label={slot.label}
                emoji={slot.emoji}
                plan={activePlan}
                onSwap={() => handleSwapMeal(activeTab, slot.label, activePlan.foods)}
                isSwapping={isAdjusting && swappingSlot === slot.label}
                onLog={() => handleLogMeal(activeTab, slot.label, activePlan)}
                isLogging={logMutation.isPending && loggingSlot === slot.label}
              />
            );
          })()
        ) : (
          <p className="text-xs text-muted-foreground text-center py-6">暂无该餐次计划</p>
        )}

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
