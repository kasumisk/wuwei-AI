/**
 * V7.2 P1-C: 跨餐补偿规则引擎
 *
 * 将 DailyPlanContextService.computeCrossMealAdjustment() 中 4 条内联规则
 * 提取为声明式规则数组，支持动态扩展和配置化。
 *
 * 设计原则：
 * - 每条规则有唯一 ID、前提条件检测、效果应用、阈值参数
 * - 规则按 priority 排序执行（小→大），但各规则效果可叠加
 * - 现有 4 条规则原样迁移，阈值从 CROSS_MEAL_PARAMS 常量搬入
 * - 新增规则只需追加到 BUILT_IN_CROSS_MEAL_RULES 数组
 */

import type {
  CrossMealAdjustment,
  DailyPlanState,
  ScoreDimension,
} from '../types/recommendation.types';

// ─── CrossMealRule：声明式跨餐规则接口 ───

/**
 * 跨餐规则执行上下文
 *
 * 包含规则检测和效果应用所需的全部输入。
 */
export interface CrossMealRuleContext {
  /** 当前日计划状态 */
  state: DailyPlanState;
  /** 当前是第几餐（0-based） */
  mealIndex: number;
  /** 日目标 */
  dailyTarget: { calories: number; protein: number };
}

/**
 * 单条规则的效果
 *
 * 规则可以同时调整热量倍数、权重覆盖、菜系多样性加分中的一个或多个。
 */
export interface CrossMealRuleEffect {
  /** 热量目标倍数调整（叠加到 calorieMultiplier，如 1.1 = +10%） */
  calorieMultiplier?: number;
  /** 权重覆盖（叠加） */
  weightOverrides?: Partial<Record<ScoreDimension, number>>;
  /** 菜系多样性加分（叠加） */
  cuisineDiversityBonus?: number;
  /** 原因标签（用于拼接 CrossMealAdjustment.reason） */
  reasonTag: string;
}

/**
 * 声明式跨餐补偿规则
 *
 * 生命周期:
 * 1. 按 priority 升序排列
 * 2. 逐条调用 condition(ctx) 检测是否适用
 * 3. 适用则调用 apply(ctx) 获取效果
 * 4. 效果叠加到 CrossMealAdjustment 中
 */
export interface CrossMealRule {
  /** 规则唯一 ID */
  readonly id: string;
  /** 规则名称（调试用） */
  readonly name: string;
  /** 执行优先级（升序） */
  readonly priority: number;
  /** 是否启用（可用于运行时开关） */
  enabled: boolean;

  /**
   * 前提条件 — 返回 true 表示此规则适用
   */
  condition(ctx: CrossMealRuleContext): boolean;

  /**
   * 计算效果 — 仅在 condition 返回 true 时调用
   */
  apply(ctx: CrossMealRuleContext): CrossMealRuleEffect;
}

// ─── 内置 4 条规则 ───

/**
 * 规则 1: 轻早餐补偿
 *
 * 条件: mealIndex=1 (午餐) 且早餐热量 < 日目标 20%
 * 效果: 午餐热量 +10%
 */
export const RULE_LIGHT_BREAKFAST: CrossMealRule = {
  id: 'light-breakfast',
  name: '轻早餐午餐补偿',
  priority: 10,
  enabled: true,

  condition(ctx: CrossMealRuleContext): boolean {
    if (ctx.mealIndex !== 1 || ctx.dailyTarget.calories <= 0) return false;
    const breakfastRatio =
      ctx.state.accumulatedNutrition.calories / ctx.dailyTarget.calories;
    return breakfastRatio < 0.2;
  },

  apply(ctx: CrossMealRuleContext): CrossMealRuleEffect {
    const breakfastRatio =
      ctx.state.accumulatedNutrition.calories / ctx.dailyTarget.calories;
    return {
      calorieMultiplier: 1.1,
      reasonTag: `light_breakfast(${(breakfastRatio * 100).toFixed(0)}%<20%)`,
    };
  },
};

/**
 * 规则 2: 高碳午餐补偿
 *
 * 条件: mealIndex=2 (晚餐) 且前序碳水占热量 > 60%
 * 效果: 晚餐碳水权重 ×1.3
 */
export const RULE_HIGH_CARB_LUNCH: CrossMealRule = {
  id: 'high-carb-lunch',
  name: '高碳午餐晚餐补偿',
  priority: 20,
  enabled: true,

  condition(ctx: CrossMealRuleContext): boolean {
    if (ctx.mealIndex !== 2) return false;
    const acc = ctx.state.accumulatedNutrition;
    if (acc.calories <= 0) return false;
    const carbRatio = (acc.carbs * 4) / acc.calories;
    return carbRatio > 0.6;
  },

  apply(ctx: CrossMealRuleContext): CrossMealRuleEffect {
    const acc = ctx.state.accumulatedNutrition;
    const carbRatio = (acc.carbs * 4) / acc.calories;
    return {
      weightOverrides: { carbs: 1.3 },
      reasonTag: `high_carb_prev(${(carbRatio * 100).toFixed(0)}%>60%)`,
    };
  },
};

/**
 * 规则 3: 蛋白不足补偿
 *
 * 条件: mealIndex>=1 且累计蛋白 < 预期进度 × 0.85
 * 效果: 蛋白权重 ×1.4
 */
export const RULE_PROTEIN_DEFICIT: CrossMealRule = {
  id: 'protein-deficit',
  name: '蛋白不足补偿',
  priority: 30,
  enabled: true,

  condition(ctx: CrossMealRuleContext): boolean {
    if (ctx.mealIndex < 1 || ctx.dailyTarget.protein <= 0) return false;
    const expectedMeals = 3;
    const expectedProgress = ctx.mealIndex / expectedMeals;
    const actualProgress =
      ctx.state.accumulatedNutrition.protein / ctx.dailyTarget.protein;
    return actualProgress < expectedProgress * 0.85;
  },

  apply(ctx: CrossMealRuleContext): CrossMealRuleEffect {
    const expectedMeals = 3;
    const expectedProgress = ctx.mealIndex / expectedMeals;
    const actualProgress =
      ctx.state.accumulatedNutrition.protein / ctx.dailyTarget.protein;
    return {
      weightOverrides: { protein: 1.4 },
      reasonTag: `protein_deficit(actual=${(actualProgress * 100).toFixed(0)}%<expected=${(expectedProgress * 0.85 * 100).toFixed(0)}%)`,
    };
  },
};

/**
 * 规则 4: 菜系单一惩罚
 *
 * 条件: 已完成 ≥2 餐且只有 ≤1 种菜系
 * 效果: 非同菜系食物 +0.05 多样性加分
 */
export const RULE_CUISINE_MONOTONY: CrossMealRule = {
  id: 'cuisine-monotony',
  name: '菜系单一多样性加分',
  priority: 40,
  enabled: true,

  condition(ctx: CrossMealRuleContext): boolean {
    return ctx.state.mealCount >= 2 && ctx.state.usedCuisines.size <= 1;
  },

  apply(ctx: CrossMealRuleContext): CrossMealRuleEffect {
    return {
      cuisineDiversityBonus: 0.05,
      reasonTag: `cuisine_monotony(${ctx.state.usedCuisines.size}_cuisines)`,
    };
  },
};

// ─── 内置规则集合 ───

/**
 * V7.2 内置跨餐补偿规则（按 priority 排序）
 *
 * 新增规则只需追加到此数组。
 * DailyPlanContextService 将从此数组读取规则而非使用内联 if-else。
 */
export const BUILT_IN_CROSS_MEAL_RULES: CrossMealRule[] = [
  RULE_LIGHT_BREAKFAST,
  RULE_HIGH_CARB_LUNCH,
  RULE_PROTEIN_DEFICIT,
  RULE_CUISINE_MONOTONY,
];

// ─── 规则引擎执行器（纯函数） ───

/**
 * 执行跨餐规则引擎
 *
 * 遍历 rules，依次检测条件并叠加效果，返回合并后的 CrossMealAdjustment。
 *
 * @param rules 规则集合（应按 priority 排序）
 * @param ctx   执行上下文
 * @returns 合并后的跨餐调整
 */
export function executeCrossMealRules(
  rules: readonly CrossMealRule[],
  ctx: CrossMealRuleContext,
): CrossMealAdjustment {
  let calorieMultiplier = 1.0;
  const weightOverrides: Partial<Record<ScoreDimension, number>> = {};
  let cuisineDiversityBonus = 0;
  const reasons: string[] = [];

  // 首餐无前序数据，不调整
  if (ctx.mealIndex === 0 || ctx.state.mealCount === 0) {
    return {
      calorieMultiplier,
      weightOverrides,
      cuisineDiversityBonus,
      reason: 'first_meal',
    };
  }

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.condition(ctx)) continue;

    const effect = rule.apply(ctx);

    if (effect.calorieMultiplier !== undefined) {
      calorieMultiplier = effect.calorieMultiplier;
    }
    if (effect.weightOverrides) {
      Object.assign(weightOverrides, effect.weightOverrides);
    }
    if (effect.cuisineDiversityBonus !== undefined) {
      cuisineDiversityBonus += effect.cuisineDiversityBonus;
    }
    reasons.push(effect.reasonTag);
  }

  return {
    calorieMultiplier,
    weightOverrides,
    cuisineDiversityBonus,
    reason: reasons.length > 0 ? reasons.join('; ') : 'no_adjustment',
  };
}
