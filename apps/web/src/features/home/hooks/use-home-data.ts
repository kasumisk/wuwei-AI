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
    queryFn: () => foodRecordService.getTodayRecords(),
    staleTime: 60 * 1000,
  });

  const suggestionQuery = useQuery({
    queryKey: ['meal-suggestion'],
    queryFn: () => recommendationService.getMealSuggestion(),
    staleTime: 5 * 60 * 1000,
  });

  const dailyPlanQuery = useQuery({
    queryKey: ['daily-plan'],
    queryFn: () => recommendationService.getDailyPlan(),
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

  return {
    summary: summaryQuery.data ?? {
      totalCalories: 0,
      calorieGoal: 2000,
      mealCount: 0,
      remaining: 2000,
    },
    records: recordsQuery.data ?? [],
    suggestion: suggestionQuery.data ?? null,
    dailyPlan: dailyPlanQuery.data ?? null,
    reminder: reminderQuery.data?.reminder ?? null,
    profile: profileQuery.data ?? null,
    isLoading: summaryQuery.isLoading || recordsQuery.isLoading,
  };
}
