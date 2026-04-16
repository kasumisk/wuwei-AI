/**
 * V2.1 Phase 2.1 — 营养汇总纯函数
 *
 * 从 TextFoodAnalysisService.calculateTotals() 提取。
 * 同时被文本和图片链路使用，确保汇总逻辑一致。
 *
 * 设计原则:
 * - 纯函数，无副作用，无依赖注入
 * - 输入为 AnalyzedFoodItem[]，输出 NutritionTotals
 */
import {
  AnalyzedFoodItem,
  NutritionTotals,
} from '../types/analysis-result.types';

/**
 * 从食物列表计算营养汇总
 *
 * 规则：
 * - calories/protein/fat/carbs 直接求和
 * - fiber/sodium/saturatedFat/addedSugar 仅在至少一个食物有值时才计算
 */
export function aggregateNutrition(foods: AnalyzedFoodItem[]): NutritionTotals {
  return {
    calories: foods.reduce((s, f) => s + (f.calories || 0), 0),
    protein: foods.reduce((s, f) => s + (f.protein || 0), 0),
    fat: foods.reduce((s, f) => s + (f.fat || 0), 0),
    carbs: foods.reduce((s, f) => s + (f.carbs || 0), 0),
    fiber: foods.some((f) => f.fiber != null)
      ? Math.round(foods.reduce((s, f) => s + (f.fiber || 0), 0) * 10) / 10
      : undefined,
    sodium: foods.some((f) => f.sodium != null)
      ? Math.round(foods.reduce((s, f) => s + (f.sodium || 0), 0))
      : undefined,
    saturatedFat: foods.some((f) => f.saturatedFat != null)
      ? Math.round(
          foods.reduce((s, f) => s + (Number(f.saturatedFat) || 0), 0) * 10,
        ) / 10
      : undefined,
    addedSugar: foods.some((f) => f.addedSugar != null)
      ? Math.round(
          foods.reduce((s, f) => s + (Number(f.addedSugar) || 0), 0) * 10,
        ) / 10
      : undefined,
  };
}

/**
 * 计算食物列表的平均置信度
 */
export function computeAvgConfidence(foods: AnalyzedFoodItem[]): number {
  if (foods.length === 0) return 0.5;
  return foods.reduce((s, f) => s + f.confidence, 0) / foods.length;
}
