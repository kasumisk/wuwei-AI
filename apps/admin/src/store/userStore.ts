import type { UserDto } from '@ai-platform/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserState {
  user: UserDto | null;
  token: string | null;
  isLoading: boolean;

  // Actions
  setUser: (user: UserDto) => void;
  setToken: (token: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      logout: () => set({ user: null, token: null }),
      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
);
