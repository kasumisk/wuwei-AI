/**
 * V6.3 P2-6: Recipe 模块类型定义
 */

/** 菜谱来源 */
export type RecipeSource = 'ai_generated' | 'user' | 'imported';

/** 菜谱摘要（列表查询返回） */
export interface RecipeSummary {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  difficulty: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number;
  tags: string[];
  imageUrl: string | null;
  source: string;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  fatPerServing: number | null;
  carbsPerServing: number | null;
  fiberPerServing: number | null;
  qualityScore: number;
  usageCount: number;
  /** V6.5 Phase 2M: 平均用户评分（1-5），无评分时为 null */
  averageRating: number | null;
  /** V6.5 Phase 2M: 评分人数 */
  ratingCount: number;
}

/** 菜谱食材 */
export interface RecipeIngredientItem {
  id: string;
  foodId: string | null;
  ingredientName: string;
  amount: number | null;
  unit: string | null;
  isOptional: boolean;
  sortOrder: number;
}

/** 菜谱详情（含食材列表） */
export interface RecipeDetail extends RecipeSummary {
  instructions: any | null;
  ingredients: RecipeIngredientItem[];
  createdAt: Date;
  updatedAt: Date;
}

/** 菜谱评分结果（用于推荐引擎） */
export interface ScoredRecipe {
  recipe: RecipeDetail;
  score: number;
  nutritionMatch: number; // 营养匹配度 0-1
  preferenceMatch: number; // 偏好匹配度 0-1
  difficultyMatch: number; // 难度匹配度 0-1
  /** V6.5 Phase 1K: 烹饪时间匹配度 0-1 */
  timeMatch: number;
  /** V6.3 P3-2: 为什么推荐这道菜 */
  whyThisRecipe?: string;
}

// ==================== V6.5 Phase 2M: 菜谱用户评分 ====================

/** 单条用户评分 */
export interface RecipeRating {
  id: string;
  recipeId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 菜谱评分汇总 */
export interface RecipeRatingSummary {
  recipeId: string;
  averageRating: number;
  ratingCount: number;
  distribution: Record<number, number>; // { 1: count, 2: count, ... 5: count }
}
