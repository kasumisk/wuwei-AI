import { FoodLibrary } from '../../../food/food.types';
import { GoalType } from '../nutrition-score.service';
import { ScoringExplanation } from './scoring-explanation.interface';
import { ShortTermProfile } from '../../../user/app/realtime-profile.service';
import { ScoredRecipe } from '../../../recipe/recipe.types';
import {
  ResolvedStrategy,
  RankPolicyConfig,
} from '../../../strategy/strategy.types';
import { ContextualProfile } from '../../../user/app/contextual-profile.service';
import { AnalysisShortTermProfile } from '../../../food/app/analysis-event.listener';
import type { MealCompositionExplanation } from './explanation-generator.service';
import type { HealthModifierContext } from './health-modifier-engine.service';
import type { HealthModifierResult } from './health-modifier-engine.service';
import type { NutritionTargets } from './nutrition-target.service';
import type { LifestyleNutrientAdjustment } from './lifestyle-scoring-adapter.service';

// ==================== 类型 ====================

/**
 * V6.4 Phase 3.2: 食物获取渠道枚举
 * 用于场景化推荐 — 根据用户当前场景过滤可获取的食物/菜谱
 */
export enum AcquisitionChannel {
  /** 在家烹饪 */
  HOME_COOK = 'home_cook',
  /** 餐厅堂食 */
  RESTAURANT = 'restaurant',
  /** 外卖配送 */
  DELIVERY = 'delivery',
  /** 便利店/即食 */
  CONVENIENCE = 'convenience',
  /** 食堂/团餐（V6.6 Phase 2-D） */
  CANTEEN = 'canteen',
  /** 未知/不限 */
  UNKNOWN = 'unknown',
}

/** 所有有效渠道值（用于校验） */
export const ALL_CHANNELS: AcquisitionChannel[] =
  Object.values(AcquisitionChannel);

/**
 * V6.4 Phase 3.2: 根据用户画像推断当前最可能的获取渠道
 *
 * 推断逻辑优先级:
 * 1. 显式传入的 channel 参数（客户端指定）
 * 2. 上下文画像场景推断（工作日午餐 → delivery/restaurant，周末 → home_cook）
 * 3. 用户声明的 canCook + takeoutFrequency
 * 4. 默认 unknown（不过滤）
 */
export function inferAcquisitionChannel(
  explicitChannel?: string | null,
  contextualProfile?: { scene?: string; dayType?: string } | null,
  declaredProfile?: {
    canCook?: boolean;
    takeoutFrequency?: string;
    /** V6.6 Phase 2-D: 主要用餐地点（'canteen'|'home'|'restaurant' 等） */
    primaryEatingLocation?: string | null;
  } | null,
  mealType?: string,
): AcquisitionChannel {
  // 1. 显式指定
  if (
    explicitChannel &&
    ALL_CHANNELS.includes(explicitChannel as AcquisitionChannel)
  ) {
    return explicitChannel as AcquisitionChannel;
  }

  // 2. 食堂场景推断（V6.6 Phase 2-D）：
  //    用户声明主要用餐地点为食堂，或工作日午餐且未开启外卖
  if (declaredProfile?.primaryEatingLocation === 'canteen') {
    return AcquisitionChannel.CANTEEN;
  }

  // 3. 上下文场景推断
  if (contextualProfile) {
    const { scene, dayType } = contextualProfile;
    const isWeekend = dayType === 'weekend';

    // 工作日午餐/晚餐 → 大概率外卖或餐厅
    if (!isWeekend && (mealType === 'lunch' || mealType === 'dinner')) {
      if (scene === 'working') return AcquisitionChannel.DELIVERY;
    }

    // 深夜场景 → 便利店/外卖
    if (scene === 'late_night') return AcquisitionChannel.CONVENIENCE;

    // 周末 → 在家烹饪概率高
    if (
      isWeekend &&
      (mealType === 'breakfast' ||
        mealType === 'lunch' ||
        mealType === 'dinner')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 4. 声明画像推断
  if (declaredProfile) {
    const { canCook, takeoutFrequency } = declaredProfile;
    if (canCook === false) return AcquisitionChannel.DELIVERY;
    if (takeoutFrequency === 'always' || takeoutFrequency === 'often') {
      return AcquisitionChannel.DELIVERY;
    }
    if (
      canCook &&
      (takeoutFrequency === 'rarely' || takeoutFrequency === 'never')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 5. 默认不限
  return AcquisitionChannel.UNKNOWN;
}

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
  /** V6.5 Phase 3D: 用户 ID（供语义召回等异步服务使用） */
  userId?: string;
  /** V6.6 Phase 2-B: 替换反馈权重 Map（食物 ID → 乘数），由 ReplacementFeedbackInjectorService 提供 */
  replacementWeightMap?: Map<string, number> | null;
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
  /** V6.4 Phase 3.2: 当前推荐的获取渠道（用于候选池过滤） */
  channel?: AcquisitionChannel;
}

export interface MealRecommendation {
  foods: ScoredFood[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  displayText: string;
  tip: string;
  /** V6.3 P3-1: 整餐层面的搭配解释 */
  /** V6.5 Phase 2E: 升级为结构化整餐分析 */
  mealExplanation?: MealCompositionExplanation;
  /** V5 2.1: 该餐的候选池（所有角色的 Top-N 合并），供全局优化器替换用 */
  candidates?: ScoredFood[];
  /** V6.5 Phase 2D: 整餐组合评分 */
  compositionScore?: {
    ingredientDiversity: number;
    cookingMethodDiversity: number;
    flavorBalance: number;
    nutritionComplementarity: number;
    overall: number;
  };
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
  /** V6.2 Phase 2.14: 用户份量倾向（'small'|'normal'|'large'），来自行为画像 */
  portionTendency?: string;
  /** V6.2 3.4: 烹饪技能等级（'beginner'|'intermediate'|'advanced'），来自声明画像 */
  cookingSkillLevel?: string;
  /** V6.2 3.4: 预算等级（'low'|'medium'|'high'），来自声明画像 */
  budgetLevel?: string;
  /** V6.2 3.4: 菜系偏好（如 ['中餐','日料']），来自声明画像 */
  cuisinePreferences?: string[];
}

/**
 * V6.2 Phase 2.11 — 增强型画像上下文
 *
 * 扩展 UserProfileConstraints，聚合五层画像数据：
 * - declared: 声明画像（用户主动填写）
 * - observed: 行为画像（Cron 聚合统计）
 * - inferred: 推断画像（BMR/TDEE/Segment 等）
 * - shortTerm: 短期画像（Redis 7天滑窗）
 * - contextual: 上下文画像（实时场景检测）
 *
 * 由 ProfileResolverService.resolve() 统一构建，
 * 推荐引擎只需注入此单一对象即可获取全部画像信息。
 */
export interface EnrichedProfileContext extends UserProfileConstraints {
  /** 声明画像 — 用户主动填写的基础信息 */
  declared: {
    gender?: string;
    birthYear?: number;
    heightCm?: number;
    weightKg?: number;
    targetWeightKg?: number;
    activityLevel?: string;
    goal?: string;
    goalSpeed?: string;
    dailyCalorieGoal?: number;
    mealsPerDay?: number;
    takeoutFrequency?: string;
    canCook?: boolean;
    cookingSkillLevel?: string;
    budgetLevel?: string;
    familySize?: number;
    cuisinePreferences?: string[];
    foodPreferences?: string[];
    dietaryRestrictions?: string[];
    allergens?: string[];
    healthConditions?: string[];
    weakTimeSlots?: string[];
    bingeTriggers?: string[];
    discipline?: string;
    regionCode?: string;
    timezone?: string;
    /** V6.3 P2-9: 每周运动计划，用于 post_exercise 场景检测 */
    exerciseSchedule?: Record<
      string,
      { startHour: number; durationHours: number }
    > | null;
    /** V6.6 Phase 2-C: 生活方式画像字段 */
    sleepQuality?: string | null;
    stressLevel?: string | null;
    hydrationGoal?: number | null;
    supplementsUsed?: string[] | null;
    mealTimingPreference?: string | null;
  } | null;

  /** 推断画像 — 系统计算的营养/行为推断 */
  inferred: {
    estimatedBmr?: number;
    estimatedTdee?: number;
    recommendedCalories?: number;
    macroTargets?: Record<string, number>;
    userSegment?: string;
    churnRisk?: number;
    optimalMealCount?: number;
    nutritionGaps?: string[];
    preferenceWeights?: Record<string, number>;
  } | null;

  /** 行为画像 — Cron 聚合的行为统计 */
  observed: {
    avgComplianceRate?: number;
    totalRecords?: number;
    streakDays?: number;
    mealTimingPatterns?: Record<string, any>;
    portionTendency?: string;
    /** V6.3 P1-3: 暴食风险时段（小时桶列表，如 [14,21,22]） */
    bingeRiskHours?: number[];
  } | null;

  /** 短期画像 — Redis 7天滑窗（实时事件驱动更新） */
  shortTerm: ShortTermProfile | null;

  /** 上下文画像 — 实时场景检测（纯计算，无 I/O） */
  contextual: ContextualProfile | null;

  /** V6.5: 生活方式画像 — 从 declared 层聚合的评分相关字段 */
  lifestyle: LifestyleProfile | null;

  /** V6.6 Phase 2-C: 生活方式营养素优先级调整 — 由 LifestyleScoringAdapter 生成 */
  lifestyleAdjustment?: Record<string, number> | null;
}

/**
 * V6.5 Phase 1E: 生活方式画像
 *
 * 从 declared 声明画像中提取与推荐评分直接相关的6个字段，
 * 结构化为独立子对象，供 ProfileScoringMapper 消费。
 */
export interface LifestyleProfile {
  /** 口味强度偏好 {spicy: 0-5, sweet: 0-5, ...} */
  tasteIntensity: Record<string, number> | null;
  /** 偏好菜系列表 */
  cuisinePreferences: string[];
  /** 预算等级 */
  budgetLevel: 'low' | 'medium' | 'high' | null;
  /** 烹饪技能等级（字符串: beginner/intermediate/advanced） */
  cookingSkillLevel: string | null;
  /** 家庭人数 */
  familySize: number;
  /** 是否愿意备餐 */
  mealPrepWilling: boolean;
  /** V6.6 Phase 2-C: 睡眠质量 */
  sleepQuality?: string | null;
  /** V6.6 Phase 2-C: 压力水平 */
  stressLevel?: string | null;
  /** V6.6 Phase 2-C: 每日目标饮水量 (ml) */
  hydrationGoal?: number | null;
  /** V6.6 Phase 2-C: 正在服用的补剂列表 */
  supplementsUsed?: string[] | null;
  /** V6.6 Phase 2-C: 用餐时间偏好 */
  mealTimingPreference?: string | null;
}

/**
 * V6.2 Phase 3.1 — recommendMealFromPool 参数请求对象
 *
 * 将原 19 个位置参数合并为单一对象，提升可读性和可维护性。
 * 所有可选字段默认为 undefined/null（与原位置参数行为一致）。
 */
export interface MealFromPoolRequest {
  /** 食物库全集 */
  allFoods: FoodLibrary[];
  /** 餐次类型 */
  mealType: string;
  /** 目标类型（减脂/增肌/健康等） */
  goalType: string;
  /** 当日已摄入量 */
  consumed: { calories: number; protein: number };
  /** 本餐目标 */
  target: MealTarget;
  /** 当日总目标 */
  dailyTarget: { calories: number; protein: number };
  /** 排除食物名称列表（去重） */
  excludeNames: string[];
  /** 用户偏好（loves/avoids） */
  userPreferences?: { loves?: string[]; avoids?: string[] };
  /** 食物反馈统计（Thompson Sampling） */
  feedbackStats?: Record<string, FoodFeedbackStats>;
  /** 用户约束画像 */
  userProfile?: UserProfileConstraints;
  /** 用户偏好画像（按维度的接受率乘数） */
  preferenceProfile?: UserPreferenceProfile;
  /** 区域加分映射 */
  regionalBoostMap?: Record<string, number>;
  /** 协同过滤评分 */
  cfScores?: Record<string, number>;
  /** V5 4.7: 在线学习后的权重覆盖 */
  weightOverrides?: number[] | null;
  /** V5 4.8: A/B 实验组覆盖的餐次权重修正 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** V6 1.9: 短期画像上下文（近 7 天行为） */
  shortTermProfile?: ShortTermProfile | null;
  /** V6 2.2: 解析后的策略配置 */
  resolvedStrategy?: ResolvedStrategy | null;
  /** V6 2.18: 上下文画像（场景检测结果） */
  contextualProfile?: ContextualProfile | null;
  /** V6.1 Phase 3.5: 分析画像（近期分析的食物分类、风险食物等） */
  analysisProfile?: AnalysisShortTermProfile | null;
  /** V6.3 P2-8: 已评分的菜谱候选（由调用方提前获取，用于菜谱优先组装模式） */
  scoredRecipes?: ScoredRecipe[] | null;
  /** V6.4 Phase 3.2: 获取渠道（用于候选池过滤） */
  channel?: AcquisitionChannel;
  /** V6.5 Phase 3D: 用户 ID（供语义召回等异步服务使用） */
  userId?: string;
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
  'seasonality', // V6.4 Phase 3.4: 时令感知评分维度
  'executability', // V6.5: 可执行性评分维度
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** 基础权重 — 按目标类型 (V6.5: 11→12 维，新增 executability) */
export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  prot, carbs, fat,  qual, sat,  glyc, nDens, inflam, fiber, season, exec]
  fat_loss: [
    0.16, 0.15, 0.07, 0.05, 0.05, 0.06, 0.11, 0.09, 0.06, 0.04, 0.03, 0.13,
  ],
  muscle_gain: [
    0.15, 0.2, 0.1, 0.05, 0.05, 0.04, 0.09, 0.08, 0.04, 0.03, 0.03, 0.14,
  ],
  health: [
    0.06, 0.05, 0.04, 0.04, 0.14, 0.06, 0.1, 0.16, 0.1, 0.07, 0.05, 0.13,
  ],
  habit: [
    0.1, 0.08, 0.05, 0.05, 0.13, 0.11, 0.08, 0.08, 0.07, 0.04, 0.04, 0.17,
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

// ==================== V6.7 Phase 1-A: ScoringContext ====================

/**
 * V6.7 Phase 1-B: 可运行时配置的评分参数快照
 *
 * 从 ScoringConfigService 加载，集中管理分散在 10+ service 中的 42+ 硬编码常量。
 * Phase 1-A 先定义接口，Phase 1-B 实现 ScoringConfigService。
 * 在 1-B 完成前，FoodScorer 内部使用硬编码默认值（行为不变）。
 */
export interface ScoringConfigSnapshot {
  /** 可执行性评分的子权重 */
  executabilitySubWeights: {
    commonality: number;
    cost: number;
    cookTime: number;
    skill: number;
  };
  /** NRF 9.3 Sigmoid 中心点 */
  nrf93SigmoidCenter: number;
  /** NRF 9.3 Sigmoid 斜率 */
  nrf93SigmoidSlope: number;
  /** 炎症指数 Sigmoid 中心点 */
  inflammationCenter: number;
  /** 炎症指数 Sigmoid 斜率 */
  inflammationSlope: number;
  /** 添加糖惩罚阈值 (g → 每 N g 扣分) */
  addedSugarPenaltyPerGrams: number;
  /** 置信度下限 */
  confidenceFloor: number;
  /** NOVA 基准惩罚乘数 [NOVA0兜底, NOVA1, NOVA2, NOVA3, NOVA4] */
  novaBase: number[];
  /** 热量评分 Sigma 比例（per-goal） */
  energySigmaRatios: Record<string, number>;
}

/**
 * V6.7 Phase 1-A: 统一评分上下文
 *
 * 替代 scoreFoodDetailed 的 12 个位置参数。
 * 将所有评分所需的外部信号封装为单一对象，新增信号只需扩展此接口，
 * 无需修改 scorer 签名和所有调用处。
 */
export interface ScoringContext {
  /** 待评分食物 */
  food: FoodLibrary;
  /** 目标类型 */
  goalType: string;
  /** 餐次营养目标 */
  target?: MealTarget;
  /** 健康修正上下文（过敏原、健康状况等） */
  penaltyContext?: HealthModifierContext;
  /** 餐次类型 */
  mealType?: string;
  /** 用户状态标记（如 'plateau', 'low_protein'） */
  statusFlags?: string[];
  /** 在线学习权重覆盖 */
  weightOverrides?: number[] | null;
  /** A/B 实验组餐次权重覆盖 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** 策略引擎排序策略配置 */
  rankPolicy?: RankPolicyConfig | null;
  /** 用户营养缺口列表 */
  nutritionGaps?: string[] | null;
  /** 健康修正请求级缓存 */
  healthModifierCache?: Map<string, HealthModifierResult>;
  /** 个性化营养目标 */
  nutritionTargets?: NutritionTargets | null;
  /** V6.7: 生活方式营养素优先级调整（waterContent、tryptophan 等信号） */
  lifestyleAdjustment?: LifestyleNutrientAdjustment | null;
  /** V6.7: 评分参数快照（Phase 1-B 实现，1-A 阶段 optional） */
  scoringConfig?: ScoringConfigSnapshot | null;
}
