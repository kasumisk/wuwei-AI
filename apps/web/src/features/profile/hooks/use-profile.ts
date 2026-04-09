'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';
import type { UserProfile } from '@/types/user';

export function useProfile() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.getProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const behaviorQuery = useQuery({
    queryKey: ['profile', 'behavior'],
    queryFn: () => profileService.getBehaviorProfile(),
    staleTime: 10 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<UserProfile>) => profileService.saveProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return {
    profile: profileQuery.data,
    behaviorProfile: behaviorQuery.data,
    isLoading: profileQuery.isLoading,
    isBehaviorLoading: behaviorQuery.isLoading,
    updateProfile: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    refetchProfile: profileQuery.refetch,
  };
}
