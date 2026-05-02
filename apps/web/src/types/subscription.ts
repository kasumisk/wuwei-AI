/**
 * 订阅相关类型定义
 */

// ── 订阅等级 ──
export type SubscriptionTier = 'free' | 'pro' | 'premium';

// ── 计费周期 ──
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';

// ── 订阅状态 ──
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'grace_period' | 'paused';

// ── 支付渠道 ──
export type PaymentChannel = 'apple_iap' | 'wechat_pay' | 'alipay' | 'manual';

// ── 支付状态 ──
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded' | 'awaiting_callback';

// ── 受限功能 ──
export type GatedFeature =
  | 'recommendation'
  | 'ai_image_analysis'
  | 'ai_text_analysis'
  | 'ai_coach'
  | 'analysis_history'
  | 'detailed_score'
  | 'advanced_explain'
  | 'deep_nutrition'
  | 'personalized_alternatives'
  | 'reports'
  | 'data_export'
  | 'weekly_plan'
  | 'full_day_linkage'
  | 'recipe_generation'
  | 'health_trend'
  | 'priority_ai';

// ── Paywall 触发场景 ──
export type TriggerScene =
  | 'analysis_limit'
  | 'advanced_result'
  | 'history_view'
  | 'precision_upgrade';

// ── 权限配置 ──
export interface FeatureEntitlements {
  // 计数类配额（-1 = unlimited）
  recommendation: number;
  ai_image_analysis: number;
  ai_text_analysis: number;
  ai_coach: number;
  analysis_history: number;
  // 布尔开关
  detailed_score: boolean;
  advanced_explain: boolean;
  deep_nutrition: boolean;
  personalized_alternatives: boolean;
  reports: boolean;
  weekly_plan: boolean;
  full_day_linkage: boolean;
  recipe_generation: boolean;
  health_trend: boolean;
  priority_ai: boolean;
  // 混合
  data_export: boolean | string; // false, 'csv', 'pdf_excel'
}

// ── Paywall 信息（后端 API 错误响应中携带） ──
export interface PaywallInfo {
  code: string;
  message: string;
  recommendedTier: SubscriptionTier;
  triggerScene?: TriggerScene;
}

// ── 分析结果中附带的权限信息 ──
export interface EntitlementInfo {
  tier: SubscriptionTier;
  fieldsHidden: string[];
}

// ── 订阅计划（用于定价页展示） ──
export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number; // 分为单位
  currency: string;
  entitlements: FeatureEntitlements;
  appleProductId?: string;
  wechatProductId?: string;
  sortOrder: number;
  isActive: boolean;
}

// ── 微信支付 APP 调起参数 ──
export interface WechatPayAppParams {
  appid: string;
  partnerid: string;
  prepayid: string;
  package: string;
  noncestr: string;
  timestamp: string;
  sign: string;
}

// ── 微信支付订单查询结果 ──
export interface WechatOrderQuery {
  orderNo: string;
  transactionId?: string;
  tradeState: string;
  tradeStateDesc: string;
  amount?: { total: number; currency: string };
}

// ── Apple IAP 验证结果 ──
export interface AppleIAPVerifyResult {
  transactionId: string;
  productId: string;
  expiresDate: string | null;
}
