import React, { useState } from 'react';
import { View, Text, Image, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import * as foodService from '@/services/food';
import type { AnalysisResult, FoodItem } from '@/types/api';
import './index.scss';

type Step = 'upload' | 'analyzing' | 'result' | 'saved';

const mealTypes = [
  { key: 'breakfast', label: '早餐', emoji: '🌅' },
  { key: 'lunch', label: '午餐', emoji: '☀️' },
  { key: 'dinner', label: '晚餐', emoji: '🌙' },
  { key: 'snack', label: '加餐', emoji: '🍪' },
];

function AnalyzePage() {
  const [step, setStep] = useState<Step>('upload');
  const [mealType, setMealType] = useState('lunch');
  const [imagePath, setImagePath] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editFoods, setEditFoods] = useState<FoodItem[]>([]);
  const [saving, setSaving] = useState(false);

  const handleChooseImage = () => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => setImagePath(res.tempFilePaths[0]),
    });
  };

  const handleAnalyze = async () => {
    if (!imagePath) return Taro.showToast({ title: '请先选择图片', icon: 'none' });
    setStep('analyzing');
    try {
      const res = await foodService.analyzeImage(imagePath, mealType);
      setResult(res);
      setEditFoods(res.foods || []);
      setStep('result');
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '分析失败', icon: 'none' });
      setStep('upload');
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const totalCalories = editFoods.reduce((sum, f) => sum + (f.calories || 0), 0);
      await foodService.saveRecord({
        foods: editFoods,
        totalCalories,
        mealType,
        imageUrl: result.imageUrl,
        advice: result.advice,
        isHealthy: result.isHealthy,
        source: 'camera',
      });
      setStep('saved');
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setImagePath('');
    setResult(null);
    setEditFoods([]);
  };

  if (step === 'upload') {
    return (
      <View className="min-h-screen bg-gray-50 p-5">
        <View className="mb-5">
          <Text className="block text-base font-semibold mb-3">选择餐类</Text>
          <View className="flex gap-2">
            {mealTypes.map((m) => (
              <View
                key={m.key}
                className={`flex-1 text-center py-3 rounded-xl ${mealType === m.key ? 'bg-blue-50 meal-active' : 'bg-white'}`}
                onClick={() => setMealType(m.key)}
              >
                <Text className="block text-xl">{m.emoji}</Text>
                <Text className="block text-xs mt-1">{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="mb-5">
          <Text className="block text-base font-semibold mb-3">拍照或上传图片</Text>
          <View
            className="upload-area bg-white rounded-2xl overflow-hidden"
            onClick={handleChooseImage}
          >
            {imagePath ? (
              <Image className="w-full upload-img" src={imagePath} mode="aspectFill" />
            ) : (
              <View className="flex flex-col items-center justify-center py-16">
                <Text className="text-5xl mb-4">📷</Text>
                <Text className="block text-base text-gray-600">点击拍照或选择图片</Text>
                <Text className="block text-xs text-gray-400 mt-1">支持 JPG、PNG、HEIC</Text>
              </View>
            )}
          </View>
        </View>

        <Button className="analyze-btn" disabled={!imagePath} onClick={handleAnalyze}>
          🔍 开始 AI 分析
        </Button>
      </View>
    );
  }

  if (step === 'analyzing') {
    return (
      <View className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <Text className="text-6xl mb-4">🔬</Text>
        <Text className="block text-xl font-semibold">AI 正在分析食物...</Text>
        <Text className="block text-sm text-gray-400 mt-2">识别食物种类和营养成分</Text>
      </View>
    );
  }

  if (step === 'saved') {
    return (
      <View className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8">
        <Text className="text-6xl mb-4">✅</Text>
        <Text className="block text-xl font-semibold mb-8">记录已保存</Text>
        <Button className="analyze-btn mb-4" onClick={handleReset}>
          继续记录
        </Button>
        <Button
          className="analyze-btn-outline"
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          返回首页
        </Button>
      </View>
    );
  }

  const totalCal = editFoods.reduce((s, f) => s + (f.calories || 0), 0);

  return (
    <View className="min-h-screen bg-gray-50 p-5">
      {imagePath && (
        <Image className="w-full rounded-2xl mb-4 result-img" src={imagePath} mode="aspectFill" />
      )}

      <View className="bg-white rounded-2xl p-5 mb-4">
        <View className="flex items-baseline gap-1">
          <Text className="text-4xl font-bold text-blue-500">{totalCal}</Text>
          <Text className="text-sm text-gray-500">千卡</Text>
          {result?.isHealthy != null && (
            <View
              className={`ml-2 px-2 py-1 rounded-full text-xs ${result.isHealthy ? 'bg-green-50 text-green-500' : 'bg-yellow-50 text-yellow-500'}`}
            >
              <Text>{result.isHealthy ? '健康' : '偏高'}</Text>
            </View>
          )}
        </View>
        {result?.advice && (
          <Text className="block text-sm text-gray-500 mt-3 leading-relaxed">
            💡 {result.advice}
          </Text>
        )}
      </View>

      <View className="mb-5">
        <Text className="block text-base font-semibold mb-3">识别到的食物</Text>
        {editFoods.map((food, idx) => (
          <View
            className="flex items-center justify-between bg-white rounded-xl p-4 mb-2"
            key={idx}
          >
            <View className="flex-1">
              <Text className="block text-sm font-medium">{food.name}</Text>
              {food.quantity && (
                <Text className="block text-xs text-gray-400 mt-1">{food.quantity}</Text>
              )}
            </View>
            <View className="flex items-center gap-3">
              <Text className="text-sm text-blue-500 font-medium">{food.calories} 千卡</Text>
              <Text
                className="text-sm text-red-400 px-1"
                onClick={() => setEditFoods((prev) => prev.filter((_, i) => i !== idx))}
              >
                ✕
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View className="flex gap-3 pb-8">
        <Button className="analyze-btn-outline flex-1" onClick={handleReset}>
          重新上传
        </Button>
        <Button className="analyze-btn flex-1" loading={saving} onClick={handleSave}>
          确认保存
        </Button>
      </View>
    </View>
  );
}

export default AnalyzePage;
