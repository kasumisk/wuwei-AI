import { FoodLibrary } from '../../../food/food.types';
import { GoalType } from '../nutrition-score.service';
import { ScoringExplanation } from './scoring-explanation.interface';
import { ShortTermProfile } from '../../../user/app/realtime-profile.service';
import {
  ResolvedStrategy,
  RankPolicyConfig,
} from '../../../strategy/strategy.types';
import { ContextualProfile } from '../../../user/app/contextual-profile.service';
import { AnalysisShortTermProfile } from '../../../food/app/analysis-event.listener';

// ==================== 类型 ====================

/**
 * 标准健康状况枚举 (V4)
 * 统一 constraint-generator 和 health-modifier-engine 使用的健康状况命名
 */
export enum HealthCondition {
  DIABETES_TYPE2 = 'diabetes_type2',
  HYPERTENSION = 'hypertension',
  HYPERLIPIDEMIA = 'hyperlipidemia',
  GOUT = 'gout',
  KIDNEY_DISEASE = 'kidney_disease',
  FATTY_LIVER = 'fatty_liver',
  /** V5 2.8: 乳糜泻（麸质不耐受） */
  CELIAC_DISEASE = 'celiac_disease',
  /** V5 2.8: 肠易激综合征 */
  IBS = 'ibs',
  /** V5 2.8: 缺铁性贫血 */
  IRON_DEFICIENCY_ANEMIA = 'iron_deficiency_anemia',
  /** V5 2.8: 骨质疏松症 */
  OSTEOPOROSIS = 'osteoporosis',
}

/**
 * 旧命名 → 标准命名映射（向后兼容）
 * 用于读取 DB 中已存储的旧格式值
 */
export const HEALTH_CONDITION_ALIASES: Record<string, HealthCondition> = {
  diabetes: HealthCondition.DIABETES_TYPE2,
  diabetes_type2: HealthCondition.DIABETES_TYPE2,
  hypertension: HealthCondition.HYPERTENSION,
  high_cholesterol: HealthCondition.HYPERLIPIDEMIA,
  hyperlipidemia: HealthCondition.HYPERLIPIDEMIA,
  gout: HealthCondition.GOUT,
  kidney_disease: HealthCondition.KIDNEY_DISEASE,
  fatty_liver: HealthCondition.FATTY_LIVER,
  // V5 2.8: 新增健康条件别名
  celiac_disease: HealthCondition.CELIAC_DISEASE,
  celiac: HealthCondition.CELIAC_DISEASE,
  gluten_intolerance: HealthCondition.CELIAC_DISEASE,
  ibs: HealthCondition.IBS,
  irritable_bowel: HealthCondition.IBS,
  iron_deficiency_anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  iron_deficiency: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  osteoporosis: HealthCondition.OSTEOPOROSIS,
};

/**
 * 将可能的旧命名标准化为 HealthCondition 枚举值
 */
export function normalizeHealthCondition(raw: string): HealthCondition | null {
  return HEALTH_CONDITION_ALIASES[raw] ?? null;
}

/**
 * 将健康状况列表标准化（去重 + 过滤无效值）
 */
export function normalizeHealthConditions(raw: string[]): HealthCondition[] {
  const result = new Set<HealthCondition>();
  for (const r of raw) {
    const normalized = normalizeHealthCondition(r);
    if (normalized) result.add(normalized);
  }
  return [...result];
}

export interface MealTarget {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** V5 2.2: 膳食纤维目标 (g)，可选 */
  fiber?: number;
  /** V5 2.2: 血糖负荷上限 (GL)，可选 */
  glycemicLoad?: number;
}

export interface Constraint {
  includeTags: string[];
  excludeTags: string[];
  maxCalories: number;
  minProtein: number;
}

export interface ScoredFood {
  food: FoodLibrary;
  score: number;
  /** 按标准份量计算的营养 */
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
  /** V5 2.2: 按标准份量计算的膳食纤维 (g) */
  servingFiber: number;
  /** V5 2.2: 该食物的血糖负荷 (GL)，来自 food.glycemicLoad */
  servingGL: number;
  /** V4: 评分解释（仅对 Top-K 食物生成） */
  explanation?: ScoringExplanation;
}

// ==================== Pipeline 上下文 ====================

/**
 * 三阶段 Pipeline 上下文 — 在各阶段间传递的共享数据
 */
export interface PipelineContext {
  allFoods: FoodLibrary[];
  mealType: string;
  goalType: string;
  target: MealTarget;
  constraints: Constraint;
  usedNames: Set<string>;
  picks: ScoredFood[];
  userPreferences?: { loves?: string[]; avoids?: string[] };
  feedbackStats?: Record<string, FoodFeedbackStats>;
  userProfile?: UserProfileConstraints;
  preferenceProfile?: UserPreferenceProfile;
  regionalBoostMap?: Record<string, number>;
  /** V4 Phase 4.4: 协同过滤推荐分（食物名 → 0~1） */
  cfScores?: Record<string, number>;
  /** V5 4.7: 在线学习后的权重覆盖（传递给 food-scorer） */
  weightOverrides?: number[] | null;
  /** V5 4.8: A/B 实验组覆盖的餐次权重修正（传递给 food-scorer → computeWeights） */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** V6 1.9: 短期画像上下文（近 7 天行为，来自 Redis） */
  shortTermProfile?: ShortTermProfile | null;
  /** V6 2.2: 解析后的策略配置（来自 StrategyResolver） */
  resolvedStrategy?: ResolvedStrategy | null;
  /** V6 2.18: 上下文画像（场景检测结果：工作日/周末/深夜等） */
  contextualProfile?: ContextualProfile | null;
  /** V6.1 Phase 3.5: 分析画像（近期分析的食物分类、风险食物等，来自 Redis） */
  analysisProfile?: AnalysisShortTermProfile | null;
}

export interface MealRecommendation {
  foods: ScoredFood[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  displayText: string;
  tip: string;
  /** V5 2.1: 该餐的候选池（所有角色的 Top-N 合并），供全局优化器替换用 */
  candidates?: ScoredFood[];
}

export interface UserProfileConstraints {
  dietaryRestrictions?: string[];
  weakTimeSlots?: string[];
  discipline?: string;
  allergens?: string[];
  healthConditions?: string[];
  regionCode?: string;
  /** V5 1.8: 用户 IANA 时区（如 'Asia/Shanghai'），传递给约束生成器用于时段判断 */
  timezone?: string;
}

/**
 * 单个食物的反馈统计 — 用于 Thompson Sampling
 * α = accepted + 1 (Beta 先验)
 * β = rejected + 1 (Beta 先验)
 * 新食物无记录 → 默认 α=1, β=1 → Beta(1,1) = 均匀分布 → 最大探索
 */
export interface FoodFeedbackStats {
  accepted: number;
  rejected: number;
}

/**
 * 用户偏好画像 — 从 RecommendationFeedback 聚合统计
 * 每个维度记录接受率乘数 (0.3~1.3)：
 *   接受率高 → >1.0（加分）
 *   接受率低 → <1.0（减分）
 *   数据不足 → 不出现在 map 中
 */
export interface UserPreferenceProfile {
  /** 按分类（category）的接受率乘数 */
  categoryWeights: Record<string, number>;
  /** 按主料（mainIngredient）的接受率乘数 */
  ingredientWeights: Record<string, number>;
  /** 按食物组（foodGroup）的接受率乘数 */
  foodGroupWeights: Record<string, number>;
  /** 按食物名的偏好乘数（指数衰减加权，映射到 0.7~1.2） */
  foodNameWeights: Record<string, number>;
}

// ==================== 评分权重 ====================

/** 维度名称 — 与 SCORE_WEIGHTS 数组索引对应 */
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
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** 基础权重 — 按目标类型 (V5 2.6: 9→10 维，新增 fiber) */
export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  prot, carbs, fat, qual, sat, glyc, nDens, inflam, fiber]
  fat_loss: [0.19, 0.18, 0.08, 0.06, 0.06, 0.07, 0.12, 0.1, 0.08, 0.06],
  muscle_gain: [0.18, 0.23, 0.13, 0.06, 0.06, 0.05, 0.1, 0.09, 0.06, 0.04],
  health: [0.08, 0.06, 0.05, 0.05, 0.17, 0.08, 0.12, 0.19, 0.12, 0.08],
  habit: [0.13, 0.11, 0.06, 0.06, 0.16, 0.14, 0.1, 0.1, 0.09, 0.05],
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
 * 合并规则:
 *   - baseWeights: rankPolicy.baseWeights[goalType] > baseOverrides > SCORE_WEIGHTS[goalType]
 *   - mealModifiers: rankPolicy.mealModifiers[mealType] > mealWeightOverrides[mealType] > MEAL_WEIGHT_MODIFIERS[mealType]
 *   - statusModifiers: rankPolicy.statusModifiers[flag] > STATUS_WEIGHT_MODIFIERS[flag]
 *
 * @param goalType 目标类型
 * @param mealType 餐次（可选）
 * @param statusFlags 用户状态标记（可选）
 * @param baseOverrides A/B 实验组覆盖的基础权重（可选，Phase 3.8）
 * @param mealWeightOverrides A/B 实验组覆盖的餐次权重修正（可选，V5 4.8）
 * @param rankPolicy V6 2.2: 策略引擎的排序策略配置（优先级最高）
 */
export function computeWeights(
  goalType: GoalType,
  mealType?: string,
  statusFlags?: string[],
  baseOverrides?: number[] | null,
  mealWeightOverrides?: Record<string, Record<string, number>> | null,
  rankPolicy?: RankPolicyConfig | null,
): number[] {
  // 基础权重优先级: rankPolicy.baseWeights > baseOverrides > 系统硬编码
  const strategyBaseWeights = rankPolicy?.baseWeights?.[goalType];
  const base = strategyBaseWeights
    ? [...strategyBaseWeights]
    : baseOverrides
      ? [...baseOverrides]
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
 * 字段对应 NRF 9.3 评分所需的 9 个鼓励项和 3 个限制项中的微量元素
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
