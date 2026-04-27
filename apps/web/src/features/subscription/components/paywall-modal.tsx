'use client';

/**
 * PaywallModal — 全局 paywall 弹窗
 *
 * 当用户触碰付费功能时弹出：
 * - 展示当前受限原因
 * - 推荐升级方案（Pro / Premium）
 * - 两个 CTA：查看定价页 / 关闭
 *
 * 使用方式：在 root layout 中放置一个 <PaywallModal />，
 * 各页面通过 useSubscription().triggerPaywall(...) 触发。
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { useQuotaStatus } from '@/features/subscription/hooks/use-quota-status';
import { subscriptionService } from '@/lib/api/subscription';
import { useLocalizedRouter } from '@/lib/hooks/use-localized-router';
import { useToast } from '@/lib/hooks/use-toast';
import type { SubscriptionTier } from '@/types/subscription';

/** 等级显示名 */
const TIER_NAMES: Record<SubscriptionTier, string> = {
  free: '免费版',
  pro: 'Pro',
  premium: 'Premium',
};

/** 等级价格标签 */
const TIER_PRICES: Record<SubscriptionTier, string> = {
  free: '免费',
  pro: '¥19.9/月',
  premium: '¥39.9/月',
};

/** 等级亮点（简短，用于弹窗中快速展示）— 功能描述，非配额数字 */
const TIER_HIGHLIGHTS: Record<SubscriptionTier, string[]> = {
  free: [],
  pro: ['更多图片分析次数', '无限文字分析', '无限AI教练', '全部分析历史', '详细评分+深度分析'],
  premium: ['无限全部功能', '全天计划联动', '食谱生成', '健康趋势分析', '优先AI响应'],
};

/** 触发场景 → 用户友好文案 */
const SCENE_MESSAGES: Record<string, string> = {
  analysis_limit: '今日分析次数已用完',
  advanced_result: '该功能为高级版专属',
  history_view: '免费版仅可查看最近3条历史',
  precision_upgrade: '升级后可获得更精准的分析',
};

export function PaywallModal() {
  const { push } = useLocalizedRouter();
  const { showPaywall, pendingPaywall, dismissPaywall, tier, updateTier } = useSubscription();
  const { coach: coachQuota, imageAnalysis, textAnalysis } = useQuotaStatus();
  const { toast } = useToast();
  const [purchasing, setPurchasing] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const recommendedTier = pendingPaywall?.recommendedTier || 'pro';

  // ── Body scroll lock ──
  useEffect(() => {
    if (!showPaywall) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [showPaywall]);

  // ── Escape key + Focus trap ──
  useEffect(() => {
    if (!showPaywall) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissPaywall();
        return;
      }
      // Simple focus trap: Tab cycles within modal
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Auto-focus modal on open
    modalRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPaywall, dismissPaywall]);

  const handleUpgrade = useCallback(async () => {
    if (purchasing) return;

    // 如果是模拟模式，直接在弹窗内完成模拟购买
    if (subscriptionService.isMockMode()) {
      setPurchasing(true);
      try {
        const planId = recommendedTier === 'premium' ? 'plan_premium_monthly' : 'plan_pro_monthly';
        const result = await subscriptionService.mockPurchase(planId);
        updateTier(result.tier);
        dismissPaywall();
        toast({ title: `已升级到 ${TIER_NAMES[result.tier]}（模拟支付）` });
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : '支付失败',
          variant: 'destructive',
        });
      } finally {
        setPurchasing(false);
      }
      return;
    }

    // 真实模式：跳转到定价页
    dismissPaywall();
    push('/pricing');
  }, [purchasing, recommendedTier, dismissPaywall, push, updateTier, toast]);

  const handleViewPricing = useCallback(() => {
    dismissPaywall();
    push('/pricing');
  }, [dismissPaywall, push]);

  if (!showPaywall || !pendingPaywall) return null;

  const sceneMessage =
    SCENE_MESSAGES[pendingPaywall.triggerScene || ''] ||
    pendingPaywall.message ||
    '升级解锁更多功能';

  // 升级后多出的功能 — 使用 TIER_HIGHLIGHTS 展示简短描述
  const upgradeHighlights = TIER_HIGHLIGHTS[recommendedTier] || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop — 不响应点击关闭，防止误触 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        aria-describedby="paywall-desc"
        tabIndex={-1}
        className="relative w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 outline-none"
      >
        {/* 顶部装饰 */}
        <div className="bg-gradient-to-br from-primary to-primary/80 px-4 pt-6 pb-8 text-primary-foreground">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-medium bg-primary-foreground/20 px-2.5 py-1 ">
              当前：{TIER_NAMES[tier]}
            </span>
            <button
              onClick={dismissPaywall}
              className="w-8 h-8 flex items-center justify-center  bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors"
              aria-label="关闭"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <h2 id="paywall-title" className="text-xl font-extrabold mb-1">
            {sceneMessage}
          </h2>
          <p id="paywall-desc" className="text-sm text-primary-foreground/80">
            升级到 {TIER_NAMES[recommendedTier]}，享受更强大的 AI 营养管理
          </p>
        </div>

        {/* 功能对比 */}
        <div className="px-4 py-5 space-y-3">
          {/* 当前配额使用情况 */}
          {(imageAnalysis || textAnalysis || coachQuota) && (
            <div className="bg-muted/60 rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
              <p className="font-semibold text-muted-foreground mb-1">今日用量</p>
              {imageAnalysis && !imageAnalysis.unlimited && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">图片分析</span>
                  <span
                    className={
                      imageAnalysis.remaining === 0 ? 'text-red-500 font-bold' : 'text-foreground'
                    }
                  >
                    {imageAnalysis.used}/{imageAnalysis.limit}
                  </span>
                </div>
              )}
              {textAnalysis && !textAnalysis.unlimited && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">文字分析</span>
                  <span
                    className={
                      textAnalysis.remaining === 0 ? 'text-red-500 font-bold' : 'text-foreground'
                    }
                  >
                    {textAnalysis.used}/{textAnalysis.limit}
                  </span>
                </div>
              )}
              {coachQuota && !coachQuota.unlimited && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI 教练</span>
                  <span
                    className={
                      coachQuota.remaining === 0 ? 'text-red-500 font-bold' : 'text-foreground'
                    }
                  >
                    {coachQuota.used}/{coachQuota.limit}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 推荐等级亮点 */}
          <div className="space-y-2">
            {(TIER_HIGHLIGHTS[recommendedTier] || []).map((highlight, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <svg
                  className="w-4 h-4 text-primary flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm">{highlight}</span>
              </div>
            ))}
          </div>

          {/* 新增功能亮点 */}
          {upgradeHighlights.length > 0 && (
            <div className="pt-2 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-2">升级后解锁</p>
              <div className="flex flex-wrap gap-1.5">
                {upgradeHighlights.map((label) => (
                  <span
                    key={label}
                    className="px-2.5 py-1 bg-primary/5 text-primary text-xs font-medium "
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CTA 按钮 */}
        <div className="px-4 pb-6 pt-2 space-y-3">
          <button
            onClick={handleUpgrade}
            disabled={purchasing}
            className="w-full bg-primary text-primary-foreground font-bold py-4  flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            {purchasing ? (
              <>
                <span className="animate-spin inline-block w-5 h-5 border-2 border-current border-t-transparent " />
                处理中...
              </>
            ) : (
              <>
                升级到 {TIER_NAMES[recommendedTier]}
                <span className="text-sm font-normal opacity-80">
                  {TIER_PRICES[recommendedTier]}
                </span>
              </>
            )}
          </button>

          <button
            onClick={handleViewPricing}
            className="w-full text-sm text-muted-foreground font-medium py-2 hover:text-foreground transition-colors"
          >
            查看全部方案对比
          </button>
        </div>

        {/* 模拟模式标识 — 仅 development 构建可见 */}
        {process.env.NODE_ENV === 'development' && subscriptionService.isMockMode() && (
          <div className="bg-amber-50 border-t border-amber-200 px-4 py-2 text-center">
            <p className="text-[11px] text-amber-700 font-medium">
              [DEV] 模拟支付模式 — 点击升级将直接成功
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
