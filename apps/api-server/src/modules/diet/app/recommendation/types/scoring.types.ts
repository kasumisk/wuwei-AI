/**
 * V7.5 P3-B: 评分权重 / 维度 / 品质饱腹 / 微量营养素 / 召回类型
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - SCORE_DIMENSIONS / ScoreDimension / SCORE_WEIGHTS
 * - MEAL_WEIGHT_MODIFIERS / STATUS_WEIGHT_MODIFIERS / computeWeights
 * - CATEGORY_QUALITY / CATEGORY_SATIETY
 * - MACRO_RANGES / MEAL_RATIOS / MEAL_PREFERENCES / MEAL_ROLES / ROLE_CATEGORIES
 * - MicroNutrientDefaults / buildCategoryMicroAverages
 * - RecallMetadata / CFRecallResult
 */

import { FoodLibrary } from '../../../../food/food.types';
import { GoalType } from '../../services/nutrition-score.service';
import { RankPolicyConfig } from '../../../../strategy/strategy.types';

// ==================== 评分维度与权重 ====================

/** 维度名称 — 与 SCORE_WEIGHTS 数组索引对应 (V7.4: 13→14维，新增 acquisition) */
export const SCORE_DIMENSIONS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber', // V5 2.6: 膳食纤维评分维度
  'seasonality', // V6.4 Phase 3.4: 时令感知评分维度
  'executability', // V6.5: 可执行性评分维度
  'popularity', // V6.9 Phase 1-D: 大众化/常见度评分维度
  'acquisition', // V7.4 Phase 3-C: 食物可获得性评分维度
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** 基础权重 — 按目标类型 (V7.4: 13→14 维，新增 acquisition)
 *  Bug6-fix: 提高 fat/carbs/protein 权重，降低 season/popul/acqui 以补偿
 *  使宏量素合计权重从 ~25% 提升至 ~35-40%，让宏量比例偏离受到更强惩罚
 */
export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  prot, carbs, fat,  qual, sat,  glyc, nDens, inflam, fiber, season, exec, popul, acqui]
  fat_loss: [
    0.14, 0.16, 0.10, 0.10, 0.05, 0.06, 0.09, 0.08, 0.06, 0.04, 0.02, 0.05,
    0.03, 0.02,
  ],
  muscle_gain: [
    0.12, 0.18, 0.12, 0.08, 0.05, 0.04, 0.06, 0.06, 0.04, 0.03, 0.02, 0.07,
    0.07, 0.06,
  ],
  health: [
    0.06, 0.07, 0.06, 0.06, 0.12, 0.06, 0.08, 0.14, 0.09, 0.07, 0.04, 0.06,
    0.05, 0.04,
  ],
  habit: [
    0.08, 0.08, 0.07, 0.07, 0.1, 0.09, 0.06, 0.06, 0.05, 0.04, 0.03, 0.09, 0.09,
    0.09,
  ],
};

/**
 * 餐次权重修正系数
 * >1.0 表示该维度在此餐次更重要, <1.0 表示不太重要
 * 所有修正后会重新归一化
 */
export const MEAL_WEIGHT_MODIFIERS: Record<
  string,
  Partial<Record<ScoreDimension, number>>
> = {
  breakfast: {
    glycemic: 1.3, // 早餐血糖影响更大（空腹后第一餐）
    satiety: 1.2, // 早餐饱腹感重要（影响上午工作）
    calories: 0.9, // 早餐热量可以稍宽松
    fiber: 1.2, // V5 2.6: 早餐纤维有助于稳定上午血糖
  },
  lunch: {
    // 午餐基本保持基准权重
  },
  dinner: {
    calories: 1.2, // 晚餐更注重热量控制
    glycemic: 1.1, // 晚餐血糖稳定有助睡眠
    satiety: 0.8, // 晚餐饱腹感需求较低
    fiber: 1.1, // V5 2.6: 晚餐纤维有助消化健康
  },
  snack: {
    calories: 1.3, // 加餐热量严格控制
    quality: 1.2, // 加餐品质需要保证
    protein: 0.8, // 加餐蛋白质要求较低
    fiber: 0.8, // V5 2.6: 加餐纤维要求较低
  },
};

/**
 * 用户状态权重修正系数
 * 基于用户行为画像中的长期趋势触发
 */
export const STATUS_WEIGHT_MODIFIERS: Record<
  string,
  Partial<Record<ScoreDimension, number>>
> = {
  /** 体重平台期：严格热量+提高蛋白 */
  plateau: {
    calories: 1.3,
    protein: 1.2,
    quality: 0.9,
  },
  /** 长期蛋白不足 */
  low_protein: {
    protein: 1.4,
    satiety: 1.1,
  },
  /** 高加工倾向 */
  high_processed: {
    quality: 1.3,
    nutrientDensity: 1.2,
    inflammation: 1.2,
    fiber: 1.2, // V5 2.6: 高加工饮食通常缺纤维，提升纤维权重
  },
  /** 血糖波动大（如糖尿病前期/已确诊） */
  glycemic_risk: {
    glycemic: 1.5,
    calories: 1.1,
  },
};

/**
 * 计算三维叠加权重: BASE × MEAL_MODIFIER × STATUS_MODIFIER
 * 返回归一化后的权重数组 (和=1.0)
 *
 * V6 2.2: 新增 rankPolicy 参数，优先级: rankPolicy > baseOverrides > 系统默认
 * V6.2 3.2: 新增 runtimeBaseWeights 参数（运行时可配置权重）
 *
 * 合并规则:
 *   - baseWeights: rankPolicy.baseWeights[goalType] > baseOverrides > runtimeBaseWeights > SCORE_WEIGHTS[goalType]
 *   - mealModifiers: rankPolicy.mealModifiers[mealType] > mealWeightOverrides[mealType] > MEAL_WEIGHT_MODIFIERS[mealType]
 *   - statusModifiers: rankPolicy.statusModifiers[flag] > STATUS_WEIGHT_MODIFIERS[flag]
 *
 * @param goalType 目标类型
 * @param mealType 餐次（可选）
 * @param statusFlags 用户状态标记（可选）
 * @param baseOverrides A/B 实验组覆盖的基础权重（可选，Phase 3.8）
 * @param mealWeightOverrides A/B 实验组覆盖的餐次权重修正（可选，V5 4.8）
 * @param rankPolicy V6 2.2: 策略引擎的排序策略配置（优先级最高）
 * @param runtimeBaseWeights V6.2 3.2: 运行时配置的基础权重（优先级介于 baseOverrides 和硬编码之间）
 */
export function computeWeights(
  goalType: GoalType,
  mealType?: string,
  statusFlags?: string[],
  baseOverrides?: number[] | null,
  mealWeightOverrides?: Record<string, Record<string, number>> | null,
  rankPolicy?: RankPolicyConfig | null,
  runtimeBaseWeights?: number[] | null,
): number[] {
  // 基础权重优先级: rankPolicy.baseWeights > baseOverrides > runtimeBaseWeights > 系统硬编码
  const strategyBaseWeights = rankPolicy?.baseWeights?.[goalType];
  const base = strategyBaseWeights
    ? [...strategyBaseWeights]
    : baseOverrides
      ? [...baseOverrides]
      : runtimeBaseWeights
        ? [...runtimeBaseWeights]
        : [...(SCORE_WEIGHTS[goalType] || SCORE_WEIGHTS.health)];

  // 应用餐次修正 — V6 2.2: 优先级 rankPolicy.mealModifiers > mealWeightOverrides > 系统硬编码
  if (mealType) {
    const strategyMealMod = rankPolicy?.mealModifiers?.[mealType];
    const mealMod =
      strategyMealMod ??
      mealWeightOverrides?.[mealType] ??
      MEAL_WEIGHT_MODIFIERS[mealType];
    if (mealMod) {
      SCORE_DIMENSIONS.forEach((dim, i) => {
        if (mealMod[dim] !== undefined) {
          base[i] *= mealMod[dim]!;
        }
      });
    }
  }

  // 应用状态修正（多个状态可叠加）
  // V6 2.2: rankPolicy.statusModifiers 覆盖对应 flag 的系统默认修正
  if (statusFlags?.length) {
    for (const flag of statusFlags) {
      const strategyStatusMod = rankPolicy?.statusModifiers?.[flag];
      const statusMod = strategyStatusMod ?? STATUS_WEIGHT_MODIFIERS[flag];
      if (!statusMod) continue;
      SCORE_DIMENSIONS.forEach((dim, i) => {
        if (statusMod[dim] !== undefined) {
          base[i] *= statusMod[dim]!;
        }
      });
    }
  }

  // 重新归一化: 确保权重和 = 1.0
  const sum = base.reduce((s, w) => s + w, 0);
  if (sum > 0) {
    for (let i = 0; i < base.length; i++) {
      base[i] /= sum;
    }
  }

  return base;
}

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

/**
 * V4: 目标自适应宏量营养素评分范围 (修复 E2)
 * 不同目标类型使用不同的碳水/脂肪供能比理想范围
 */
export const MACRO_RANGES: Record<
  string,
  { carb: [number, number]; fat: [number, number] }
> = {
  fat_loss: { carb: [0.3, 0.45], fat: [0.2, 0.35] },
  muscle_gain: { carb: [0.4, 0.6], fat: [0.15, 0.3] },
  health: { carb: [0.45, 0.55], fat: [0.2, 0.3] },
  habit: { carb: [0.4, 0.55], fat: [0.2, 0.35] },
};

/**
 * V4: 目标自适应餐次比例 (修复 E3)
 * 不同目标类型使用不同的热量分配比例
 */
export const MEAL_RATIOS: Record<string, Record<string, number>> = {
  fat_loss: { breakfast: 0.3, lunch: 0.35, dinner: 0.25, snack: 0.1 },
  muscle_gain: { breakfast: 0.25, lunch: 0.3, dinner: 0.25, snack: 0.2 },
  health: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
  habit: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
};

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

// ==================== V5 2.7: 微量营养素品类均值插补 ====================

/**
 * 微量营养素默认值 — 用于插补缺失数据
 * 字段对应 NRF 11.4 评分所需的 11 个鼓励项和 4 个限制项中的微量元素
 */
export interface MicroNutrientDefaults {
  vitaminA: number; // ug RAE / 100g
  vitaminC: number; // mg / 100g
  vitaminD: number; // ug / 100g
  vitaminE: number; // mg / 100g
  calcium: number; // mg / 100g
  iron: number; // mg / 100g
  potassium: number; // mg / 100g
  fiber: number; // g / 100g
  zinc: number; // V7.3 NRF11.4: mg / 100g
  magnesium: number; // V7.3 NRF11.4: mg / 100g
}

/** 需要插补的微量营养素字段名列表 */
const MICRO_FIELDS: (keyof MicroNutrientDefaults)[] = [
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'calcium',
  'iron',
  'potassium',
  'fiber',
  'zinc',
  'magnesium',
];

/**
 * V5 2.7: 从食物列表构建品类微量营养素均值表
 *
 * 对每个 category，计算各微量营养素字段的均值（仅统计有数据的食物）。
 * 如果某个品类某字段完全没有数据，则使用全局均值。
 *
 * @param foods 食物库全量列表
 * @returns 品类 → 微量营养素均值映射
 */
export function buildCategoryMicroAverages(
  foods: FoodLibrary[],
): Map<string, MicroNutrientDefaults> {
  // 按品类分组
  const groups = new Map<string, FoodLibrary[]>();
  for (const food of foods) {
    const cat = food.category || 'unknown';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(food);
  }

  // 计算全局均值（作为兜底）
  const globalDefaults = calcGroupAverage(foods);

  // 计算每个品类的均值
  const result = new Map<string, MicroNutrientDefaults>();
  for (const [category, groupFoods] of groups) {
    const avg = calcGroupAverage(groupFoods);
    // 对没有数据的字段，回退到全局均值
    for (const field of MICRO_FIELDS) {
      if (avg[field] === 0) {
        avg[field] = globalDefaults[field];
      }
    }
    result.set(category, avg);
  }

  // 设置一个 'unknown' 兜底条目
  if (!result.has('unknown')) {
    result.set('unknown', globalDefaults);
  }

  return result;
}

/** 计算一组食物的微量营养素均值 */
function calcGroupAverage(foods: FoodLibrary[]): MicroNutrientDefaults {
  const sums: Record<keyof MicroNutrientDefaults, number> = {
    vitaminA: 0,
    vitaminC: 0,
    vitaminD: 0,
    vitaminE: 0,
    calcium: 0,
    iron: 0,
    potassium: 0,
    fiber: 0,
    zinc: 0,
    magnesium: 0,
  };
  const counts: Record<keyof MicroNutrientDefaults, number> = {
    vitaminA: 0,
    vitaminC: 0,
    vitaminD: 0,
    vitaminE: 0,
    calcium: 0,
    iron: 0,
    potassium: 0,
    fiber: 0,
    zinc: 0,
    magnesium: 0,
  };

  for (const food of foods) {
    for (const field of MICRO_FIELDS) {
      const val = Number(food[field]) || 0;
      if (val > 0) {
        sums[field] += val;
        counts[field]++;
      }
    }
  }

  const result = {} as MicroNutrientDefaults;
  for (const field of MICRO_FIELDS) {
    result[field] = counts[field] > 0 ? sums[field] / counts[field] : 0;
  }
  return result;
}

// ==================== V6.7 Phase 2-B: RecallMetadata ====================

/**
 * V6.7 Phase 2-B: 三路召回元数据
 *
 * 记录每个召回候选的来源信息，用于：
 * - RecallMerger 合并去重时确定 ruleWeight
 * - rankCandidates 阶段读取 semanticScore / cfScore 做精细化加分
 * - 调试追踪（recommendation-trace）
 */
export interface RecallMetadata {
  foodId: string;
  /** 候选来源集合：rule / semantic / cf */
  sources: Set<'rule' | 'semantic' | 'cf'>;
  /** 语义召回相似度 (0-1)，未命中则为 0 */
  semanticScore: number;
  /** CF 推荐分 (0-1)，未命中则为 0 */
  cfScore: number;
  /** 最终权重乘数（规则路 = 1.0，非规则路折扣） */
  ruleWeight: number;
}

/**
 * V6.7 Phase 2-B: CF 召回结果
 */
export interface CFRecallResult {
  foodId: string;
  cfScore: number;
}
