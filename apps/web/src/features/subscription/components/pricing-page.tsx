'use client';

/**
 * PricingPage — 定价页 /pricing
 *
 * 三档对比（Free / Pro / Premium）：
 * - 功能对比表
 * - 购买/升级按钮（模拟支付模式直接走 mock）
 * - 当前方案高亮
 */

import { useState, useCallback } from 'react';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { subscriptionService } from '@/lib/api/subscription';
import { useLocalizedRouter } from '@/lib/hooks/use-localized-router';
import { useToast } from '@/lib/hooks/use-toast';
import { TIER_COMPARISON } from '@/types/subscription';
import type { SubscriptionTier } from '@/types/subscription';

/** 等级显示信息 */
const TIERS: {
  tier: SubscriptionTier;
  name: string;
  price: string;
  priceNote: string;
  badge?: string;
  planId: string;
  color: string;
}[] = [
  {
    tier: 'free',
    name: '免费版',
    price: '¥0',
    priceNote: '永久免费',
    planId: 'plan_free',
    color: 'border-border',
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: '¥19.9',
    priceNote: '/月',
    badge: '推荐',
    planId: 'plan_pro_monthly',
    color: 'border-primary',
  },
  {
    tier: 'premium',
    name: 'Premium',
    price: '¥39.9',
    priceNote: '/月',
    planId: 'plan_premium_monthly',
    color: 'border-amber-500',
  },
];

export function PricingPage() {
  const { push, router } = useLocalizedRouter();
  const { tier: currentTier, updateTier } = useSubscription();
  const { toast } = useToast();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [downgradeConfirm, setDowngradeConfirm] = useState<{
    planId: string;
    targetTier: SubscriptionTier;
  } | null>(null);

  /** 安全返回：有历史则 back()，否则跳首页 */
  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      push('/');
    }
  }, [router, push]);

  /** 确认降级 */
  const confirmDowngrade = useCallback(() => {
    if (!downgradeConfirm) return;
    updateTier(downgradeConfirm.targetTier);
    toast({
      title: `已切换到${TIERS.find((t) => t.tier === downgradeConfirm.targetTier)?.name || '免费版'}`,
    });
    setDowngradeConfirm(null);
  }, [downgradeConfirm, updateTier, toast]);

  const handlePurchase = useCallback(
    async (planId: string, targetTier: SubscriptionTier) => {
      if (purchasing) return;

      // 如果已经是当前等级
      if (targetTier === currentTier) {
        toast({ title: '您已经是该方案' });
        return;
      }

      // 降级操作：弹确认框
      const isDowngrade =
        (targetTier === 'free' && currentTier !== 'free') ||
        (targetTier === 'pro' && currentTier === 'premium');
      if (isDowngrade) {
        setDowngradeConfirm({ planId, targetTier });
        return;
      }

      setPurchasing(planId);
      try {
        if (subscriptionService.isMockMode()) {
          const result = await subscriptionService.mockPurchase(planId);
          updateTier(result.tier);
          toast({
            title: `已升级到 ${TIERS.find((t) => t.tier === result.tier)?.name || result.tier}（模拟支付）`,
          });
        } else {
          // 真实模式：创建微信订单
          await subscriptionService.createWechatOrder(planId);
          // TODO: 调起微信支付 SDK / 轮询
          toast({ title: '订单已创建，请在微信中完成支付' });
        }
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : '支付失败',
          variant: 'destructive',
        });
      } finally {
        setPurchasing(null);
      }
    },
    [purchasing, currentTier, updateTier, toast]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center px-6 py-4 max-w-lg mx-auto">
          <button
            onClick={handleBack}
            aria-label="返回"
            className="mr-4 text-foreground/70 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold font-headline tracking-tight">选择方案</h1>
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        {/* 副标题 */}
        <p className="text-sm text-muted-foreground mb-6 text-center">
          选择最适合你的计划，让 AI 营养管家为你服务
        </p>

        {/* 三列卡片 */}
        <div className="space-y-4 mb-8">
          {TIERS.map((t) => {
            const isCurrent = currentTier === t.tier;
            const isUpgrade =
              (t.tier === 'pro' && currentTier === 'free') ||
              (t.tier === 'premium' && currentTier !== 'premium');
            const isDowngrade =
              (t.tier === 'free' && currentTier !== 'free') ||
              (t.tier === 'pro' && currentTier === 'premium');

            return (
              <div
                key={t.tier}
                className={`relative rounded-2xl border-2 ${t.color} bg-card overflow-hidden transition-all ${
                  isCurrent ? 'ring-2 ring-primary/30' : ''
                }`}
              >
                {/* 徽章 */}
                {t.badge && (
                  <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1 rounded-bl-xl">
                    {t.badge}
                  </div>
                )}

                <div className="p-5">
                  {/* 标题行 */}
                  <div className="flex items-baseline gap-2 mb-1">
                    <h3 className="text-lg font-extrabold">{t.name}</h3>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        当前方案
                      </span>
                    )}
                  </div>

                  {/* 价格 */}
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-3xl font-extrabold">{t.price}</span>
                    <span className="text-sm text-muted-foreground">{t.priceNote}</span>
                  </div>

                  {/* CTA */}
                  {isCurrent ? (
                    <div className="w-full py-3 rounded-xl bg-muted text-center text-sm font-bold text-muted-foreground">
                      当前方案
                    </div>
                  ) : isUpgrade ? (
                    <button
                      onClick={() => handlePurchase(t.planId, t.tier)}
                      disabled={!!purchasing}
                      className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {purchasing === t.planId ? (
                        <>
                          <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          处理中...
                        </>
                      ) : (
                        `升级到 ${t.name}`
                      )}
                    </button>
                  ) : isDowngrade ? (
                    <button
                      onClick={() => handlePurchase(t.planId, t.tier)}
                      disabled={!!purchasing}
                      className="w-full py-3 rounded-xl bg-muted text-foreground font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      切换到 {t.name}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* 功能对比表 */}
        <div className="bg-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <h3 className="text-sm font-bold">功能对比</h3>
          </div>

          {/* 表头 */}
          <div className="grid grid-cols-4 gap-0 px-4 py-2 bg-muted/50 text-xs font-bold text-muted-foreground">
            <div className="col-span-1">功能</div>
            <div className="text-center">免费版</div>
            <div className="text-center">Pro</div>
            <div className="text-center">Premium</div>
          </div>

          {/* 表体 */}
          {TIER_COMPARISON.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-4 gap-0 px-4 py-2.5 text-xs ${
                i % 2 === 0 ? '' : 'bg-muted/20'
              }`}
            >
              <div className="col-span-1 font-medium">{row.label}</div>
              <FeatureCell value={row.free} tier="free" currentTier={currentTier} />
              <FeatureCell value={row.pro} tier="pro" currentTier={currentTier} />
              <FeatureCell value={row.premium} tier="premium" currentTier={currentTier} />
            </div>
          ))}
        </div>

        {/* 模拟模式提示 */}
        {subscriptionService.isMockMode() && (
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
            <p className="text-xs text-amber-700 font-medium">
              [DEV] 模拟支付模式 — 所有购买将直接成功，不产生实际扣费
            </p>
          </div>
        )}
      </main>

      {/* 降级确认弹窗 */}
      {downgradeConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setDowngradeConfirm(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="downgrade-title"
            className="relative bg-card rounded-2xl shadow-2xl w-[90%] max-w-sm p-6 animate-in zoom-in-95 duration-200"
          >
            <h3 id="downgrade-title" className="text-lg font-extrabold mb-2">
              确定降级方案？
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              切换到{TIERS.find((t) => t.tier === downgradeConfirm.targetTier)?.name || '免费版'}
              后，您将失去以下功能：
            </p>
            <ul className="space-y-1.5 mb-5">
              {TIER_COMPARISON.filter((row) => {
                const currentVal = row[currentTier];
                const targetVal = row[downgradeConfirm.targetTier];
                if (currentVal !== false && targetVal === false) return true;
                if (
                  typeof currentVal === 'string' &&
                  typeof targetVal === 'string' &&
                  currentVal !== targetVal
                )
                  return true;
                return false;
              })
                .slice(0, 6)
                .map((row) => (
                  <li key={row.label} className="flex items-center gap-2 text-sm text-destructive">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {row.label}
                  </li>
                ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setDowngradeConfirm(null)}
                className="flex-1 py-3 rounded-xl bg-muted text-foreground font-bold text-sm active:scale-[0.98] transition-all"
              >
                取消
              </button>
              <button
                onClick={confirmDowngrade}
                className="flex-1 py-3 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm active:scale-[0.98] transition-all"
              >
                确认降级
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 单元格渲染：布尔 → 图标，字符串 → 文字 */
function FeatureCell({
  value,
  tier,
  currentTier,
}: {
  value: string | boolean;
  tier: SubscriptionTier;
  currentTier: SubscriptionTier;
}) {
  const isCurrent = tier === currentTier;

  if (typeof value === 'boolean') {
    return (
      <div className="flex justify-center">
        {value ? (
          <svg
            className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-green-500'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-muted-foreground/40" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
    );
  }

  return (
    <div className={`text-center ${isCurrent ? 'text-primary font-bold' : 'text-foreground'}`}>
      {value}
    </div>
  );
}
