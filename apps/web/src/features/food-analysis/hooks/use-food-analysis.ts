'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import type { AnalysisResult, FoodItem, FoodRecord } from '@/types/food';

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
    }) => foodRecordService.saveRecord(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  return {
    analyzing,
    analyzeImage,
    saveRecord: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
