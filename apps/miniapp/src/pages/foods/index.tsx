import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import * as foodLibrary from '@/services/food-library';
import type { FoodLibraryItem, FoodCategory } from '@/types/api';
import './index.scss';

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
  海鲜: '🦐',
  蛋奶: '🥚',
};

function FoodsPage() {
  const [searchText, setSearchText] = useState('');
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [foods, setFoods] = useState<FoodLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadCategories();
    loadPopular();
  }, []);

  const loadCategories = async () => {
    try {
      const c = await foodLibrary.getCategories();
      setCategories(c);
    } catch {}
  };

  const loadPopular = async (category?: string) => {
    setLoading(true);
    try {
      const r = await foodLibrary.getPopular(category, 30);
      setFoods(r);
    } catch {
      setFoods([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(
    (text: string) => {
      setSearchText(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        loadPopular(activeCategory || undefined);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const r = await foodLibrary.search(text, 20);
          setFoods(r.items || []);
        } catch {
          setFoods([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [activeCategory]
  );

  const handleCategoryClick = (catName: string) => {
    const c = activeCategory === catName ? '' : catName;
    setActiveCategory(c);
    setSearchText('');
    loadPopular(c || undefined);
  };

  return (
    <View className="flex flex-col h-screen bg-gray-50">
      <View className="px-5 py-4 bg-white">
        <Input
          className="foods-search-input w-full"
          placeholder="搜索食物..."
          value={searchText}
          onInput={(e) => handleSearch(e.detail.value)}
        />
      </View>

      <ScrollView
        scrollX
        className="foods-categories bg-white border-b border-gray-100 px-5 py-3"
        enableFlex
      >
        {categories.map((cat) => (
          <View
            key={cat.name}
            className={`foods-cat inline-flex flex-col items-center px-3 py-2 rounded-xl mr-2 ${activeCategory === cat.name ? 'bg-blue-50 foods-cat--active' : 'bg-gray-50'}`}
            onClick={() => handleCategoryClick(cat.name)}
          >
            <Text className="text-xl">{categoryEmoji[cat.name] || '🍽️'}</Text>
            <Text className="text-xs mt-1 whitespace-nowrap">{cat.name}</Text>
            <Text className="text-xs text-gray-400" style={{ fontSize: '20rpx' }}>
              {cat.count}
            </Text>
          </View>
        ))}
      </ScrollView>

      <ScrollView scrollY className="flex-1 px-5 py-3">
        {loading ? (
          <View className="py-20 text-center">
            <Text className="text-sm text-gray-400">加载中...</Text>
          </View>
        ) : foods.length === 0 ? (
          <View className="py-20 text-center">
            <Text className="text-sm text-gray-400">暂无结果</Text>
          </View>
        ) : (
          foods.map((food) => (
            <View
              className="flex items-center bg-white rounded-xl p-4 mb-2"
              key={food.id}
              onClick={() =>
                Taro.navigateTo({
                  url: '/pages/foods/detail?name=' + encodeURIComponent(food.name),
                })
              }
            >
              <Text className="text-2xl mr-3">{categoryEmoji[food.category] || '🍽️'}</Text>
              <View className="flex-1 min-w-0">
                <Text className="block text-sm font-medium">{food.name}</Text>
                <View className="flex gap-1 mt-1 flex-wrap">
                  {food.proteinPer100g != null && (
                    <Text className="foods-tag foods-tag--protein">
                      蛋白 {food.proteinPer100g}g
                    </Text>
                  )}
                  {food.fatPer100g != null && (
                    <Text className="foods-tag foods-tag--fat">脂肪 {food.fatPer100g}g</Text>
                  )}
                  {food.carbsPer100g != null && (
                    <Text className="foods-tag foods-tag--carbs">碳水 {food.carbsPer100g}g</Text>
                  )}
                </View>
              </View>
              <View className="text-right ml-3 shrink-0">
                <Text className="block text-base font-bold text-blue-500">
                  {food.caloriesPer100g}
                </Text>
                <Text className="block text-xs text-gray-400" style={{ fontSize: '20rpx' }}>
                  kcal/100g
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default FoodsPage;
