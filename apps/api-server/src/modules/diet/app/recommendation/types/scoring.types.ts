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
  // #fix Bug34: fat_loss 脂肪权重从 0.10→0.14，使高脂食物受到更强惩罚
  // 从 season(0.02→0.01), popul(0.03→0.02), acqui(0.02→0.01) 中回收 0.04
  fat_loss: [
    0.14, 0.16, 0.1, 0.14, 0.05, 0.06, 0.09, 0.08, 0.06, 0.04, 0.01, 0.05, 0.02,
    0.0,
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
 *
 * ⚠️ P0-3 警告：此常量为 **fallback**。当 ScoringContext.dailyTarget 可用时，
 *     应改用 deriveMacroRangesFromTarget() 动态派生，避免与用户真实目标冲突。
 *     典型 Bug: fat_loss fat 上限 0.35 奖励高脂食物 → 与 nutrition-score 的 22% 目标冲突 → fat +73%
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
 * P0-3: 由 dailyTarget 派生供能比奖励区间
 *
 * 原理：以用户真实目标供能比为中心，±5pp 形成 Green-Zone，
 *       替代硬编码的 MACRO_RANGES（后者可能与用户目标方向相反）。
 *
 * 示例（fat_loss, 1500kcal, protein=144g, fat=37g, carbs=148g）：
 *   - fatRatio  = 37*9/1500  = 22.2%  →  fat  区间 [17.2%, 27.2%]
 *   - carbRatio = 148*4/1500 = 39.5%  →  carb 区间 [34.5%, 44.5%]
 *   相比旧 MACRO_RANGES.fat_loss.fat=[20%,35%] — 不再奖励 35% 高脂食物
 */
export function deriveMacroRangesFromTarget(target: {
  calories: number;
  fat: number;
  carbs: number;
}): { carb: [number, number]; fat: [number, number] } | null {
  if (!target || target.calories <= 0) return null;
  const fatRatio = (target.fat * 9) / target.calories;
  const carbRatio = (target.carbs * 4) / target.calories;
  const band = 0.05; // ±5pp Green-Zone
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  return {
    fat: [clamp(fatRatio - band), clamp(fatRatio + band)],
    carb: [clamp(carbRatio - band), clamp(carbRatio + band)],
  };
}

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

/**
 * P1-2: 统一蛋白质系数（g/kg 体重）
 *
 * 作为 nutrition-score.service 与 nutrition-target.service 的单一数据源。
 * 数值采纳 nutrition-score 的较高标准（fat_loss=2.0 足以保肌肉、muscle_gain=2.2 符合运动营养学共识）。
 *
 * 历史（已废弃）：
 *   - nutrition-target.service 旧值: fat_loss=1.2, muscle_gain=1.6, health/habit=0.8（过低，导致 protein −37% 偏差）
 */
export const PROTEIN_PER_KG_BY_GOAL: Record<string, number> = {
  // P-ε（阶段 2 矩阵 D1_lowBMI 修复）：低体重用户在典型 kcal 下 %-目标不可达。
  // 调参规则：baseline 用户 proPP 保持 ≤ +8pp，同时为 45kg 低体重留出尽可能大的 headroom。
  // fat_loss: 2.0→2.1（baseline 70kg/1400kcal：147g=42%，+7pp 合规）
  // muscle_gain: 2.2→2.4（baseline 75kg/2800kcal：180g=25.7%，-4.3pp）
  // health: 1.3→1.6（baseline 85kg/2200kcal：136g=24.7%，-0.3pp）
  // habit: 1.8→2.0（baseline 68kg/2100kcal：136g=25.9%，+0.9pp 合规；D1_lowBMI 45kg：90g=17.1%，-7.9pp 在 ±8pp 内）
  fat_loss: 2.1,
  muscle_gain: 2.4,
  health: 1.6,
  habit: 2.0,
};

/**
 * P1-2: 查询指定目标对应的 g/kg 系数，未知目标回退到 health
 */
export function getProteinPerKg(goal: string | undefined | null): number {
  if (!goal) return PROTEIN_PER_KG_BY_GOAL.health;
  return PROTEIN_PER_KG_BY_GOAL[goal] ?? PROTEIN_PER_KG_BY_GOAL.health;
}

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

/**
 * #fix Bug13: muscle_gain 目标的餐次角色模板 — 午餐/晚餐增加第二个蛋白质槽位
 * 使得增肌用户每餐获得 2 份蛋白质食物，解决蛋白质摄入严重不足的问题
 */
export const MUSCLE_GAIN_MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'protein2'],
  lunch: ['carb', 'protein', 'protein2', 'veggie'],
  dinner: ['protein', 'protein2', 'veggie', 'side'],
  snack: ['snack_protein', 'snack2'],
};

export const ROLE_CATEGORIES: Record<string, string[]> = {
  carb: ['grain', 'composite'],
  protein: ['protein', 'dairy'],
  protein2: ['protein', 'dairy'], // #fix Bug13: 第二蛋白质槽位，使用相同品类
  protein3: ['protein', 'dairy'], // P0-A: 第三蛋白质槽位（减脂/高蛋白需求动态扩容）
  veggie: ['veggie'],
  side: ['veggie', 'dairy', 'beverage', 'fruit'],
  snack1: ['fruit', 'snack', 'dairy'],
  snack_protein: ['protein', 'dairy', 'snack'], // muscle_gain snack: protein-first
  snack2: ['beverage', 'snack', 'fruit'],
};

/**
 * P0-A 根因#3 修复：按当餐蛋白目标动态构建 role 数组
 *
 * 问题背景：原 `MEAL_ROLES` 硬编码每餐 1 个 protein slot，日总 3 slot，
 * 物理天花板 ≈105g（命中线上 107g 偏差）。即使优化器权重拉满也突破不了。
 *
 * 策略：按 `targetProtein / 25g per slot` 估算所需 slot 数，clamp [1, 3]。
 * - 减脂 152g/日 ÷ 4 餐 ≈ 38g/餐 → 2 slot/餐 → 日总 8 slot
 * - 维持 100g/日 ÷ 4 餐 ≈ 25g/餐 → 1 slot/餐 → 日总 4 slot
 * - 增肌 180g/日 ÷ 4 餐 ≈ 45g/餐 → 2-3 slot/餐 → 日总 10 slot+
 *
 * 注意：此函数不再依赖 goalType 硬分支，纯数据驱动。
 */
export function buildMealRoles(
  mealType: string,
  targetProtein: number,
): string[] {
  const slotsNeeded =
    targetProtein > 0
      ? Math.max(1, Math.min(3, Math.ceil(targetProtein / 25)))
      : 1;

  // snack 特殊处理：有蛋白需求走 protein-first snack
  if (mealType === 'snack') {
    return slotsNeeded >= 1
      ? ['snack_protein', 'snack2']
      : ['snack1', 'snack2'];
  }

  const baseStructure: Record<string, string[]> = {
    breakfast: ['carb'],
    lunch: ['carb', 'veggie'],
    dinner: ['veggie', 'side'],
  };
  const base = baseStructure[mealType] ?? ['carb', 'veggie'];
  const proteinRoles = ['protein', 'protein2', 'protein3'].slice(0, slotsNeeded);
  return [...base, ...proteinRoles];
}

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
