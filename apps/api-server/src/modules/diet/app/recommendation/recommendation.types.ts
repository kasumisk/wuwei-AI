import { FoodLibrary } from '../../../food/entities/food-library.entity';
import { GoalType } from '../nutrition-score.service';

// ==================== 类型 ====================

export interface MealTarget {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface Constraint {
  includeTags: string[];
  excludeTags: string[];
  maxCalories: number;
  minProtein: number;
}

export interface ScoredFood {
  food: FoodLibrary;
  score: number;
  /** 按标准份量计算的营养 */
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
}

export interface MealRecommendation {
  foods: ScoredFood[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  displayText: string;
  tip: string;
}

export interface UserProfileConstraints {
  dietaryRestrictions?: string[];
  weakTimeSlots?: string[];
  discipline?: string;
  allergens?: string[];
  healthConditions?: string[];
}

// ==================== 评分权重 ====================

export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  protein, carbs, fat,  quality, satiety]
  fat_loss: [0.3, 0.25, 0.15, 0.1, 0.1, 0.1],
  muscle_gain: [0.25, 0.3, 0.2, 0.1, 0.1, 0.05],
  health: [0.15, 0.1, 0.1, 0.1, 0.3, 0.25],
  habit: [0.2, 0.15, 0.1, 0.1, 0.25, 0.2],
};

// ==================== 食物品质/饱腹分推导 ====================

export const CATEGORY_QUALITY: Record<string, number> = {
  veggie: 8,
  fruit: 7,
  dairy: 7,
  protein: 6,
  grain: 5,
  composite: 4,
  snack: 2,
  beverage: 3,
  fat: 3,
  condiment: 3,
};

export const CATEGORY_SATIETY: Record<string, number> = {
  protein: 7,
  grain: 7,
  dairy: 6,
  veggie: 5,
  composite: 5,
  fruit: 3,
  snack: 2,
  beverage: 2,
  fat: 3,
  condiment: 1,
};

// ==================== 餐次偏好策略 ====================

export const MEAL_PREFERENCES: Record<
  string,
  { includeTags: string[]; excludeTags: string[] }
> = {
  breakfast: {
    includeTags: ['breakfast', 'high_carb', 'easy_digest'],
    excludeTags: ['fried', 'heavy_flavor'],
  },
  lunch: {
    includeTags: ['balanced'],
    excludeTags: [],
  },
  dinner: {
    includeTags: ['low_carb', 'high_protein', 'light'],
    excludeTags: ['high_carb', 'dessert'],
  },
  snack: {
    includeTags: ['low_calorie', 'snack', 'fruit'],
    excludeTags: ['fried', 'high_fat'],
  },
};

// ==================== 角色模板 ====================

export const MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'side'],
  lunch: ['carb', 'protein', 'veggie'],
  dinner: ['protein', 'veggie', 'side'],
  snack: ['snack1', 'snack2'],
};

export const ROLE_CATEGORIES: Record<string, string[]> = {
  carb: ['grain', 'composite'],
  protein: ['protein', 'dairy'],
  veggie: ['veggie'],
  side: ['veggie', 'dairy', 'beverage', 'fruit'],
  snack1: ['fruit', 'snack'],
  snack2: ['beverage', 'snack', 'fruit'],
};
