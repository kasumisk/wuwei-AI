// ═══════════════════════════════════════════════════════════════════
// V7.3 Phase 1-E: 场景化评分配置 — 类型定义 + 预设
// ═══════════════════════════════════════════════════════════════════

import { SceneType } from './recommendation.types';

/**
 * 场景评分配置
 *
 * 定义每种场景下各评分维度的权重调整和ScoringFactor强度覆盖。
 * 当用户处于特定场景（外卖/做饭/食堂/运动后等）时，
 * 系统会自动应用对应的评分策略，而不是使用统一权重。
 */
export interface SceneScoringProfile {
  /** 适用的场景类型 */
  sceneType: SceneType;
  /**
   * 评分维度权重乘数
   * key = SCORE_DIMENSIONS 中的维度名（如 'calories', 'protein', 'quality'）
   * value = 乘数（>1 增强该维度, <1 降低该维度, 1 = 不变）
   */
  dimensionWeightAdjustments: Partial<Record<string, number>>;
  /**
   * ScoringFactor 强度覆盖
   * key = Factor name（如 'preference-signal', 'scene-context'）
   * value = 强度乘数（>1 增强, <1 减弱）
   */
  factorStrengthOverrides?: Partial<Record<string, number>>;
  /** 描述 (i18n key, 用于调试/日志) */
  descriptionKey: string;
}

// ─── 预设场景评分配置 ───

/**
 * 场景评分策略预设
 *
 * 设计原则：
 * 1. 每种场景的调整基于该场景的核心用户需求
 * 2. 乘数范围控制在 [0.3, 1.5]，避免过度偏离基线
 * 3. 未列出的维度/因子保持默认（乘数=1.0）
 */
export const SCENE_SCORING_PROFILES: SceneScoringProfile[] = [
  {
    sceneType: 'eating_out',
    dimensionWeightAdjustments: {
      executability: 0.5, // 外卖不需要自己做，降低可执行性权重
      popularity: 1.5, // 外卖偏好热门菜品
      calories: 1.2, // 外卖通常热量偏高，需要更严格的热量控制
      quality: 0.8, // 外卖营养质量期望适度降低
    },
    factorStrengthOverrides: {
      'scene-context': 1.3,
    },
    descriptionKey: 'scene.eating_out.desc',
  },
  {
    sceneType: 'home_cooking',
    dimensionWeightAdjustments: {
      quality: 1.3, // 在家做饭注重营养质量
      executability: 1.2, // 关注技能/设备是否匹配
      popularity: 0.8, // 在家可以尝试新菜，降低大众化权重
    },
    descriptionKey: 'scene.home_cooking.desc',
  },
  {
    sceneType: 'canteen_meal',
    dimensionWeightAdjustments: {
      executability: 0.3, // 食堂不需要自己做
      popularity: 1.4, // 食堂偏好大众菜品
      satiety: 1.2, // 食堂餐偏好管饱
    },
    descriptionKey: 'scene.canteen_meal.desc',
  },
  {
    sceneType: 'quick_breakfast',
    dimensionWeightAdjustments: {
      executability: 1.5, // 早餐要快速简单
      calories: 0.8, // 早餐热量要求相对宽松
      satiety: 1.3, // 要管饱到中午
    },
    descriptionKey: 'scene.quick_breakfast.desc',
  },
  {
    sceneType: 'convenience_meal',
    dimensionWeightAdjustments: {
      executability: 0.3, // 便利店不需要做
      popularity: 1.3, // 偏好常见品
    },
    descriptionKey: 'scene.convenience_meal.desc',
  },
  {
    sceneType: 'post_workout',
    dimensionWeightAdjustments: {
      protein: 1.5, // 运动后蛋白质需求高
      glycemic: 1.3, // 需要快速补充碳水（高GI可接受）
      calories: 1.1, // 运动后热量适度放宽
    },
    descriptionKey: 'scene.post_workout.desc',
  },
  {
    sceneType: 'family_dinner',
    dimensionWeightAdjustments: {
      quality: 1.3, // 家庭聚餐注重营养均衡
      popularity: 1.2, // 偏好大众化口味（照顾家人）
      executability: 1.0, // 正常难度
    },
    descriptionKey: 'scene.family_dinner.desc',
  },
  {
    sceneType: 'office_lunch',
    dimensionWeightAdjustments: {
      executability: 0.5, // 办公室午餐通常外食
      satiety: 1.2, // 下午还要工作，要管饱
      popularity: 1.3, // 偏好常见快餐
    },
    descriptionKey: 'scene.office_lunch.desc',
  },
  {
    sceneType: 'meal_prep',
    dimensionWeightAdjustments: {
      quality: 1.4, // 备餐注重营养
      executability: 1.3, // 需要可批量制作
      calories: 1.2, // 需要精确控制热量
    },
    descriptionKey: 'scene.meal_prep.desc',
  },
  {
    sceneType: 'late_night_snack',
    dimensionWeightAdjustments: {
      calories: 1.5, // 夜宵严格控制热量
      satiety: 0.8, // 不需要管饱
      quality: 1.2, // 偏好清淡健康
    },
    descriptionKey: 'scene.late_night_snack.desc',
  },
];

/**
 * 根据场景类型查找评分配置
 * @returns 对应的 SceneScoringProfile, 未找到时返回 undefined (使用默认权重)
 */
export function findSceneScoringProfile(
  sceneType: SceneType,
): SceneScoringProfile | undefined {
  return SCENE_SCORING_PROFILES.find((p) => p.sceneType === sceneType);
}
