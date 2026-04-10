'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FoodLibraryItem } from '@/lib/api/food-library';
import { useToast } from '@/lib/hooks/use-toast';

/* ─── 常量 ─── */

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const MEAL_OPTIONS: { key: MealType; label: string; emoji: string }[] = [
  { key: 'breakfast', label: '早餐', emoji: '🌅' },
  { key: 'lunch', label: '午餐', emoji: '☀️' },
  { key: 'dinner', label: '晚餐', emoji: '🌙' },
  { key: 'snack', label: '加餐', emoji: '🍪' },
];

const SERVING_PRESETS = [0.5, 1, 1.5, 2];

/* ─── 自动推测当前餐次 ─── */

function guessCurrentMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 18) return 'snack';
  return 'dinner';
}

/* ─── 组件 ─── */

interface QuickLogPanelProps {
  food: FoodLibraryItem;
  onClose: () => void;
  onSuccess?: () => void;
}

export function QuickLogPanel({ food, onClose, onSuccess }: QuickLogPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mealType, setMealType] = useState<MealType>(guessCurrentMealType);
  const [servings, setServings] = useState(1);
  const [customGrams, setCustomGrams] = useState<string>('');

  const standardG = food.standardServingG || 100;
  const useCustom = customGrams.trim().length > 0;
  const actualGrams = useCustom ? Number(customGrams) || 0 : servings * standardG;
  const ratio = actualGrams / 100;

  const calories = Math.round(food.caloriesPer100g * ratio);
  const protein = food.proteinPer100g != null ? Math.round(food.proteinPer100g * ratio) : null;
  const fat = food.fatPer100g != null ? Math.round(food.fatPer100g * ratio) : null;
  const carbs = food.carbsPer100g != null ? Math.round(food.carbsPer100g * ratio) : null;

  const addMutation = useMutation({
    mutationFn: () => foodLibraryClientAPI.addFromLibrary(food.id, actualGrams, mealType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      toast({ title: `已记录 ${food.name} ${actualGrams}g` });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      toast({
        title: err instanceof Error ? err.message : '记录失败',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = useCallback(() => {
    if (actualGrams <= 0) {
      toast({ title: '请输入有效的份量', variant: 'destructive' });
      return;
    }
    addMutation.mutate();
  }, [actualGrams, addMutation, toast]);

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* 面板 */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="max-w-lg mx-auto p-6 space-y-5">
          {/* 拖拽指示条 */}
          <div className="flex justify-center">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
          </div>

          {/* 食物信息 */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg">{food.name}</h3>
              <p className="text-xs text-muted-foreground">
                {food.caloriesPer100g} kcal / 100g
                {food.standardServingDesc && ` · ${food.standardServingDesc}`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* 餐次选择 */}
          <div>
            <p className="text-xs font-bold text-muted-foreground mb-2">选择餐次</p>
            <div className="flex gap-2">
              {MEAL_OPTIONS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMealType(m.key)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    mealType === m.key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 份量选择 */}
          <div>
            <p className="text-xs font-bold text-muted-foreground mb-2">
              选择份量（每份 {standardG}g）
            </p>
            <div className="flex gap-2 mb-2">
              {SERVING_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setServings(s);
                    setCustomGrams('');
                  }}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
                    !useCustom && servings === s
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {s === 0.5 ? '半份' : `${s}份`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">或自定义</span>
              <input
                type="number"
                value={customGrams}
                onChange={(e) => setCustomGrams(e.target.value)}
                placeholder="克数"
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-xs text-muted-foreground">g</span>
            </div>
          </div>

          {/* 预计营养 */}
          <div className="bg-card rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-2">
              预计摄入（{actualGrams}g）
            </p>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extrabold text-primary">{calories} kcal</span>
              <div className="flex gap-3 text-xs text-muted-foreground">
                {protein != null && <span className="text-blue-600">蛋白{protein}g</span>}
                {fat != null && <span className="text-amber-600">脂肪{fat}g</span>}
                {carbs != null && <span className="text-green-600">碳水{carbs}g</span>}
              </div>
            </div>
          </div>

          {/* 确认按钮 */}
          <button
            onClick={handleSubmit}
            disabled={addMutation.isPending || actualGrams <= 0}
            className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {addMutation.isPending ? '记录中...' : `确认记录 ${food.name}`}
          </button>
        </div>
      </div>
    </>
  );
}
