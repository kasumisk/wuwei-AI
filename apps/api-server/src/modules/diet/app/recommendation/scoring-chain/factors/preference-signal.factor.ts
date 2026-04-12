/**
 * V7.2 P2-B: 用户偏好因子
 *
 * 合并原 rankCandidates 中的 3 个偏好相关 boost：
 * - preferenceBoost (loves/avoids 关键词匹配)
 * - profileBoost (四维偏好画像: category/ingredient/foodGroup/foodName)
 * - foodPrefBoost (声明偏好 tags/category 匹配)
 *
 * 最终乘数 = preferenceBoost × profileBoost × foodPrefBoost
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type {
  EnrichedProfileContext,
  PipelineContext,
} from '../../recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class PreferenceSignalFactor implements ScoringFactor {
  readonly name = 'preference-signal';
  readonly order = 10;

  private loves: string[] = [];
  private avoids: string[] = [];
  private lovesMultiplier = 1.12;
  private avoidsMultiplier = 0.3;
  private categoryWeights: Record<string, number> = {};
  private ingredientWeights: Record<string, number> = {};
  private foodGroupWeights: Record<string, number> = {};
  private foodNameWeights: Record<string, number> = {};
  private declaredFoodPrefs: string[] = [];
  /** V7.5: 声明偏好调参 */
  private declaredPrefPerMatch = 0.05;
  private declaredPrefCap = 0.15;

  isApplicable(_ctx: PipelineContext): boolean {
    return true; // 始终适用，无数据时返回 1.0
  }

  init(ctx: PipelineContext): void {
    const boostConfig = ctx.resolvedStrategy?.config?.boost;

    // preferenceBoost 数据
    this.loves = ctx.userPreferences?.loves ?? [];
    this.avoids = ctx.userPreferences?.avoids ?? [];
    this.lovesMultiplier = boostConfig?.preference?.lovesMultiplier ?? 1.12;
    this.avoidsMultiplier = boostConfig?.preference?.avoidsMultiplier ?? 0.3;

    // profileBoost 数据
    if (ctx.preferenceProfile) {
      this.categoryWeights = ctx.preferenceProfile.categoryWeights ?? {};
      this.ingredientWeights = ctx.preferenceProfile.ingredientWeights ?? {};
      this.foodGroupWeights = ctx.preferenceProfile.foodGroupWeights ?? {};
      this.foodNameWeights = ctx.preferenceProfile.foodNameWeights ?? {};
    }

    // foodPrefBoost 数据
    this.declaredFoodPrefs =
      (ctx.userProfile as EnrichedProfileContext | undefined)?.declared
        ?.foodPreferences ?? [];

    // V7.5: 从调参配置读取声明偏好阈值
    if (ctx.tuning) {
      this.declaredPrefPerMatch = ctx.tuning.declaredPrefPerMatch;
      this.declaredPrefCap = ctx.tuning.declaredPrefCap;
    }
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    let multiplier = 1.0;
    const parts: string[] = [];

    // 1. loves/avoids
    const name = food.name;
    const mainIng = food.mainIngredient || '';
    if (this.loves.some((l) => name.includes(l) || mainIng.includes(l))) {
      multiplier *= this.lovesMultiplier;
      parts.push(`loves×${this.lovesMultiplier}`);
    }
    if (this.avoids.some((a) => name.includes(a) || mainIng.includes(a))) {
      multiplier *= this.avoidsMultiplier;
      parts.push(`avoids×${this.avoidsMultiplier}`);
    }

    // 2. 四维画像
    const catW = this.categoryWeights[food.category];
    if (catW !== undefined) multiplier *= catW;
    const ingW = food.mainIngredient
      ? this.ingredientWeights[food.mainIngredient]
      : undefined;
    if (ingW !== undefined) multiplier *= ingW;
    const grpW = food.foodGroup
      ? this.foodGroupWeights[food.foodGroup]
      : undefined;
    if (grpW !== undefined) multiplier *= grpW;
    const nameW = this.foodNameWeights[food.name];
    if (nameW !== undefined) multiplier *= nameW;

    // 3. 声明偏好
    if (this.declaredFoodPrefs.length > 0) {
      const foodTags = food.tags || [];
      const foodCat = food.category || '';
      const foodSubCat = food.subCategory || '';
      const matchCount = this.declaredFoodPrefs.filter(
        (pref) =>
          foodTags.includes(pref) || foodCat === pref || foodSubCat === pref,
      ).length;
      if (matchCount > 0) {
        const fpBoost =
          1 +
          Math.min(
            matchCount * this.declaredPrefPerMatch,
            this.declaredPrefCap,
          );
        multiplier *= fpBoost;
        parts.push(`declared×${fpBoost.toFixed(2)}`);
      }
    }

    if (multiplier === 1.0) return null;

    return {
      factorName: this.name,
      multiplier,
      additive: 0,
      explanationKey: 'preferenceBoost',
      reason:
        parts.length > 0
          ? parts.join(', ')
          : `combined_pref×${multiplier.toFixed(3)}`,
    };
  }
}
