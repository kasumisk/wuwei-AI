/**
 * V5.1 P1.5 — Nutrition Aggregation & Per-Serving Conversion
 *
 * Centralized per-100g → per-serving conversion logic.
 * All conversion in the codebase should use these functions.
 *
 * Functions:
 * - getWeightFactor(food): weight conversion factor (estimatedWeightGrams / 100)
 * - toPerServing(food): single food per-100g → per-serving (all nutrient fields)
 * - aggregateNutrition(foods): sum per-serving values across food list
 * - computeAvgConfidence(foods): average confidence score
 *
 * Design:
 * - Pure functions, no side effects, no DI
 * - Input: AnalyzedFoodItem (per-100g), Output: per-serving values
 */
import {
  AnalyzedFoodItem,
  NutritionTotals,
} from '../types/analysis-result.types';

/**
 * Weight conversion factor: estimatedWeightGrams / 100
 *
 * Fallback: estimatedWeightGrams → standardServingG → 100g
 */
export function getWeightFactor(food: AnalyzedFoodItem): number {
  const grams = food.estimatedWeightGrams || food.standardServingG || 100;
  return grams / 100;
}

/** Per-serving result for a single food item */
export interface PerServingResult {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sodium: number;
  saturatedFat?: number;
  addedSugar?: number;
  transFat?: number;
  cholesterol?: number;
  sugar?: number;
  omega3?: number;
  omega6?: number;
}

/**
 * V5.1: Convert a single food item from per-100g to per-serving.
 *
 * Handles all nutrient fields. Optional fields return undefined if source is null/undefined.
 */
export function toPerServing(food: AnalyzedFoodItem): PerServingResult {
  const factor = getWeightFactor(food);

  const optNum = (v: number | null | undefined): number | undefined =>
    v != null ? (Number(v) || 0) * factor : undefined;

  return {
    calories: (food.calories || 0) * factor,
    protein: (food.protein || 0) * factor,
    fat: (food.fat || 0) * factor,
    carbs: (food.carbs || 0) * factor,
    fiber: (food.fiber || 0) * factor,
    sodium: (food.sodium || 0) * factor,
    saturatedFat: optNum(food.saturatedFat),
    addedSugar: optNum(food.addedSugar),
    transFat: optNum(food.transFat),
    cholesterol: optNum(food.cholesterol),
    sugar: optNum(food.sugar),
    omega3: optNum(food.omega3),
    omega6: optNum(food.omega6),
  };
}

/**
 * Aggregate nutrition totals from food list (per-100g → per-serving, then sum)
 */
export function aggregateNutrition(foods: AnalyzedFoodItem[]): NutritionTotals {
  return {
    calories: foods.reduce(
      (s, f) => s + (f.calories || 0) * getWeightFactor(f),
      0,
    ),
    protein: foods.reduce(
      (s, f) => s + (f.protein || 0) * getWeightFactor(f),
      0,
    ),
    fat: foods.reduce((s, f) => s + (f.fat || 0) * getWeightFactor(f), 0),
    carbs: foods.reduce((s, f) => s + (f.carbs || 0) * getWeightFactor(f), 0),
    fiber: foods.some((f) => f.fiber != null)
      ? Math.round(
          foods.reduce(
            (s, f) => s + (f.fiber || 0) * getWeightFactor(f),
            0,
          ) * 10,
        ) / 10
      : undefined,
    sodium: foods.some((f) => f.sodium != null)
      ? Math.round(
          foods.reduce(
            (s, f) => s + (f.sodium || 0) * getWeightFactor(f),
            0,
          ),
        )
      : undefined,
    saturatedFat: foods.some((f) => f.saturatedFat != null)
      ? Math.round(
          foods.reduce(
            (s, f) => s + (Number(f.saturatedFat) || 0) * getWeightFactor(f),
            0,
          ) * 10,
        ) / 10
      : undefined,
    addedSugar: foods.some((f) => f.addedSugar != null)
      ? Math.round(
          foods.reduce(
            (s, f) => s + (Number(f.addedSugar) || 0) * getWeightFactor(f),
            0,
          ) * 10,
        ) / 10
      : undefined,
  };
}

/**
 * Average confidence across food items
 */
export function computeAvgConfidence(foods: AnalyzedFoodItem[]): number {
  if (foods.length === 0) return 0.5;
  return foods.reduce((s, f) => s + f.confidence, 0) / foods.length;
}
