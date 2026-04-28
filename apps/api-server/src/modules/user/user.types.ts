// Enums and types extracted from entity files for use after TypeORM removal

/**
 * 管理员角色枚举
 */
export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
}

/**
 * 管理员状态枚举
 */
export enum AdminUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

/**
 * App 用户认证方式枚举
 */
export enum AppUserAuthType {
  ANONYMOUS = 'anonymous',
  GOOGLE = 'google',
  EMAIL = 'email',
  PHONE = 'phone',
  WECHAT = 'wechat',
  WECHAT_MINI = 'wechat_mini',
  APPLE = 'apple',
}

/**
 * App 用户状态枚举
 */
export enum AppUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

/**
 * 画像变更类型
 */
export type ProfileChangeType =
  | 'preference_weights' // 偏好权重变更
  | 'behavior' // 行为画像变更
  | 'inferred' // 推断画像变更
  | 'declared' // 用户声明信息变更（手动修改目标/过敏原等）
  | 'short_term' // 短期画像变更
  | 'segment' // 用户细分变更
  | 'account'; // 账号级变更（如删除）

/**
 * 变更来源
 */
export type ProfileChangeSource =
  | 'feedback' // 用户反馈触发
  | 'meal_record' // 饮食记录触发
  | 'cron' // 定时任务触发
  | 'manual' // 用户手动修改
  | 'event' // 域事件触发
  | 'migration' // 数据迁移
  | 'admin'; // 管理员操作

/**
 * 活动等级枚举
 */
export enum ActivityLevel {
  SEDENTARY = 'sedentary',
  LIGHT = 'light',
  MODERATE = 'moderate',
  ACTIVE = 'active',
}

/**
 * 目标类型枚举
 */
export enum GoalType {
  FAT_LOSS = 'fat_loss', // 减脂
  MUSCLE_GAIN = 'muscle_gain', // 增肌
  HEALTH = 'health', // 保持健康
  HABIT = 'habit', // 改善习惯
}

/**
 * 目标速度枚举
 */
export enum GoalSpeed {
  AGGRESSIVE = 'aggressive', // 快速（激进）
  STEADY = 'steady', // 稳定（推荐）
  RELAXED = 'relaxed', // 佛系（轻松）
}

/**
 * 自律程度枚举
 */
export enum Discipline {
  HIGH = 'high', // 很强
  MEDIUM = 'medium', // 一般
  LOW = 'low', // 容易放弃
}

// ─── V6.5 Phase 3F: 用户推荐偏好 ───

/**
 * 大众化偏好: 用户希望推荐偏大众还是偏探索
 * - popular: 优先推荐常见、容易买到的食物（高 commonalityThreshold）
 * - balanced: 默认平衡
 * - adventurous: 喜欢尝试新食物（低 commonalityThreshold）
 */
export enum PopularityPreference {
  POPULAR = 'popular',
  BALANCED = 'balanced',
  ADVENTUROUS = 'adventurous',
}

/**
 * 烹饪投入偏好: 用户愿意花多少时间做饭
 * - quick: 快手菜（≤30min）
 * - moderate: 适中（≤60min）
 * - elaborate: 精致（不限制）
 */
export enum CookingEffort {
  QUICK = 'quick',
  MODERATE = 'moderate',
  ELABORATE = 'elaborate',
}

/**
 * 预算偏好: 用户对食材价格的敏感度
 * - budget: 优先便宜食材
 * - moderate: 默认适中
 * - unlimited: 不限预算
 */
export enum BudgetSensitivity {
  BUDGET = 'budget',
  MODERATE = 'moderate',
  UNLIMITED = 'unlimited',
}

/**
 * 用户推荐偏好（存储在 user_profiles.recommendation_preferences JSON 字段中）
 *
 * V7.0: 新增 5 个可选维度（cuisineWeights/diversityTolerance/dietaryPhilosophy/mealPattern/flavorOpenness）。
 * 向后兼容 — 旧数据只有前 3 个字段，新字段缺失时由 ProfileFactory 推断或使用默认值。
 */
export interface RecommendationPreferences {
  /** 大众化/探索型偏好 */
  popularityPreference?: PopularityPreference;
  /** 烹饪投入偏好（快手/适中/精致） */
  cookingEffort?: CookingEffort;
  /** 预算敏感度 */
  budgetSensitivity?: BudgetSensitivity;

  // ── V7.0 新增偏好维度 ──

  /** 菜系偏好权重（0-1），key=菜系名 */
  cuisineWeights?: Record<string, number>;
  /** 多样性容忍度 */
  diversityTolerance?: DiversityTolerance;
  /** 用餐模式 */
  mealPattern?: MealPattern;
  /** 口味开放度 */
  flavorOpenness?: FlavorOpenness;

  // ── V7.2 新增偏好维度 ──

  /** V7.2: 现实性级别偏好（strict/normal/relaxed/off），覆盖场景默认值 */
  realismLevel?: 'strict' | 'normal' | 'relaxed' | 'off';
}

// ─── V7.0: 偏好扩展枚举 ───

/**
 * V7.0: 多样性容忍度
 * - low: 喜欢固定搭配，跨餐惩罚减半
 * - medium: 标准（默认）
 * - high: 喜欢每天不同，跨餐惩罚加倍
 */
export enum DiversityTolerance {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * V7.0: 用餐模式
 * - frequent_small: 少食多餐（5-6 餐/天）
 * - standard_three: 标准三餐 + 可选加餐（默认）
 * - intermittent_fasting: 间歇性断食（16:8 或 18:6）
 */
export enum MealPattern {
  FREQUENT_SMALL = 'frequent_small',
  STANDARD_THREE = 'standard_three',
  INTERMITTENT_FASTING = 'intermittent_fasting',
}

/**
 * V7.0: 口味开放度
 * - conservative: 保守（减少探索，偏好熟悉食物）
 * - moderate: 标准（默认）
 * - adventurous: 冒险（增加探索，乐于尝新）
 */
export enum FlavorOpenness {
  CONSERVATIVE = 'conservative',
  MODERATE = 'moderate',
  ADVENTUROUS = 'adventurous',
}

// ─── V7.0: 分阶段目标系统 ───

/**
 * V7.0: 目标阶段定义
 *
 * 一个 CompoundGoal 由多个 GoalPhase 组成，按 order 排序。
 * 每个阶段有独立的热量调整比例和可选的宏量素比例覆盖。
 *
 * 示例: 增肌 12 周 → 减脂 8 周 → 维持 4 周
 */
export interface GoalPhase {
  /** 阶段 ID（uuid） */
  id: string;
  /** 阶段对应的目标类型（决定评分权重基线） */
  goalType: GoalType;
  /** 阶段名称（用户可见，如"增肌期"、"减脂期"） */
  name: string;
  /** 阶段持续周数 */
  durationWeeks: number;
  /**
   * 热量调整比例（相对 TDEE）
   * - 1.0 = 维持
   * - 0.8 = 20% 热量赤字（适合减脂）
   * - 1.15 = 15% 热量盈余（适合增肌）
   */
  calorieMultiplier: number;
  /** 宏量素比例覆盖（可选，覆盖 MACRO_RANGES） */
  macroRatioOverride?: { carb: [number, number]; fat: [number, number] };
  /** 阶段顺序（0-based） */
  order: number;
}

/**
 * V7.0: 复合目标
 *
 * 支持主+辅双目标 + 多阶段。
 * 存储在 user_profiles.compound_goal (JSONB) 字段中。
 *
 * 当 compound_goal 为 null 时，系统回退到 user_profiles.goal_type 简单目标。
 */
export interface CompoundGoal {
  /** 主目标 */
  primary: GoalType;
  /** 辅目标（影响权重但不改变主方向，如 "减脂为主 + 改善睡眠为辅"） */
  secondary?: GoalType;
  /**
   * 辅目标权重 (0-0.3)
   * - 0 = 辅目标无影响
   * - 0.15 = 默认（15% 权重分配给辅目标维度）
   * - 0.3 = 上限
   */
  secondaryWeight?: number;
  /** 阶段列表（按 order 排序） */
  phases?: GoalPhase[];
  /** 当前阶段索引（0-based，null/undefined = 无阶段或使用第一个） */
  currentPhaseIndex?: number;
  /** 目标开始日期（ISO 8601 格式 YYYY-MM-DD） */
  startDate?: string;
}

// ─── V7.1 Phase 1-C: 厨房设备画像 ───

/**
 * V7.1 方向 2C: 厨房设备画像
 *
 * 用户声明的厨房设备，用于场景约束精细化。
 * 在 home_cooking 场景下，根据设备过滤不可行的烹饪方式。
 * 存储在 user_profiles.kitchen_profile (JSON) 中。
 *
 * 所有字段默认 true（乐观假设用户有该设备），
 * 仅当用户明确声明"没有"时设为 false。
 */
export interface KitchenProfile {
  /** 有烤箱 */
  hasOven: boolean;
  /** 有微波炉 */
  hasMicrowave: boolean;
  /** 有空气炸锅 */
  hasAirFryer: boolean;
  /** 有电饭煲 */
  hasRiceCooker: boolean;
  /** 有蒸锅/蒸笼 */
  hasSteamer: boolean;
  /** 灶具类型 */
  primaryStove: 'gas' | 'induction' | 'none';
}

/** V7.1: KitchenProfile 默认值（乐观假设） */
export const DEFAULT_KITCHEN_PROFILE: KitchenProfile = {
  hasOven: false,
  hasMicrowave: true,
  hasAirFryer: false,
  hasRiceCooker: true,
  hasSteamer: true,
  primaryStove: 'gas',
};
