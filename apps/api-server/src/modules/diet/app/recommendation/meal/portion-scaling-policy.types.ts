/**
 * V8.5: 份量缩放策略系统
 *
 * 解决现有统一全局缩放导致鸡蛋缩到 0.3 个、套餐缩到 0.6 份等问题。
 * 基于食物类别/形态/属性自动推断缩放策略，使推荐结果更接近真实饮食。
 */
import type { FoodLibrary } from '../../../../food/food.types';

// ═══════════════════════════════════════════════════════════════════════════
// 缩放模式枚举
// ═══════════════════════════════════════════════════════════════════════════

export enum PortionScalingMode {
  /** 自由缩放：可按 gram 线性缩放，有合理上下界 */
  SCALABLE = 'scalable',

  /** 有限缩放：允许小范围调整 (0.75x~1.25x)，不应大幅缩放 */
  LIMITED_SCALABLE = 'limited_scalable',

  /** 固定单位：不允许缩放，只能推荐整数个单位（1个、2个，或不推荐） */
  FIXED_UNIT = 'fixed_unit',

  /** 不可缩放：完全不适合缩放，只能按默认标准份推荐 */
  NOT_SCALABLE = 'not_scalable',

  /** 调味品/微量：可有严格上限的小克重缩放，不应作为主推荐食物 */
  CONDIMENT_OR_MICRO = 'condiment_or_micro',
}

// ═══════════════════════════════════════════════════════════════════════════
// 缩放策略 — 每个食物一个策略
// ═══════════════════════════════════════════════════════════════════════════

export interface PortionScalingPolicy {
  /** 缩放模式 */
  mode: PortionScalingMode;

  /** 最小缩放比例（相对于 standardServingG） */
  minRatio: number;

  /** 最大缩放比例（相对于 standardServingG） */
  maxRatio: number;

  /** 缩放步长（0.25 = 四分之一份步进，0 或 1 = 整数步进） */
  ratioStep: number;

  /** 策略推断来源（用于可解释性） */
  inferredFrom: string[];

  /** 该食物是否为餐次核心角色（staple/protein/veggie）vs 配菜/可选项 */
  isCoreMealRole: boolean;

  /** 单位类型 */
  unitType: 'gram' | 'piece' | 'cup' | 'bottle' | 'pack' | 'serving' | 'ml';

  /** 该食物是否应作为主推荐位展示 */
  isPrimaryRecommendation: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 缩放结果
// ═══════════════════════════════════════════════════════════════════════════

export interface PortionAdjustedResult {
  /** 缩放后的 food（含 displayServingDesc 覆盖） */
  food: FoodLibrary;

  /** 实际缩放比例 */
  ratio: number;

  /** 缩放后的每份热量 */
  servingCalories: number;

  /** 缩放后的每份蛋白质 */
  servingProtein: number;

  /** 缩放后的每份脂肪 */
  servingFat: number;

  /** 缩放后的每份碳水 */
  servingCarbs: number;

  /** 缩放后的每份纤维 */
  servingFiber: number;

  /** 是否在缩放时被裁剪（超出最小/最大边界） */
  wasClamped: boolean;

  /** 缩放说明（如 "保持标准份量，未缩放"、"约120g"、"约1份"） */
  scalingNote?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 策略推断规则配置
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyInferenceConfig {
  /** 默认模式（当无其他规则匹配时） */
  defaultMode: PortionScalingMode;

  /** scalable 模式的最小比例 */
  scalableMinRatio: number;

  /** scalable 模式的最大比例 */
  scalableMaxRatio: number;

  /** limited_scalable 的最小比例 */
  limitedScalableMinRatio: number;

  /** limited_scalable 的最大比例 */
  limitedScalableMaxRatio: number;

  /** condiment_or_micro 的最大克数 */
  condimentMaxGrams: number;

  /** 每餐最大食物数量 */
  maxFoodsPerMeal: Record<string, number>;

  /** 小克重阈值（标准份 < 此值视为 micro） */
  microServingThresholdG: number;
}

export const DEFAULT_POLICY_INFERENCE_CONFIG: PolicyInferenceConfig = {
  defaultMode: PortionScalingMode.SCALABLE,

  scalableMinRatio: 0.5,
  scalableMaxRatio: 2.0,

  limitedScalableMinRatio: 0.75,
  limitedScalableMaxRatio: 1.25,

  condimentMaxGrams: 20,

  maxFoodsPerMeal: {
    breakfast: 4,
    lunch: 5,
    dinner: 5,
    snack: 2,
  },

  microServingThresholdG: 10,
};

// ═══════════════════════════════════════════════════════════════════════════
// 餐次食物数量范围（用于组合生成策略）
// ═══════════════════════════════════════════════════════════════════════════

export const MEAL_FOOD_COUNT_RANGE: Record<
  string,
  { min: number; target: number; max: number }
> = {
  breakfast: { min: 2, target: 3, max: 4 },
  lunch: { min: 3, target: 4, max: 5 },
  dinner: { min: 3, target: 4, max: 5 },
  snack: { min: 1, target: 1, max: 2 },
};

/** 餐次核心角色优先级（排序靠前的先保留，靠后的先移除） */
export const MEAL_ROLE_PRIORITY: Record<string, number> = {
  staple: 10,
  protein: 9,
  veggie: 8,
  fruit: 5,
  dairy: 4,
  drink: 2,
  side: 1,
  condiment: 0,
};
