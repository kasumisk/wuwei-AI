'use client';

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { AppUserInfo } from '@/lib/api/app-auth';

interface AuthState {
  /** 当前用户信息 */
  user: AppUserInfo | null;
  /** JWT token */
  token: string | null;
  /** 是否已初始化（已尝试恢复登录态） */
  initialized: boolean;
  /** 登录中 */
  loading: boolean;

  /** 设置登录态 */
  setAuth: (user: AppUserInfo, token: string) => void;
  /** 清除登录态 */
  clearAuth: () => void;
  /** 更新用户信息 */
  updateUser: (partial: Partial<AppUserInfo>) => void;
  /** 标记已初始化 */
  setInitialized: () => void;
  /** 设置 loading */
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        token: null,
        initialized: false,
        loading: false,

        setAuth: (user, token) => {
          // 同步写入 localStorage 供 axios 拦截器读取
          if (typeof window !== 'undefined') {
            localStorage.setItem('app_auth_token', token);
          }
          set({ user, token, initialized: true });
        },

        clearAuth: () => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('app_auth_token');
          }
          set({ user: null, token: null });
        },

        updateUser: (partial) =>
          set((state) => ({
            user: state.user ? { ...state.user, ...partial } : null,
          })),

        setInitialized: () => set({ initialized: true }),
        setLoading: (loading) => set({ loading }),
      }),
      {
        name: 'app-auth-storage',
        partialize: (state) => ({
          user: state.user,
          token: state.token,
        }),
      },
    ),
  ),
);
