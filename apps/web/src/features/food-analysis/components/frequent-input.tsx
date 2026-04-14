'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FrequentFood } from '@/lib/api/food-library';
import { Skeleton } from '@/components/ui/skeleton';

interface FrequentInputProps {
  mealType: string;
  onAddFromLibrary: (foodId: string, name: string, servingGrams: number) => void;
  isAdding?: boolean;
}

export function FrequentInput({ mealType, onAddFromLibrary, isAdding }: FrequentInputProps) {
  const [addingId, setAddingId] = useState<string | null>(null);

  const {
    data: frequentFoods,
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

  // Reset addingId when isAdding goes false
  useEffect(() => {
    if (!isAdding) setAddingId(null);
  }, [isAdding]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-muted-foreground">加载常吃食物失败</p>
        <p className="text-xs text-muted-foreground/60 mt-1">请稍后重试</p>
      </div>
    );
  }

  if (!frequentFoods || frequentFoods.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
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
            多记录几次饮食后，这里会显示你常吃的食物
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-medium px-1">
        点击即可一键记录到「
        {mealType === 'breakfast'
          ? '早餐'
          : mealType === 'lunch'
            ? '午餐'
            : mealType === 'dinner'
              ? '晚餐'
              : '加餐'}
        」
      </p>

      <div className="grid grid-cols-1 gap-2">
        {frequentFoods.map((item) => {
          const food = item.food;
          const isCurrentAdding = addingId === food?.id && isAdding;

          return (
            <button
              key={item.name}
              onClick={() => handleAdd(item)}
              disabled={isAdding || !food?.id}
              className="bg-card rounded-xl p-3.5 flex items-center justify-between hover:bg-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm truncate">{item.name}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                    吃过{item.count}次
                  </span>
                </div>
                {food && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {food.standardServingDesc || `${food.standardServingG}g`}
                    {' · '}
                    {Math.round((food.caloriesPer100g * (food.standardServingG || 100)) / 100)} kcal
                    {food.category && ` · ${food.category}`}
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
    </div>
  );
}
