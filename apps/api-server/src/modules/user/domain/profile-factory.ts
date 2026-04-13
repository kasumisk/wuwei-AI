/**
 * V7.0 Phase 1-A: 画像工厂
 *
 * 从 Prisma 记录（user_profiles / user_inferred_profiles / user_behavior_profiles）
 * 转换为强类型领域实体，消除 any 转换。
 *
 * 所有字段有安全默认值 — 即使 Prisma 记录为 null 也能生成有效的领域实体。
 *
 * 消费者：ProfileResolverService（在 resolve() 中调用 fromEnrichedContext()）
 */

import {
  NutritionProfile,
  MacroTargets,
  DEFAULT_NUTRITION_PROFILE,
  validateNutritionProfile,
} from './nutrition-profile';
import {
  PreferencesProfile,
  DEFAULT_PREFERENCES_PROFILE,
  validatePreferencesProfile,
} from './preferences-profile';
import type { EnrichedProfileContext } from '../../diet/app/recommendation/types/recommendation.types';

// ─── 域画像聚合体 ───

/**
 * V7.0: 域画像聚合
 *
 * 将 EnrichedProfileContext 中分散的画像字段聚合为两个强类型领域实体。
 * 作为 PipelineContext 的补充数据（不替代 EnrichedProfileContext）。
 */
export interface DomainProfiles {
  /** 营养画像 */
  nutrition: NutritionProfile;
  /** 偏好画像 */
  preferences: PreferencesProfile;
}

// ─── ProfileFactory ───

/**
 * 画像工厂
 *
 * 纯静态方法，无依赖注入，可在任何上下文中使用。
 */
export class ProfileFactory {
  /**
   * 从 EnrichedProfileContext 构建领域画像
   *
   * 这是主入口 — ProfileResolver.resolve() 完成后立即调用。
   * 从 enriched context 的 inferred/declared/observed 层提取数据。
   */
  static fromEnrichedContext(ctx: EnrichedProfileContext): DomainProfiles {
    return {
      nutrition: ProfileFactory.createNutritionProfile(ctx),
      preferences: ProfileFactory.createPreferencesProfile(ctx),
    };
  }

  /**
   * 从 EnrichedProfileContext 构建营养画像
   */
  static createNutritionProfile(ctx: EnrichedProfileContext): NutritionProfile {
    const inferred = ctx.inferred;
    if (!inferred) {
      return { ...DEFAULT_NUTRITION_PROFILE, calculatedAt: Date.now() };
    }

    const macroTargets: MacroTargets = {
      protein:
        Number(inferred.macroTargets?.protein) ||
        DEFAULT_NUTRITION_PROFILE.macroTargets.protein,
      carbs:
        Number(inferred.macroTargets?.carbs) ||
        DEFAULT_NUTRITION_PROFILE.macroTargets.carbs,
      fat:
        Number(inferred.macroTargets?.fat) ||
        DEFAULT_NUTRITION_PROFILE.macroTargets.fat,
      fiber:
        Number(inferred.macroTargets?.fiber) ||
        DEFAULT_NUTRITION_PROFILE.macroTargets.fiber,
    };

    const raw: NutritionProfile = {
      bmr: Number(inferred.estimatedBmr) || DEFAULT_NUTRITION_PROFILE.bmr,
      tdee: Number(inferred.estimatedTdee) || DEFAULT_NUTRITION_PROFILE.tdee,
      recommendedCalories:
        Number(inferred.recommendedCalories) ||
        DEFAULT_NUTRITION_PROFILE.recommendedCalories,
      macroTargets,
      nutritionGaps: Array.isArray(inferred.nutritionGaps)
        ? inferred.nutritionGaps
        : [],
      calculationMethod: ProfileFactory.inferCalculationMethod(ctx),
      calculatedAt: Date.now(),
      confidence: ProfileFactory.computeNutritionConfidence(ctx),
    };

    return validateNutritionProfile(raw);
  }

  /**
   * 从 EnrichedProfileContext 构建偏好画像
   *
   * 数据来源优先级:
   * 1. declared.recommendation_preferences 中的显式设置
   * 2. declared 层推断（cuisinePreferences → cuisineWeights）
   * 3. observed 层推断（行为模式 → diversityTolerance 等）
   * 4. 默认值
   */
  static createPreferencesProfile(
    ctx: EnrichedProfileContext,
  ): PreferencesProfile {
    // 从 declared 层的 recommendation_preferences JSON 读取
    // 注意: RecommendationPreferences 是 user_profiles.recommendation_preferences 的类型
    const declared = ctx.declared;

    // 菜系偏好: 从 string[] 转换为权重 map
    const cuisineWeights: Record<string, number> = {};
    const cuisineList =
      declared?.cuisinePreferences ?? ctx.cuisinePreferences ?? [];
    for (const cuisine of cuisineList) {
      cuisineWeights[cuisine] = 0.8; // 声明偏好 = 0.8 权重
    }

    // 多样性容忍度: 从行为画像推断
    const diversityTolerance = ProfileFactory.inferDiversityTolerance(ctx);

    // 饮食哲学: 从 dietaryRestrictions 推断
    const dietaryPhilosophy = ProfileFactory.inferDietaryPhilosophy(ctx);

    // 用餐模式: 从 declared.mealsPerDay 推断
    const mealPattern = ProfileFactory.inferMealPattern(ctx);

    // 口味开放度: 从行为画像推断
    const flavorOpenness = ProfileFactory.inferFlavorOpenness(ctx);

    // 原有 3 维偏好: 直接传递（已在 RecommendationPreferences 中定义）
    // 注意: user_profiles.recommendation_preferences 是 JSON 字段，
    // 已经有 popularityPreference/cookingEffort/budgetSensitivity

    return validatePreferencesProfile({
      popularityPreference: undefined, // 从 recommendation_preferences 读取
      cookingEffort: undefined,
      budgetSensitivity: undefined,
      cuisineWeights,
      diversityTolerance,
      dietaryPhilosophy,
      mealPattern,
      flavorOpenness,
    });
  }

  // ─── 私有推断方法 ───

  /**
   * 推断 BMR 计算方式
   *
   * 如果用户提供了体脂率相关数据，使用 Katch-McArdle；否则 Harris-Benedict。
   */
  private static inferCalculationMethod(
    ctx: EnrichedProfileContext,
  ): 'harris_benedict' | 'katch_mcardle' {
    // Katch-McArdle 需要体脂率数据 — 当前 schema 无此字段，统一使用 Harris-Benedict
    return 'harris_benedict';
  }

  /**
   * 计算营养画像置信度
   *
   * 综合考虑：
   * - 声明画像新鲜度（profileFreshness）
   * - 推断画像是否有数据
   * - 行为画像记录数量
   */
  private static computeNutritionConfidence(
    ctx: EnrichedProfileContext,
  ): number {
    let confidence = 0.3; // 基线

    // 声明画像新鲜度加分
    if (ctx.profileFreshness > 0.5) {
      confidence += 0.2;
    }

    // 推断画像有数据加分
    if (ctx.inferred?.estimatedBmr && ctx.inferred?.estimatedTdee) {
      confidence += 0.2;
    }

    // 行为画像有足够记录加分
    if (ctx.observed?.totalRecords && ctx.observed.totalRecords > 10) {
      confidence += 0.2;
    }

    // 宏量素目标有数据加分
    if (ctx.inferred?.macroTargets) {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  /**
   * 从行为画像推断多样性容忍度
   *
   * 基于观察到的品类多样性和重复率推断。
   * 无数据时返回 undefined（使用默认值 medium）。
   */
  private static inferDiversityTolerance(
    ctx: EnrichedProfileContext,
  ): PreferencesProfile['diversityTolerance'] | undefined {
    // 当前无直接的品类多样性数据 — 返回 undefined 使用默认值
    // V7.1 可基于 recommendation_feedbacks 中的替换频率推断
    return undefined;
  }

  /**
   * 从饮食限制推断饮食哲学
   */
  private static inferDietaryPhilosophy(
    ctx: EnrichedProfileContext,
  ): PreferencesProfile['dietaryPhilosophy'] | undefined {
    const restrictions = ctx.dietaryRestrictions ?? [];
    const lower = restrictions.map((r) => r.toLowerCase());

    if (lower.includes('vegan')) return 'vegan';
    if (lower.includes('vegetarian')) return 'vegetarian';
    if (lower.includes('pescatarian')) return 'pescatarian';

    return undefined; // 默认 omnivore
  }

  /**
   * 从 mealsPerDay 推断用餐模式
   */
  private static inferMealPattern(
    ctx: EnrichedProfileContext,
  ): PreferencesProfile['mealPattern'] | undefined {
    const mealsPerDay = ctx.declared?.mealsPerDay;
    if (!mealsPerDay) return undefined;

    if (mealsPerDay >= 5) return 'frequent_small';
    if (mealsPerDay <= 2) return 'intermittent_fasting';
    return 'standard_three';
  }

  /**
   * 从行为画像推断口味开放度
   *
   * 基于用户对新食物的接受率推断。
   * 无数据时返回 undefined（使用默认值 moderate）。
   */
  private static inferFlavorOpenness(
    ctx: EnrichedProfileContext,
  ): PreferencesProfile['flavorOpenness'] | undefined {
    // 当前无直接的新食物接受率数据 — 返回 undefined 使用默认值
    // V7.1 可基于 recommendation_feedbacks 中新食物的反馈率推断
    return undefined;
  }
}
