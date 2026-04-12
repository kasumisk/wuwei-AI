/**
 * V7.2 P2-B: 生活方式因子
 *
 * 合并原 rankCandidates 中的 lifestyleBoost + lifestyleNutrientBoost：
 * - lifestyleBoost: 5 维生活方式匹配（taste/cuisine/budget/skill/mealPrep）
 * - lifestyleNutrientBoost: 营养素优先级调整（magnesium/vitC/...）
 *
 * 注意：这个因子需要外部传入 lifestyleFactors 和 lifestyleAdjustment，
 * 因为它们依赖注入服务（LifestyleScoringAdapter + mapLifestyleToScoringFactors）。
 * 在 Phase 3 集成时，PipelineBuilder 将这些数据放入 PipelineContext 的扩展字段中。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

/**
 * 生活方式评分函数接口（与 profile-scoring-mapper.ts 的 ScoringFactors 一致）
 */
interface LifestyleScoringFunctions {
  tasteMatch: (food: FoodLibrary) => number;
  cuisineMatch: (food: FoodLibrary) => number;
  budgetMatch: (food: FoodLibrary) => number;
  skillMatch: (food: FoodLibrary) => number;
  mealPrepMatch: (food: FoodLibrary) => number;
}

export class LifestyleBoostFactor implements ScoringFactor {
  readonly name = 'lifestyle-boost';
  readonly order = 40;

  private lifestyleFactors: LifestyleScoringFunctions | null = null;
  private lifestyleAdjustment: Record<string, number> | null = null;

  /**
   * 构造时传入外部依赖
   *
   * @param getLifestyleFactors 从 PipelineContext 获取 lifestyle 评分函数
   * @param getLifestyleAdjustment 从 PipelineContext 获取营养素优先级调整
   */
  constructor(
    private readonly getLifestyleFactors: (
      ctx: PipelineContext,
    ) => LifestyleScoringFunctions | null,
    private readonly getLifestyleAdjustment: (
      ctx: PipelineContext,
    ) => Record<string, number> | null,
  ) {}

  isApplicable(_ctx: PipelineContext): boolean {
    return true; // 始终适用，无数据时返回 1.0
  }

  init(ctx: PipelineContext): void {
    this.lifestyleFactors = this.getLifestyleFactors(ctx);
    this.lifestyleAdjustment = this.getLifestyleAdjustment(ctx);
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    let multiplier = 1.0;

    // 1. 5 维生活方式匹配
    if (this.lifestyleFactors) {
      multiplier *=
        this.lifestyleFactors.tasteMatch(food) *
        this.lifestyleFactors.cuisineMatch(food) *
        this.lifestyleFactors.budgetMatch(food) *
        this.lifestyleFactors.skillMatch(food) *
        this.lifestyleFactors.mealPrepMatch(food);
    }

    // 2. 营养素优先级调整
    if (
      this.lifestyleAdjustment &&
      Object.keys(this.lifestyleAdjustment).length > 0
    ) {
      const foodNutrientValues: Record<string, number> = {
        magnesium: Number((food as any).magnesium) || 0,
        vitaminC: Number((food as any).vitaminC) || 0,
        vitaminD: Number((food as any).vitaminD) || 0,
        vitaminB12: Number((food as any).vitaminB12) || 0,
        vitaminB6: Number((food as any).vitaminB6) || 0,
        calcium: Number((food as any).calcium) || 0,
        iron: Number((food as any).iron) || 0,
        omega3: Number((food as any).omega3) || 0,
        zinc: Number((food as any).zinc) || 0,
        folate: Number((food as any).folate) || 0,
        potassium: Number((food as any).potassium) || 0,
      };

      // tryptophan 使用标签匹配
      const TRYPTOPHAN_RICH_TAGS = [
        'poultry',
        'dairy',
        'banana',
        'oats',
        'eggs',
        'seeds',
        'nuts',
        'turkey',
      ];
      const hasTryptophan = TRYPTOPHAN_RICH_TAGS.some(
        (t) =>
          food.tags?.includes(t) ||
          food.category === t ||
          food.mainIngredient?.toLowerCase().includes(t),
      );
      if (hasTryptophan) {
        foodNutrientValues['tryptophan'] = 1;
      }

      // waterContent 使用品类估算
      const waterPct = Number((food as any).waterContentPercent) || 0;
      if (waterPct > 80) {
        foodNutrientValues['waterContent'] = 1;
      }

      let cumulativeDelta = 0;
      for (const [nutrient, delta] of Object.entries(
        this.lifestyleAdjustment,
      )) {
        const val = foodNutrientValues[nutrient];
        if (val !== undefined && val > 0) {
          cumulativeDelta += delta;
        }
      }

      const nutrientBoost = Math.max(
        0.85,
        Math.min(1.15, 1 + cumulativeDelta * 0.05),
      );
      multiplier *= nutrientBoost;
    }

    if (multiplier === 1.0) return null;

    return {
      factorName: this.name,
      multiplier,
      additive: 0,
      explanationKey: 'lifestyleBoost',
      reason: `lifestyle×${multiplier.toFixed(3)}`,
    };
  }
}
