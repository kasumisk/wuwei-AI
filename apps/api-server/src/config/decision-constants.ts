/**
 * V2.4 Decision Constants
 * 
 * 聚集所有硬编码的决策相关常量：时间边界、阈值、决策规则等
 */

export const DECISION_CONSTANTS = {
  // 热量评估
  CALORIE_RATIO_THRESHOLDS: {
    UNDER: 0.9,    // < 90% = under budget
    BALANCED: 1.1, // 90-110% = balanced
    OVER: 1.1,     // > 110% = over budget
  },

  // 营养问题严重程度
  ISSUE_SEVERITY: {
    PROTEIN_DEFICIT_HIGH: 20,       // g
    PROTEIN_DEFICIT_MEDIUM: 10,     // g
    FAT_EXCESS_HIGH: 20,            // g
    CARBS_EXCESS_HIGH: 50,          // g
    FIBER_LOW_THRESHOLD: 0.7,       // ratio of target
  },

  // 宏量均衡度评分
  MACRO_BALANCE_DEVIATION: {
    // 当摄入/目标的比值与1的偏差大于此值时认为不均衡
    THRESHOLD: 0.2,
  },

  // 决策置信度权重
  CONFIDENCE_WEIGHTS: {
    ANALYSIS: 0.8,  // 分析置信度的权重
    REASON: 0.2,    // 理由权重的权重
  },

  // 时间边界(小时)
  TIME_BOUNDS: {
    IMMEDIATE: 2,      // 立即建议的时间范围
    SHORT_TERM: 4,     // 短期建议的时间范围
    MEDIUM_TERM: 8,    // 中期建议的时间范围
  },

  // 决策动作的优先级
  ACTION_PRIORITY: {
    'must_eat': 1,
    'should_eat': 2,
    'can_skip': 3,
    'should_avoid': 4,
  },
};

/**
 * 决策规则配置
 */
export const DECISION_RULES = {
  // 如果热量剩余小于食物热量，不应该吃
  CALORIE_REMAINING_MIN_RATIO: 0.8,

  // 蛋白质缺陷严重程度的权重
  PROTEIN_DEFICIT_WEIGHT: 0.5,

  // 碳水缺陷的权重
  CARBS_WEIGHT: 0.3,

  // 用户偏好的权重
  PREFERENCE_WEIGHT: 0.2,

  // 热量限制的权重
  CALORIE_LIMIT_WEIGHT: 0.7,
};
