'use client';

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { SubscriptionTier, PaywallInfo } from '@/types/subscription';

interface SubscriptionState {
  /** 当前订阅等级 */
  tier: SubscriptionTier;
  /** 最后一次 paywall 信息（用于展示弹窗） */
  pendingPaywall: PaywallInfo | null;
  /** 是否正在显示 paywall */
  showPaywall: boolean;

  /** 设置订阅等级（从 API 响应中提取） */
  setTier: (tier: SubscriptionTier) => void;
  /** 触发 paywall */
  triggerPaywall: (info: PaywallInfo) => void;
  /** 关闭 paywall */
  dismissPaywall: () => void;
  /** 重置 */
  reset: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  devtools(
    persist(
      (set) => ({
        tier: 'free',
        pendingPaywall: null,
        showPaywall: false,

        setTier: (tier) => set({ tier }),

        triggerPaywall: (info) => set({ pendingPaywall: info, showPaywall: true }),

        dismissPaywall: () => set({ showPaywall: false, pendingPaywall: null }),

        reset: () => set({ tier: 'free', pendingPaywall: null, showPaywall: false }),
      }),
      {
        name: 'app-subscription-storage',
        partialize: (state) => ({
          tier: state.tier,
        }),
      }
    )
  )
);
