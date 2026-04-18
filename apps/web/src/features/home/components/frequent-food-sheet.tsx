'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FrequentFood } from '@/lib/api/food-library';
import { useToast } from '@/lib/hooks/use-toast';
import { handlePaywallError } from '@/features/subscription/hooks/use-subscription';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * FrequentFoodSheet — 首页常吃食物底部Sheet
 *
 * 一键记录：从5步(首页→分析页→选文件/输入→等待分析→保存)降到1步(点击添加)
 * 调用 POST /api/app/food/records/from-library 直接写入记录，零AI成本。
 */

type MealTypeOption = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const mealTypeLabels: Record<MealTypeOption, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

interface FrequentFoodSheetProps {
  open: boolean;
  onClose: () => void;
}

export function FrequentFoodSheet({ open, onClose }: FrequentFoodSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mealType, setMealType] = useState<MealTypeOption>(() => {
    // Auto-detect meal type by current time
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return 'breakfast';
    if (hour >= 10 && hour < 14) return 'lunch';
    if (hour >= 14 && hour < 17) return 'snack';
    return 'dinner';
  });
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: frequentFoods, isLoading } = useQuery<FrequentFood[]>({
    queryKey: ['frequent-foods'],
    queryFn: () => foodLibraryClientAPI.getFrequentFoods(10),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const addMutation = useMutation({
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
      toast({ title: `已将「${variables.name}」记录到${mealTypeLabels[mealType]}` });
      setAddingId(null);
    },
    onError: (err) => {
      setAddingId(null);
      if (
        err &&
        typeof err === 'object' &&
        handlePaywallError(err as unknown as Record<string, unknown>)
      ) {
        return;
      }
      toast({
        title: err instanceof Error ? err.message : '添加失败',
        variant: 'destructive',
      });
    },
  });

  const handleAdd = useCallback(
    (food: FrequentFood) => {
      if (!food.food?.id) return;
      setAddingId(food.food.id);
      addMutation.mutate({
        foodId: food.food.id,
        name: food.name,
        servingGrams: food.food.standardServingG || 100,
      });
    },
    [addMutation]
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl max-h-[75vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Header */}
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

        {/* Meal Type Selector */}
        <div className="px-6 pb-3 flex gap-2">
          {(Object.entries(mealTypeLabels) as [MealTypeOption, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMealType(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                mealType === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : !frequentFoods || frequentFoods.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="28"
                  height="28"
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
          ) : (
            <div className="space-y-2">
              {frequentFoods.map((item) => {
                const food = item.food;
                const isCurrentAdding = addingId === food?.id && addMutation.isPending;

                return (
                  <button
                    key={item.name}
                    onClick={() => handleAdd(item)}
                    disabled={addMutation.isPending || !food?.id}
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
                          {Math.round((food.calories * (food.standardServingG || 100)) / 100)} kcal
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 ml-3">
                      {isCurrentAdding ? (
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
          )}
        </div>
      </div>
    </div>
  );
}
