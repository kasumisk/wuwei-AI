'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { gamificationService } from '@/lib/api/gamification';

export function useChallenges() {
  const queryClient = useQueryClient();

  const achievementsQuery = useQuery({
    queryKey: ['achievements'],
    queryFn: () => gamificationService.getAchievements(),
    staleTime: 5 * 60 * 1000,
  });

  const challengesQuery = useQuery({
    queryKey: ['challenges'],
    queryFn: () => gamificationService.getChallenges(),
    staleTime: 5 * 60 * 1000,
  });

  const streakQuery = useQuery({
    queryKey: ['streak'],
    queryFn: () => gamificationService.getStreak(),
    staleTime: 5 * 60 * 1000,
  });

  const joinMutation = useMutation({
    mutationFn: (challengeId: string) => gamificationService.joinChallenge(challengeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges'] });
    },
  });

  return {
    achievements: achievementsQuery.data?.all ?? [],
    unlockedAchievements: achievementsQuery.data?.unlocked ?? [],
    challenges: challengesQuery.data?.available ?? [],
    activeChallenges: challengesQuery.data?.active ?? [],
    streak: streakQuery.data ?? { current: 0, longest: 0, todayStatus: 'on_track' as const },
    isLoading: achievementsQuery.isLoading || challengesQuery.isLoading,
    joinChallenge: joinMutation.mutateAsync,
    isJoining: joinMutation.isPending,
  };
}
