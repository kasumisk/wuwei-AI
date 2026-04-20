/**
 * V4.9 P1.5 — 营养数据合理性校验器（纯函数）
 *
 * 职责：
 * - 校验 AI 估算的营养数据是否符合热力学一致性
 * - 规则：protein×4 + fat×9 + carbs×4 ≈ calories（±15% 容差）
 * - 异常时用 category defaults 纠偏 + 建议降低置信度
 *
 * V4.9 变更:
 * - CATEGORY_MACRO_RATIO 统一为 DB 14 分类
 * - 移除旧 protein/veggie/composite 分类
 * - 新增 meat/seafood/egg/legume/nut/other 分类
 * - 营养数据现在是 per 100g 基准（热力学一致性校验同样适用）
 *
 * 设计原则：
 * - 纯函数，无状态，无副作用，可独立单元测试
 * - 不修改原始数据，返回新对象
 * - 只校验 AI/LLM 估算数据，标准库数据信任度高无需校验
 */

/** 每类食物的默认宏量比例（kcal%），用于纠偏。V4.9: 统一为 DB 14 分类 */
const CATEGORY_MACRO_RATIO: Record<
  string,
  { proteinRatio: number; fatRatio: number; carbsRatio: number }
> = {
  grain:     { proteinRatio: 0.10, fatRatio: 0.08, carbsRatio: 0.82 }, // 谷物
  vegetable: { proteinRatio: 0.20, fatRatio: 0.10, carbsRatio: 0.70 }, // 蔬菜
  fruit:     { proteinRatio: 0.06, fatRatio: 0.04, carbsRatio: 0.90 }, // 水果
  meat:      { proteinRatio: 0.42, fatRatio: 0.30, carbsRatio: 0.00 }, // 畜禽肉
  seafood:   { proteinRatio: 0.50, fatRatio: 0.20, carbsRatio: 0.00 }, // 鱼虾贝
  dairy:     { proteinRatio: 0.22, fatRatio: 0.48, carbsRatio: 0.30 }, // 乳制品
  egg:       { proteinRatio: 0.35, fatRatio: 0.60, carbsRatio: 0.05 }, // 蛋类
  legume:    { proteinRatio: 0.30, fatRatio: 0.15, carbsRatio: 0.55 }, // 豆类
  nut:       { proteinRatio: 0.12, fatRatio: 0.72, carbsRatio: 0.16 }, // 坚果
  fat:       { proteinRatio: 0.00, fatRatio: 1.00, carbsRatio: 0.00 }, // 油脂
  beverage:  { proteinRatio: 0.04, fatRatio: 0.00, carbsRatio: 0.96 }, // 饮品
  condiment: { proteinRatio: 0.10, fatRatio: 0.30, carbsRatio: 0.60 }, // 调味品
  snack:     { proteinRatio: 0.08, fatRatio: 0.38, carbsRatio: 0.54 }, // 零食
  other:     { proteinRatio: 0.15, fatRatio: 0.30, carbsRatio: 0.55 }, // 其他/复合食物
};

const DEFAULT_RATIO = { proteinRatio: 0.15, fatRatio: 0.3, carbsRatio: 0.55 };

/** 校验输入 */
export interface NutritionInput {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  category?: string;
}

/** 校验输出 */
export interface SanityResult {
  /** 是否通过校验（偏差 ≤ 15%） */
  isValid: boolean;
  /** 偏差率 0~1（计算热量与报告热量之比差） */
  deviation: number;
  /** 纠偏后的营养数据（若 isValid 则与输入相同） */
  corrected: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
  };
  /** 是否进行了纠偏 */
  wasAdjusted: boolean;
  /** 建议降低的置信度（0 | 0.1 | 0.2） */
  confidenceReduction: number;
}

/** 容差阈值 */
const TOLERANCE = 0.15;

/**
 * 校验并纠偏单个食物项的营养数据
 *
 * @param input 食物营养数据（来自 AI/LLM 估算）
 * @returns 校验结果，包含纠偏建议
 */
export function validateNutrition(input: NutritionInput): SanityResult {
  const { calories, protein, fat, carbs, category } = input;

  // 数据缺失时直接通过（无法校验）
  if (!calories || calories <= 0) {
    return {
      isValid: true,
      deviation: 0,
      corrected: { calories, protein, fat, carbs },
      wasAdjusted: false,
      confidenceReduction: 0,
    };
  }

  // 计算宏量热量
  const computedCalories = protein * 4 + fat * 9 + carbs * 4;

  // 偏差率 = |计算值 - 报告值| / 报告值
  const deviation =
    Math.abs(computedCalories - calories) / Math.max(calories, 1);

  if (deviation <= TOLERANCE) {
    return {
      isValid: true,
      deviation: Math.round(deviation * 1000) / 1000,
      corrected: { calories, protein, fat, carbs },
      wasAdjusted: false,
      confidenceReduction: 0,
    };
  }

  // 偏差超限：用 category defaults 按 calories 重新推算宏量
  const ratio = CATEGORY_MACRO_RATIO[category || ''] || DEFAULT_RATIO;

  const correctedProtein = Math.round((calories * ratio.proteinRatio) / 4);
  const correctedFat = Math.round((calories * ratio.fatRatio) / 9);
  const correctedCarbs = Math.round((calories * ratio.carbsRatio) / 4);

  // 偏差越大，置信度惩罚越大
  const confidenceReduction: 0 | 0.1 | 0.2 = deviation > 0.4 ? 0.2 : 0.1;

  return {
    isValid: false,
    deviation: Math.round(deviation * 1000) / 1000,
    corrected: {
      calories,
      protein: correctedProtein,
      fat: correctedFat,
      carbs: correctedCarbs,
    },
    wasAdjusted: true,
    confidenceReduction,
  };
}

/**
 * 批量校验食物列表（用于 LLM 返回的 foods 数组）
 *
 * @param foods 食物数组
 * @returns 纠偏后的食物数组（仅修改不一致的项）
 */
export function validateAndCorrectFoods<
  T extends NutritionInput & { confidence?: number },
>(foods: T[]): T[] {
  return foods.map((food) => {
    const result = validateNutrition(food);
    if (!result.wasAdjusted) return food;

    return {
      ...food,
      protein: result.corrected.protein,
      fat: result.corrected.fat,
      carbs: result.corrected.carbs,
      confidence: Math.max(
        0.1,
        (food.confidence ?? 0.6) - result.confidenceReduction,
      ),
    };
  });
}
