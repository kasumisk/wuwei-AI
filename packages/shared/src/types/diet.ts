/**
 * 共享饮食类型定义
 * Web 和小程序的 DailySummary / FoodItem / MealSuggestion 等基础类型
 * 各端可按需扩展
 */

/** 食物条目 — 后端 foods JSONB 中的单条数据 */
export interface SharedFoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  protein?: number;
  fat?: number;
  carbs?: number;
  quality?: number;
  satiety?: number;
}

/** 每日摘要基础字段 — 后端 daily_summaries 表 */
export interface SharedDailySummary {
  totalCalories: number;
  mealCount: number;
  calorieGoal?: number | null;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  avgQuality?: number;
  avgSatiety?: number;
  nutritionScore?: number;
  proteinGoal?: number;
  fatGoal?: number;
  carbsGoal?: number;
}

/** 单餐计划 */
export interface SharedMealPlan {
  foods: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  tip: string;
}

/** 下一餐推荐场景 */
export interface SharedMealScenario {
  scenario: string;
  foods: string;
  calories: number;
  tip: string;
}

/** 下一餐推荐 */
export interface SharedMealSuggestion {
  mealType: string;
  remainingCalories: number;
  suggestion: { foods: string; calories: number; tip: string };
  scenarios?: SharedMealScenario[];
}

/** 营养评分维度 */
export interface SharedNutritionScoreBreakdown {
  energy: number;
  proteinRatio: number;
  macroBalance: number;
  foodQuality: number;
  satiety: number;
  stability: number;
  glycemicImpact?: number;
}
