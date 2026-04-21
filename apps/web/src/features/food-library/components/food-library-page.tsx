'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFoodLibrary } from '@/features/food-library/hooks/use-food-library';
import {
  foodLibraryClientAPI,
  type FoodLibraryItem,
  type FoodCategory,
  type FrequentFood,
} from '@/lib/api/food-library';

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

/** 构造食物描述文本，用于预填分析页输入框 */
function buildFoodDraft(food: FoodLibraryItem): string {
  const servingDesc = food.standardServingDesc || `${food.standardServingG || 100}g`;
  return `${food.name} ${servingDesc}`;
}

export function FoodLibraryPage({
  locale,
  initialCategories,
  initialPopularFoods,
}: FoodLibraryPageProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // ── 多选"待分析篮" ──
  const [basket, setBasket] = useState<FoodLibraryItem[]>([]);
  const basketIds = useMemo(() => new Set(basket.map((f) => f.id)), [basket]);

  const toggleBasket = useCallback((food: FoodLibraryItem) => {
    setBasket((prev) => {
      if (prev.some((f) => f.id === food.id)) {
        return prev.filter((f) => f.id !== food.id);
      }
      return [...prev, food];
    });
  }, []);

  const clearBasket = useCallback(() => setBasket([]), []);

  /** 确认：将全部食物合成文本，跳转分析页触发 AI 决策 */
  const confirmAnalyze = useCallback(() => {
    if (basket.length === 0) return;
    const draft = basket.map(buildFoodDraft).join('，');
    try {
      sessionStorage.setItem('analyze_text_draft', draft);
    } catch {
      /* ignore */
    }
    setBasket([]);
    router.push('/analyze?tab=text');
  }, [basket, router]);

  // 常吃食物
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [frequentLoaded, setFrequentLoaded] = useState(false);

  useEffect(() => {
    foodLibraryClientAPI
      .getFrequentFoods(8)
      .then((data) => {
        setFrequentFoods(data);
        setFrequentLoaded(true);
      })
      .catch(() => setFrequentLoaded(true));
  }, []);

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
    searchError,
    categoryError,
    retryCategory,
  } = useFoodLibrary({ initialCategories, initialPopularFoods });

  const localePath = locale === 'en' ? '' : `/${locale}`;

  const renderFoodCard = (food: FoodLibraryItem) => {
    const selected = basketIds.has(food.id);
    return (
      <div
        key={food.id}
        className={`p-4 border  transition-all duration-200 bg-card ${
          selected
            ? 'border-primary shadow-md ring-1 ring-primary/20'
            : 'border-border hover:border-primary/30 hover:shadow-md'
        }`}
      >
        <div className="flex items-start justify-between mb-2">
          <Link
            href={`${localePath}/foods/${encodeURIComponent(food.name)}`}
            className="flex items-center gap-2 flex-1 min-w-0"
          >
            <span className="text-lg">{categoryEmoji[food.category] || '🍽️'}</span>
            <h3 className="font-medium text-foreground">{food.name}</h3>
            {food.isVerified && (
              <span
                className="shrink-0 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 "
                title="官方验证数据"
              >
                ✓ 已验证
              </span>
            )}
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold text-primary">{food.calories} kcal</span>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleBasket(food);
              }}
              aria-pressed={selected}
              aria-label={selected ? `取消选择 ${food.name}` : `选择 ${food.name} 进行分析`}
              className={`w-8 h-8 flex items-center justify-center text-lg font-bold active:scale-95 transition-all shadow-sm ${
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-primary/10'
              }`}
              title={selected ? '已加入分析篮' : '加入分析篮'}
            >
              {selected ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              ) : (
                '+'
              )}
            </button>
          </div>
        </div>
        <Link href={`${localePath}/foods/${encodeURIComponent(food.name)}`} className="block">
          <p className="text-xs text-muted-foreground mb-2">
            每100g · {food.standardServingDesc || `标准份${food.standardServingG}g`}
            {food.aliases && food.aliases.length > 0 && (
              <span className="ml-1">· 又名: {food.aliases.split(',').slice(0, 3).join('、')}</span>
            )}
          </p>
          <div className="flex gap-2">
            {food.protein != null && (
              <span className={`text-xs px-2 py-0.5  ${getNutrientColor('蛋白质')}`}>
                蛋白质 {food.protein}g
              </span>
            )}
            {food.fat != null && (
              <span className={`text-xs px-2 py-0.5  ${getNutrientColor('脂肪')}`}>
                脂肪 {food.fat}g
              </span>
            )}
            {food.carbs != null && (
              <span className={`text-xs px-2 py-0.5  ${getNutrientColor('碳水')}`}>
                碳水 {food.carbs}g
              </span>
            )}
          </div>
        </Link>
      </div>
    );
  };

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
                className="w-full pl-10 pr-4 py-2.5  border border-border bg-muted/50 
                  text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 
                  focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
              {query && (
                <button
                  onClick={() => {
                    clearSearch();
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5  
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

      <main
        className={`max-w-2xl mx-auto px-4 py-4 space-y-6 ${
          basket.length > 0 ? 'pb-44' : 'pb-24'
        }`}
      >
        {/* 顶部提示：多选模式说明 */}
        <div className="bg-primary/5 border border-primary/15  px-3 py-2 text-xs text-primary/90">
          💡 选择一个或多个食物，确认后进入 AI 分析决策
        </div>

        {/* 常吃食物快捷区 */}
        {!showSearchResults && frequentLoaded && frequentFoods.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">⚡ 你的常吃食物</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {frequentFoods.map((ff) => {
                const selected = ff.food ? basketIds.has(ff.food.id) : false;
                return (
                  <button
                    key={ff.name}
                    onClick={() => {
                      if (ff.food) toggleBasket(ff.food);
                    }}
                    disabled={!ff.food}
                    aria-pressed={selected}
                    className={`shrink-0 flex items-center gap-2 px-3 py-2 border transition-all active:scale-[0.97] disabled:opacity-50 ${
                      selected
                        ? 'bg-primary/10 border-primary ring-1 ring-primary/20'
                        : 'bg-card border-border hover:border-primary/30'
                    }`}
                  >
                    <span className="text-sm">{categoryEmoji[ff.food?.category || ''] || '🍽️'}</span>
                    <div className="text-left">
                      <p className="text-xs font-bold">{ff.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        吃过{ff.count}次{ff.food ? ` · ${ff.food.calories}kcal/100g` : ''}
                      </p>
                    </div>
                    {selected && (
                      <svg
                        className="w-4 h-4 text-primary"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!showSearchResults && categories.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground px-1">食物分类</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => handleCategoryClick(cat.category)}
                  className={`flex items-center gap-1.5 px-3 py-1.5  text-sm transition-all
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
            <div className="w-6 h-6 border-2 border-primary border-t-transparent  animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">搜索中...</span>
          </div>
        )}

        {showSearchResults && !searching && results.length === 0 && (
          <div className="text-center py-12">
            {searchError ? (
              <>
                <span className="text-4xl">⚠️</span>
                <p className="mt-2 text-muted-foreground">搜索出错，请稍后重试</p>
                <button
                  onClick={() => onQueryChange(query)}
                  className="mt-3 text-sm text-primary hover:underline"
                >
                  重新搜索
                </button>
              </>
            ) : (
              <>
                <span className="text-4xl">🔍</span>
                <p className="mt-2 text-muted-foreground">未找到「{query}」相关食物</p>
                <p className="text-sm text-muted-foreground mt-1">试试搜索其他关键词</p>
              </>
            )}
          </div>
        )}

        {showCategoryFoods && loadingCategory && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent  animate-spin" />
          </div>
        )}

        {showCategoryFoods && !loadingCategory && categoryError && (
          <div className="text-center py-8">
            <span className="text-3xl">⚠️</span>
            <p className="mt-2 text-sm text-muted-foreground">加载分类失败，请稍后重试</p>
            <button onClick={retryCategory} className="mt-2 text-sm text-primary hover:underline">
              重试
            </button>
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

      {/* 底部浮动确认栏 */}
      {basket.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg animate-in slide-in-from-bottom duration-200">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">已选 {basket.length} 个食物</p>
              <p className="text-sm font-medium truncate">
                {basket.map((f) => f.name).join('、')}
              </p>
            </div>
            <button
              onClick={clearBasket}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              清空
            </button>
            <button
              onClick={confirmAnalyze}
              className="shrink-0 bg-primary text-primary-foreground font-bold text-sm px-5 py-2.5 rounded-md active:scale-95 transition-all shadow-md"
            >
              开始 AI 分析 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
