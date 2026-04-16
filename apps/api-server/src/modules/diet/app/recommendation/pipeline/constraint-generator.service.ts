import { Injectable } from '@nestjs/common';
import {
  Constraint,
  MealTarget,
  UserProfileConstraints,
  MEAL_PREFERENCES,
  HealthCondition,
  normalizeHealthCondition,
} from '../types/recommendation.types';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../../../common/utils/timezone.util';
import { ScoringConfigService } from '../context/scoring-config.service';

@Injectable()
export class ConstraintGeneratorService {
  constructor(private readonly scoringConfigService: ScoringConfigService) {}

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: UserProfileConstraints,
    /** V5: IANA 时区字符串（如 'Asia/Shanghai'），替代 V4 的 timezoneOffset 数字 */
    timezone?: string,
    /** V6.3 P1-3: 暴食风险时段（小时桶列表），来自行为画像 */
    bingeRiskHours?: number[] | null,
  ): Constraint {
    const includeTags: string[] = [];
    const excludeTags: string[] = [];
    let excludeIsFried = false;
    let maxSodium: number | undefined;
    let maxPurine: number | undefined;
    let maxFat: number | undefined;

    // 目标驱动
    if (goalType === 'fat_loss') {
      includeTags.push('high_protein');
    } else if (goalType === 'muscle_gain') {
      includeTags.push('high_protein');
    }

    // 状态驱动
    const proteinGap = dailyTarget.protein - consumed.protein;
    const calorieGap = dailyTarget.calories - consumed.calories;
    const tuning = this.scoringConfigService.getTuning();

    if (proteinGap > tuning.proteinGapThreshold)
      includeTags.push('high_protein');
    if (calorieGap < tuning.calorieGapThreshold)
      includeTags.push('low_calorie');
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

      // 健康状况 → 动态约束注入 (V4: 使用标准枚举，兼容旧命名)
      if (userProfile.healthConditions?.length) {
        for (const rawCondition of userProfile.healthConditions) {
          // 支持对象格式 {condition: "hypertension", severity: "moderate"} 和纯字符串
          const rawStr =
            typeof rawCondition === 'string'
              ? rawCondition
              : (rawCondition as { condition?: string }).condition ?? '';
          const condition =
            normalizeHealthCondition(rawStr) ?? rawStr;
          if (condition === HealthCondition.DIABETES_TYPE2) {
            excludeTags.push('high_sugar', 'high_gi');
            includeTags.push('low_gi');
          } else if (condition === HealthCondition.HYPERTENSION) {
            excludeTags.push('high_sodium');
            includeTags.push('low_sodium');
            // #fix Bug18+Bug27: 高血压硬过滤钠含量 >=380mg/100g（从400降至380，排除边界值如蒜苗炒肉Na=400）
            maxSodium = maxSodium == null ? 380 : Math.min(maxSodium, 380);
          } else if (condition === HealthCondition.HYPERLIPIDEMIA) {
            excludeTags.push('high_cholesterol');
          } else if (condition === HealthCondition.GOUT) {
            excludeTags.push('high_purine');
            // #fix Bug19: 痛风硬过滤嘌呤 >150mg/100g（高嘌呤），中嘌呤50-150保留但由health-modifier打分惩罚
            maxPurine = maxPurine == null ? 150 : Math.min(maxPurine, 150);
          } else if (condition === HealthCondition.KIDNEY_DISEASE) {
            excludeTags.push('high_potassium', 'high_phosphorus');
          } else if (condition === HealthCondition.FATTY_LIVER) {
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
          else if (restriction === 'low_sodium') {
            excludeTags.push('high_sodium');
            // #fix Bug18+Bug27: low_sodium 饮食限制硬过滤钠含量 >=380mg/100g
            maxSodium = maxSodium == null ? 380 : Math.min(maxSodium, 380);
          }
          // #fix Bug31: low_fat 饮食限制 — 排除高脂食物（非低脂食物），
          // 并添加 maxFat 硬过滤（每 100g 脂肪 ≤ 15g）
          else if (restriction === 'low_fat') {
            excludeTags.push('high_fat');
            maxFat = maxFat == null ? 15 : Math.min(maxFat, 15);
          }
          else excludeTags.push(restriction);
        }
      }

      // 薄弱时段 → 更严格约束
      // V5: 使用 IANA 时区替代 V4 的 timezoneOffset 数字
      const hour = getUserLocalHour(timezone || DEFAULT_TIMEZONE);
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

      // #fix Bug11: fat_loss 目标排除油炸食物（通过 isFried 字段而非 tags）
      if (goalType === 'fat_loss') {
        excludeIsFried = true;
      }
    }

    // V6.3 P1-3: 暴食风险时段紧缩 — 当前小时处于用户的暴食高风险时段时，
    // 收紧卡路里上限，并排除高卡/甜品/油炸类食物
    let maxCalories = target.calories * tuning.calorieCeilingMultiplier;
    const currentHour = getUserLocalHour(timezone || DEFAULT_TIMEZONE);
    if (bingeRiskHours?.length && bingeRiskHours.includes(currentHour)) {
      maxCalories = target.calories * tuning.bingeRiskCalorieMultiplier;
      excludeTags.push('high_calorie', 'dessert', 'fried');
      includeTags.push('low_calorie', 'high_protein');
    }

    return {
      includeTags: [...new Set(includeTags)],
      excludeTags: [...new Set(excludeTags)],
      maxCalories,
      minProtein: target.protein * tuning.minProteinRatio,
      // #fix Bug7: 传递饮食限制给 FoodFilter 做多字段硬过滤
      dietaryRestrictions: userProfile?.dietaryRestrictions ?? [],
      // #fix Bug11: fat_loss 排除油炸食物
      excludeIsFried,
      // #fix Bug18: 钠含量硬过滤上限
      maxSodium,
      // #fix Bug19: 嘌呤硬过滤上限
      maxPurine,
      // #fix Bug31: 脂肪硬过滤上限
      maxFat,
    };
  }
}
