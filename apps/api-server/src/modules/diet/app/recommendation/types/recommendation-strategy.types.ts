/**
 * V7.4 Phase 2-A: 推荐策略类型定义
 *
 * 与 V6 策略引擎 (strategy.types.ts) 的区别：
 * - V6 策略引擎：数据库持久化、A/B 实验组分配、细粒度 policy config
 * - V7.4 推荐策略：推荐行为模式预设，控制 Recall/Rank/Rerank 三阶段的行为倾向
 *
 * V7.4 策略可叠加在 V6 ResolvedStrategy 之上：
 * - V6 ResolvedStrategy 提供细粒度参数覆盖（baseWeights, mealModifiers 等）
 * - V7.4 RecommendationStrategy 提供宏观行为模式（explore/exploit/strict_health/scene_first）
 * - 冲突时 V6 细粒度配置优先（向后兼容）
 *
 * 选择逻辑（由 RecommendationStrategyResolverService 执行）：
 *   if (feedbackCount < 10)           → explore
 *   else if (goalType in [fat_loss, health] && healthConditions.length > 0) → strict_health
 *   else if (sceneType in [canteen_meal, convenience_meal]) → scene_first
 *   else                               → exploit
 */

import type { ScoreDimension } from './recommendation.types';

// ─── 现实性级别（复用已有定义） ───

export type { RealismLevel } from './recommendation.types';

// ─── 推荐策略名称 ───

export const RECOMMENDATION_STRATEGY_NAMES = [
  'explore',
  'exploit',
  'strict_health',
  'scene_first',
] as const;

export type RecommendationStrategyName =
  (typeof RECOMMENDATION_STRATEGY_NAMES)[number];

// ─── 推荐策略接口 ───

/**
 * 推荐策略 — 控制 Recall/Rank/Rerank 三阶段的行为模式
 *
 * 每个策略是一组预设参数，影响：
 * - Recall: 候选池大小、多样性、品类分散度
 * - Rank: 评分维度权重覆盖、因子强度覆盖、探索率
 * - Rerank: 现实性严格度、同品类上限、获取难度上限
 */
export interface RecommendationStrategy {
  /** 策略名称（唯一标识） */
  name: RecommendationStrategyName;
  /** 策略描述（供日志/调试/解释用） */
  description: string;

  /** Recall 阶段参数 */
  recall: {
    /** 候选池大小倍数（相对于默认召回量），>1.0 扩大召回 */
    poolSizeMultiplier: number;
    /** 多样性加分（0~1，影响品类分散选择） */
    diversityBoost: number;
    /** 品类分散度（每个品类最少占比 0~1） */
    categorySpread: number;
  };

  /** Rank 阶段参数 */
  rank: {
    /** 评分维度权重覆盖（部分覆盖，缺失维度不修改） */
    scoringWeightOverrides: Partial<Record<ScoreDimension, number>>;
    /** 因子强度覆盖（ScoringFactor name → 强度乘数，如 'preference-signal' → 0.5） */
    factorStrengthOverrides: Record<string, number>;
    /** 探索率（0~1，0=纯利用/Top-1, 1=纯探索/均匀随机） */
    explorationRate: number;
  };

  /** Rerank 阶段参数 */
  rerank: {
    /** 现实性严格度 */
    realismLevel: 'strict' | 'normal' | 'relaxed' | 'off';
    /** 同品类食物最大数量（同一餐中） */
    maxSameCategory: number;
    /** 获取难度上限（1~5, acquisitionDifficulty 超过此值的食物被过滤） */
    acquisitionDifficultyMax: number;
  };
}

// ─── 4 个预设策略 ───

/**
 * 探索策略（新用户 / feedbackCount < 10）
 *
 * 特点：广泛召回 + 高探索率 + 宽松现实性
 * 目标：帮助新用户快速了解系统推荐范围，收集初始偏好信号
 */
export const STRATEGY_EXPLORE: RecommendationStrategy = {
  name: 'explore',
  description: '新用户探索模式：广泛召回、高多样性、温和健康约束',
  recall: {
    poolSizeMultiplier: 1.5,
    diversityBoost: 0.8,
    categorySpread: 0.3,
  },
  rank: {
    scoringWeightOverrides: {
      // 降低热量/营养密度的严格约束，让用户先尝试多种食物
      calories: 0.8,
      nutrientDensity: 0.8,
      // 提高大众化和可执行性，确保新用户能获取推荐的食物
      popularity: 1.3,
      executability: 1.2,
      // V7.4: 新用户优先推荐容易获得的食物
      acquisition: 1.3,
    },
    factorStrengthOverrides: {
      // 新用户没什么偏好数据，降低偏好因子影响
      'preference-signal': 0.3,
      'collaborative-filtering': 0.5,
      // 提升大众化和场景感知
      popularity: 1.3,
      'scene-context': 1.1,
    },
    explorationRate: 0.6,
  },
  rerank: {
    realismLevel: 'normal',
    maxSameCategory: 2,
    acquisitionDifficultyMax: 4,
  },
};

/**
 * 利用策略（成熟用户 / feedbackCount >= 10，默认策略）
 *
 * 特点：精准召回 + 低探索率 + 偏好驱动
 * 目标：基于已积累的偏好画像精准推荐，偶尔穿插新食物
 */
export const STRATEGY_EXPLOIT: RecommendationStrategy = {
  name: 'exploit',
  description: '成熟用户利用模式：偏好驱动、精准匹配、适度探索',
  recall: {
    poolSizeMultiplier: 1.0,
    diversityBoost: 0.3,
    categorySpread: 0.15,
  },
  rank: {
    scoringWeightOverrides: {
      // 保持默认权重，不做特殊覆盖
    },
    factorStrengthOverrides: {
      // 全面利用偏好数据
      'preference-signal': 1.2,
      'collaborative-filtering': 1.1,
      'short-term-profile': 1.1,
      'analysis-profile': 1.0,
    },
    explorationRate: 0.15,
  },
  rerank: {
    realismLevel: 'normal',
    maxSameCategory: 2,
    acquisitionDifficultyMax: 4,
  },
};

/**
 * 严格健康策略（有健康状况的 fat_loss/health 用户）
 *
 * 特点：严格营养约束 + 低探索率 + 高健康维度权重
 * 目标：优先保障营养目标达成，牺牲部分多样性和口味偏好
 */
export const STRATEGY_STRICT_HEALTH: RecommendationStrategy = {
  name: 'strict_health',
  description: '严格健康模式：营养优先、血糖管控、低炎症倾向',
  recall: {
    poolSizeMultiplier: 1.2,
    diversityBoost: 0.4,
    categorySpread: 0.2,
  },
  rank: {
    scoringWeightOverrides: {
      // 大幅提升健康相关维度
      calories: 1.3,
      protein: 1.2,
      glycemic: 1.4,
      nutrientDensity: 1.3,
      inflammation: 1.3,
      fiber: 1.2,
      // 适度降低非健康维度
      popularity: 0.7,
      seasonality: 0.8,
    },
    factorStrengthOverrides: {
      // 降低偏好影响，避免"好吃但不健康"的推荐
      'preference-signal': 0.7,
      popularity: 0.6,
      // 提升规则权重（营养规则更严格）
      'rule-weight': 1.3,
    },
    explorationRate: 0.1,
  },
  rerank: {
    realismLevel: 'normal',
    maxSameCategory: 2,
    acquisitionDifficultyMax: 3,
  },
};

/**
 * 场景优先策略（食堂/便利店等特定场景）
 *
 * 特点：场景约束最优先 + 高可执行性 + 高大众化
 * 目标：推荐的食物必须在当前场景下容易获取
 */
export const STRATEGY_SCENE_FIRST: RecommendationStrategy = {
  name: 'scene_first',
  description: '场景优先模式：获取便利性最高、大众化、快速决策',
  recall: {
    poolSizeMultiplier: 1.3,
    diversityBoost: 0.5,
    categorySpread: 0.2,
  },
  rank: {
    scoringWeightOverrides: {
      // 大幅提升场景相关维度
      executability: 1.5,
      popularity: 1.4,
      // V7.4: 场景下必须容易获取
      acquisition: 1.5,
      // 适度降低精细营养维度（场景下选择有限）
      nutrientDensity: 0.8,
      inflammation: 0.7,
      glycemic: 0.9,
    },
    factorStrengthOverrides: {
      // 场景感知因子权重拉满
      'scene-context': 1.5,
      popularity: 1.3,
      'regional-boost': 1.2,
      // 适度降低精细偏好
      'analysis-profile': 0.8,
    },
    explorationRate: 0.2,
  },
  rerank: {
    realismLevel: 'strict',
    maxSameCategory: 3, // 场景下选择有限，允许同品类更多
    acquisitionDifficultyMax: 2, // 只推荐容易获取的食物
  },
};

// ─── 策略注册表 ───

/**
 * 所有预设策略的注册表 — 按名称索引
 */
export const RECOMMENDATION_STRATEGIES: Record<
  RecommendationStrategyName,
  RecommendationStrategy
> = {
  explore: STRATEGY_EXPLORE,
  exploit: STRATEGY_EXPLOIT,
  strict_health: STRATEGY_STRICT_HEALTH,
  scene_first: STRATEGY_SCENE_FIRST,
};

// ─── 策略解析输入 ───

/**
 * 策略解析器的输入上下文
 *
 * RecommendationStrategyResolverService.resolve() 需要这些信息来决定使用哪个策略。
 */
export interface StrategyResolverInput {
  /** 用户累计反馈次数 */
  feedbackCount: number;
  /** 用户目标类型 */
  goalType: string;
  /** 用户健康状况列表（如 ['diabetes', 'hypertension']） */
  healthConditions: string[];
  /** 当前场景类型（如 'canteen_meal', 'home_cooking'） */
  sceneType?: string;
}

/**
 * 策略解析结果
 */
export interface ResolvedRecommendationStrategy {
  /** 选中的策略 */
  strategy: RecommendationStrategy;
  /** 选择原因（供日志/解释用） */
  reason: string;
  /** 解析时间戳 */
  resolvedAt: number;
}
