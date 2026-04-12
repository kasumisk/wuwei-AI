/**
 * V6 Phase 2.1 — 策略引擎类型定义
 *
 * 策略引擎核心概念:
 *
 *   Strategy         推荐策略（完整的推荐方案配置）
 *   ├── RankPolicy       排序策略（评分维度权重/评分公式参数）
 *   ├── RecallPolicy     召回策略（召回源选择与权重 — 2.3 实现）
 *   ├── RerankPolicy     重排策略（探索率/多样性参数 — 保留硬编码）
 *   ├── BoostPolicy      加分/惩罚策略（偏好/CF/短期画像系数）
 *   └── MealPolicy       餐次组合策略（角色/品类/热量分配）
 *
 *   StrategyResolver  根据用户画像 + A/B 实验 → 决定使用哪个 Strategy
 *   ResolvedStrategy  解析后的不可变策略配置，附着到 PipelineContext
 *
 * 存储: strategy 表 + strategy_assignment 表（PostgreSQL JSONB）
 * 缓存: Redis 30s TTL
 */
import { GoalType } from '../diet/app/nutrition-score.service';

// ─── 评分维度（与 recommendation.types.ts 保持一致） ───

export const SCORE_DIMENSION_NAMES = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber',
  'seasonality',
  'executability',
  'popularity', // V7.0: 同步 V6.9 新增的大众化评分维度
] as const;

export type StrategyScoreDimension = (typeof SCORE_DIMENSION_NAMES)[number];

// ─── 排序策略（Phase 2.2 核心） ───

/**
 * 排序策略配置 — 控制 Rank 阶段的评分行为
 *
 * 所有字段均为可选: 缺失字段使用系统默认值（recommendation.types.ts 中的硬编码常量）
 */
export interface RankPolicyConfig {
  /** 基础评分权重覆盖（按目标类型，12 维数组） */
  baseWeights?: Partial<Record<GoalType, number[]>>;
  /** 餐次权重修正系数覆盖 */
  mealModifiers?: Record<
    string,
    Partial<Record<StrategyScoreDimension, number>>
  >;
  /** 用户状态权重修正系数覆盖 */
  statusModifiers?: Record<
    string,
    Partial<Record<StrategyScoreDimension, number>>
  >;
}

// ─── 召回策略（Phase 2.3 扩展） ───

/**
 * 召回策略配置 — 控制 Recall 阶段的候选源和过滤行为
 */
export interface RecallPolicyConfig {
  /** 各召回源的权重/启用状态 */
  sources?: {
    /** 规则召回（角色品类匹配） */
    rule?: { enabled?: boolean };
    /** 向量召回权重 */
    vector?: { enabled?: boolean; weight?: number };
    /** 协同过滤召回权重 */
    cf?: { enabled?: boolean; weight?: number };
    /** 热门食物召回 */
    popular?: { enabled?: boolean; weight?: number };
  };
  /** 短期拒绝食物过滤阈值（默认 2 次） */
  shortTermRejectThreshold?: number;
}

// ─── 加分/惩罚策略 ───

/**
 * 加分/惩罚策略配置 — 控制 Rank 阶段的各种 boost/penalty 系数
 */
export interface BoostPolicyConfig {
  /** 用户偏好加分系数 */
  preference?: {
    /** 喜爱食物乘数（默认 1.12） */
    lovesMultiplier?: number;
    /** 厌恶食物乘数（默认 0.3） */
    avoidsMultiplier?: number;
  };
  /** 协同过滤加分上限（默认 0.15） */
  cfBoostCap?: number;
  /** 短期画像参数 */
  shortTerm?: {
    /** 接受率加分范围 [min, max]（默认 [0.9, 1.1]） */
    boostRange?: [number, number];
    /** 单次拒绝惩罚乘数（默认 0.85） */
    singleRejectPenalty?: number;
  };
  /** 相似度惩罚系数（默认 0.3） */
  similarityPenaltyCoeff?: number;
}

// ─── 探索策略（Phase 2.6） ───

/**
 * 自适应探索策略配置 — 控制 Rerank 阶段的 Thompson Sampling 行为
 *
 * 核心思想: 用户交互越多（越成熟），探索范围越窄（越利用）
 *
 * 探索系数范围 = [baseMin + maturityShrink × maturity, baseMax - maturityShrink × maturity]
 * 其中 maturity = min(1, totalInteractions / matureThreshold)
 *
 * 新用户(maturity≈0): [0.3, 1.7] — 高探索
 * 成熟用户(maturity≈1): [0.7, 1.3] — 高利用
 */
export interface ExplorationPolicyConfig {
  /** 基础最小探索系数（默认 0.3，新用户使用此值作为下界） */
  baseMin?: number;
  /** 基础最大探索系数（默认 1.7，新用户使用此值作为上界） */
  baseMax?: number;
  /** 成熟度收缩量: 成熟用户的范围在两端各收缩此值（默认 0.4） */
  maturityShrink?: number;
  /** 成熟度阈值: 累计交互次数达到此值时视为完全成熟（默认 50） */
  matureThreshold?: number;
}

// ─── 餐次组合策略 ───

/**
 * 餐次组合策略配置 — 控制膳食的角色、品类、热量分配
 */
export interface MealPolicyConfig {
  /** 餐次角色模板覆盖（如 lunch: ['carb', 'protein', 'veggie']） */
  mealRoles?: Record<string, string[]>;
  /** 角色→品类映射覆盖 */
  roleCategories?: Record<string, string[]>;
  /** 目标→餐次热量分配覆盖 */
  mealRatios?: Partial<Record<GoalType, Record<string, number>>>;
  /** 宏量营养素理想范围覆盖 */
  macroRanges?: Partial<
    Record<GoalType, { carb: [number, number]; fat: [number, number] }>
  >;
}

// ─── 多目标优化策略（Phase 2.5） ───

/**
 * 多目标优化维度名称
 *
 * 4 个独立优化目标:
 * - health: 营养健康度（基于现有 10 维评分归一化）
 * - taste: 口味匹配度（用户口味偏好 vs 食物 flavorProfile）
 * - cost: 价格经济性（基于 estimatedCostLevel 反转）
 * - convenience: 便利性/可获取性（基于 prepTime + cookTime + skillRequired）
 */
export const MULTI_OBJECTIVE_DIMENSIONS = [
  'health',
  'taste',
  'cost',
  'convenience',
] as const;

export type MultiObjectiveDimension =
  (typeof MULTI_OBJECTIVE_DIMENSIONS)[number];

/**
 * 多目标优化配置 — 控制 Pareto 前沿选择行为
 */
export interface MultiObjectiveConfig {
  /** 是否启用多目标优化（默认 false，向后兼容） */
  enabled?: boolean;

  /**
   * 各维度偏好权重（0-1），用于从 Pareto 前沿中选择最优解
   * 缺失的维度使用默认权重
   *
   * 默认值: { health: 0.4, taste: 0.3, cost: 0.15, convenience: 0.15 }
   */
  preferences?: Partial<Record<MultiObjectiveDimension, number>>;

  /**
   * Pareto 前沿最大保留数量（默认 20）
   * 在大候选集时控制 Pareto 计算复杂度
   */
  paretoFrontLimit?: number;

  /**
   * 用户口味偏好向量（6 维: spicy, sweet, salty, sour, umami, bitter）
   * 每个维度 0-1 表示偏好程度
   * 缺失时从 UserPreferenceProfile 推断
   */
  tastePreference?: {
    spicy?: number;
    sweet?: number;
    salty?: number;
    sour?: number;
    umami?: number;
    bitter?: number;
  };

  /**
   * 成本敏感度（0-1，0=不在意价格，1=极度价格敏感）
   * 影响 cost 维度在偏好向量中的实际权重
   * 默认 0.5
   */
  costSensitivity?: number;
}

// ─── V6.3 组装策略 ───

/**
 * 组装策略配置 — 控制 MealAssembler 阶段的行为
 *
 * 决定是优先推荐菜谱还是原料，以及多样性水平
 */
export interface AssemblyPolicyConfig {
  /** 是否优先推荐菜谱（true 时优先从 Recipe 池选择，false 时走原有食物组合模式） */
  preferRecipe?: boolean;
  /**
   * 多样性级别
   * - low: 严格营养匹配，品类集中
   * - medium: 平衡营养与多样性
   * - high: 尽可能多样化品类和菜系
   */
  diversityLevel?: 'low' | 'medium' | 'high';
}

// ─── V6.3 解释策略 ───

/**
 * 解释策略配置 — 控制推荐解释的详细程度和展示方式
 */
export interface ExplainPolicyConfig {
  /**
   * 解释详细程度
   * - simple: 一句话解释（适合新用户，减少认知负担）
   * - standard: 标准解释（营养概览 + 推荐理由）
   * - detailed: 详细解释（完整营养数据 + 各维度评分 + 健康修正说明）
   */
  detailLevel?: 'simple' | 'standard' | 'detailed';
  /** 是否展示营养雷达图数据 */
  showNutritionRadar?: boolean;
}

// ─── V6.5 现实性策略 ───

/**
 * 现实性策略配置 — 控制推荐结果的现实可执行性
 *
 * 核心思想: 推荐的食物不仅要营养合理，还要用户实际能获取、有能力制作、
 * 符合预算和时间约束。这是 V6.5 "让推荐更贴近现实" 的关键参数。
 */
export interface RealismConfig {
  /** 是否启用现实性过滤 */
  enabled?: boolean;
  /** 大众化最低阈值（0-100，默认 20），commonalityScore 低于此值的食物被过滤 */
  commonalityThreshold?: number;
  /** 是否启用预算过滤 */
  budgetFilterEnabled?: boolean;
  /** 是否启用烹饪时间过滤 */
  cookTimeCapEnabled?: boolean;
  /** 工作日烹饪时间上限（分钟，默认 45） */
  weekdayCookTimeCap?: number;
  /** 周末烹饪时间上限（分钟，默认 120） */
  weekendCookTimeCap?: number;
  /** 可执行性评分权重倍数（1.0=默认，2.0=双倍权重，默认 1.0） */
  executabilityWeightMultiplier?: number;
  /** V6.6 Phase 2-D: 食堂模式 — 跳过烹饪时间过滤，提高大众化阈值到 60 */
  canteenMode?: boolean;
}

// ─── 完整策略配置 ───

/**
 * 完整的推荐策略配置（存储在 strategy 表的 config JSONB 字段中）
 *
 * 所有 Policy 均为可选: 缺失的 Policy 使用系统默认值。
 * 这允许策略只覆盖需要调整的部分，不需要完整指定。
 */
export interface StrategyConfig {
  /** 排序策略 — Rank 阶段评分权重/公式参数 */
  rank?: RankPolicyConfig;
  /** 召回策略 — Recall 阶段候选源配置 */
  recall?: RecallPolicyConfig;
  /** 加分/惩罚策略 — 各种 boost/penalty 系数 */
  boost?: BoostPolicyConfig;
  /** 餐次组合策略 — 角色/品类/热量分配 */
  meal?: MealPolicyConfig;
  /** V6 2.5: 多目标优化策略 — Pareto 前沿 + 偏好向量选择 */
  multiObjective?: MultiObjectiveConfig;
  /** V6 2.6: 自适应探索策略 — 新用户高探索、老用户低探索 */
  exploration?: ExplorationPolicyConfig;
  /** V6.3 P2-1: 组装策略 — 菜谱优先 / 多样性级别 */
  assembly?: AssemblyPolicyConfig;
  /** V6.3 P2-1: 解释策略 — 详细程度 / 雷达图 */
  explain?: ExplainPolicyConfig;
  /** V6.5: 现实性策略 — 大众化过滤 / 预算 / 烹饪时间 / 可执行性权重 */
  realism?: RealismConfig;
}

// ─── 策略状态枚举 ───

export enum StrategyStatus {
  /** 草稿 — 可编辑，不生效 */
  DRAFT = 'draft',
  /** 激活 — 当前生效（同一 scope 只允许一个 active） */
  ACTIVE = 'active',
  /** 归档 — 历史版本，不可修改 */
  ARCHIVED = 'archived',
}

// ─── 策略适用范围 ───

export enum StrategyScope {
  /** 全局默认策略（所有用户的 fallback） */
  GLOBAL = 'global',
  /** 按目标类型的策略 */
  GOAL_TYPE = 'goal_type',
  /** A/B 实验组策略 */
  EXPERIMENT = 'experiment',
  /** 用户个性化策略（管理后台指定） */
  USER = 'user',
  /** V7.0: 上下文感知策略（时段/工作日/季节/生命周期匹配） */
  CONTEXT = 'context',
}

// ─── V7.0: 上下文策略匹配条件 ───

/**
 * V7.0: 上下文策略匹配条件
 *
 * 当 scope = CONTEXT 时，策略需要满足以下条件才生效。
 * 所有字段可选 — 缺失字段视为"不限制"（通配）。
 * 存储在 strategy.context_condition (JSONB) 字段中。
 */
export interface ContextStrategyCondition {
  /** 时段: morning/afternoon/evening/night */
  timeOfDay?: string[];
  /** 工作日/周末 */
  dayType?: ('weekday' | 'weekend')[];
  /** 季节 */
  season?: ('spring' | 'summer' | 'autumn' | 'winter')[];
  /** 用户生命周期阶段 */
  userLifecycle?: ('new' | 'active' | 'mature' | 'churning')[];
  /** 目标阶段（如果用户有复合目标） */
  goalPhaseType?: GoalType[];
}

/**
 * V7.0: 上下文策略匹配输入
 *
 * 由 StrategyResolver 在解析时构建，传递给 matchContextStrategy()。
 */
export interface StrategyContextInput {
  /** 当前时段 */
  timeOfDay: string;
  /** 工作日/周末 */
  dayType: 'weekday' | 'weekend';
  /** 当前季节 */
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  /** 用户生命周期 */
  lifecycle: 'new' | 'active' | 'mature' | 'churning';
  /** 当前目标阶段类型（如有复合目标） */
  goalPhaseType?: GoalType;
}

// ─── 策略解析结果 ───

/**
 * 解析后的策略 — 由 StrategyResolver 生成，附着到 PipelineContext
 *
 * 不可变，在整个推荐请求生命周期内保持一致。
 * 所有字段都已填充（缺失的 Policy 已用默认值合并）。
 */
export interface ResolvedStrategy {
  /** 策略 ID（可能是合并了多个来源后的标识） */
  strategyId: string;
  /** 策略名称 */
  strategyName: string;
  /** 使用的策略来源（按优先级排列） */
  sources: string[];
  /** 合并后的完整配置 */
  config: StrategyConfig;
  /** 解析时间戳 */
  resolvedAt: number;
}

// ─── 策略分配记录 ───

export enum AssignmentType {
  /** A/B 实验分配 */
  EXPERIMENT = 'experiment',
  /** 管理后台手动分配 */
  MANUAL = 'manual',
  /** 按用户画像段自动分配 */
  SEGMENT = 'segment',
}

// ─── V6.5 预设 realism 默认值 ───

/**
 * 4 套预设策略的 realism 参数
 * 在数据库初始化或策略创建时使用
 */
export const PRESET_REALISM: Record<string, RealismConfig> = {
  warm_start: {
    enabled: true,
    commonalityThreshold: 40,
    budgetFilterEnabled: true,
    cookTimeCapEnabled: true,
    weekdayCookTimeCap: 30,
    weekendCookTimeCap: 90,
    executabilityWeightMultiplier: 1.5,
  },
  re_engage: {
    enabled: true,
    commonalityThreshold: 30,
    budgetFilterEnabled: true,
    cookTimeCapEnabled: true,
    weekdayCookTimeCap: 40,
    weekendCookTimeCap: 120,
    executabilityWeightMultiplier: 1.3,
  },
  precision: {
    enabled: true,
    commonalityThreshold: 15,
    budgetFilterEnabled: false,
    cookTimeCapEnabled: false,
    weekdayCookTimeCap: 60,
    weekendCookTimeCap: 180,
    executabilityWeightMultiplier: 0.8,
  },
  discovery: {
    enabled: true,
    commonalityThreshold: 10,
    budgetFilterEnabled: false,
    cookTimeCapEnabled: false,
    weekdayCookTimeCap: 90,
    weekendCookTimeCap: 180,
    executabilityWeightMultiplier: 0.7,
  },
};

/**
 * 默认 realism 配置（无策略配置时的 fallback）
 */
export const DEFAULT_REALISM: Required<RealismConfig> = {
  enabled: true,
  commonalityThreshold: 20,
  budgetFilterEnabled: false,
  cookTimeCapEnabled: false,
  weekdayCookTimeCap: 45,
  weekendCookTimeCap: 120,
  executabilityWeightMultiplier: 1.0,
  canteenMode: false,
};
