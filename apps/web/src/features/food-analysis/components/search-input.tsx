'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { foodLibraryClientAPI, type FoodLibraryItem } from '@/lib/api/food-library';
import { Skeleton } from '@/components/ui/skeleton';

interface SearchInputProps {
  mealType: string;
  onAddFromLibrary: (foodId: string, name: string, servingGrams: number) => void;
  isAdding?: boolean;
}

export function SearchInput({ mealType, onAddFromLibrary, isAdding }: SearchInputProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search results
  const { data: searchResults, isLoading: isSearching } = useQuery<FoodLibraryItem[]>({
    queryKey: ['food-search', debouncedQuery],
    queryFn: () => foodLibraryClientAPI.search(debouncedQuery, 15),
    enabled: debouncedQuery.length >= 1,
    staleTime: 2 * 60 * 1000,
  });

  // Popular foods (shown when no search query)
  const { data: popularFoods, isLoading: isLoadingPopular } = useQuery<FoodLibraryItem[]>({
    queryKey: ['food-popular'],
    queryFn: () => foodLibraryClientAPI.getPopular(undefined, 12),
    staleTime: 10 * 60 * 1000,
    enabled: !debouncedQuery,
  });

  const handleAdd = useCallback(
    (food: FoodLibraryItem) => {
      setAddingId(food.id);
      onAddFromLibrary(food.id, food.name, food.standardServingG || 100);
    },
    [onAddFromLibrary]
  );

  // Reset addingId when isAdding goes false
  useEffect(() => {
    if (!isAdding) {
      setTimeout(() => setAddingId(null), 0);
    }
  }, [isAdding]);

  const mealLabel =
    mealType === 'breakfast'
      ? '早餐'
      : mealType === 'lunch'
        ? '午餐'
        : mealType === 'dinner'
          ? '晚餐'
          : '加餐';
  const displayItems = debouncedQuery ? searchResults : popularFoods;
  const isLoadingItems = debouncedQuery ? isSearching : isLoadingPopular;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
        >
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索食物名称，如：鸡胸肉、西蓝花..."
          className="w-full h-11 pl-10 pr-4 bg-card  text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}
      </div>

      {/* Section title */}
      <p className="text-xs text-muted-foreground font-medium px-1">
        {debouncedQuery
          ? searchResults && searchResults.length > 0
            ? `找到 ${searchResults.length} 个结果，点击添加到「${mealLabel}」`
            : isSearching
              ? '搜索中...'
              : '未找到匹配食物'
          : `热门食物 · 点击添加到「${mealLabel}」`}
      </p>

      {/* Results */}
      {isLoadingItems ? (
        <div className="grid grid-cols-1 gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full " />
          ))}
        </div>
      ) : displayItems && displayItems.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {displayItems.map((food) => {
            const isCurrentAdding = addingId === food.id && isAdding;
            const servingCalories = Math.round(
              (food.calories * (food.standardServingG || 100)) / 100
            );

            return (
              <button
                key={food.id}
                onClick={() => handleAdd(food)}
                disabled={isAdding}
                className="bg-card  p-3.5 flex items-center justify-between hover:bg-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm truncate">{food.name}</h4>
                    {food.isVerified && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="14"
                        height="14"
                        className="text-primary shrink-0"
                      >
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {food.standardServingDesc || `${food.standardServingG}g`}
                    {' · '}
                    {servingCalories} kcal
                    {food.category && ` · ${food.category}`}
                  </p>
                </div>
                <div className="shrink-0 ml-3">
                  {isCurrentAdding ? (
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
      ) : (
        !isLoadingItems &&
        debouncedQuery && (
          <div className="text-center py-8 space-y-2">
            <div className="w-14 h-14 mx-auto  bg-muted flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="24"
                height="24"
                className="text-muted-foreground/50"
              >
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">没有找到「{debouncedQuery}」</p>
            <p className="text-xs text-muted-foreground/60">试试换个关键词，或使用文字描述分析</p>
          </div>
        )
      )}

      {/* Zero AI cost hint */}
      <div className="bg-green-500/5 border border-green-500/10  px-4 py-2.5 flex items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="16"
          height="16"
          className="text-green-600 shrink-0"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
        <span className="text-xs text-green-700">从食物库添加不消耗 AI 分析次数</span>
      </div>
    </div>
  );
}
