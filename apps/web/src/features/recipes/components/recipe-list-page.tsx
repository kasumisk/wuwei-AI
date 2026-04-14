'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRecipeSearch } from '@/features/recipes/hooks/use-recipes';
import { RecipeCard } from './recipe-card';
import type { SearchRecipesParams } from '@/types/food';

const CUISINE_OPTIONS = ['全部', '中式', '西式', '日式', '韩式', '东南亚', '轻食'];
const DIFFICULTY_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 1, label: '入门' },
  { value: 2, label: '简单' },
  { value: 3, label: '中等' },
];

const PAGE_SIZE = 20;

export function RecipeListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [searchText, setSearchText] = useState(initialQ);
  const [activeCuisine, setActiveCuisine] = useState('全部');
  const [activeDifficulty, setActiveDifficulty] = useState(0);
  const [offset, setOffset] = useState(0);

  // Sync URL q param on mount / navigation
  useEffect(() => {
    const q = searchParams.get('q') || '';
    if (q && q !== searchText) {
      setSearchText(q);
      setOffset(0);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo<SearchRecipesParams>(() => {
    const p: SearchRecipesParams = { limit: PAGE_SIZE, offset };
    if (searchText.trim()) p.q = searchText.trim();
    if (activeCuisine !== '全部') p.cuisine = activeCuisine;
    if (activeDifficulty > 0) p.difficulty = activeDifficulty;
    return p;
  }, [searchText, activeCuisine, activeDifficulty, offset]);

  const { data, isLoading, isFetching } = useRecipeSearch(params);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
  }, []);

  const handleCuisineChange = useCallback((cuisine: string) => {
    setActiveCuisine(cuisine);
    setOffset(0);
  }, []);

  const handleDifficultyChange = useCallback((d: number) => {
    setActiveDifficulty(d);
    setOffset(0);
  }, []);

  const recipes = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = offset + PAGE_SIZE < total;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="fixed top-0 w-full z-50 glass-morphism">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors shrink-0"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h1 className="text-lg font-bold font-headline">菜谱</h1>
        </div>
      </div>

      <main className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {/* 搜索栏 */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索菜谱..."
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/30 rounded-xl text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
        </form>

        {/* 菜系筛选 */}
        <div className="mb-3 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {CUISINE_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => handleCuisineChange(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-[0.97] ${
                  activeCuisine === c
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 难度筛选 */}
        <div className="mb-4 flex gap-2">
          {DIFFICULTY_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleDifficultyChange(value)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                activeDifficulty === value
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-card text-muted-foreground border border-border/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card rounded-2xl overflow-hidden animate-pulse">
                <div className="h-40 bg-muted" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-20 bg-muted rounded" />
                  <div className="h-3 w-full bg-muted rounded" />
                  <div className="h-3 w-16 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!isLoading && recipes.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🍳</p>
            <p className="text-sm text-muted-foreground">
              {searchText ? '没有找到相关菜谱' : '暂无菜谱'}
            </p>
            {searchText && (
              <button
                onClick={() => {
                  setSearchText('');
                  setOffset(0);
                }}
                className="mt-3 text-xs text-primary font-medium"
              >
                清除搜索
              </button>
            )}
          </div>
        )}

        {/* 菜谱列表 */}
        {!isLoading && recipes.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {recipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </div>

            {/* 分页控制 */}
            <div className="flex items-center justify-center gap-4 mt-6">
              {offset > 0 && (
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={isFetching}
                  className="px-4 py-2 rounded-xl bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-all disabled:opacity-50"
                >
                  上一页
                </button>
              )}
              {hasMore && (
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={isFetching}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {isFetching ? '加载中...' : '下一页'}
                </button>
              )}
            </div>

            <p className="text-center text-[11px] text-muted-foreground mt-3">共 {total} 个菜谱</p>
          </>
        )}
      </main>
    </div>
  );
}
