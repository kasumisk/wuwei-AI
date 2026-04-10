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
  | 'full_day_plan'
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
  full_day_plan: boolean;
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

// ── 三档默认配额（硬编码，与后端 TIER_ENTITLEMENTS 保持一致） ──
export const TIER_QUOTAS: Record<
  SubscriptionTier,
  {
    imageAnalysis: { limit: number; label: string };
    textAnalysis: { limit: number; label: string };
    coach: { limit: number; label: string };
    history: { limit: number; label: string };
  }
> = {
  free: {
    imageAnalysis: { limit: 3, label: '3次/天' },
    textAnalysis: { limit: 20, label: '20次/天' },
    coach: { limit: 5, label: '5次/天' },
    history: { limit: 3, label: '最近3条' },
  },
  pro: {
    imageAnalysis: { limit: 20, label: '20次/天' },
    textAnalysis: { limit: -1, label: '无限' },
    coach: { limit: -1, label: '无限' },
    history: { limit: -1, label: '全部' },
  },
  premium: {
    imageAnalysis: { limit: -1, label: '无限' },
    textAnalysis: { limit: -1, label: '无限' },
    coach: { limit: -1, label: '无限' },
    history: { limit: -1, label: '全部' },
  },
};

// ── 三档对比表（用于定价页） ──
export interface TierFeatureRow {
  label: string;
  free: string | boolean;
  pro: string | boolean;
  premium: string | boolean;
}

export const TIER_COMPARISON: TierFeatureRow[] = [
  { label: '图片分析', free: '3次/天', pro: '20次/天', premium: '无限' },
  { label: '文字分析', free: '20次/天', pro: '无限', premium: '无限' },
  { label: 'AI 教练', free: '5次/天', pro: '无限', premium: '无限' },
  { label: '分析历史', free: '最近3条', pro: '全部', premium: '全部' },
  { label: '详细评分', free: false, pro: true, premium: true },
  { label: '深度营养分析', free: false, pro: true, premium: true },
  { label: '个性化替代方案', free: false, pro: true, premium: true },
  { label: '周报/月报', free: false, pro: true, premium: true },
  { label: '数据导出', free: false, pro: 'CSV', premium: 'PDF+Excel' },
  { label: '全天计划联动', free: false, pro: false, premium: true },
  { label: '食谱生成', free: false, pro: false, premium: true },
  { label: '健康趋势分析', free: false, pro: false, premium: true },
  { label: '优先 AI 响应', free: false, pro: false, premium: true },
];
