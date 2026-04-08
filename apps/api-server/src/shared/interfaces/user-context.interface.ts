export interface UserContext {
  userId: string;
  goalType: string;
  goalSpeed: string;
  targetCalories: number;
  macroTargets: { protein: number; fat: number; carbs: number };
  mealType: string;
  allergens: string[];
  dietaryRestrictions: string[];
  discipline: string;
  userSegment: string;
  /** 已消耗（今日截至当前的热量） */
  consumedCalories: number;
  consumedProtein: number;
  consumedFat: number;
  consumedCarbs: number;
}
