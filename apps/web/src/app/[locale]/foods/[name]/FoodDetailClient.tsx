'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import { foodLibraryClientAPI, type FoodLibraryItem } from '@/lib/api/food-library';

interface FoodDetailClientProps {
  locale: string;
  food: FoodLibraryItem;
  relatedFoods: FoodLibraryItem[];
}

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

const mealTypeLabels: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export default function FoodDetailClient({ locale, food, relatedFoods }: FoodDetailClientProps) {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [servingGrams, setServingGrams] = useState(food.standardServingG);
  const [mealType, setMealType] = useState('lunch');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  // 按份量计算营养数据
  const computed = useMemo(() => {
    const ratio = servingGrams / 100;
    return {
      calories: Math.round(food.calories * ratio),
      protein: food.protein != null ? +(food.protein * ratio).toFixed(1) : null,
      fat: food.fat != null ? +(food.fat * ratio).toFixed(1) : null,
      carbs: food.carbs != null ? +(food.carbs * ratio).toFixed(1) : null,
    };
  }, [food, servingGrams]);

  // 添加到饮食记录
  const handleAddRecord = async () => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }
    setAdding(true);
    try {
      await foodLibraryClientAPI.addFromLibrary(food.id, servingGrams, mealType);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
      // 刷新首页相关缓存
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
    } catch {
      toast({
        title: '添加失败',
        description: '记录食物时出错，请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  };

  const localePath = locale === 'en' ? '' : `/${locale}`;

  // 预设份量选项
  const presetServings = [
    { label: '50g', value: 50 },
    { label: '100g', value: 100 },
    {
      label: food.standardServingDesc || `${food.standardServingG}g`,
      value: food.standardServingG,
    },
    { label: '200g', value: 200 },
    { label: '300g', value: 300 },
  ];
  // 去重
  const uniqueServings = presetServings.filter(
    (s, i, arr) => arr.findIndex((a) => a.value === s.value) === i
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
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
          <h1 className="text-lg font-semibold truncate">{food.name}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {/* 食物基本信息 */}
        <div className="bg-linear-to-br from-primary/5 to-primary/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{categoryEmoji[food.category] || '🍽️'}</span>
            <div>
              <h2 className="text-xl font-bold text-foreground">{food.name}</h2>
              <p className="text-sm text-muted-foreground">
                {food.category}
                {food.aliases && ` · ${food.aliases}`}
              </p>
            </div>
          </div>

          {/* 核心热量数据 */}
          <div className="bg-background/80 rounded-xl p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">{servingGrams}g 热量</p>
            <p className="text-4xl font-bold text-primary">
              {computed.calories}
              <span className="text-base font-normal text-muted-foreground ml-1">kcal</span>
            </p>
          </div>
        </div>

        {/* 营养成分详情 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground px-1">
            营养成分（{servingGrams}g）
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 text-center">
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">蛋白质</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">
                {computed.protein ?? '-'}
                <span className="text-xs font-normal ml-0.5">g</span>
              </p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4 text-center">
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">脂肪</p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-300">
                {computed.fat ?? '-'}
                <span className="text-xs font-normal ml-0.5">g</span>
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-xl p-4 text-center">
              <p className="text-xs text-green-600 dark:text-green-400 mb-1">碳水</p>
              <p className="text-xl font-bold text-green-700 dark:text-green-300">
                {computed.carbs ?? '-'}
                <span className="text-xs font-normal ml-0.5">g</span>
              </p>
            </div>
          </div>

          {/* 每100g基准 */}
          <p className="text-xs text-muted-foreground text-center">
            每100g：{food.calories}kcal · 蛋白质{food.protein ?? '-'}g · 脂肪
            {food.fat ?? '-'}g · 碳水{food.carbs ?? '-'}g
          </p>
        </div>

        {/* 份量选择 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground px-1">选择份量</h3>
          <div className="flex flex-wrap gap-2">
            {uniqueServings.map((s) => (
              <button
                key={s.value}
                onClick={() => setServingGrams(s.value)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all
                  ${
                    servingGrams === s.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted hover:bg-muted/80 text-foreground'
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* 自定义份量 */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={500}
              step={10}
              value={servingGrams}
              onChange={(e) => setServingGrams(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-medium w-16 text-right">{servingGrams}g</span>
          </div>
        </div>

        {/* 餐次选择 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground px-1">记录为</h3>
          <div className="flex gap-2">
            {Object.entries(mealTypeLabels).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMealType(key)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all
                  ${
                    mealType === key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted hover:bg-muted/80 text-foreground'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 相关食物 */}
        {relatedFoods.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground px-1">相关食物</h3>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
              {relatedFoods.map((rf) => (
                <Link
                  key={rf.id}
                  href={`${localePath}/foods/${encodeURIComponent(rf.name)}`}
                  className="min-w-35 p-3 rounded-xl border border-border hover:border-primary/30 
                    hover:shadow-sm transition-all bg-card shrink-0"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{categoryEmoji[rf.category] || '🍽️'}</span>
                    <span className="text-sm font-medium truncate">{rf.name}</span>
                  </div>
                  <p className="text-xs text-primary font-semibold">{rf.calories} kcal/100g</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* JSON-LD 结构化数据 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'NutritionInformation',
              name: food.name,
              calories: `${food.calories} kcal`,
              proteinContent: food.protein ? `${food.protein} g` : undefined,
              fatContent: food.fat ? `${food.fat} g` : undefined,
              carbohydrateContent: food.carbs ? `${food.carbs} g` : undefined,
              servingSize: '100g',
            }),
          }}
        />
      </main>

      {/* 底部固定操作栏 */}
      <div className="fixed bottom-[3.5rem] left-0 w-full bg-background/80 backdrop-blur-sm border-t border-border px-4 py-3 pb-safe z-10">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={handleAddRecord}
            disabled={adding}
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all
              ${
                added
                  ? 'bg-green-500 text-white'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]'
              }
              disabled:opacity-60`}
          >
            {adding ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                添加中...
              </span>
            ) : added ? (
              '✓ 已添加到饮食记录'
            ) : (
              `记录 ${computed.calories} kcal 到${mealTypeLabels[mealType]}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
