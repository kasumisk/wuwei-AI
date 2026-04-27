/**
 * Nutrition Aggregation
 *
 * 数据契约（V6.x 起）：AnalyzedFoodItem 上的所有营养字段均已是
 * **per-serving 实际摄入值**（由各上游路径——食物库匹配、LLM 解析、
 * 启发式兜底、图片分析——在生成 AnalyzedFoodItem 时按
 * estimatedWeightGrams/100 完成换算）。
 *
 * 因此本聚合器只做"逐项求和"，不再对单项做任何按重量缩放。
 * 历史的 `getWeightFactor` / `toPerServing` 工具已删除，避免被误用造成双重缩放。
 *
 * 导出：
 * - aggregateNutrition(foods): 对食物列表的 per-serving 营养字段求和
 * - computeAvgConfidence(foods): 平均置信度
 */
import {
  AnalyzedFoodItem,
  NutritionTotals,
} from '../types/analysis-result.types';

/** 累加可选字段：仅当至少有一项非空时返回求和值（保留 undefined 语义） */
function sumOptional(
  foods: AnalyzedFoodItem[],
  pick: (f: AnalyzedFoodItem) => number | null | undefined,
  precision: 0 | 1 = 0,
): number | undefined {
  if (!foods.some((f) => pick(f) != null)) return undefined;
  const total = foods.reduce((s, f) => s + (Number(pick(f)) || 0), 0);
  return precision === 1 ? Math.round(total * 10) / 10 : Math.round(total);
}

/**
 * 汇总营养总量。
 *
 * 输入：foods 中的 calories/protein/fat/... 视为已按份量换算后的实际摄入；
 * 输出：直接求和；浮点字段统一保留 1 位小数，整数字段（钠、胆固醇）四舍五入。
 *
 * 不变量：Σ foods[i].x === totals.x（前端编辑/保存依赖此契约）。
 */
export function aggregateNutrition(foods: AnalyzedFoodItem[]): NutritionTotals {
  const sumNum = (pick: (f: AnalyzedFoodItem) => number | null | undefined) =>
    foods.reduce((s, f) => s + (Number(pick(f)) || 0), 0);

  return {
    calories: Math.round(sumNum((f) => f.calories) * 10) / 10,
    protein: Math.round(sumNum((f) => f.protein) * 10) / 10,
    fat: Math.round(sumNum((f) => f.fat) * 10) / 10,
    carbs: Math.round(sumNum((f) => f.carbs) * 10) / 10,
    fiber: sumOptional(foods, (f) => f.fiber, 1),
    sodium: sumOptional(foods, (f) => f.sodium, 0),
    saturatedFat: sumOptional(foods, (f) => f.saturatedFat, 1),
    addedSugar: sumOptional(foods, (f) => f.addedSugar, 1),
  };
}

/**
 * 平均置信度
 */
export function computeAvgConfidence(foods: AnalyzedFoodItem[]): number {
  if (foods.length === 0) return 0.5;
  return foods.reduce((s, f) => s + f.confidence, 0) / foods.length;
}
