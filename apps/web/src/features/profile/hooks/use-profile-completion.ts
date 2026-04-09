'use client';

import { useQuery } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';
import { useProfile } from './use-profile';

export function useProfileCompletion() {
  const { profile, isLoading: isProfileLoading } = useProfile();

  const completionQuery = useQuery({
    queryKey: ['profile', 'completion-suggestions'],
    queryFn: () => profileService.getCompletionSuggestions(),
    staleTime: 30 * 60 * 1000,
    enabled: !!profile,
  });

  const goalTransitionQuery = useQuery({
    queryKey: ['profile', 'goal-transition'],
    queryFn: () => profileService.getGoalTransition(),
    staleTime: 60 * 60 * 1000,
    enabled: !!profile,
  });

  const completeness =
    ((profile as unknown as Record<string, unknown>)?.dataCompleteness as number) ?? 0;
  const shouldShowPrompt = completeness < 0.6 && !isProfileLoading;

  return {
    completeness,
    suggestions: completionQuery.data,
    goalTransition: goalTransitionQuery.data,
    shouldShowPrompt,
    isLoading: completionQuery.isLoading,
  };
}
