'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FrequentFood } from '@/lib/api/food-library';
import { useToast } from '@/lib/hooks/use-toast';
import { handlePaywallError } from '@/features/subscription/hooks/use-subscription';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * FrequentFoodPicker — 统一常吃食物组件
 *
 * 替代 FrequentFoodSheet（底部Sheet模式）+ FrequentInput（内联模式）。
 * 通过 `inline` prop 控制渲染模式：
 *   - inline=false（默认）: 底部Sheet，适合首页
 *   - inline=true: 内联列表，适合分析页表单内
 */

type MealTypeKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const MEAL_LABELS: Record<MealTypeKey, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

function autoMealType(): MealTypeKey {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return 'breakfast';
  if (h >= 10 && h < 14) return 'lunch';
  if (h >= 14 && h < 17) return 'snack';
  return 'dinner';
}

/* ─── shared food list ─── */

interface FoodListProps {
  foods: FrequentFood[];
  addingId: string | null;
  isPending: boolean;
  onAdd: (food: FrequentFood) => void;
  mealLabel: string;
  showMealHint?: boolean;
}

function FoodList({ foods, addingId, isPending, onAdd, mealLabel, showMealHint }: FoodListProps) {
  if (foods.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="w-14 h-14 mx-auto rounded-full bg-muted flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="24"
            height="24"
            className="text-muted-foreground/50"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium">还没有常吃食物</p>
          <p className="text-xs text-muted-foreground mt-1">
            多记录几次饮食后，这里会出现你的常吃食物
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {showMealHint && (
        <p className="text-xs text-muted-foreground font-medium px-1">
          点击即可一键记录到「{mealLabel}」
        </p>
      )}
      {foods.map((item) => {
        const food = item.food;
        const isAdding = addingId === food?.id && isPending;
        return (
          <button
            key={item.name}
            onClick={() => onAdd(item)}
            disabled={isPending || !food?.id}
            className="w-full bg-card rounded-xl p-3.5 flex items-center justify-between hover:bg-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm truncate">{item.name}</h4>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                  {item.count}次
                </span>
              </div>
              {food && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {food.standardServingDesc || `${food.standardServingG}g`}
                  {' · '}
                  {Math.round(food.calories)} kcal
                  {food.category && ` · ${food.category}`}
                </p>
              )}
            </div>
            <div className="shrink-0 ml-3">
              {isAdding ? (
                <span className="animate-spin inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                    className="text-primary"
                  >
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Sheet mode ─── */

interface FrequentFoodPickerSheetProps {
  open: boolean;
  onClose: () => void;
}

function FrequentFoodPickerSheet({ open, onClose }: FrequentFoodPickerSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mealType, setMealType] = useState<MealTypeKey>(autoMealType);
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: foods = [], isLoading } = useQuery<FrequentFood[]>({
    queryKey: ['frequent-foods'],
    queryFn: () => foodLibraryClientAPI.getFrequentFoods(10),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: ({
      foodId,
      servingGrams,
    }: {
      foodId: string;
      name: string;
      servingGrams: number;
    }) => foodLibraryClientAPI.addFromLibrary(foodId, servingGrams, mealType),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      toast({ title: `已将「${variables.name}」记录到${MEAL_LABELS[mealType]}` });
      setAddingId(null);
    },
    onError: (err) => {
      setAddingId(null);
      if (
        err &&
        typeof err === 'object' &&
        handlePaywallError(err as unknown as Record<string, unknown>)
      )
        return;
      toast({ title: err instanceof Error ? err.message : '添加失败', variant: 'destructive' });
    },
  });

  const handleAdd = useCallback(
    (food: FrequentFood) => {
      if (!food.food?.id) return;
      setAddingId(food.food.id);
      mutation.mutate({
        foodId: food.food.id,
        name: food.name,
        servingGrams: food.food.standardServingG || 100,
      });
    },
    [mutation]
  );

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl max-h-[75vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="px-6 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-headline font-bold">常吃食物</h2>
            <p className="text-xs text-muted-foreground mt-0.5">一键记录，不消耗 AI 分析次数</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="18"
              height="18"
              className="text-muted-foreground"
            >
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Meal type selector */}
        <div className="px-6 pb-3 flex gap-2">
          {(Object.entries(MEAL_LABELS) as [MealTypeKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMealType(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${mealType === key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <FoodList
              foods={foods}
              addingId={addingId}
              isPending={mutation.isPending}
              onAdd={handleAdd}
              mealLabel={MEAL_LABELS[mealType]}
              showMealHint={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Inline mode ─── */

interface FrequentFoodPickerInlineProps {
  mealType: string;
  onAddFromLibrary: (foodId: string, name: string, servingGrams: number) => void;
  isAdding?: boolean;
}

function FrequentFoodPickerInline({
  mealType,
  onAddFromLibrary,
  isAdding,
}: FrequentFoodPickerInlineProps) {
  const [addingId, setAddingId] = useState<string | null>(null);

  const {
    data: foods = [],
    isLoading,
    error,
  } = useQuery<FrequentFood[]>({
    queryKey: ['frequent-foods'],
    queryFn: () => foodLibraryClientAPI.getFrequentFoods(10),
    staleTime: 5 * 60 * 1000,
  });

  const handleAdd = useCallback(
    (food: FrequentFood) => {
      if (!food.food?.id) return;
      setAddingId(food.food.id);
      onAddFromLibrary(food.food.id, food.name, food.food.standardServingG || 100);
    },
    [onAddFromLibrary]
  );

  useEffect(() => {
    if (!isAdding) setAddingId(null);
  }, [isAdding]);

  if (isLoading)
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  if (error)
    return <p className="text-sm text-center text-muted-foreground py-8">加载常吃食物失败</p>;

  const mealKey = mealType as MealTypeKey;
  return (
    <FoodList
      foods={foods}
      addingId={addingId}
      isPending={!!isAdding}
      onAdd={handleAdd}
      mealLabel={MEAL_LABELS[mealKey] || mealType}
      showMealHint
    />
  );
}

/* ─── Public exports ─── */

export { FrequentFoodPickerSheet, FrequentFoodPickerInline };

/** Convenience default: sheet mode */
export function FrequentFoodPicker(props: FrequentFoodPickerSheetProps) {
  return <FrequentFoodPickerSheet {...props} />;
}
