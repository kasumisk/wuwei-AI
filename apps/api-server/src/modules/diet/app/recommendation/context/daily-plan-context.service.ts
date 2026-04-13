/**
 * V6.9 Phase 2-A — 跨餐多样性上下文服务
 *
 * 在推荐多餐（日计划）时追踪已推荐食物的品类、食材、烹饪方式等维度，
 * 对跨餐重复施加惩罚，促进一日饮食多样性。
 *
 * V7.1 Phase 2-C: 跨餐场景联动
 * - computeCrossMealAdjustment() — 基于前序餐次营养累计，调整后续餐次的目标和权重
 *
 * V7.1 Phase 2-F: 多样性奖惩双向 + 风味追踪
 * - calcDiversityAdjustment() — 替代 calcDiversityPenalty()，支持正向奖励（新品类/新烹饪方式/新风味）
 *   和负向惩罚（重复/单一）
 *
 * 使用场景：
 *   daily-plan.service.ts 在生成一日多餐推荐时：
 *   1. createEmpty() → 初始化日计划状态
 *   2. 每餐推荐后 updateAfterMeal() 更新状态
 *   3. 下一餐推荐时 calcDiversityAdjustment() 对候选施加奖惩
 *   4. 下一餐推荐前 computeCrossMealAdjustment() 计算营养补偿
 *
 * 惩罚规则（可通过 ScoringConfigSnapshot 覆盖）：
 *   - 名称重复:      -0.3
 *   - 主食材重复:    -0.2
 *   - 同品类 ≥ 3次: -0.15
 *   - 同烹饪方式 ≥ 2次: -0.1
 *   - 同风味 ≥ 2次:  -0.1  (V7.1)
 *   - 温度全同:      -0.05 (V7.1)
 *   奖励规则 (V7.1)：
 *   - 新品类:         +0.05
 *   - 新烹饪方式:     +0.03
 *   - 新风味:         +0.03
 *   - 总调整范围:    [-0.5, +0.1]
 */

import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  CrossMealAdjustment,
  DailyPlanState,
  MealRecommendation,
  ScoringConfigSnapshot,
} from '../types/recommendation.types';
import {
  type CrossMealRule,
  type CrossMealRuleContext,
  executeCrossMealRules,
  BUILT_IN_CROSS_MEAL_RULES,
} from '../utils/cross-meal-rules';

/** 默认跨餐多样性惩罚参数 */
const DEFAULT_PENALTIES = {
  /** 名称完全重复 */
  nameDuplicate: -0.3,
  /** 主食材重复 */
  mainIngredientDuplicate: -0.2,
  /** 同品类出现次数 ≥ categoryThreshold */
  categoryOveruse: -0.15,
  /** 同烹饪方式出现次数 ≥ cookingMethodThreshold */
  cookingMethodOveruse: -0.1,
  /** 品类过度使用阈值 */
  categoryThreshold: 3,
  /** 烹饪方式过度使用阈值 */
  cookingMethodThreshold: 2,
  /** 惩罚下限（总惩罚不低于此值） */
  minPenalty: -0.5,
} as const;

/** V7.1 P2-F: 多样性奖励参数 */
const DIVERSITY_REWARDS = {
  /** 引入新品类 */
  newCategory: 0.05,
  /** 引入新烹饪方式 */
  newCookingMethod: 0.03,
  /** 引入新风味 */
  newFlavor: 0.03,
  /** 同风味出现 ≥ 此次数时惩罚 */
  flavorOveruseThreshold: 2,
  /** 同风味过度使用惩罚 */
  flavorOveruse: -0.1,
  /** 温度全同惩罚（所有餐次温度一样） */
  temperatureMonotony: -0.05,
  /** 调整上限（奖励不超过此值） */
  maxReward: 0.1,
} as const;

@Injectable()
export class DailyPlanContextService {
  private readonly logger = new Logger(DailyPlanContextService.name);

  /**
   * 创建空的日计划状态
   */
  createEmpty(): DailyPlanState {
    return {
      usedFoodIds: new Set(),
      usedFoodNames: new Set(),
      categoryCounts: {},
      cookingMethodCounts: {},
      usedMainIngredients: new Set(),
      accumulatedNutrition: {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0,
      },
      // V7.1 Phase 1-D: 多样性追踪扩展
      flavorCounts: {},
      temperatureCounts: {},
      usedCuisines: new Set(),
      mealCount: 0,
    };
  }

  /**
   * 在一餐推荐完成后更新日计划状态
   *
   * @param state  当前日计划状态（就地更新）
   * @param meal   当餐推荐结果
   */
  updateAfterMeal(state: DailyPlanState, meal: MealRecommendation): void {
    for (const sf of meal.foods) {
      state.usedFoodIds.add(sf.food.id);
      state.usedFoodNames.add(sf.food.name);

      // 品类计数
      state.categoryCounts[sf.food.category] =
        (state.categoryCounts[sf.food.category] ?? 0) + 1;

      // 烹饪方式计数
      if (sf.food.cookingMethod) {
        state.cookingMethodCounts[sf.food.cookingMethod] =
          (state.cookingMethodCounts[sf.food.cookingMethod] ?? 0) + 1;
      }

      // 主食材
      if (sf.food.mainIngredient) {
        state.usedMainIngredients.add(sf.food.mainIngredient);
      }

      // 累计营养素
      state.accumulatedNutrition.calories += sf.servingCalories;
      state.accumulatedNutrition.protein += sf.servingProtein;
      state.accumulatedNutrition.fat += sf.servingFat;
      state.accumulatedNutrition.carbs += sf.servingCarbs;
      state.accumulatedNutrition.fiber += sf.servingFiber;

      // ─── V7.1 Phase 1-D: 多样性追踪扩展 ───

      // 风味统计（从 flavorProfile 提取主风味）
      if (sf.food.flavorProfile) {
        const fp = sf.food.flavorProfile as Record<string, number>;
        const dominantFlavor = Object.entries(fp)
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .sort(([, a], [, b]) => b - a)[0];
        if (dominantFlavor) {
          state.flavorCounts[dominantFlavor[0]] =
            (state.flavorCounts[dominantFlavor[0]] ?? 0) + 1;
        }
      }

      // 温度统计（V7.1 新字段，可选回退）
      const temp = sf.food.servingTemperature ?? 'hot';
      state.temperatureCounts[temp] = (state.temperatureCounts[temp] ?? 0) + 1;

      // 菜系追踪
      if (sf.food.cuisine) {
        state.usedCuisines.add(sf.food.cuisine);
      }
    }

    // 餐次计数
    state.mealCount += 1;

    this.logger.debug(
      `DailyPlan updated: ${state.usedFoodIds.size} foods, ` +
        `${Object.keys(state.categoryCounts).length} categories, ` +
        `${state.usedCuisines.size} cuisines, ` +
        `${state.mealCount} meals, ` +
        `${state.accumulatedNutrition.calories.toFixed(0)} kcal accumulated`,
    );
  }

  /**
   * V7.1 P2-F: 计算候选食物的跨餐多样性调整（奖惩双向）
   *
   * 正向奖励：引入新品类 +0.05, 新烹饪方式 +0.03, 新风味 +0.03
   * 负向惩罚：名称重复 -0.3, 主食材重复 -0.2, 品类过度使用 -0.15,
   *          烹饪方式过度使用 -0.1, 风味过度使用 -0.1, 温度单一 -0.05
   *
   * 替代原 calcDiversityPenalty()，返回值可正可负。
   *
   * @param food   候选食物
   * @param state  当前日计划状态
   * @param config 可选评分参数快照（惩罚值可覆盖）
   * @returns 调整值 [-0.5, +0.1]，0 表示无调整
   */
  calcDiversityAdjustment(
    food: FoodLibrary,
    state: DailyPlanState,
    config?: ScoringConfigSnapshot | null,
  ): number {
    const penalties = config?.crossMealDiversityPenalties ?? DEFAULT_PENALTIES;
    let adjustment = 0;

    // ── 负向惩罚（保留 V6.9 原有规则）──

    // 规则1: 名称完全重复
    if (state.usedFoodNames.has(food.name)) {
      adjustment += penalties.nameDuplicate ?? DEFAULT_PENALTIES.nameDuplicate;
    }

    // 规则2: 主食材重复
    if (
      food.mainIngredient &&
      state.usedMainIngredients.has(food.mainIngredient)
    ) {
      adjustment +=
        penalties.mainIngredientDuplicate ??
        DEFAULT_PENALTIES.mainIngredientDuplicate;
    }

    // 规则3: 同品类已出现 ≥ threshold 次
    const categoryCount = state.categoryCounts[food.category] ?? 0;
    const categoryThreshold =
      penalties.categoryThreshold ?? DEFAULT_PENALTIES.categoryThreshold;
    if (categoryCount >= categoryThreshold) {
      adjustment +=
        penalties.categoryOveruse ?? DEFAULT_PENALTIES.categoryOveruse;
    }

    // 规则4: 同烹饪方式已出现 ≥ threshold 次
    if (food.cookingMethod) {
      const methodCount = state.cookingMethodCounts[food.cookingMethod] ?? 0;
      const methodThreshold =
        penalties.cookingMethodThreshold ??
        DEFAULT_PENALTIES.cookingMethodThreshold;
      if (methodCount >= methodThreshold) {
        adjustment +=
          penalties.cookingMethodOveruse ??
          DEFAULT_PENALTIES.cookingMethodOveruse;
      }
    }

    // V7.1 规则5: 风味过度使用
    if (food.flavorProfile) {
      const fp = food.flavorProfile as Record<string, number>;
      const dominantFlavor = Object.entries(fp)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .sort(([, a], [, b]) => b - a)[0];
      if (dominantFlavor) {
        const flavorCount = state.flavorCounts[dominantFlavor[0]] ?? 0;
        if (flavorCount >= DIVERSITY_REWARDS.flavorOveruseThreshold) {
          adjustment += DIVERSITY_REWARDS.flavorOveruse;
        }
      }
    }

    // V7.1 规则6: 温度单一（所有餐次温度一样）
    if (state.mealCount >= 2) {
      const temp = food.servingTemperature ?? 'hot';
      const tempKeys = Object.keys(state.temperatureCounts);
      if (tempKeys.length === 1 && tempKeys[0] === temp) {
        adjustment += DIVERSITY_REWARDS.temperatureMonotony;
      }
    }

    // ── 正向奖励（V7.1 新增）──

    // 只有已有至少 1 餐时才发放奖励（首餐无对比基准）
    if (state.mealCount >= 1) {
      // 奖励1: 引入新品类
      if (categoryCount === 0) {
        adjustment += DIVERSITY_REWARDS.newCategory;
      }

      // 奖励2: 引入新烹饪方式
      if (
        food.cookingMethod &&
        (state.cookingMethodCounts[food.cookingMethod] ?? 0) === 0
      ) {
        adjustment += DIVERSITY_REWARDS.newCookingMethod;
      }

      // 奖励3: 引入新风味
      if (food.flavorProfile) {
        const fp = food.flavorProfile as Record<string, number>;
        const dominantFlavor = Object.entries(fp)
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .sort(([, a], [, b]) => b - a)[0];
        if (
          dominantFlavor &&
          (state.flavorCounts[dominantFlavor[0]] ?? 0) === 0
        ) {
          adjustment += DIVERSITY_REWARDS.newFlavor;
        }
      }
    }

    // Clamp 到 [minPenalty, maxReward]
    const minPenalty = penalties.minPenalty ?? DEFAULT_PENALTIES.minPenalty;
    return Math.max(
      minPenalty,
      Math.min(DIVERSITY_REWARDS.maxReward, adjustment),
    );
  }

  /**
   * V6.9 原接口保留（向后兼容，内部委托到 calcDiversityAdjustment）
   *
   * @deprecated 使用 calcDiversityAdjustment() 替代
   */
  calcDiversityPenalty(
    food: FoodLibrary,
    state: DailyPlanState,
    config?: ScoringConfigSnapshot | null,
  ): number {
    // 兼容：旧调用方只期望 <= 0 的值，clamp 到 [-0.5, 0]
    return Math.min(0, this.calcDiversityAdjustment(food, state, config));
  }

  /**
   * V7.1 P2-C: 跨餐场景联动 — 计算营养补偿调整
   *
   * 基于前序餐次的营养累计，对后续餐次的推荐目标和权重进行补偿。
   *
   * V7.2 P2-D: 规则引擎化 — 委托给 executeCrossMealRules()
   * 内联 4 条 if-else 已提取为声明式 BUILT_IN_CROSS_MEAL_RULES，
   * 支持通过 customRules 参数注入自定义规则（追加到内置规则后执行）。
   *
   * @param state       当前日计划状态
   * @param mealIndex   当前是第几餐（0-based）
   * @param dailyTarget 日目标（热量 + 蛋白）
   * @param customRules 可选自定义规则（追加到内置规则后按 priority 排序执行）
   * @returns 跨餐调整参数
   */
  computeCrossMealAdjustment(
    state: DailyPlanState,
    mealIndex: number,
    dailyTarget: { calories: number; protein: number },
    customRules?: readonly CrossMealRule[],
  ): CrossMealAdjustment {
    // 构建规则执行上下文
    const ctx: CrossMealRuleContext = { state, mealIndex, dailyTarget };

    // 合并内置 + 自定义规则，按 priority 排序
    const allRules: readonly CrossMealRule[] = customRules?.length
      ? [...BUILT_IN_CROSS_MEAL_RULES, ...customRules].sort(
          (a, b) => a.priority - b.priority,
        )
      : BUILT_IN_CROSS_MEAL_RULES;

    const result = executeCrossMealRules(allRules, ctx);

    // 调试日志（保留原有格式）
    if (result.reason !== 'first_meal' && result.reason !== 'no_adjustment') {
      this.logger.debug(
        `CrossMealAdjustment meal#${mealIndex}: calorie×${result.calorieMultiplier.toFixed(2)}, ` +
          `overrides=${JSON.stringify(result.weightOverrides)}, cuisineBonus=${result.cuisineDiversityBonus}, ` +
          `reasons=[${result.reason}]`,
      );
    }

    return result;
  }

  /**
   * 获取当前日计划状态的摘要（用于日志/调试）
   */
  getSummary(state: DailyPlanState): {
    totalFoods: number;
    categories: number;
    accumulatedCalories: number;
  } {
    return {
      totalFoods: state.usedFoodIds.size,
      categories: Object.keys(state.categoryCounts).length,
      accumulatedCalories: Math.round(state.accumulatedNutrition.calories),
    };
  }
}
