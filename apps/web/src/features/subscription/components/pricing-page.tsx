'use client';

/**
 * PricingPage — 定价页 /pricing
 *
 * 三档对比（Free / Pro / Premium）：
 * - 功能对比表
 * - 购买/升级按钮（模拟支付模式直接走 mock）
 * - 当前方案高亮
 */

import { useState, useCallback, useEffect } from 'react';
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
  monthlyPrice: string;
  yearlyPrice: string;
  yearlySaving: string;
  priceNoteMonthly: string;
  priceNoteYearly: string;
  badge?: string;
  monthlyPlanId: string;
  yearlyPlanId: string;
  color: string;
}[] = [
  {
    tier: 'free',
    name: '免费版',
    monthlyPrice: '¥0',
    yearlyPrice: '¥0',
    yearlySaving: '',
    priceNoteMonthly: '永久免费',
    priceNoteYearly: '永久免费',
    monthlyPlanId: 'plan_free',
    yearlyPlanId: 'plan_free',
    color: 'border-border',
  },
  {
    tier: 'pro',
    name: 'Pro',
    monthlyPrice: '¥19.9',
    yearlyPrice: '¥15.9',
    yearlySaving: '省20%',
    priceNoteMonthly: '/月',
    priceNoteYearly: '/月 (年付 ¥190.8)',
    badge: '最受欢迎',
    monthlyPlanId: 'plan_pro_monthly',
    yearlyPlanId: 'plan_pro_yearly',
    color: 'border-primary',
  },
  {
    tier: 'premium',
    name: 'Premium',
    monthlyPrice: '¥39.9',
    yearlyPrice: '¥31.9',
    yearlySaving: '省20%',
    priceNoteMonthly: '/月',
    priceNoteYearly: '/月 (年付 ¥382.8)',
    monthlyPlanId: 'plan_premium_monthly',
    yearlyPlanId: 'plan_premium_yearly',
    color: 'border-amber-500',
  },
];

export function PricingPage() {
  const { push, router } = useLocalizedRouter();
  const { tier: currentTier, updateTier } = useSubscription();
  const { toast } = useToast();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [downgradeConfirm, setDowngradeConfirm] = useState<{
    planId: string;
    targetTier: SubscriptionTier;
  } | null>(null);
  const [celebration, setCelebration] = useState<{
    tierName: string;
  } | null>(null);

  // 自动关闭庆祝弹窗
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 4000);
    return () => clearTimeout(timer);
  }, [celebration]);

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
          const tierName = TIERS.find((t) => t.tier === result.tier)?.name || result.tier;
          setCelebration({ tierName });
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
        <div className="flex items-center px-4 py-4 max-w-lg mx-auto">
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

      <main className="px-4 py-6 max-w-lg mx-auto pb-32">
        {/* 副标题 */}
        <p className="text-sm text-muted-foreground mb-4 text-center">
          选择最适合你的计划，让 AI 营养管家为你服务
        </p>

        {/* 月付/年付切换 */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <span
            className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            月付
          </span>
          <button
            onClick={() => setBillingCycle((c) => (c === 'monthly' ? 'yearly' : 'monthly'))}
            role="switch"
            aria-checked={billingCycle === 'yearly'}
            aria-label="切换月付/年付"
            className={`relative w-12 h-7  transition-colors ${
              billingCycle === 'yearly' ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6  bg-white shadow transition-transform ${
                billingCycle === 'yearly' ? 'translate-x-5' : ''
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium ${billingCycle === 'yearly' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            年付
          </span>
          {billingCycle === 'yearly' && (
            <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 ">
              省20%
            </span>
          )}
        </div>

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

            const price = billingCycle === 'yearly' ? t.yearlyPrice : t.monthlyPrice;
            const priceNote = billingCycle === 'yearly' ? t.priceNoteYearly : t.priceNoteMonthly;
            const planId = billingCycle === 'yearly' ? t.yearlyPlanId : t.monthlyPlanId;

            return (
              <div
                key={t.tier}
                className={`relative  border-2 ${t.color} bg-card overflow-hidden transition-all ${
                  isCurrent ? 'ring-2 ring-primary/30' : ''
                } ${t.badge ? 'shadow-lg shadow-primary/10' : ''}`}
              >
                {/* 徽章（最受欢迎 强调） */}
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
                      <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 ">
                        当前方案
                      </span>
                    )}
                  </div>

                  {/* 价格 */}
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-3xl font-extrabold">{price}</span>
                    <span className="text-sm text-muted-foreground">{priceNote}</span>
                    {billingCycle === 'yearly' && t.yearlySaving && (
                      <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5  ml-1">
                        {t.yearlySaving}
                      </span>
                    )}
                  </div>

                  {/* CTA */}
                  {isCurrent ? (
                    <div className="w-full py-3  bg-muted text-center text-sm font-bold text-muted-foreground">
                      当前方案
                    </div>
                  ) : isUpgrade ? (
                    <button
                      onClick={() => handlePurchase(planId, t.tier)}
                      disabled={!!purchasing}
                      className="w-full py-3  bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {purchasing === planId ? (
                        <>
                          <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent " />
                          处理中...
                        </>
                      ) : (
                        `升级到 ${t.name}`
                      )}
                    </button>
                  ) : isDowngrade ? (
                    <button
                      onClick={() => handlePurchase(planId, t.tier)}
                      disabled={!!purchasing}
                      className="w-full py-3  bg-muted text-foreground font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      切换到 {t.name}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* 功能对比表（语义化 table） */}
        <div className="bg-card  overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40">
            <h3 className="text-sm font-bold" id="comparison-heading">
              功能对比
            </h3>
          </div>

          <table className="w-full text-xs" aria-labelledby="comparison-heading">
            <thead>
              <tr className="bg-muted/50">
                <th scope="col" className="text-left px-4 py-2 font-bold text-muted-foreground">
                  功能
                </th>
                <th scope="col" className="text-center px-2 py-2 font-bold text-muted-foreground">
                  免费版
                </th>
                <th scope="col" className="text-center px-2 py-2 font-bold text-muted-foreground">
                  Pro
                </th>
                <th scope="col" className="text-center px-2 py-2 font-bold text-muted-foreground">
                  Premium
                </th>
              </tr>
            </thead>
            <tbody>
              {TIER_COMPARISON.map((row, i) => (
                <tr key={row.label} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                  <th scope="row" className="text-left px-4 py-2.5 font-medium">
                    {row.label}
                  </th>
                  <FeatureCell value={row.free} tier="free" currentTier={currentTier} />
                  <FeatureCell value={row.pro} tier="pro" currentTier={currentTier} />
                  <FeatureCell value={row.premium} tier="premium" currentTier={currentTier} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 模拟模式提示 */}
        {subscriptionService.isMockMode() && (
          <div className="mt-6 bg-amber-50 border border-amber-200  px-4 py-3 text-center">
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
            className="relative bg-card  shadow-2xl w-[90%] max-w-sm p-4 animate-in zoom-in-95 duration-200"
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
                className="flex-1 py-3  bg-muted text-foreground font-bold text-sm active:scale-[0.98] transition-all"
              >
                取消
              </button>
              <button
                onClick={confirmDowngrade}
                className="flex-1 py-3  bg-destructive text-destructive-foreground font-bold text-sm active:scale-[0.98] transition-all"
              >
                确认降级
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 升级成功庆祝弹窗 */}
      {celebration && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setCelebration(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="celebration-title"
            className="relative bg-card  shadow-2xl w-[85%] max-w-sm overflow-hidden animate-in zoom-in-90 duration-300"
          >
            {/* 顶部渐变装饰 */}
            <div className="bg-gradient-to-br from-primary via-primary/90 to-primary/70 px-4 pt-8 pb-6 text-center text-primary-foreground">
              {/* 庆祝图标 */}
              <div className="inline-flex items-center justify-center w-16 h-16  bg-primary-foreground/20 mb-4 animate-bounce">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h3 id="celebration-title" className="text-xl font-extrabold mb-1">
                升级成功！
              </h3>
              <p className="text-sm text-primary-foreground/80">欢迎使用 {celebration.tierName}</p>
            </div>
            <div className="px-4 py-5 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                所有高级功能已解锁，立即体验 AI 营养管家的完整能力
              </p>
              <button
                onClick={() => {
                  setCelebration(null);
                  push('/');
                }}
                className="w-full py-3  bg-primary text-primary-foreground font-bold text-sm active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
              >
                开始使用
              </button>
              <button
                onClick={() => setCelebration(null)}
                className="w-full mt-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                留在当前页
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 单元格渲染：布尔 → 图标，字符串 → 文字（语义化 td） */
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
      <td className="text-center px-2 py-2.5">
        <span className="inline-flex justify-center">
          {value ? (
            <svg
              className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-green-500'}`}
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
          ) : (
            <svg
              className="w-4 h-4 text-muted-foreground/40"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </span>
        <span className="sr-only">{value ? '支持' : '不支持'}</span>
      </td>
    );
  }

  return (
    <td
      className={`text-center px-2 py-2.5 ${isCurrent ? 'text-primary font-bold' : 'text-foreground'}`}
    >
      {value}
    </td>
  );
}
