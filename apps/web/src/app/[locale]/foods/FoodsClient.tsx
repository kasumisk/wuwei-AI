'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  foodLibraryClientAPI,
  type FoodLibraryItem,
  type FoodCategory,
} from '@/lib/api/food-library';

interface FoodsClientProps {
  locale: string;
  initialCategories: FoodCategory[];
  initialPopularFoods: FoodLibraryItem[];
}

// 分类 emoji 映射
const categoryEmoji: Record<string, string> = {
  '主食': '🍚',
  '肉类': '🥩',
  '蔬菜': '🥬',
  '水果': '🍎',
  '豆制品': '🫘',
  '汤类': '🍲',
  '饮品': '🥤',
  '零食': '🍪',
  '快餐': '🍔',
  '调味料': '🧂',
};

function getNutrientColor(label: string) {
  switch (label) {
    case '蛋白质': return 'text-blue-600 bg-blue-50';
    case '脂肪': return 'text-amber-600 bg-amber-50';
    case '碳水': return 'text-green-600 bg-green-50';
    default: return 'text-gray-600 bg-gray-50';
  }
}

export default function FoodsClient({
  locale,
  initialCategories,
  initialPopularFoods,
}: FoodsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodLibraryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categoryFoods, setCategoryFoods] = useState<FoodLibraryItem[]>([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 搜索
  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await foodLibraryClientAPI.search(q, 20);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // 防抖搜索
  const onInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        setResults([]);
        return;
      }
      debounceRef.current = setTimeout(() => handleSearch(value), 300);
    },
    [handleSearch],
  );

  // 分类筛选
  const handleCategoryClick = useCallback(async (category: string) => {
    if (activeCategory === category) {
      setActiveCategory(null);
      setCategoryFoods([]);
      return;
    }
    setActiveCategory(category);
    setLoadingCategory(true);
    try {
      const data = await foodLibraryClientAPI.getPopular(category, 50);
      setCategoryFoods(data);
    } catch {
      setCategoryFoods([]);
    } finally {
      setLoadingCategory(false);
    }
  }, [activeCategory]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const localePath = locale === 'en' ? '' : `/${locale}`;

  // 渲染食物卡片
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
        <span className="text-sm font-semibold text-primary">
          {food.caloriesPer100g} kcal
        </span>
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

  // 判断展示内容
  const showSearchResults = query.trim().length > 0;
  const showCategoryFoods = activeCategory && !showSearchResults;
  const displayFoods = showSearchResults
    ? results
    : showCategoryFoods
      ? categoryFoods
      : initialPopularFoods;

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder="搜索食物名称，如：米饭、鸡胸肉..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-muted/50 
                  text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 
                  focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full 
                    hover:bg-muted-foreground/20 transition-colors"
                >
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {/* 分类标签 */}
        {!showSearchResults && initialCategories.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">食物分类</h2>
            <div className="flex flex-wrap gap-2">
              {initialCategories.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => handleCategoryClick(cat.category)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all
                    ${activeCategory === cat.category
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

        {/* 搜索状态 */}
        {searching && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">搜索中...</span>
          </div>
        )}

        {/* 搜索无结果 */}
        {showSearchResults && !searching && results.length === 0 && (
          <div className="text-center py-12">
            <span className="text-4xl">🔍</span>
            <p className="mt-2 text-muted-foreground">
              未找到「{query}」相关食物
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              试试搜索其他关键词
            </p>
          </div>
        )}

        {/* 分类加载中 */}
        {showCategoryFoods && loadingCategory && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* 食物列表 */}
        {!searching && displayFoods.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">
              {showSearchResults
                ? `搜索结果（${results.length}）`
                : showCategoryFoods
                  ? `${activeCategory}（${categoryFoods.length}）`
                  : '热门食物'}
            </h2>
            <div className="grid gap-3">
              {displayFoods.map(renderFoodCard)}
            </div>
          </div>
        )}

        {/* 底部提示 */}
        {!showSearchResults && !showCategoryFoods && !searching && (
          <p className="text-center text-xs text-muted-foreground py-4">
            数据来源于中国食物成分表，仅供参考
          </p>
        )}
      </main>
    </div>
  );
}
