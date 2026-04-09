import { Injectable } from '@nestjs/common';
import {
  Constraint,
  MealTarget,
  UserProfileConstraints,
  MEAL_PREFERENCES,
} from './recommendation.types';

@Injectable()
export class ConstraintGeneratorService {
  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: UserProfileConstraints,
  ): Constraint {
    const includeTags: string[] = [];
    const excludeTags: string[] = [];

    // 目标驱动
    if (goalType === 'fat_loss') {
      includeTags.push('high_protein');
    } else if (goalType === 'muscle_gain') {
      includeTags.push('high_protein');
    }

    // 状态驱动
    const proteinGap = dailyTarget.protein - consumed.protein;
    const calorieGap = dailyTarget.calories - consumed.calories;

    if (proteinGap > 30) includeTags.push('high_protein');
    if (calorieGap < 300) includeTags.push('low_calorie');
    if (calorieGap < 0) {
      includeTags.push('ultra_low_calorie');
      excludeTags.push('high_fat');
    }

    // 餐次偏好策略
    if (mealType) {
      const mealPref = MEAL_PREFERENCES[mealType];
      if (mealPref) {
        includeTags.push(...mealPref.includeTags);
        excludeTags.push(...mealPref.excludeTags);
      }
    }

    // 用户档案约束融合
    if (userProfile) {
      // 过敏原 → 硬约束排除
      if (userProfile.allergens?.length) {
        for (const allergen of userProfile.allergens) {
          excludeTags.push(`allergen_${allergen}`);
        }
      }

      // 健康状况 → 动态约束注入
      if (userProfile.healthConditions?.length) {
        for (const condition of userProfile.healthConditions) {
          if (condition === 'diabetes_type2') {
            excludeTags.push('high_sugar', 'high_gi');
            includeTags.push('low_gi');
          } else if (condition === 'hypertension') {
            excludeTags.push('high_sodium');
            includeTags.push('low_sodium');
          } else if (condition === 'high_cholesterol') {
            excludeTags.push('high_cholesterol');
          } else if (condition === 'gout') {
            excludeTags.push('high_purine');
          } else if (condition === 'kidney_disease') {
            excludeTags.push('high_potassium', 'high_phosphorus');
          } else if (condition === 'fatty_liver') {
            excludeTags.push('high_fat', 'high_sugar');
          }
        }
      }

      // 饮食限制 → 排除标签
      if (userProfile.dietaryRestrictions?.length) {
        for (const restriction of userProfile.dietaryRestrictions) {
          if (restriction === 'vegetarian') excludeTags.push('meat');
          else if (restriction === 'no_spicy') excludeTags.push('heavy_flavor');
          else if (restriction === 'no_fried') excludeTags.push('fried');
          else if (restriction === 'low_sodium')
            excludeTags.push('high_sodium');
          else excludeTags.push(restriction);
        }
      }

      // 薄弱时段 → 更严格约束
      const hour = new Date().getHours();
      const isWeakSlot = userProfile.weakTimeSlots?.some((slot) => {
        if (slot === 'afternoon' && hour >= 14 && hour < 17) return true;
        if (slot === 'evening' && hour >= 18 && hour < 21) return true;
        if (slot === 'midnight' && (hour >= 21 || hour < 5)) return true;
        return false;
      });
      if (isWeakSlot) {
        excludeTags.push('high_fat', 'high_carb', 'dessert');
        includeTags.push('low_calorie');
      }

      // 自律程度 → 约束松紧度
      if (userProfile.discipline === 'low') {
        // 低自律：更宽松
      } else if (userProfile.discipline === 'high') {
        if (goalType === 'fat_loss') excludeTags.push('processed');
      }
    }

    return {
      includeTags: [...new Set(includeTags)],
      excludeTags: [...new Set(excludeTags)],
      maxCalories: target.calories * 1.15,
      minProtein: target.protein * 0.5,
    };
  }
}
