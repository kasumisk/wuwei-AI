'use client';

import { useQuery } from '@tanstack/react-query';
import { foodRecordService } from '@/lib/api/food-record';
import { recommendationService } from '@/lib/api/recommendation';
import { profileService } from '@/lib/api/profile';

export function useHomeData() {
  const summaryQuery = useQuery({
    queryKey: ['summary', 'today'],
    queryFn: () => foodRecordService.getTodaySummary(),
    staleTime: 60 * 1000,
  });

  const recordsQuery = useQuery({
    queryKey: ['records', 'today'],
    queryFn: () => foodRecordService.queryRecords(),
    staleTime: 60 * 1000,
  });

  const suggestionQuery = useQuery({
    queryKey: ['meal-suggestion'],
    queryFn: () => recommendationService.getMealSuggestion(),
    staleTime: 5 * 60 * 1000,
  });

  const reminderQuery = useQuery({
    queryKey: ['proactive-check'],
    queryFn: () => recommendationService.proactiveCheck(),
    staleTime: 10 * 60 * 1000,
  });

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.getProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const recentSummariesQuery = useQuery({
    queryKey: ['recent-summaries', 7],
    queryFn: () => foodRecordService.getRecentSummaries(7),
    staleTime: 5 * 60 * 1000,
  });

  const nutritionScoreQuery = useQuery({
    queryKey: ['nutrition-score'],
    queryFn: () => foodRecordService.getNutritionScore(),
    staleTime: 5 * 60 * 1000,
  });

  return {
    summary: summaryQuery.data ?? {
      totalCalories: 0,
      calorieGoal: 2000,
      mealCount: 0,
      remaining: 2000,
    },
    records: recordsQuery.data?.items ?? [],
    suggestion: suggestionQuery.data ?? null,
    reminder: reminderQuery.data?.reminder ?? null,
    profile: profileQuery.data ?? null,
    recentSummaries: recentSummariesQuery.data ?? [],
    nutritionScore: nutritionScoreQuery.data ?? null,
    isLoading:
      summaryQuery.isLoading ||
      recordsQuery.isLoading ||
      profileQuery.isLoading ||
      nutritionScoreQuery.isLoading ||
      suggestionQuery.isLoading ||
      reminderQuery.isLoading ||
      recentSummariesQuery.isLoading,
  };
}
