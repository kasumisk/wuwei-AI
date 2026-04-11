/**
 * V6.5 Phase 1E: ProfileScoringMapper — 画像→评分映射器
 *
 * 将 LifestyleProfile 中的6个画像字段转换为评分调整因子，
 * 供 food-scorer 和 recommendation-engine 在评分阶段使用。
 *
 * 设计原则：
 * - 纯函数，无副作用，无 I/O
 * - 每个因子返回 0.7~1.15 范围的乘数（避免极端修正）
 * - 未设置的字段返回中性乘数 1.0（不影响评分）
 */

import { FoodLibrary } from '../../../food/food.types';
import { LifestyleProfile } from './recommendation.types';

// ─── 口味强度计算辅助 ───

/**
 * 计算食物的口味强度总值 (0-1 归一化)
 *
 * flavorProfile 各维度 0-1，取最大值和平均值的加权平均：
 * intensity = 0.6 * max + 0.4 * avg
 * 这样既反映食物的"最突出"风味，也考虑整体强度。
 */
function calcFlavorIntensity(flavorProfile: Record<string, number>): number {
  const values = Object.values(flavorProfile).filter(
    (v) => typeof v === 'number' && !isNaN(v),
  );
  if (values.length === 0) return 0.5; // 无数据时视为中等
  const max = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return 0.6 * max + 0.4 * avg;
}

/**
 * 将用户 tasteIntensity (0-5 scale) 转为归一化偏好强度 (0-1)
 *
 * 取所有维度的平均值，然后除以5归一化。
 * 高值 = 用户偏好重口味，低值 = 偏好清淡。
 */
function calcUserTastePreference(
  tasteIntensity: Record<string, number>,
): number {
  const values = Object.values(tasteIntensity).filter(
    (v) => typeof v === 'number' && !isNaN(v),
  );
  if (values.length === 0) return 0.5;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.min(1, avg / 5);
}

// ─── 评分因子接口 ───

/**
 * 评分调整因子集合
 *
 * 每个因子是一个函数（接受 food 返回乘数）或一个常量乘数。
 * 推荐引擎在评分阶段对每个食物调用这些函数，将结果乘到最终分数上。
 */
export interface ScoringFactors {
  /**
   * 口味匹配度：根据用户口味偏好强度与食物风味强度的匹配度
   * 返回 0.8~1.0 的乘数
   */
  tasteMatch: (food: FoodLibrary) => number;

  /**
   * 菜系匹配度：用户偏好菜系命中时加分
   * 返回 1.0（不匹配）或 1.08（匹配）
   */
  cuisineMatch: (food: FoodLibrary) => number;

  /**
   * 预算匹配度：食物价格等级与用户预算的对比
   * 返回 0.7~1.0 的乘数（超预算按级递减 -10%）
   */
  budgetMatch: (food: FoodLibrary) => number;

  /**
   * 烹饪技能匹配度：食物难度与用户技能的对比
   * 返回 0.8~1.05 的乘数
   */
  skillMatch: (food: FoodLibrary) => number;

  /**
   * 备餐意愿修正：用户不愿备餐时降低需要备餐的复杂食物得分
   * 返回 0.85~1.0 的乘数
   */
  mealPrepMatch: (food: FoodLibrary) => number;

  /**
   * 家庭份量乘数：家庭人数 > 1 时用于菜谱份量建议
   * 不影响评分（仅用于展示），值为家庭人数
   */
  portionMultiplier: number;
}

// ─── 技能等级映射 ───

const COOKING_SKILL_NUMERIC: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

const FOOD_SKILL_NUMERIC: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

// ─── 预算映射 ───

const BUDGET_MAX_COST: Record<string, number> = {
  low: 2,
  medium: 3,
  high: 5,
};

// ─── 核心映射函数 ───

/**
 * 将 LifestyleProfile 映射为评分调整因子
 *
 * @param lifestyle - 生活方式画像（来自 EnrichedProfileContext.lifestyle）
 * @returns ScoringFactors — 各维度的评分乘数函数
 */
export function mapLifestyleToScoringFactors(
  lifestyle: LifestyleProfile | null,
): ScoringFactors {
  // 无画像数据时返回全中性因子
  if (!lifestyle) {
    return {
      tasteMatch: () => 1.0,
      cuisineMatch: () => 1.0,
      budgetMatch: () => 1.0,
      skillMatch: () => 1.0,
      mealPrepMatch: () => 1.0,
      portionMultiplier: 1,
    };
  }

  // 预计算用户口味偏好强度（避免每次食物评分都重算）
  const userTastePref = lifestyle.tasteIntensity
    ? calcUserTastePreference(lifestyle.tasteIntensity)
    : null;

  return {
    // ─── 1. 口味匹配 ───
    tasteMatch: (food: FoodLibrary): number => {
      if (userTastePref === null || !food.flavorProfile) return 1.0;
      const foodIntensity = calcFlavorIntensity(food.flavorProfile);
      const diff = Math.abs(foodIntensity - userTastePref);
      // diff 0 → 1.0, diff 1 → 0.8
      return Math.max(0.8, 1.0 - diff * 0.2);
    },

    // ─── 2. 菜系匹配 ───
    cuisineMatch: (food: FoodLibrary): number => {
      if (!lifestyle.cuisinePreferences?.length || !food.cuisine) return 1.0;
      return lifestyle.cuisinePreferences.includes(food.cuisine) ? 1.08 : 1.0;
    },

    // ─── 3. 预算匹配 ───
    budgetMatch: (food: FoodLibrary): number => {
      if (!lifestyle.budgetLevel) return 1.0;
      const costLevel = food.estimatedCostLevel ?? 2;
      const maxAcceptable = BUDGET_MAX_COST[lifestyle.budgetLevel] ?? 3;
      if (costLevel <= maxAcceptable) return 1.0;
      // 超预算每级 -10%，最低 0.7
      return Math.max(0.7, 1.0 - (costLevel - maxAcceptable) * 0.1);
    },

    // ─── 4. 烹饪技能匹配 ───
    skillMatch: (food: FoodLibrary): number => {
      if (!lifestyle.cookingSkillLevel) return 1.0;
      const userSkill = COOKING_SKILL_NUMERIC[lifestyle.cookingSkillLevel] ?? 2;
      const foodSkill = FOOD_SKILL_NUMERIC[food.skillRequired ?? 'easy'] ?? 1;

      if (foodSkill <= userSkill) {
        // 食物在技能范围内：略加分（用户能轻松做）
        return 1.0 + (userSkill - foodSkill) * 0.025; // max 1.05
      }
      // 食物超出技能：降分
      const gap = foodSkill - userSkill;
      return Math.max(0.8, 1.0 - gap * 0.15); // 超1级 0.85, 超2级 0.7→clamped 0.8
    },

    // ─── 5. 备餐意愿 ───
    mealPrepMatch: (food: FoodLibrary): number => {
      // 用户不愿备餐 + 食物需要长时间制作 → 降分
      if (lifestyle.mealPrepWilling) return 1.0;
      const totalTime =
        (food.prepTimeMinutes ?? 0) + (food.cookTimeMinutes ?? 0);
      if (totalTime > 60) return 0.85; // 超过1小时的复杂料理
      if (totalTime > 30) return 0.92; // 中等时长
      return 1.0;
    },

    // ─── 6. 份量乘数 ───
    portionMultiplier: lifestyle.familySize > 1 ? lifestyle.familySize : 1,
  };
}
