'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FrequentFood } from '@/lib/api/food-library';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * FrequentFoodPicker — 统一常吃食物组件
 *
 * 两种模式（由 `inline` 控制）：
 *   - 默认（Sheet）：用于首页，支持多选 + 批量跳转 AI 分析
 *   - Inline：用于分析页表单，单击即时添加到当前餐次
 */

type MealTypeKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const MEAL_LABELS: Record<MealTypeKey, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

/* ─── Sheet mode: 多选批量分析 ─── */

interface FrequentFoodPickerSheetProps {
  open: boolean;
  onClose: () => void;
}

function FrequentFoodPickerSheet({ open, onClose }: FrequentFoodPickerSheetProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: foods = [], isLoading } = useQuery<FrequentFood[]>({
    queryKey: ['frequent-foods'],
    queryFn: () => foodLibraryClientAPI.getFrequentFoods(10),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // 关闭时清空选择
  useEffect(() => {
    if (!open) setSelectedIds(new Set());
  }, [open]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedFoods = useMemo(
    () => foods.filter((f) => f.food && selectedIds.has(f.food.id)),
    [foods, selectedIds]
  );

  const confirmAnalyze = useCallback(() => {
    if (selectedFoods.length === 0) return;
    const draft = selectedFoods
      .map((f) => {
        const g = f.food?.standardServingDesc || `${f.food?.standardServingG || 100}g`;
        return `${f.name} ${g}`;
      })
      .join('，');
    try {
      sessionStorage.setItem('analyze_text_draft', draft);
    } catch {
      /* ignore */
    }
    setSelectedIds(new Set());
    onClose();
    router.push('/analyze?tab=text');
  }, [selectedFoods, onClose, router]);

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
      <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1  bg-muted-foreground/20" />
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-headline font-bold">常吃食物</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              选择一个或多个，AI 一起分析决策
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8  bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
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

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full " />
              ))}
            </div>
          ) : foods.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <div className="w-14 h-14 mx-auto  bg-muted flex items-center justify-center">
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
          ) : (
            <div className="space-y-2">
              {foods.map((item) => {
                const food = item.food;
                const id = food?.id;
                const selected = id ? selectedIds.has(id) : false;
                return (
                  <button
                    key={item.name}
                    onClick={() => id && toggle(id)}
                    disabled={!id}
                    aria-pressed={selected}
                    className={`w-full  p-3.5 flex items-center justify-between active:scale-[0.98] transition-all text-left disabled:opacity-50 border ${
                      selected
                        ? 'bg-primary/10 border-primary ring-1 ring-primary/20'
                        : 'bg-card border-border hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm truncate">{item.name}</h4>
                        <span className="text-[10px] px-1.5 py-0.5  bg-primary/10 text-primary font-medium shrink-0">
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
                      <div
                        className={`w-6 h-6 border-2 flex items-center justify-center transition-colors ${
                          selected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                        }`}
                      >
                        {selected && (
                          <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            width="14"
                            height="14"
                            className="text-primary-foreground"
                          >
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部确认栏 */}
        <div className="border-t border-border/40 px-4 py-3 bg-background">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                {selectedFoods.length === 0 ? '未选择食物' : `已选 ${selectedFoods.length} 个食物`}
              </p>
              {selectedFoods.length > 0 && (
                <p className="text-sm font-medium truncate">
                  {selectedFoods.map((f) => f.name).join('、')}
                </p>
              )}
            </div>
            <button
              onClick={confirmAnalyze}
              disabled={selectedFoods.length === 0}
              className="shrink-0 bg-primary text-primary-foreground font-bold text-sm px-5 py-2.5 rounded-md active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:active:scale-100"
            >
              开始 AI 分析 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline mode: 单击即时添加到当前餐次 ─── */

interface FoodListProps {
  foods: FrequentFood[];
  addingId: string | null;
  isPending: boolean;
  onAdd: (food: FrequentFood) => void;
  mealLabel: string;
}

function InlineFoodList({ foods, addingId, isPending, onAdd, mealLabel }: FoodListProps) {
  if (foods.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="w-14 h-14 mx-auto  bg-muted flex items-center justify-center">
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
      <p className="text-xs text-muted-foreground font-medium px-1">
        点击即可一键记录到「{mealLabel}」
      </p>
      {foods.map((item) => {
        const food = item.food;
        const isAdding = addingId === food?.id && isPending;
        return (
          <button
            key={item.name}
            onClick={() => onAdd(item)}
            disabled={isPending || !food?.id}
            className="w-full bg-card  p-3.5 flex items-center justify-between hover:bg-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm truncate">{item.name}</h4>
                <span className="text-[10px] px-1.5 py-0.5  bg-primary/10 text-primary font-medium shrink-0">
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
                <span className="animate-spin inline-block w-5 h-5 border-2 border-primary border-t-transparent " />
              ) : (
                <div className="w-8 h-8  bg-primary/10 flex items-center justify-center">
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
          <Skeleton key={i} className="h-16 w-full " />
        ))}
      </div>
    );
  if (error)
    return <p className="text-sm text-center text-muted-foreground py-8">加载常吃食物失败</p>;

  const mealKey = mealType as MealTypeKey;
  return (
    <InlineFoodList
      foods={foods}
      addingId={addingId}
      isPending={!!isAdding}
      onAdd={handleAdd}
      mealLabel={MEAL_LABELS[mealKey] || mealType}
    />
  );
}

/* ─── Public exports ─── */

export { FrequentFoodPickerSheet, FrequentFoodPickerInline };

/** Convenience default: sheet mode */
export function FrequentFoodPicker(props: FrequentFoodPickerSheetProps) {
  return <FrequentFoodPickerSheet {...props} />;
}
