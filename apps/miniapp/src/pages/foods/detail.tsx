import React, { useState, useEffect } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import * as foodLibrary from '@/services/food-library';
import type { FoodLibraryItem } from '@/types/api';
import './detail.scss';

const mealTypes = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '加餐' },
];

function FoodDetailPage() {
  const router = useRouter();
  const name = decodeURIComponent(router.params.name || '');
  const [food, setFood] = useState<FoodLibraryItem | null>(null);
  const [related, setRelated] = useState<FoodLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mealType, setMealType] = useState('lunch');
  const [grams, setGrams] = useState(100);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (name) loadDetail();
  }, [name]);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const res = await foodLibrary.getByName(name);
      setFood(res.food);
      setRelated(res.relatedFoods || []);
      if (res.food.standardServingG) setGrams(res.food.standardServingG);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!food) return;
    setAdding(true);
    try {
      await foodLibrary.addFromLibrary(food.id, grams, mealType);
      Taro.showToast({ title: '已添加到今日记录', icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '添加失败', icon: 'none' });
    } finally {
      setAdding(false);
    }
  };

  if (loading)
    return (
      <View className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Text className="text-sm text-gray-400">加载中...</Text>
      </View>
    );
  if (!food)
    return (
      <View className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Text className="text-sm text-gray-400">未找到该食物</Text>
      </View>
    );

  const factor = grams / 100;
  const cal = Math.round(food.caloriesPer100g * factor);

  return (
    <View className="min-h-screen bg-gray-50 p-5">
      <View className="mb-5">
        <Text className="block text-2xl font-bold">{food.name}</Text>
        <Text className="block text-xs text-gray-400 mt-1">{food.category}</Text>
      </View>

      <View className="bg-white  p-5 mb-4">
        <View className="text-center mb-4">
          <Text className="text-4xl font-bold text-blue-500">{cal}</Text>
          <Text className="text-sm text-gray-500 ml-1">千卡 / {grams}g</Text>
        </View>
        <View className="flex justify-around">
          <View className="text-center">
            <Text className="block text-base font-semibold">
              {food.proteinPer100g != null ? Math.round(food.proteinPer100g * factor) : '-'}g
            </Text>
            <Text className="block text-xs text-gray-400 mt-1">蛋白质</Text>
          </View>
          <View className="text-center">
            <Text className="block text-base font-semibold">
              {food.fatPer100g != null ? Math.round(food.fatPer100g * factor) : '-'}g
            </Text>
            <Text className="block text-xs text-gray-400 mt-1">脂肪</Text>
          </View>
          <View className="text-center">
            <Text className="block text-base font-semibold">
              {food.carbsPer100g != null ? Math.round(food.carbsPer100g * factor) : '-'}g
            </Text>
            <Text className="block text-xs text-gray-400 mt-1">碳水</Text>
          </View>
          {food.fiberPer100g != null && (
            <View className="text-center">
              <Text className="block text-base font-semibold">
                {Math.round(food.fiberPer100g * factor)}g
              </Text>
              <Text className="block text-xs text-gray-400 mt-1">膳食纤维</Text>
            </View>
          )}
        </View>
      </View>

      <View className="bg-white  p-5 mb-4">
        <Text className="block text-sm font-semibold mb-3">份量 (克)</Text>
        <View className="flex gap-2 flex-wrap">
          {[50, 100, 150, 200, food.standardServingG].filter(Boolean).map((g) => (
            <View
              key={g}
              className={`detail-gram-btn px-4 py-2  text-xs ${grams === g ? 'bg-blue-50 text-blue-500 detail-gram-btn--active' : 'bg-gray-50 text-gray-600'}`}
              onClick={() => setGrams(g!)}
            >
              <Text>{g}g</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="bg-white  p-5 mb-5">
        <Text className="block text-sm font-semibold mb-3">添加到</Text>
        <View className="flex gap-2">
          {mealTypes.map((m) => (
            <View
              key={m.key}
              className={`detail-gram-btn flex-1 text-center py-2  text-xs ${mealType === m.key ? 'bg-blue-50 text-blue-500 detail-gram-btn--active' : 'bg-gray-50 text-gray-600'}`}
              onClick={() => setMealType(m.key)}
            >
              <Text>{m.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Button className="detail-add-btn" loading={adding} onClick={handleAdd}>
        添加 {cal} 千卡到 {mealTypes.find((m) => m.key === mealType)?.label}
      </Button>

      {related.length > 0 && (
        <View className="mt-5">
          <Text className="block text-base font-semibold mb-3">相关食物</Text>
          {related.map((r) => (
            <View
              key={r.id}
              className="flex items-center justify-between bg-white  p-4 mb-2"
              onClick={() =>
                Taro.navigateTo({ url: '/pages/foods/detail?name=' + encodeURIComponent(r.name) })
              }
            >
              <Text className="text-sm">{r.name}</Text>
              <Text className="text-sm text-blue-500">{r.caloriesPer100g} kcal/100g</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default FoodDetailPage;
