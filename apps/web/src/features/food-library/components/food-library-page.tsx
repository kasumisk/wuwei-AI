'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFoodLibrary } from '@/features/food-library/hooks/use-food-library';
import type { FoodLibraryItem, FoodCategory } from '@/lib/api/food-library';

// 分类 emoji 映射
const categoryEmoji: Record<string, string> = {
  主食: '🍚',
  肉类: '🥩',
  蔬菜: '🥬',
  水果: '🍎',
  豆制品: '🫘',
  汤类: '🍲',
  饮品: '🥤',
  零食: '🍪',
  快餐: '🍔',
  调味料: '🧂',
};

function getNutrientColor(label: string) {
  switch (label) {
    case '蛋白质':
      return 'text-blue-600 bg-blue-50';
    case '脂肪':
      return 'text-amber-600 bg-amber-50';
    case '碳水':
      return 'text-green-600 bg-green-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}

interface FoodLibraryPageProps {
  locale: string;
  initialCategories: FoodCategory[];
  initialPopularFoods: FoodLibraryItem[];
}

export function FoodLibraryPage({
  locale,
  initialCategories,
  initialPopularFoods,
}: FoodLibraryPageProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    query,
    onQueryChange,
    clearSearch,
    searching,
    activeCategory,
    loadingCategory,
    handleCategoryClick,
    categories,
    showSearchResults,
    showCategoryFoods,
    displayFoods,
    results,
    categoryFoods,
  } = useFoodLibrary({ initialCategories, initialPopularFoods });

  const localePath = locale === 'en' ? '' : `/${locale}`;

  const renderFoodCard = (food: FoodLibraryItem) => (
    <Link
      key={food.id}
      href={`${localePath}/foods/${encodeURIComponent(food.name)}`}
      className="block p-4 rounded-xl border border-border hover:border-primary/30 hover:shadow-md 
        transition-all duration-200 bg-card"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{categoryEmoji[food.category] || '🍽️'}</span>
          <h3 className="font-medium text-foreground">{food.name}</h3>
        </div>
        <span className="text-sm font-semibold text-primary">{food.caloriesPer100g} kcal</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        每100g · {food.standardServingDesc || `标准份${food.standardServingG}g`}
      </p>
      <div className="flex gap-2">
        {food.proteinPer100g != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${getNutrientColor('蛋白质')}`}>
            蛋白质 {food.proteinPer100g}g
          </span>
        )}
        {food.fatPer100g != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${getNutrientColor('脂肪')}`}>
            脂肪 {food.fatPer100g}g
          </span>
        )}
        {food.carbsPer100g != null && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${getNutrientColor('碳水')}`}>
            碳水 {food.carbsPer100g}g
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="搜索食物名称，如：米饭、鸡胸肉..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-muted/50 
                  text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 
                  focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
              {query && (
                <button
                  onClick={() => {
                    clearSearch();
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full 
                    hover:bg-muted-foreground/20 transition-colors"
                >
                  <svg
                    className="w-4 h-4 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {!showSearchResults && categories.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">食物分类</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => handleCategoryClick(cat.category)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all
                    ${
                      activeCategory === cat.category
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted hover:bg-muted/80 text-foreground'
                    }`}
                >
                  <span>{categoryEmoji[cat.category] || '🍽️'}</span>
                  <span>{cat.category}</span>
                  <span className="text-xs opacity-70">({cat.count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {searching && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">搜索中...</span>
          </div>
        )}

        {showSearchResults && !searching && results.length === 0 && (
          <div className="text-center py-12">
            <span className="text-4xl">🔍</span>
            <p className="mt-2 text-muted-foreground">未找到「{query}」相关食物</p>
            <p className="text-sm text-muted-foreground mt-1">试试搜索其他关键词</p>
          </div>
        )}

        {showCategoryFoods && loadingCategory && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!searching && displayFoods.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">
              {showSearchResults
                ? `搜索结果（${results.length}）`
                : showCategoryFoods
                  ? `${activeCategory}（${categoryFoods.length}）`
                  : '热门食物'}
            </h2>
            <div className="grid gap-3">{displayFoods.map(renderFoodCard)}</div>
          </div>
        )}

        {!showSearchResults && !showCategoryFoods && !searching && (
          <p className="text-center text-xs text-muted-foreground py-4">
            数据来源于中国食物成分表，仅供参考
          </p>
        )}
      </main>
    </div>
  );
}
