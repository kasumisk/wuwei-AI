/**
 * V7.0 Phase 1-A: 偏好画像领域实体
 *
 * 扩展 V6.5 的 3 维偏好（popularity/cooking/budget）到 8 维。
 * 新增维度可从声明画像 + 行为画像推断，也可由用户直接设置。
 *
 * 消费者：FoodScorer（菜系偏好 boost）、PipelineBuilder（多样性惩罚调节）、
 *         RealisticFilter（饮食哲学过滤）、ExplanationGenerator（偏好解释）
 */

// ─── 偏好画像主接口 ───

/**
 * 偏好画像领域实体
 *
 * 8 维偏好，前 3 维向后兼容 V6.5 RecommendationPreferences。
 * 后 5 维为 V7.0 新增，均有安全默认值。
 */
export interface PreferencesProfile {
  // ── V6.5 原有维度（向后兼容） ──

  /** 大众化偏好: popular=常见食物, balanced=默认, adventurous=探索新食物 */
  popularityPreference: 'popular' | 'balanced' | 'adventurous';
  /** 烹饪投入: quick=快手, moderate=适中, elaborate=精致 */
  cookingEffort: 'quick' | 'moderate' | 'elaborate';
  /** 预算敏感度: budget=省钱, moderate=适中, unlimited=不限 */
  budgetSensitivity: 'budget' | 'moderate' | 'unlimited';

  // ── V7.0 新增维度 ──

  /**
   * 菜系偏好权重 (0-1)
   *
   * key = 菜系名（如 '中餐', '日料', '西餐'），value = 偏好权重。
   * 权重 > 0.5 = 正向偏好，< 0.5 = 负向偏好，空 map = 无偏好。
   *
   * vs V6.9 的 cuisinePreferences: string[] — 从二值（有/无）升级为连续权重。
   * 从 EnrichedProfileContext.declared.cuisinePreferences 初始化（存在=0.8，不存在=不出现）。
   * 后续由行为数据（实际选择的菜系）动态调整。
   */
  cuisineWeights: Record<string, number>;

  /**
   * 多样性容忍度
   *
   * 影响 DailyPlanContext 的跨餐惩罚强度：
   * - low: 惩罚减半（用户喜欢固定搭配）
   * - medium: 标准惩罚（默认）
   * - high: 惩罚加倍（用户喜欢每天不同）
   */
  diversityTolerance: 'low' | 'medium' | 'high';

  /**
   * 用餐模式
   *
   * 影响 MEAL_RATIOS 热量分配：
   * - frequent_small: 5-6 餐/天，每餐热量更小
   * - standard_three: 3 餐 + 0-1 加餐（默认）
   * - intermittent_fasting: 16:8 或 18:6，集中在 2-3 餐
   */
  mealPattern: 'frequent_small' | 'standard_three' | 'intermittent_fasting';

  /**
   * 口味开放度
   *
   * 影响 Thompson Sampling 探索率和新食物推荐比例：
   * - conservative: 减少探索率（prior 更强）
   * - moderate: 标准（默认）
   * - adventurous: 增加探索率（prior 更弱）
   */
  flavorOpenness: 'conservative' | 'moderate' | 'adventurous';
}

// ─── 默认值常量 ───

/** 偏好画像默认值（零数据时使用） */
export const DEFAULT_PREFERENCES_PROFILE: PreferencesProfile = {
  popularityPreference: 'balanced',
  cookingEffort: 'moderate',
  budgetSensitivity: 'moderate',
  cuisineWeights: {},
  diversityTolerance: 'medium',
  mealPattern: 'standard_three',
  flavorOpenness: 'moderate',
};

// ─── 多样性惩罚系数映射 ───

/**
 * 多样性容忍度 → 惩罚倍数映射
 *
 * 用于 DailyPlanContext.calcDiversityPenalty() 中：
 *   finalPenalty = basePenalty × DIVERSITY_PENALTY_MULTIPLIER[tolerance]
 */
export const DIVERSITY_PENALTY_MULTIPLIER: Record<string, number> = {
  low: 0.5, // 喜欢固定搭配 → 减半惩罚
  medium: 1.0, // 标准
  high: 1.5, // 喜欢多样化 → 加倍惩罚
};

// ─── 口味开放度 → 探索率调整 ───

/**
 * 口味开放度 → Thompson Sampling 探索率调整
 *
 * 用于 PipelineBuilder 的 Rerank 阶段：
 *   adjustedExploration = baseExploration × FLAVOR_EXPLORATION_FACTOR[openness]
 */
export const FLAVOR_EXPLORATION_FACTOR: Record<string, number> = {
  conservative: 0.7, // 保守 → 减少探索
  moderate: 1.0, // 标准
  adventurous: 1.4, // 冒险 → 增加探索
};

// ─── 验证函数 ───

/**
 * 验证偏好画像（确保枚举值合法）
 *
 * 不合法的值回退到默认值。
 */
export function validatePreferencesProfile(
  profile: Partial<PreferencesProfile>,
): PreferencesProfile {
  const defaults = DEFAULT_PREFERENCES_PROFILE;

  const validPopularity = ['popular', 'balanced', 'adventurous'];
  const validCooking = ['quick', 'moderate', 'elaborate'];
  const validBudget = ['budget', 'moderate', 'unlimited'];
  const validDiversity = ['low', 'medium', 'high'];
  const validMealPattern = [
    'frequent_small',
    'standard_three',
    'intermittent_fasting',
  ];
  const validFlavor = ['conservative', 'moderate', 'adventurous'];

  return {
    popularityPreference: validPopularity.includes(
      profile.popularityPreference as string,
    )
      ? (profile.popularityPreference as PreferencesProfile['popularityPreference'])
      : defaults.popularityPreference,

    cookingEffort: validCooking.includes(profile.cookingEffort as string)
      ? (profile.cookingEffort as PreferencesProfile['cookingEffort'])
      : defaults.cookingEffort,

    budgetSensitivity: validBudget.includes(profile.budgetSensitivity as string)
      ? (profile.budgetSensitivity as PreferencesProfile['budgetSensitivity'])
      : defaults.budgetSensitivity,

    cuisineWeights: sanitizeCuisineWeights(profile.cuisineWeights),

    diversityTolerance: validDiversity.includes(
      profile.diversityTolerance as string,
    )
      ? (profile.diversityTolerance as PreferencesProfile['diversityTolerance'])
      : defaults.diversityTolerance,

    mealPattern: validMealPattern.includes(profile.mealPattern as string)
      ? (profile.mealPattern as PreferencesProfile['mealPattern'])
      : defaults.mealPattern,

    flavorOpenness: validFlavor.includes(profile.flavorOpenness as string)
      ? (profile.flavorOpenness as PreferencesProfile['flavorOpenness'])
      : defaults.flavorOpenness,
  };
}

/**
 * 清理菜系权重：clamp 到 [0, 1]，移除 NaN/无效值
 *
 * P0-R3: key 统一 normalizeCuisine（toLowerCase + 中文别名归一），
 * 与 RegionalBoostFactor / cuisineMatch / preference-signal 全链路对齐。
 */
function sanitizeCuisineWeights(
  weights?: Record<string, number> | null,
): Record<string, number> {
  if (!weights || typeof weights !== 'object') return {};

  // 延迟引用以避免循环依赖（domain 层不直接依赖 common/utils）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { normalizeCuisine } = require('../../../common/utils/cuisine.util') as {
    normalizeCuisine: (v: unknown) => string | null;
  };

  const result: Record<string, number> = {};
  for (const [cuisine, weight] of Object.entries(weights)) {
    const key = normalizeCuisine(cuisine);
    if (!key) continue;
    const w = Number(weight);
    if (!isNaN(w) && isFinite(w)) {
      // 同 key 取 max（多别名映射到同 key 时保留最强信号）
      const clamped = Math.max(0, Math.min(1, w));
      result[key] =
        result[key] !== undefined ? Math.max(result[key], clamped) : clamped;
    }
  }
  return result;
}
