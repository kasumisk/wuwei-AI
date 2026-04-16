/**
 * V2.2 Phase 1.2 — 决策阈值配置中心
 *
 * 统一存放所有决策相关的配置常量：
 * - Score→Decision 边界（V1.9 已有）
 * - 动态阈值比例因子（V2.2 新增）
 * - 上下文修正器参数（V2.2 从 contextual-modifier 迁入）
 */

// ==================== 目标差异化决策阈值 ====================

export interface DecisionThresholds {
  excellent: number;
  good: number;
  caution: number;
}

export const GOAL_DECISION_THRESHOLDS: Record<string, DecisionThresholds> = {
  fat_loss: { excellent: 78, good: 58, caution: 38 },
  muscle_gain: { excellent: 72, good: 52, caution: 32 },
  health: { excellent: 75, good: 55, caution: 35 },
  habit: { excellent: 70, good: 50, caution: 30 },
};

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  excellent: 75,
  good: 55,
  caution: 35,
};

/**
 * 获取指定目标的决策阈值
 */
export function getDecisionThresholds(goalType: string): DecisionThresholds {
  return GOAL_DECISION_THRESHOLDS[goalType] || DEFAULT_THRESHOLDS;
}

// ==================== 决策级别 ====================

export type DecisionLevel = 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';

/**
 * 根据分数和阈值确定决策级别
 */
export function scoreToDecisionLevel(
  score: number,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): DecisionLevel {
  if (score >= thresholds.excellent) return 'SAFE';
  if (score >= thresholds.good) return 'OK';
  if (score >= thresholds.caution) return 'LIMIT';
  return 'AVOID';
}

// ==================== V2.2: 动态阈值比例因子 ====================
// 所有绝对阈值替换为 用户日目标 × 比例因子

export const THRESHOLD_RATIOS = {
  /** 显著餐热量门槛（占日目标比例）：原 300kcal → goalCalories * 0.15 */
  significantMealCalRatio: 0.15,
  /** 高蛋白餐门槛（占日目标比例）：原 25g → goalProtein * 0.3 */
  highProteinMealRatio: 0.3,
  /** 低蛋白餐门槛（占日目标比例）：原 15g → goalProtein * 0.12 */
  lowProteinMealRatio: 0.12,
  /** 极低蛋白餐门槛（占日目标比例）：原 10g → goalProtein * 0.08 */
  veryLowProteinMealRatio: 0.08,
  /** 高脂肪餐门槛（占日目标比例）：原 30g → goalFat * 0.45 */
  highFatMealRatio: 0.45,
  /** 晚间高碳水门槛（占日目标比例）：原 60g → goalCarbs * 0.22 */
  highCarbMealRatio: 0.22,
  /** 晚餐高碳水门槛（占日目标比例）：原 40g → goalCarbs * 0.15 */
  dinnerHighCarbRatio: 0.15,
  /** 零食高热量门槛（占日目标比例）：原 200kcal → goalCalories * 0.1 */
  snackHighCalRatio: 0.1,
  /** 超预算边界（占日目标比例）：原 -100kcal → goalCalories * -0.05 */
  overBudgetMarginRatio: 0.05,
  /** 单餐最大热量占比：保持 0.5 */
  singleMealMaxRatio: 0.5,
  /** 碳水超标比：保持 1.1 */
  carbExcessRatio: 1.1,
  /** 碳水严重超标比：保持 1.3 */
  carbCriticalRatio: 1.3,
  /** 脂肪超标比：保持 1.0 */
  fatExcessRatio: 1.0,
  /** 脂肪严重超标比：保持 1.3 */
  fatCriticalRatio: 1.3,
  /** 下一餐低预算门槛（占日目标比例）：原 100kcal → goalCalories * 0.05 */
  nextMealLowBudgetRatio: 0.05,
} as const;

/** 份量 buffer ratio（按目标） */
export const PORTION_BUFFER: Record<string, number> = {
  fat_loss: 0.8,
  muscle_gain: 0.9,
  health: 0.9,
  habit: 0.9,
};

/** 份量最低推荐百分比 */
export const PORTION_MIN_PERCENT = 20;

// ==================== V2.2: 健康检查阈值 ====================

/** 钠摄入限制（mg/餐） */
export const SODIUM_LIMITS = {
  /** 有高血压 */
  hypertension: 600,
  /** 默认 */
  default: 2000,
} as const;

/** 添加糖限制（g/餐） */
export const ADDED_SUGAR_LIMITS = {
  /** 有糖尿病 */
  diabetes: 5,
  /** 默认 */
  default: 25,
} as const;

// ==================== V2.2: 时间边界 ====================

export const TIME_BOUNDARIES = {
  /** 深夜开始（含） */
  lateNightStart: 21,
  /** 深夜结束（不含） */
  lateNightEnd: 5,
  /** 晚间开始 */
  eveningStart: 18,
  /** 修正器深夜开始（更严格） */
  modifierLateNightStart: 22,
  /** 修正器深夜结束 */
  modifierLateNightEnd: 4,
} as const;

// ==================== V2.2: 上下文修正器参数（从 contextual-modifier 迁入） ====================

export const MODIFIER_PARAMS = {
  /** 累积饱和度阈值：今日已超标百分比 */
  saturationThreshold: 1.1,
  /** 累积饱和度分数乘数 */
  saturationMultiplier: 0.9,
  /** 深夜时段分数乘数 */
  lateNightMultiplier: 0.85,
  /** 深夜进食最低热量触发 — 使用 snackHighCalRatio 动态化 */
  /** 连续超标严格化每天递增 */
  excessDayStrictness: 0.03,
  /** 最大严格化惩罚 */
  maxStrictnessPenalty: 0.15,
  /** 短时间大量记录阈值（餐数） */
  bingeMealThreshold: 5,
  /** 连续健康饮食奖励乘数 */
  healthyStreakBonus: 1.05,
  /** 触发多日趋势/健康奖励的最低天数 */
  streakMinDays: 3,
  /** 分数乘数下限 */
  multiplierMin: 0.5,
  /** 分数乘数上限 */
  multiplierMax: 1.08,
} as const;
