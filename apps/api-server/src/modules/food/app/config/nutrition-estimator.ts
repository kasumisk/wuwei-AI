/**
 * V1.9 Phase 1.2 — 营养估算纯函数
 *
 * 从 FoodDecisionService.estimateQuality / estimateSatiety 提取为独立纯函数，
 * 打破 FoodScoringService → FoodDecisionService 的循环依赖。
 *
 * 两个服务均可直接调用这些函数，无需相互注入。
 */

/** 估算所需的最小食物字段 */
export interface EstimatableFoodItem {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  estimatedWeightGrams: number;
  fiber?: number;
  sodium?: number;
  saturatedFat?: number | null;
  addedSugar?: number | null;
}

/**
 * 估算食物质量分 (1-10)
 *
 * 评估维度: 纤维、钠、添加糖、饱和脂肪、蛋白质比、能量密度
 */
export function estimateQuality(food: EstimatableFoodItem): number {
  let q = 5;
  if (food.fiber && food.fiber > 3) q += 1;
  if (food.sodium && food.sodium > 600) q -= 1;
  if (food.addedSugar && Number(food.addedSugar) > 5) q -= 1;
  if (food.saturatedFat && Number(food.saturatedFat) > 5) q -= 1;
  const proteinRatio = (food.protein * 4) / Math.max(1, food.calories);
  if (proteinRatio > 0.25) q += 1;
  if (
    food.estimatedWeightGrams > 0 &&
    food.calories / food.estimatedWeightGrams < 1.2
  ) {
    q += 1;
  }
  return Math.max(1, Math.min(10, q));
}

/**
 * 估算饱腹感分 (1-10)
 *
 * 评估维度: 蛋白质、纤维、脂肪/碳水比、热量、精制碳水
 */
export function estimateSatiety(food: EstimatableFoodItem): number {
  let s = 5;
  if (food.protein > 15) s += 1;
  if (food.fiber && food.fiber > 3) s += 1;
  if (food.fat > 15 && food.carbs < 20) s += 1;
  if (food.calories > 0 && food.calories < 100) s -= 1;
  if (food.carbs > 40 && (!food.fiber || food.fiber < 2)) s -= 1;
  return Math.max(1, Math.min(10, s));
}
