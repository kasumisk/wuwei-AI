'use client';

/**
 * 订阅与支付 API 服务
 *
 * 支持两种模式：
 * - 真实模式：调用后端 API 完成支付
 * - 模拟模式（MOCK_PAYMENT=true）：本地模拟支付流程，可跑通完整订阅流
 */

import { clientGet, clientPost } from './client-api';
import type { ApiResponse } from './http-client';
import type {
  SubscriptionPlan,
  SubscriptionTier,
  WechatPayAppParams,
  WechatOrderQuery,
  AppleIAPVerifyResult,
} from '@/types/subscription';

// ── 模拟支付开关 ──
// 通过环境变量控制：NEXT_PUBLIC_MOCK_PAYMENT=true 启用模拟支付
// 未设置时默认 true（开发阶段），生产环境应设为 false
const MOCK_PAYMENT = process.env.NEXT_PUBLIC_MOCK_PAYMENT !== 'false';

// ── 模拟支付失败概率（0-1），用于测试错误处理流程 ──
// NEXT_PUBLIC_MOCK_PAYMENT_FAIL_RATE=0.2 表示 20% 概率失败
const MOCK_FAIL_RATE = parseFloat(process.env.NEXT_PUBLIC_MOCK_PAYMENT_FAIL_RATE || '0');

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

/** 模拟延迟 */
function mockDelay(ms = 1500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 硬编码种子计划（当 API 不可用或模拟模式时使用） ──
const SEED_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_free',
    name: '免费版',
    description: '基础功能，每日有限次数',
    tier: 'free',
    billingCycle: 'monthly',
    priceCents: 0,
    currency: 'CNY',
    entitlements: {
      recommendation: 3,
      ai_image_analysis: 3,
      ai_text_analysis: 20,
      ai_coach: 5,
      analysis_history: 3,
      detailed_score: false,
      advanced_explain: false,
      deep_nutrition: false,
      personalized_alternatives: false,
      reports: false,
      weekly_plan: false,
      full_day_linkage: false,
      recipe_generation: false,
      health_trend: false,
      priority_ai: false,
      data_export: false,
    },
    sortOrder: 0,
    isActive: true,
  },
  {
    id: 'plan_pro_monthly',
    name: 'Pro 月度',
    description: '解锁高级分析与无限教练',
    tier: 'pro',
    billingCycle: 'monthly',
    priceCents: 1990,
    currency: 'CNY',
    entitlements: {
      recommendation: -1,
      ai_image_analysis: 20,
      ai_text_analysis: -1,
      ai_coach: -1,
      analysis_history: -1,
      detailed_score: true,
      advanced_explain: true,
      deep_nutrition: true,
      personalized_alternatives: true,
      reports: true,
      weekly_plan: false,
      full_day_linkage: false,
      recipe_generation: false,
      health_trend: false,
      priority_ai: false,
      data_export: 'csv',
    },
    wechatProductId: 'pro_monthly',
    appleProductId: 'com.wuwei.pro.monthly',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'plan_pro_yearly',
    name: 'Pro 年度',
    description: '解锁高级分析与无限教练（年付优惠）',
    tier: 'pro',
    billingCycle: 'yearly',
    priceCents: 19080,
    currency: 'CNY',
    entitlements: {
      recommendation: -1,
      ai_image_analysis: 20,
      ai_text_analysis: -1,
      ai_coach: -1,
      analysis_history: -1,
      detailed_score: true,
      advanced_explain: true,
      deep_nutrition: true,
      personalized_alternatives: true,
      reports: true,
      weekly_plan: false,
      full_day_linkage: false,
      recipe_generation: false,
      health_trend: false,
      priority_ai: false,
      data_export: 'csv',
    },
    wechatProductId: 'pro_yearly',
    appleProductId: 'com.wuwei.pro.yearly',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'plan_premium_monthly',
    name: 'Premium 月度',
    description: '全部功能无限制',
    tier: 'premium',
    billingCycle: 'monthly',
    priceCents: 3990,
    currency: 'CNY',
    entitlements: {
      recommendation: -1,
      ai_image_analysis: -1,
      ai_text_analysis: -1,
      ai_coach: -1,
      analysis_history: -1,
      detailed_score: true,
      advanced_explain: true,
      deep_nutrition: true,
      personalized_alternatives: true,
      reports: true,
      weekly_plan: true,
      full_day_linkage: true,
      recipe_generation: true,
      health_trend: true,
      priority_ai: true,
      data_export: 'pdf_excel',
    },
    wechatProductId: 'premium_monthly',
    appleProductId: 'com.wuwei.premium.monthly',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 'plan_premium_yearly',
    name: 'Premium 年度',
    description: '全部功能无限制（年付优惠）',
    tier: 'premium',
    billingCycle: 'yearly',
    priceCents: 38280,
    currency: 'CNY',
    entitlements: {
      recommendation: -1,
      ai_image_analysis: -1,
      ai_text_analysis: -1,
      ai_coach: -1,
      analysis_history: -1,
      detailed_score: true,
      advanced_explain: true,
      deep_nutrition: true,
      personalized_alternatives: true,
      reports: true,
      weekly_plan: true,
      full_day_linkage: true,
      recipe_generation: true,
      health_trend: true,
      priority_ai: true,
      data_export: 'pdf_excel',
    },
    wechatProductId: 'premium_yearly',
    appleProductId: 'com.wuwei.premium.yearly',
    sortOrder: 2,
    isActive: true,
  },
];

export const subscriptionService = {
  // ── 订阅计划查询 ──

  /** 获取可用的订阅计划列表（激活状态）— 直接读取 API */
  getPlans: async (): Promise<SubscriptionPlan[]> => {
    const res = await unwrap(clientGet<{ list: SubscriptionPlan[] }>('/app/subscription/plans'));
    return res.list;
  },

  /** 获取当前用户配额使用状态 */
  getQuotaStatus: async (): Promise<{
    tier: SubscriptionTier;
    quotas: Array<{
      feature: string;
      used: number;
      limit: number;
      remaining: number;
      unlimited: boolean;
      resetAt: string | null;
    }>;
  }> => {
    return unwrap(clientGet('/app/subscription/quota-status'));
  },

  // ── 模拟支付：购买指定计划 ──

  /** 模拟购买（仅 MOCK 模式可用），返回新的 tier */
  mockPurchase: async (planId: string): Promise<{ tier: SubscriptionTier; orderNo: string }> => {
    await mockDelay(2000);

    // 模拟随机失败（用于测试错误处理）
    if (MOCK_FAIL_RATE > 0 && Math.random() < MOCK_FAIL_RATE) {
      const errors = ['支付超时，请重试', '网络连接异常，支付未完成', '支付渠道繁忙，请稍后再试'];
      throw new Error(errors[Math.floor(Math.random() * errors.length)]);
    }

    const plan = SEED_PLANS.find((p) => p.id === planId);
    if (!plan) throw new Error('计划不存在');
    const orderNo = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return { tier: plan.tier, orderNo };
  },

  /** 是否处于模拟支付模式 */
  isMockMode: () => MOCK_PAYMENT,

  // ── 微信支付（真实模式） ──

  /** 创建微信支付订单 */
  createWechatOrder: async (planId: string): Promise<WechatPayAppParams> => {
    if (MOCK_PAYMENT) {
      await mockDelay(1000);
      return {
        appid: 'mock_appid',
        partnerid: 'mock_partnerid',
        prepayid: `mock_prepay_${Date.now()}`,
        package: 'Sign=WXPay',
        noncestr: 'mock_nonce',
        timestamp: String(Math.floor(Date.now() / 1000)),
        sign: 'mock_sign',
      };
    }
    return unwrap(
      clientPost<WechatPayAppParams>('/app/subscription/wechat/create-order', { planId })
    );
  },

  /** 查询微信订单状态 */
  queryWechatOrder: async (orderNo: string): Promise<WechatOrderQuery> => {
    if (MOCK_PAYMENT) {
      await mockDelay(500);
      return {
        orderNo,
        transactionId: `mock_txn_${Date.now()}`,
        tradeState: 'SUCCESS',
        tradeStateDesc: '支付成功（模拟）',
        amount: { total: 1990, currency: 'CNY' },
      };
    }
    return unwrap(clientGet<WechatOrderQuery>(`/app/subscription/wechat/query/${orderNo}`));
  },

  // ── Apple IAP（真实模式） ──

  /** 验证 Apple IAP 购买 */
  verifyAppleIAP: async (
    transactionId: string,
    productId: string
  ): Promise<AppleIAPVerifyResult> => {
    if (MOCK_PAYMENT) {
      await mockDelay(1000);
      return {
        transactionId,
        productId,
        expiresDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    return unwrap(
      clientPost<AppleIAPVerifyResult>('/app/subscription/apple/verify', {
        transactionId,
        productId,
      })
    );
  },
};
