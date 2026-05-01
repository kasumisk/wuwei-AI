/**
 * V7.2 P2-B: 用户偏好因子
 *
 * 合并原 rankCandidates 中的 3 个偏好相关 boost：
 * - preferenceBoost (loves/avoids 关键词匹配)
 * - profileBoost (四维偏好画像: category/ingredient/foodGroup/foodName)
 * - foodPrefBoost (声明偏好 tags/category 匹配)
 *
 * 最终乘数 = preferenceBoost × profileBoost × foodPrefBoost
 *
 * V8.x: foodPrefBoost 从简单字符串比较升级为结构化多字段映射，
 *       全面支持 7 个声明偏好枚举：
 *         sweet / fried / carbs / meat / spicy / light / seafood
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import { normalizeCuisine } from '../../../../../../common/utils/cuisine.util';
import type {
  EnrichedProfileContext,
  PipelineContext,
} from '../../types/recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

// ─── 声明偏好 → 食物库字段映射表 ───────────────────────────────────────────
//
// 每条规则检查食物是否"符合"该偏好，命中则计为一次匹配。
// 命中后加分：1 + min(matchCount × perMatch, cap)
//
type PrefMatcher = (food: FoodLibrary) => boolean;

/** 肉类 foodGroup 集合（与 food-filter.service.ts 保持一致） */
const MEAT_FG = new Set([
  'pork',
  'beef',
  'chicken',
  'poultry',
  'lamb',
  'duck',
  'goose',
  'game',
  'organ',
  'meat',
  'processed_meat',
]);
/** 海鲜 foodGroup 集合 */
const SEAFOOD_FG = new Set(['seafood', 'fish', 'shellfish', 'shrimp', 'crab']);

/**
 * 声明偏好 key → 匹配函数
 *
 * 设计原则：
 * - sweet:   flavorProfile.sweet >= 3 OR tags 含 sweet/dessert OR subCategory 为 dessert
 * - fried:   isFried === true OR tags 含 fried/deep_fried
 * - carbs:   category 为 grain OR foodGroup 为 grain/noodle/rice/bread OR tags 含 high_carb
 * - meat:    foodGroup 在 MEAT_FG 集合中 OR category 为 meat
 * - spicy:   flavorProfile.spicy >= 3 OR tags 含 spicy
 * - light:   isFried === false AND fat < 10 AND tags 不含 fried/heavy（偏好清淡=不喜欢油腻）
 * - seafood: foodGroup 在 SEAFOOD_FG 集合中 OR category 为 seafood
 */
const FOOD_PREF_MATCHERS: Record<string, PrefMatcher> = {
  sweet: (food) => {
    const fp = food.flavorProfile as Record<string, number> | undefined;
    if (fp && (fp['sweet'] ?? 0) >= 3) return true;
    const tags: string[] = food.tags || [];
    if (tags.some((t) => t === 'sweet' || t === 'dessert')) return true;
    const subCat = (food.subCategory || '').toLowerCase();
    return subCat === 'dessert' || subCat === 'sweet';
  },
  fried: (food) => {
    if (food.isFried) return true;
    const tags: string[] = food.tags || [];
    return tags.some(
      (t) => t === 'fried' || t === 'deep_fried' || t === 'pan_fried',
    );
  },
  carbs: (food) => {
    const fg = (food.foodGroup || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    if (cat === 'grain') return true;
    if (['grain', 'noodle', 'rice', 'bread', 'pasta', 'cereal'].includes(fg))
      return true;
    const tags: string[] = food.tags || [];
    return tags.some((t) => t === 'high_carb' || t === 'carbs');
  },
  meat: (food) => {
    const fg = (food.foodGroup || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    return MEAT_FG.has(fg) || cat === 'meat';
  },
  spicy: (food) => {
    const fp = food.flavorProfile as Record<string, number> | undefined;
    if (fp && (fp['spicy'] ?? 0) >= 3) return true;
    const tags: string[] = food.tags || [];
    return tags.some((t) => t === 'spicy' || t === 'hot');
  },
  light: (food) => {
    // 清淡偏好：食物本身是非油炸、低脂、非辛辣的
    if (food.isFried) return false;
    const fat = Number(food.fat) || 0;
    if (fat > 15) return false; // 每100g脂肪超15g视为不清淡
    const fp = food.flavorProfile as Record<string, number> | undefined;
    if (fp && (fp['spicy'] ?? 0) >= 3) return false;
    const tags: string[] = food.tags || [];
    if (tags.some((t) => t === 'fried' || t === 'heavy' || t === 'greasy'))
      return false;
    return true;
  },
  seafood: (food) => {
    const fg = (food.foodGroup || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    return SEAFOOD_FG.has(fg) || cat === 'seafood';
  },
};

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
  /** P3-3.3: 菜系相对偏好（用户/region 群体均值） */
  private cuisineAffinityRelative: Record<string, number> | null = null;

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

    // P3-3.3: 菜系相对偏好
    this.cuisineAffinityRelative =
      (ctx.userProfile as any)?.inferred?.cuisineAffinityRelative ?? null;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    let multiplier = 1.0;
    const parts: string[] = [];

    // 1. loves/avoids（行为画像：具体食物名称关键字匹配）
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

    // 2. 四维画像（协同过滤学习到的偏好权重）
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

    // P3-3.3: 菜系相对偏好（cuisineAffinityRelative）
    // relative ∈ [0.2, 5.0]；>1.0 表示比同 region 群体更偏好
    // 映射到 multiplier：relative=1.0 → ×1.0，relative=2.0 → ×1.05，relative=0.5 → ×0.975
    // P0-R3: cuisine 查表前规范化（cuisineAffinityRelative key 由 profile-cron 写入时已 toLowerCase）
    if (this.cuisineAffinityRelative && food.cuisine) {
      const cuisineKey = normalizeCuisine(food.cuisine);
      const relative = cuisineKey
        ? this.cuisineAffinityRelative[cuisineKey]
        : undefined;
      if (relative !== undefined) {
        // log 压缩避免高 relative 值影响过大
        const cuisineRelativeBoost = Math.log(Math.max(0.2, relative)) * 0.05;
        multiplier *= 1 + cuisineRelativeBoost;
        parts.push(`cuisineRel×${(1 + cuisineRelativeBoost).toFixed(3)}`);
      }
    }

    // 3. 声明偏好（结构化多字段映射，支持全部 7 个枚举）
    if (this.declaredFoodPrefs.length > 0) {
      let matchCount = 0;
      for (const pref of this.declaredFoodPrefs) {
        const matcher = FOOD_PREF_MATCHERS[pref];
        if (matcher && matcher(food)) {
          matchCount++;
        }
      }
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
