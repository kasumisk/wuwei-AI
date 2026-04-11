/**
 * V6.5 Phase 2C — 整餐组合评分器
 *
 * 职责：
 * - 在单品评分（food-scorer）之后、最终输出之前，对已组装的整餐进行组合级评分
 * - 评估维度：食材多样性、烹饪方式多样性、口味互补性、营养互补性
 * - 输出整餐组合评分（MealCompositionScore），供 Rerank 和前端展示使用
 *
 * 使用场景：
 *   MealAssembler 组装完整餐后 → 调用 scoreMealComposition() 获取组合评分
 *   → 前端展示整餐推荐时附带组合评分解释
 */
import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import { ScoredFood } from './recommendation.types';

// ─── 类型定义 ───

/** 整餐组合评分结果 */
export interface MealCompositionScore {
  /** 食材重复度（0-100，100=完全不重复） */
  ingredientDiversity: number;
  /** 烹饪方式多样性（0-100，100=每道菜不同烹饪方式） */
  cookingMethodDiversity: number;
  /** 口味互补性（0-100，100=口味维度覆盖均衡） */
  flavorBalance: number;
  /** 营养互补性（0-100，100=互补营养素对完美覆盖） */
  nutritionComplementarity: number;
  /** 整体组合评分（加权） */
  overall: number;
}

/** 组合评分各维度权重 */
const COMPOSITION_WEIGHTS = {
  ingredientDiversity: 0.3,
  cookingMethodDiversity: 0.2,
  flavorBalance: 0.25,
  nutritionComplementarity: 0.25,
} as const;

/** 互补营养素对 — 同时包含两者时吸收/效果增强 */
const COMPLEMENTARY_PAIRS: ReadonlyArray<{
  a: keyof FoodLibrary;
  b: keyof FoodLibrary;
  label: string;
}> = [
  { a: 'iron', b: 'vitaminC', label: '铁+维C→铁吸收增强' },
  { a: 'calcium', b: 'vitaminD', label: '钙+维D→钙吸收增强' },
  { a: 'fat', b: 'vitaminA', label: '脂肪+维A→脂溶性维生素吸收' },
  { a: 'protein', b: 'vitaminB12', label: '蛋白质+B12→蛋白质合成' },
];

/** 口味六轴 */
const FLAVOR_AXES = [
  'sweet',
  'sour',
  'salty',
  'bitter',
  'umami',
  'spicy',
] as const;

@Injectable()
export class MealCompositionScorer {
  /**
   * 对已选定的整餐组合进行组合级评分
   *
   * @param selectedFoods 已通过 MealAssembler 选定的食物列表
   * @returns MealCompositionScore
   */
  scoreMealComposition(selectedFoods: ScoredFood[]): MealCompositionScore {
    if (selectedFoods.length === 0) {
      return {
        ingredientDiversity: 100,
        cookingMethodDiversity: 100,
        flavorBalance: 80,
        nutritionComplementarity: 0,
        overall: 50,
      };
    }

    const ingredientDiversity = this.calcIngredientDiversity(selectedFoods);
    const cookingMethodDiversity =
      this.calcCookingMethodDiversity(selectedFoods);
    const flavorBalance = this.calcFlavorBalance(selectedFoods);
    const nutritionComplementarity =
      this.calcNutritionComplementarity(selectedFoods);

    const overall = Math.round(
      ingredientDiversity * COMPOSITION_WEIGHTS.ingredientDiversity +
        cookingMethodDiversity * COMPOSITION_WEIGHTS.cookingMethodDiversity +
        flavorBalance * COMPOSITION_WEIGHTS.flavorBalance +
        nutritionComplementarity * COMPOSITION_WEIGHTS.nutritionComplementarity,
    );

    return {
      ingredientDiversity,
      cookingMethodDiversity,
      flavorBalance,
      nutritionComplementarity,
      overall,
    };
  }

  /**
   * 食材重复度检测
   * 提取每道菜的主要食材（mainIngredient），检测重叠比例
   * 100 = 完全不重复，0 = 全部相同
   */
  private calcIngredientDiversity(foods: ScoredFood[]): number {
    const allIngredients = foods
      .map((f) => f.food.mainIngredient?.toLowerCase())
      .filter(Boolean) as string[];

    if (allIngredients.length <= 1) return 100;

    const uniqueCount = new Set(allIngredients).size;
    return Math.round((uniqueCount / allIngredients.length) * 100);
  }

  /**
   * 烹饪方式多样性
   * 100 = 每道菜不同方式，0 = 全部相同
   */
  private calcCookingMethodDiversity(foods: ScoredFood[]): number {
    const methods = foods
      .map((f) => f.food.cookingMethod?.toLowerCase())
      .filter(Boolean) as string[];

    if (methods.length <= 1) return 100;

    const uniqueCount = new Set(methods).size;
    return Math.round((uniqueCount / methods.length) * 100);
  }

  /**
   * 口味互补性
   *
   * 基于 flavorProfile 六轴（sweet/sour/salty/bitter/umami/spicy），
   * 计算各轴的标准差。标准差越大 → 口味越分散（越好）。
   *
   * 单品时默认 80 分。
   */
  private calcFlavorBalance(foods: ScoredFood[]): number {
    const profiles = foods
      .map((f) => f.food.flavorProfile)
      .filter(Boolean) as NonNullable<FoodLibrary['flavorProfile']>[];

    if (profiles.length < 2) return 80;

    let totalVariance = 0;
    for (const axis of FLAVOR_AXES) {
      const values = profiles.map((p) => p[axis] ?? 0);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance =
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      totalVariance += variance;
    }

    // 平均标准差映射到 0-100：
    // std < 0.5 → 低分（口味太相似），std > 2.5 → 满分
    const avgStd = Math.sqrt(totalVariance / FLAVOR_AXES.length);
    return Math.min(100, Math.round(avgStd * 40));
  }

  /**
   * 营养互补性
   *
   * 检测互补营养素对（如铁+维C、钙+维D），
   * 整餐中同时包含两种营养素时得分。
   * 100 = 所有互补对都满足。
   */
  private calcNutritionComplementarity(foods: ScoredFood[]): number {
    if (foods.length < 2) return 0;

    let hits = 0;
    for (const pair of COMPLEMENTARY_PAIRS) {
      const hasA = foods.some((f) => {
        const val = f.food[pair.a];
        return typeof val === 'number' && val > 0;
      });
      const hasB = foods.some((f) => {
        const val = f.food[pair.b];
        return typeof val === 'number' && val > 0;
      });
      if (hasA && hasB) hits++;
    }

    return Math.round((hits / COMPLEMENTARY_PAIRS.length) * 100);
  }
}
