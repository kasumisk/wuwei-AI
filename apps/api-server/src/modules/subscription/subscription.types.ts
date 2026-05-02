/**
 * V6.1 — 订阅模块类型定义
 *
 * 三档订阅: Free / Pro / Premium
 * V6.1 升级: 功能级 + 能力级双层控制，支持运行时可配置化
 *
 * 变更记录:
 * - V6 Phase 2.12: 初始版本，硬编码权益映射
 * - V6.1 Phase 1.1: 双层控制模型（功能级配额 + 能力级开关），新增文本分析等功能标识，
 *                    权益配置可通过 DB subscription_plan.entitlements 运行时覆盖
 */

// ==================== 订阅计划 ====================

/** 订阅等级 */
export enum SubscriptionTier {
  FREE = 'free',
  PRO = 'pro',
  PREMIUM = 'premium',
}

/** 计费周期 */
export enum BillingCycle {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
  LIFETIME = 'lifetime',
}

/** 订阅状态 */
export enum SubscriptionStatus {
  /** 试用期 */
  TRIAL = 'trial',
  /** 活跃中 */
  ACTIVE = 'active',
  /** 扣款失败重试中 */
  BILLING_RETRY = 'billing_retry',
  /** 已过期 */
  EXPIRED = 'expired',
  /** 已取消（当前周期结束后失效） */
  CANCELLED = 'cancelled',
  /** 宽限期（过期但仍有短暂访问权限） */
  GRACE_PERIOD = 'grace_period',
  /** 暂停（用户主动暂停） */
  PAUSED = 'paused',
  /** 已退款 */
  REFUNDED = 'refunded',
  /** 已撤销 */
  REVOKED = 'revoked',
  /** 转移到其他用户/账号 */
  TRANSFERRED = 'transferred',
  /** 未知状态，需要人工排查 */
  UNKNOWN = 'unknown',
}

// ==================== 支付 ====================

/** 支付渠道 */
export enum PaymentChannel {
  APPLE_IAP = 'apple_iap',
  GOOGLE_PLAY = 'google_play',
  WECHAT_PAY = 'wechat_pay',
  ALIPAY = 'alipay',
  /** 系统赠送 / 管理员操作 */
  MANUAL = 'manual',
}

/** 支付状态 */
export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  /** 等待支付平台回调确认 */
  AWAITING_CALLBACK = 'awaiting_callback',
}

// ==================== 功能权益（V6.1 双层控制） ====================

/**
 * 可门控的功能标识
 * 用于 usage_quota 表和功能检查
 *
 * V6.1 新增: AI_TEXT_ANALYSIS, PERSONALIZED_ALTERNATIVES, ANALYSIS_HISTORY,
 *            DEEP_NUTRITION, FULL_DAY_LINKAGE
 * V6.2 变更: FULL_DAY_PLAN → WEEKLY_PLAN（全天膳食规划权益改为周膳食规划权益）
 */
export enum GatedFeature {
  /** 每日推荐次数 */
  RECOMMENDATION = 'recommendation',
  /** AI 图片分析次数 */
  AI_IMAGE_ANALYSIS = 'ai_image_analysis',
  /** AI 文本分析次数（V6.1 新增） */
  AI_TEXT_ANALYSIS = 'ai_text_analysis',
  /** AI 教练对话次数 */
  AI_COACH = 'ai_coach',
  /** 详细评分拆解 */
  DETAILED_SCORE = 'detailed_score',
  /** 高级解释（V2 可视化） */
  ADVANCED_EXPLAIN = 'advanced_explain',
  /** 深度营养拆解（V6.1 新增：完整微量营养素、成分占比） */
  DEEP_NUTRITION = 'deep_nutrition',
  /** 个性化替代建议（V6.1 新增：结合用户目标和偏好推荐替代食物） */
  PERSONALIZED_ALTERNATIVES = 'personalized_alternatives',
  /** 分析历史记录（V6.1 新增：可查看历史分析结果，Free 限最近 3 条） */
  ANALYSIS_HISTORY = 'analysis_history',
  /** 周报/月报 */
  REPORTS = 'reports',
  /** 数据导出 */
  DATA_EXPORT = 'data_export',
  /** 周膳食规划（V6.2 变更：原全天膳食规划，权益升级为周计划） */
  WEEKLY_PLAN = 'weekly_plan',
  /** 全天膳食联动建议（V6.1 新增：跨餐建议、下一餐纠偏） */
  FULL_DAY_LINKAGE = 'full_day_linkage',
  /** 食谱生成 */
  RECIPE_GENERATION = 'recipe_generation',
  /** 健康趋势分析 */
  HEALTH_TREND = 'health_trend',
  /** 优先 AI 响应 */
  PRIORITY_AI = 'priority_ai',
  /** 行为分析（V3 行为画像、主动提醒、决策反馈） */
  BEHAVIOR_ANALYSIS = 'behavior_analysis',
  /** 教练风格选择（V5 严格/友善/数据三种人格） */
  COACH_STYLE = 'coach_style',
  /** 高级挑战（V4 高级挑战模式，Free 仅基础） */
  ADVANCED_CHALLENGES = 'advanced_challenges',
}

/**
 * V6.1 功能权益配置
 *
 * 双层控制模型:
 * - 功能级（配额）: number 类型，-1 表示无限，>0 表示每周期可用次数
 * - 能力级（开关）: boolean 类型，true/false 控制能否使用
 * - 混合型: boolean | string 类型，如导出格式
 *
 * 所有字段可选（Partial），DB 中只需存储需要覆盖默认值的字段。
 * PlanEntitlementResolver 会将 DB 配置与默认值合并。
 */
export interface FeatureEntitlements {
  // ---- 功能级：计次配额 ----
  [GatedFeature.RECOMMENDATION]: number;
  [GatedFeature.AI_IMAGE_ANALYSIS]: number;
  [GatedFeature.AI_TEXT_ANALYSIS]: number;
  [GatedFeature.AI_COACH]: number;
  /** 分析历史可查看条数（-1 表示全量） */
  [GatedFeature.ANALYSIS_HISTORY]: number;

  // ---- 能力级：布尔开关 ----
  [GatedFeature.DETAILED_SCORE]: boolean;
  [GatedFeature.ADVANCED_EXPLAIN]: boolean;
  [GatedFeature.DEEP_NUTRITION]: boolean;
  [GatedFeature.PERSONALIZED_ALTERNATIVES]: boolean;
  [GatedFeature.REPORTS]: boolean;
  [GatedFeature.WEEKLY_PLAN]: boolean;
  [GatedFeature.FULL_DAY_LINKAGE]: boolean;
  [GatedFeature.RECIPE_GENERATION]: boolean;
  [GatedFeature.HEALTH_TREND]: boolean;
  [GatedFeature.PRIORITY_AI]: boolean;

  // ---- V3/V4/V5 能力级 ----
  [GatedFeature.BEHAVIOR_ANALYSIS]: boolean;
  [GatedFeature.COACH_STYLE]: boolean;
  [GatedFeature.ADVANCED_CHALLENGES]: boolean;

  // ---- 混合型 ----
  [GatedFeature.DATA_EXPORT]: boolean | string;
}

/** 无限次数标记 */
export const UNLIMITED = -1;

/**
 * 各档位默认权益配置（硬编码兜底值）
 *
 * V6.1 设计文档规格:
 * - Free: 文本20次/天, 图片3次/天, 推荐3次, 教练5次, 历史最近3条
 * - Pro: 文本无限, 图片20次/天, 推荐无限, 教练无限, 历史全量
 * - Premium: 全部无限/全部开放
 *
 * 注意: 这是默认值。实际运行时，PlanEntitlementResolver 会优先读取
 * subscription_plan 表中的 entitlements JSONB 字段，此处作为兜底。
 * 如需运行时修改权益，只需更新数据库中的 subscription_plan.entitlements 即可。
 */
export const TIER_ENTITLEMENTS: Record<SubscriptionTier, FeatureEntitlements> =
  {
    [SubscriptionTier.FREE]: {
      [GatedFeature.RECOMMENDATION]: 3,
      [GatedFeature.AI_IMAGE_ANALYSIS]: 1,
      [GatedFeature.AI_TEXT_ANALYSIS]: 3,
      [GatedFeature.AI_COACH]: 5,
      [GatedFeature.ANALYSIS_HISTORY]: 3,
      [GatedFeature.DETAILED_SCORE]: true,
      [GatedFeature.ADVANCED_EXPLAIN]: true,
      [GatedFeature.DEEP_NUTRITION]: true,
      [GatedFeature.PERSONALIZED_ALTERNATIVES]: true,
      [GatedFeature.REPORTS]: true,
      [GatedFeature.DATA_EXPORT]: false,
      [GatedFeature.WEEKLY_PLAN]: false,
      [GatedFeature.FULL_DAY_LINKAGE]: false,
      [GatedFeature.RECIPE_GENERATION]: false,
      [GatedFeature.HEALTH_TREND]: false,
      [GatedFeature.PRIORITY_AI]: false,
      [GatedFeature.BEHAVIOR_ANALYSIS]: false,
      [GatedFeature.COACH_STYLE]: false,
      [GatedFeature.ADVANCED_CHALLENGES]: false,
    },
    [SubscriptionTier.PRO]: {
      [GatedFeature.RECOMMENDATION]: UNLIMITED,
      [GatedFeature.AI_IMAGE_ANALYSIS]: 20,
      [GatedFeature.AI_TEXT_ANALYSIS]: UNLIMITED,
      [GatedFeature.AI_COACH]: UNLIMITED,
      [GatedFeature.ANALYSIS_HISTORY]: UNLIMITED,
      [GatedFeature.DETAILED_SCORE]: true,
      [GatedFeature.ADVANCED_EXPLAIN]: true,
      [GatedFeature.DEEP_NUTRITION]: true,
      [GatedFeature.PERSONALIZED_ALTERNATIVES]: true,
      [GatedFeature.REPORTS]: true,
      [GatedFeature.DATA_EXPORT]: 'csv',
      [GatedFeature.WEEKLY_PLAN]: true,
      [GatedFeature.FULL_DAY_LINKAGE]: false,
      [GatedFeature.RECIPE_GENERATION]: false,
      [GatedFeature.HEALTH_TREND]: false,
      [GatedFeature.PRIORITY_AI]: false,
      [GatedFeature.BEHAVIOR_ANALYSIS]: true,
      [GatedFeature.COACH_STYLE]: true,
      [GatedFeature.ADVANCED_CHALLENGES]: true,
    },
    [SubscriptionTier.PREMIUM]: {
      [GatedFeature.RECOMMENDATION]: UNLIMITED,
      [GatedFeature.AI_IMAGE_ANALYSIS]: UNLIMITED,
      [GatedFeature.AI_TEXT_ANALYSIS]: UNLIMITED,
      [GatedFeature.AI_COACH]: UNLIMITED,
      [GatedFeature.ANALYSIS_HISTORY]: UNLIMITED,
      [GatedFeature.DETAILED_SCORE]: true,
      [GatedFeature.ADVANCED_EXPLAIN]: true,
      [GatedFeature.DEEP_NUTRITION]: true,
      [GatedFeature.PERSONALIZED_ALTERNATIVES]: true,
      [GatedFeature.REPORTS]: true,
      [GatedFeature.DATA_EXPORT]: 'pdf_excel',
      [GatedFeature.WEEKLY_PLAN]: true,
      [GatedFeature.FULL_DAY_LINKAGE]: true,
      [GatedFeature.RECIPE_GENERATION]: true,
      [GatedFeature.HEALTH_TREND]: true,
      [GatedFeature.PRIORITY_AI]: true,
      [GatedFeature.BEHAVIOR_ANALYSIS]: true,
      [GatedFeature.COACH_STYLE]: true,
      [GatedFeature.ADVANCED_CHALLENGES]: true,
    },
  };

/**
 * 配额周期类型
 */
export enum QuotaCycle {
  /** 每日重置 */
  DAILY = 'daily',
  /** 每周重置 */
  WEEKLY = 'weekly',
  /** 每月重置 */
  MONTHLY = 'monthly',
}

// ==================== V6.1 访问决策 ====================

/**
 * 结果降级模式
 *
 * - none: 完整返回，不裁剪
 * - basic_result: 只返回基础结论（隐藏深度字段、替代建议等）
 * - hide_advanced_fields: 隐藏特定高级字段（如 userContextImpact、趋势对比）
 */
export type DegradeMode = 'none' | 'basic_result' | 'hide_advanced_fields';

/**
 * 统一访问决策对象
 *
 * 由 QuotaGateService 返回，Controller/Service 根据此对象决定：
 * 1. 是否放行请求
 * 2. 是否已扣减配额
 * 3. 结果是否需要裁剪
 * 4. 是否需要展示升级提示
 */
export interface AccessDecision {
  /** 是否允许执行 */
  allowed: boolean;
  /** 是否已扣减配额（false 表示只检查未扣减，或不受配额限制） */
  quotaConsumed: boolean;
  /** 结果降级模式 */
  degradeMode: DegradeMode;
  /** 付费墙信息（仅当需要展示升级提示时存在） */
  paywall?: PaywallInfo;
}

/**
 * 付费墙提示信息
 *
 * 前端根据此对象展示升级引导 UI
 */
export interface PaywallInfo {
  /** 触发编码（如 'quota_exceeded'、'advanced_result_hidden'） */
  code: string;
  /** 用户可见提示文案 */
  message: string;
  /** 推荐升级到的档位 */
  recommendedTier: SubscriptionTier;
  /** 触发场景（用于埋点和 A/B 实验） */
  triggerScene?: string;
}

/**
 * 配额检查上下文
 *
 * 传入 QuotaGateService 的请求参数
 */
export interface QuotaCheckContext {
  userId: string;
  feature: GatedFeature;
  /** 触发场景标识（如 'food_analysis', 'recommendation'，用于付费墙策略） */
  scene?: string;
  /** 是否在检查通过后立即扣减配额（默认 true） */
  consumeQuota?: boolean;
}
