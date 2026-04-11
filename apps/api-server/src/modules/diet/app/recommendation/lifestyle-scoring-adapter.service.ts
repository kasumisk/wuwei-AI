import { Injectable } from '@nestjs/common';

/**
 * V6.6 Phase 2-C: LifestyleScoringAdapter
 *
 * 将 user_profiles 中的生活方式字段转换为营养素优先级调整向量，
 * 叠加到 NutritionTargetService 输出的 nutritionGaps。
 *
 * 支持的输入字段（来自 DeclaredProfile）：
 * - sleepQuality: 'poor'|'fair'|'good'
 * - stressLevel: 'low'|'medium'|'high'
 * - supplementsUsed: string[]（补剂名称列表）
 * - hydrationGoal: number（ml/天）
 * - mealTimingPreference: 'early_bird'|'standard'|'late_eater'（预留，暂无评分影响）
 *
 * 输出：nutrient → 优先级调整量（正数=提升，负数=降低）
 * 由 ProfileResolverService 写入 EnrichedProfileContext.lifestyleAdjustment，
 * 推荐引擎在 nutritionGaps 叠加时消费。
 */

/** 营养素优先级调整 Map（nutrient key → delta 值，正/负） */
export type LifestyleNutrientAdjustment = Record<string, number>;

/** 补剂 → 对应营养素映射（服用补剂时下调该营养素的推荐优先级，避免重叠推高） */
const SUPPLEMENT_NUTRIENT_MAP: Record<string, string> = {
  vitamin_c: 'vitaminC',
  vitamin_d: 'vitaminD',
  vitamin_b12: 'vitaminB12',
  vitamin_b6: 'vitaminB6',
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
   * @param profile 声明画像中的相关字段（可能部分缺失）
   * @returns LifestyleNutrientAdjustment — 营养素 → 调整量 Map
   */
  adapt(profile: {
    sleepQuality?: string | null;
    stressLevel?: string | null;
    supplementsUsed?: string[] | null;
    hydrationGoal?: number | null;
    mealTimingPreference?: string | null;
  }): LifestyleNutrientAdjustment {
    const adjustments: LifestyleNutrientAdjustment = {};

    // 睡眠质量差 → 提高色氨酸/镁/B6 优先级（这些营养素有助改善睡眠）
    if (profile.sleepQuality === 'poor') {
      adjustments['tryptophan'] = (adjustments['tryptophan'] ?? 0) + 0.15;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.1;
      adjustments['vitaminB6'] = (adjustments['vitaminB6'] ?? 0) + 0.1;
    }

    // 高压状态 → 提高抗氧化维生素/B族维生素优先级
    if (profile.stressLevel === 'high') {
      adjustments['vitaminC'] = (adjustments['vitaminC'] ?? 0) + 0.12;
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.08;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.08;
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

    // mealTimingPreference: 预留，暂无直接营养素调整逻辑
    // early_bird / late_eater 可未来扩展为餐次时段评分修正

    return adjustments;
  }
}
