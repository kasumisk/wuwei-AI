'use client';

import { useCallback } from 'react';
import { useSubscriptionStore } from '@/features/subscription/store/subscription-store';
import type { SubscriptionTier, PaywallInfo } from '@/types/subscription';

/**
 * 全局订阅状态 hook
 *
 * 用法:
 * - 读取当前 tier: `const { tier, isFree, isPro, isPremium } = useSubscription()`
 * - 从 API 响应更新: `updateTier('pro')`
 * - 触发 paywall: `triggerPaywall({ code: 'quota_exceeded', message: '...', recommendedTier: 'pro' })`
 */
export function useSubscription() {
  const { tier, pendingPaywall, showPaywall, setTier, triggerPaywall, dismissPaywall } =
    useSubscriptionStore();

  const updateTier = useCallback(
    (newTier: SubscriptionTier) => {
      setTier(newTier);
    },
    [setTier]
  );

  return {
    tier,
    isFree: tier === 'free',
    isPro: tier === 'pro',
    isPremium: tier === 'premium',
    isPaid: tier !== 'free',

    pendingPaywall,
    showPaywall,

    updateTier,
    triggerPaywall,
    dismissPaywall,
  };
}

/**
 * 从 API 响应中自动提取 entitlement.tier 并更新全局状态
 * 在分析相关 API 调用后调用此函数
 */
export function extractTierFromResponse(response: Record<string, unknown>): void {
  const entitlement = response?.entitlement as { tier?: SubscriptionTier } | undefined;
  if (entitlement?.tier) {
    useSubscriptionStore.getState().setTier(entitlement.tier);
  }
}

/**
 * 从 API 错误响应中提取 paywall 信息并触发弹窗
 * 在 API error handler 中调用
 */
export function handlePaywallError(error: Record<string, unknown>): boolean {
  const paywall = error?.paywall as PaywallInfo | undefined;
  if (paywall?.code && paywall?.recommendedTier) {
    useSubscriptionStore.getState().triggerPaywall(paywall);
    return true;
  }
  return false;
}
