/** 每日推荐摄入量 (DV) - 基于 FDA 2020 */
export const DAILY_VALUES = {
  calories: 2000,
  protein: 50,        // g
  fat: 78,             // g
  carbs: 275,          // g
  fiber: 28,           // g
  sugar: 50,           // g
  sodium: 2300,        // mg
  potassium: 4700,     // mg
  calcium: 1300,       // mg
  iron: 18,            // mg
  vitaminA: 900,       // μg RAE
  vitaminC: 90,        // mg
  vitaminD: 20,        // μg
  vitaminE: 15,        // mg
  vitaminB12: 2.4,     // μg
  folate: 400,         // μg
  zinc: 11,            // mg
  magnesium: 420,      // mg
} as const;

/** NRF 9.3 正面营养素 */
export const NRF_POSITIVE = ['protein', 'fiber', 'calcium', 'iron', 'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'potassium'] as const;

/** NRF 9.3 负面营养素 */
export const NRF_NEGATIVE = ['sodium', 'sugar', 'saturatedFat'] as const;

/** 促炎食物标签 */
export const PRO_INFLAMMATORY_TAGS = ['fried', 'ultra_processed', 'high_sugar', 'high_sodium'] as const;

/** 抗炎食物标签 */
export const ANTI_INFLAMMATORY_TAGS = ['omega3', 'leafy_green', 'berry', 'whole_grain', 'fatty_fish'] as const;

/** 10维评分的基础权重 (按目标类型) */
export const BASE_WEIGHTS: Record<string, Record<string, number>> = {
  fat_loss: {
    calorieEfficiency: 0.22, macroBalance: 0.10, nutrientDensity: 0.04, satiety: 0.12,
    quality: 0.08, processingPenalty: 0.06, glycemicControl: 0.10, inflammationIndex: 0.04,
    diversity: 0.06, budgetFit: 0.18,
  },
  muscle_gain: {
    calorieEfficiency: 0.15, macroBalance: 0.12, nutrientDensity: 0.08, satiety: 0.05,
    quality: 0.08, processingPenalty: 0.06, glycemicControl: 0.05, inflammationIndex: 0.06,
    diversity: 0.10, budgetFit: 0.25,
  },
  health: {
    calorieEfficiency: 0.12, macroBalance: 0.12, nutrientDensity: 0.12, satiety: 0.08,
    quality: 0.14, processingPenalty: 0.10, glycemicControl: 0.08, inflammationIndex: 0.08,
    diversity: 0.06, budgetFit: 0.10,
  },
  habit: {
    calorieEfficiency: 0.10, macroBalance: 0.08, nutrientDensity: 0.08, satiety: 0.10,
    quality: 0.10, processingPenalty: 0.08, glycemicControl: 0.06, inflammationIndex: 0.06,
    diversity: 0.26, budgetFit: 0.08,
  },
};

/** 餐次权重修正因子 */
export const MEAL_WEIGHT_MODIFIERS: Record<string, Record<string, number>> = {
  breakfast: { calorieEfficiency: 0.9, satiety: 1.2, glycemicControl: 1.3 },
  lunch: { calorieEfficiency: 1.0, satiety: 1.0, macroBalance: 1.1 },
  dinner: { calorieEfficiency: 1.1, satiety: 0.8, glycemicControl: 1.2 },
  snack: { calorieEfficiency: 1.3, satiety: 0.6, quality: 1.2 },
};

/** 惩罚规则 */
export const PENALTY_RULES = [
  { id: 'fried_food', condition: 'isFried', weight: 0.15, description: '油炸食品' },
  { id: 'ultra_processed', condition: 'processingLevel >= 4', weight: 0.20, description: '超加工食品' },
  { id: 'high_sodium', condition: 'sodium > 800mg', weight: 0.10, description: '高钠' },
  { id: 'high_sugar', condition: 'sugar > 15g', weight: 0.10, description: '高糖' },
  { id: 'trans_fat', condition: 'transFat > 0.5g', weight: 0.25, description: '含反式脂肪' },
  { id: 'late_night_heavy', condition: 'snack && calories > 300', weight: 0.10, description: '夜宵过重' },
] as const;

/** 决策映射阈值 */
export const DECISION_THRESHOLDS = {
  SAFE: 75,
  OK: 55,
  LIMIT: 35,
  AVOID: 0,
} as const;

/** 宏量营养素目标比例 */
export const MACRO_TARGETS: Record<string, { protein: number; fat: number; carbs: number }> = {
  fat_loss: { protein: 0.30, fat: 0.25, carbs: 0.45 },
  muscle_gain: { protein: 0.30, fat: 0.25, carbs: 0.45 },
  health: { protein: 0.20, fat: 0.30, carbs: 0.50 },
  habit: { protein: 0.20, fat: 0.30, carbs: 0.50 },
};
