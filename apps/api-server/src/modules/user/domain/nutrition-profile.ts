/**
 * V7.0 Phase 1-A: 营养画像领域实体
 *
 * 从 UserProfileService 的 BMR/TDEE/推荐热量计算中提取，
 * 封装为不可变值对象。替代 EnrichedProfileContext.inferred 中的
 * 松散字段（estimatedBmr/estimatedTdee/recommendedCalories/macroTargets）。
 *
 * 消费者：RecommendationEngine、FoodScorer、ExplanationGenerator
 */

// ─── 营养画像主接口 ───

/**
 * 营养画像领域实体
 *
 * 表示用户当前的营养基线和目标，由 ProfileFactory 从 Prisma 记录构建。
 */
export interface NutritionProfile {
  /** BMR (kcal/day) — 基础代谢率 */
  bmr: number;
  /** TDEE (kcal/day) — 每日总能量消耗 */
  tdee: number;
  /** 推荐每日热量 (kcal/day) — 基于目标调整后 */
  recommendedCalories: number;
  /** 宏量素每日目标 (g/day) */
  macroTargets: MacroTargets;
  /** 微量素缺口（从行为画像推断，如 ['iron', 'vitaminD']） */
  nutritionGaps: string[];
  /** BMR 计算方式 */
  calculationMethod: 'harris_benedict' | 'katch_mcardle';
  /** 计算时间戳 (epoch ms) */
  calculatedAt: number;
  /** 画像置信度 0-1 */
  confidence: number;
}

/**
 * 宏量素目标
 */
export interface MacroTargets {
  /** 蛋白质 (g/day) */
  protein: number;
  /** 碳水化合物 (g/day) */
  carbs: number;
  /** 脂肪 (g/day) */
  fat: number;
  /** 膳食纤维 (g/day) */
  fiber: number;
}

// ─── 默认值常量 ───

/** 营养画像默认值（零数据时使用） */
export const DEFAULT_NUTRITION_PROFILE: NutritionProfile = {
  bmr: 1500,
  tdee: 2000,
  recommendedCalories: 2000,
  macroTargets: {
    protein: 75,
    carbs: 250,
    fat: 67,
    fiber: 25,
  },
  nutritionGaps: [],
  calculationMethod: 'harris_benedict',
  calculatedAt: 0,
  confidence: 0.3,
};

// ─── 验证函数 ───

/**
 * 验证并修正营养画像的合理性
 *
 * - BMR/TDEE/推荐热量 clamp 到 [800, 6000]
 * - 蛋白质 clamp 到 [30, 400] g
 * - 碳水 clamp 到 [50, 800] g
 * - 脂肪 clamp 到 [20, 300] g
 * - 纤维 clamp 到 [10, 60] g
 */
export function validateNutritionProfile(
  profile: NutritionProfile,
): NutritionProfile {
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  return {
    ...profile,
    bmr: clamp(profile.bmr, 800, 6000),
    tdee: clamp(profile.tdee, 800, 6000),
    recommendedCalories: clamp(profile.recommendedCalories, 800, 6000),
    macroTargets: {
      protein: clamp(profile.macroTargets.protein, 30, 400),
      carbs: clamp(profile.macroTargets.carbs, 50, 800),
      fat: clamp(profile.macroTargets.fat, 20, 300),
      fiber: clamp(profile.macroTargets.fiber, 10, 60),
    },
    confidence: clamp(profile.confidence, 0, 1),
  };
}
