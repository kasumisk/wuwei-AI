'use client';

import { useState, useCallback } from 'react';
import { foodService, type AnalysisResult, type FoodRecord, type DailySummary, type UserProfile, type FoodItem, type DailySummaryRecord } from '@/lib/api/food';

/**
 * 饮食记录 + AI 分析 hook
 */
export function useFood() {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  /** 上传图片 AI 分析 */
  const analyzeImage = useCallback(async (file: File, mealType?: string): Promise<AnalysisResult> => {
    setAnalyzing(true);
    try {
      return await foodService.analyzeImage(file, mealType);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  /** 保存饮食记录 */
  const saveRecord = useCallback(async (data: {
    requestId?: string;
    imageUrl?: string;
    foods: FoodItem[];
    totalCalories: number;
    mealType?: string;
    advice?: string;
    isHealthy?: boolean;
  }): Promise<FoodRecord> => {
    setLoading(true);
    try {
      return await foodService.saveRecord(data);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 获取今日记录 */
  const getTodayRecords = useCallback(async (): Promise<FoodRecord[]> => {
    return foodService.getTodayRecords();
  }, []);

  /** 分页查询记录 */
  const getRecords = useCallback(async (params?: { page?: number; limit?: number; date?: string }) => {
    return foodService.getRecords(params);
  }, []);

  /** 删除记录 */
  const deleteRecord = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    try {
      await foodService.deleteRecord(id);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 获取今日汇总 */
  const getTodaySummary = useCallback(async (): Promise<DailySummary> => {
    return foodService.getTodaySummary();
  }, []);

  /** 获取最近 N 天汇总 */
  const getRecentSummaries = useCallback(async (days?: number): Promise<DailySummaryRecord[]> => {
    return foodService.getRecentSummaries(days);
  }, []);

  /** 获取用户档案 */
  const getProfile = useCallback(async (): Promise<UserProfile | null> => {
    return foodService.getProfile();
  }, []);

  /** 保存用户档案 */
  const saveProfile = useCallback(async (data: {
    gender?: string;
    birthYear?: number;
    heightCm?: number;
    weightKg?: number;
    targetWeightKg?: number;
    activityLevel?: string;
    dailyCalorieGoal?: number;
  }): Promise<UserProfile> => {
    setLoading(true);
    try {
      return await foodService.saveProfile(data);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    analyzing,
    analyzeImage,
    saveRecord,
    getTodayRecords,
    getRecords,
    deleteRecord,
    getTodaySummary,
    getRecentSummaries,
    getProfile,
    saveProfile,
  };
}
