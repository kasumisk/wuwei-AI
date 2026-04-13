import { Injectable } from '@nestjs/common';

/**
 * V6.6 Phase 2-C → V6.7 Phase 2-F/3-E: LifestyleScoringAdapter
 *
 * 将 user_profiles 中的生活方式字段转换为营养素优先级调整向量，
 * 叠加到 NutritionTargetService 输出的 nutritionGaps。
 *
 * 支持的输入字段（来自 DeclaredProfile）：
 * - sleepQuality: 'poor'|'fair'|'good'
 * - stressLevel: 'low'|'medium'|'high'
 * - supplementsUsed: string[]（补剂名称列表）
 * - hydrationGoal: number（ml/天）
 * - mealTimingPreference: 'early_bird'|'standard'|'late_eater'
 *
 * V6.7 Phase 3-E: 新增 fair sleep / medium stress 中间档调整
 * - fair sleep → tryptophan +0.05, magnesium +0.04, B6 +0.04（poor 的 ~1/3 强度）
 * - medium stress → vitaminC +0.06, B12 +0.04, magnesium +0.04（high 的 ~1/2 强度）
 *
 * 输出：nutrient → 优先级调整量（正数=提升，负数=降低）
 * 由 ProfileResolverService 写入 EnrichedProfileContext.lifestyleAdjustment，
 * 推荐引擎在 nutritionGaps 叠加时消费。
 */

/** 营养素优先级调整 Map（nutrient key → delta 值，正/负） */
export type LifestyleNutrientAdjustment = Record<string, number>;

/** 补剂 → 对应营养素映射（服用补剂时下调该营养素的推荐优先级，避免重叠推高） */
const SUPPLEMENT_NUTRIENT_MAP: Record<string, string> = {
  vitaminC: 'vitaminC',
  vitaminD: 'vitaminD',
  vitaminB12: 'vitaminB12',
  vitaminB6: 'vitaminB6',
  magnesium: 'magnesium',
  calcium: 'calcium',
  iron: 'iron',
  omega3: 'omega3',
  zinc: 'zinc',
  folate: 'folate',
  // 常见中文补剂名称别名
  维生素C: 'vitaminC',
  维生素D: 'vitaminD',
  维生素B12: 'vitaminB12',
  维生素B6: 'vitaminB6',
  镁: 'magnesium',
  钙: 'calcium',
  铁: 'iron',
  鱼油: 'omega3',
  锌: 'zinc',
  叶酸: 'folate',
};

@Injectable()
export class LifestyleScoringAdapter {
  /**
   * 将生活方式字段转换为营养素优先级调整向量
   *
   * V6.7 Phase 2-F: 新增 mealType 参数，激活 mealTimingPreference 评分逻辑。
   * - early_bird + breakfast → 碳水/蛋白提升（早餐是主能量来源）
   * - early_bird + dinner → 纤维/饱腹感提升、碳水降低（轻晚餐）
   * - late_eater + breakfast → 轻碳水、纤维提升（轻早餐）
   * - late_eater + dinner → 蛋白/碳水提升（晚餐是主能量来源）
   *
   * @param profile 声明画像中的相关字段（可能部分缺失）
   * @param mealType V6.7: 当前餐次类型（breakfast/lunch/dinner/snack）
   * @returns LifestyleNutrientAdjustment — 营养素 → 调整量 Map
   */
  adapt(
    profile: {
      sleepQuality?: string | null;
      stressLevel?: string | null;
      supplementsUsed?: string[] | null;
      hydrationGoal?: number | null;
      mealTimingPreference?: string | null;
      exerciseIntensity?: string | null; // V7.8: 运动强度（来自 exercise_profile.intensity）
      alcoholFrequency?: string | null; // V6.8 Phase 3-B: 饮酒频率
      age?: number | null; // V6.8 Phase 3-B: 年龄
    },
    mealType?: string,
  ): LifestyleNutrientAdjustment {
    const adjustments: LifestyleNutrientAdjustment = {};

    // 睡眠质量 → 色氨酸/镁/B6 优先级调整
    // V6.7 Phase 3-E: poor + fair 两档，fair 为 poor 的 ~1/3 强度
    if (profile.sleepQuality === 'poor') {
      adjustments['tryptophan'] = (adjustments['tryptophan'] ?? 0) + 0.15;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.1;
      adjustments['vitaminB6'] = (adjustments['vitaminB6'] ?? 0) + 0.1;
    } else if (profile.sleepQuality === 'fair') {
      adjustments['tryptophan'] = (adjustments['tryptophan'] ?? 0) + 0.05;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.04;
      adjustments['vitaminB6'] = (adjustments['vitaminB6'] ?? 0) + 0.04;
    }

    // 压力水平 → 抗氧化维生素/B族优先级调整
    // V6.7 Phase 3-E: high + medium 两档，medium 为 high 的 ~1/2 强度
    if (profile.stressLevel === 'high') {
      adjustments['vitaminC'] = (adjustments['vitaminC'] ?? 0) + 0.12;
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.08;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.08;
    } else if (profile.stressLevel === 'medium') {
      adjustments['vitaminC'] = (adjustments['vitaminC'] ?? 0) + 0.06;
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.04;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.04;
    }

    // V6.8 Phase 1-B + Phase 3-B: 运动恢复 → 蛋白质/钾/镁优先级调整
    if (profile.exerciseIntensity === 'high') {
      adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.12;
      adjustments['potassium'] = (adjustments['potassium'] ?? 0) + 0.08;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.06;
    } else if (
      profile.exerciseIntensity === 'medium' ||
      profile.exerciseIntensity === 'moderate'
    ) {
      adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.06;
      adjustments['potassium'] = (adjustments['potassium'] ?? 0) + 0.04;
    }

    // V6.8 Phase 3-B: 酒精影响 → B12/叶酸/镁优先级调整
    if (profile.alcoholFrequency === 'frequent') {
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.1;
      adjustments['folate'] = (adjustments['folate'] ?? 0) + 0.08;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.06;
    } else if (profile.alcoholFrequency === 'occasional') {
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.04;
      adjustments['folate'] = (adjustments['folate'] ?? 0) + 0.04;
    }

    // V6.8 Phase 3-B: 年龄相关调整 → 50+岁钙/维D/B12优先级提升
    if (profile.age != null && profile.age >= 50) {
      adjustments['calcium'] = (adjustments['calcium'] ?? 0) + 0.1;
      adjustments['vitaminD'] = (adjustments['vitaminD'] ?? 0) + 0.1;
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.08;
    }

    // 补剂已服用 → 避免重叠推高（下调对应营养素优先级，防止过量）
    for (const supplement of profile.supplementsUsed ?? []) {
      const nutrient =
        SUPPLEMENT_NUTRIENT_MAP[supplement.toLowerCase()] ??
        SUPPLEMENT_NUTRIENT_MAP[supplement];
      if (nutrient) {
        adjustments[nutrient] = (adjustments[nutrient] ?? 0) - 0.1;
      }
    }

    // 高饮水目标 → 高含水量食物（含水率 > 80%）加分
    if (profile.hydrationGoal && profile.hydrationGoal > 2000) {
      adjustments['waterContent'] = (adjustments['waterContent'] ?? 0) + 0.08;
    }

    // V6.7 Phase 2-F: mealTimingPreference 实现
    // 根据用户的进餐时间偏好 + 当前餐次，调整碳水/蛋白/纤维优先级
    if (profile.mealTimingPreference && mealType) {
      const timing = profile.mealTimingPreference;

      if (timing === 'early_bird') {
        // 早起型：早餐是主能量来源，晚餐轻量化
        if (mealType === 'breakfast') {
          adjustments['carbs'] = (adjustments['carbs'] ?? 0) + 0.1;
          adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.08;
        } else if (mealType === 'dinner') {
          adjustments['fiber'] = (adjustments['fiber'] ?? 0) + 0.1;
          adjustments['carbs'] = (adjustments['carbs'] ?? 0) - 0.08;
        }
      } else if (timing === 'late_eater') {
        // 晚食型：早餐轻量化，晚餐是主能量来源
        if (mealType === 'breakfast') {
          adjustments['fiber'] = (adjustments['fiber'] ?? 0) + 0.08;
          adjustments['carbs'] = (adjustments['carbs'] ?? 0) - 0.06;
        } else if (mealType === 'dinner') {
          adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.1;
          adjustments['carbs'] = (adjustments['carbs'] ?? 0) + 0.08;
        }
      }
      // 'standard' → 无额外调整
    }

    // V6.8 Phase 1-B: 调整总量封顶 — 每个营养素最大 ±0.25
    for (const key of Object.keys(adjustments)) {
      adjustments[key] = Math.max(-0.25, Math.min(0.25, adjustments[key]));
    }

    return adjustments;
  }
}
