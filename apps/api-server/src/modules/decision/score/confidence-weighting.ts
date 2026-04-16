/**
 * V2.2 Phase 1.3 — 置信度加权纯函数
 *
 * 核心思想：低置信度食物的营养数据向"单餐目标值"衰减，
 * 避免不可靠数据对评分产生过大影响。
 *
 * 置信度=1.0 → 完全使用原值
 * 置信度=0.5 → 原值与单餐目标各占一半
 *
 * 仅影响评分计算输入，不影响用户看到的原始营养数据展示。
 */

// ==================== 类型 ====================

export interface WeightableFood {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  confidence: number;
}

export interface MealNutritionTarget {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface WeightedNutrition {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

// ==================== 纯函数 ====================

/**
 * 对单个食物的营养值按置信度向单餐目标衰减。
 *
 * @param food — 食物营养 + 置信度
 * @param mealTarget — 单餐目标值（goalX / mealsPerDay）
 * @returns 加权后的营养值
 */
export function applyConfidenceWeighting(
  food: WeightableFood,
  mealTarget: MealNutritionTarget,
): WeightedNutrition {
  const w = Math.max(0, Math.min(1, food.confidence ?? 0.7));

  // 高置信度（>=0.9）不做衰减，避免对库匹配结果产生影响
  if (w >= 0.9) {
    return {
      calories: food.calories,
      protein: food.protein,
      fat: food.fat,
      carbs: food.carbs,
    };
  }

  return {
    calories: food.calories * w + mealTarget.calories * (1 - w),
    protein: food.protein * w + mealTarget.protein * (1 - w),
    fat: food.fat * w + mealTarget.fat * (1 - w),
    carbs: food.carbs * w + mealTarget.carbs * (1 - w),
  };
}

/**
 * 对一组食物做置信度加权汇总。
 *
 * @param foods — 食物列表
 * @param mealTarget — 单餐目标值
 * @returns 加权后的总营养值
 */
export function aggregateWithConfidence(
  foods: WeightableFood[],
  mealTarget: MealNutritionTarget,
): WeightedNutrition {
  const result: WeightedNutrition = {
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
  };

  for (const food of foods) {
    const weighted = applyConfidenceWeighting(food, mealTarget);
    result.calories += weighted.calories;
    result.protein += weighted.protein;
    result.fat += weighted.fat;
    result.carbs += weighted.carbs;
  }

  return result;
}
