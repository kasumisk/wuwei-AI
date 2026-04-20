'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import type { AnalysisResult, FoodItem, FoodRecord, AnalysisHistoryResponse } from '@/types/food';

export function useFoodAnalysis() {
  const [analyzing, setAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const analyzeImage = useCallback(
    async (file: File, mealType?: string): Promise<AnalysisResult> => {
      setAnalyzing(true);
      try {
        return await foodRecordService.analyzeImage(file, mealType);
      } finally {
        setAnalyzing(false);
      }
    },
    []
  );

  const analyzeText = useCallback(
    async (text: string, mealType?: string): Promise<AnalysisResult> => {
      setAnalyzing(true);
      try {
        return await foodRecordService.analyzeText({
          text,
          mealType: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined,
        });
      } finally {
        setAnalyzing(false);
      }
    },
    []
  );

  const saveMutation = useMutation({
    mutationFn: (data: {
      requestId?: string;
      imageUrl?: string;
      foods: FoodItem[];
      totalCalories: number;
      mealType?: string;
      advice?: string;
      isHealthy?: boolean;
      decision?: string;
      riskLevel?: string;
      reason?: string;
      suggestion?: string;
      insteadOptions?: string[];
      compensation?: { diet?: string; activity?: string; nextMeal?: string };
      contextComment?: string;
      encouragement?: string;
      // V6: 营养维度
      totalProtein?: number;
      totalFat?: number;
      totalCarbs?: number;
      avgQuality?: number;
      avgSatiety?: number;
      nutritionScore?: number;
    }) =>
      foodRecordService.createRecord({
        foods: data.foods,
        totalCalories: data.totalCalories,
        mealType: data.mealType || 'lunch',
        source: 'decision',
        totalProtein: data.totalProtein,
        totalFat: data.totalFat,
        totalCarbs: data.totalCarbs,
        avgQuality: data.avgQuality,
        avgSatiety: data.avgSatiety,
        nutritionScore: data.nutritionScore,
        advice: data.advice,
        isHealthy: data.isHealthy,
        imageUrl: data.imageUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['analysis-history'] });
    },
  });

  /** 简化保存：只需 analysisId */
  const saveAnalysisMutation = useMutation({
    mutationFn: (data: { analysisId: string; mealType?: string; recordedAt?: string }) =>
      foodRecordService.saveAnalysis({
        analysisId: data.analysisId,
        mealType: data.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined,
        recordedAt: data.recordedAt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      queryClient.invalidateQueries({ queryKey: ['analysis-history'] });
    },
  });

  /** 删除饮食记录 */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => foodRecordService.deleteRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['analysis-history'] });
    },
  });

  /** 删除分析记录（分析历史） */
  const deleteAnalysisMutation = useMutation({
    mutationFn: (analysisId: string) => foodRecordService.deleteAnalysis(analysisId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis-history'] });
    },
  });

  return {
    analyzing,
    analyzeImage,
    analyzeText,
    saveRecord: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveAnalysis: saveAnalysisMutation.mutateAsync,
    isSavingAnalysis: saveAnalysisMutation.isPending,
    deleteRecord: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    deleteAnalysis: deleteAnalysisMutation.mutateAsync,
    isDeletingAnalysis: deleteAnalysisMutation.isPending,
  };
}

/** 分析历史 hook */
export function useAnalysisHistory(params?: {
  page?: number;
  pageSize?: number;
  inputType?: 'text' | 'image';
  enabled?: boolean;
}) {
  return useQuery<AnalysisHistoryResponse>({
    queryKey: ['analysis-history', params?.page, params?.pageSize, params?.inputType],
    queryFn: () =>
      foodRecordService.getAnalysisHistory({
        page: params?.page,
        pageSize: params?.pageSize,
        inputType: params?.inputType,
      }),
    enabled: params?.enabled !== false,
  });
}

/** 单个分析详情 hook */
export function useAnalysisDetail(analysisId: string | null) {
  return useQuery<AnalysisResult>({
    queryKey: ['analysis-detail', analysisId],
    queryFn: () => foodRecordService.getAnalysisDetail(analysisId!),
    enabled: !!analysisId,
  });
}

/** 近 N 天营养汇总 hook */
export function useRecentSummaries(days: number = 7) {
  return useQuery({
    queryKey: ['recent-summaries', days],
    queryFn: () => foodRecordService.getRecentSummaries(days),
    staleTime: 5 * 60 * 1000,
  });
}
