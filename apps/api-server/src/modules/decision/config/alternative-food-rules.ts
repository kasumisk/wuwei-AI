/**
 * V4.9: 替代食物规则配置（constraint-based）
 *
 * 按食物品类 + 用户目标提供替代约束，传递给推荐引擎动态匹配。
 * 不再硬编码具体食物名称，改为 substitutionConstraints 描述替代方向。
 *
 * V4.9 变更:
 * - category 统一为 DB 14 分类（grain/vegetable/fruit/meat/seafood/dairy/egg/legume/nut/fat/beverage/condiment/snack/other）
 * - 移除旧 protein/veggie/composite 分类引用
 * - preferCategories 使用 DB 分类
 */

// V5.2: LocaleKey removed — fallbackHint now uses cl() key string

/**
 * 营养约束阈值说明（NutritionConstraints）
 *
 * 以下阈值均为每次**餐次分析**的绝对值，基于典型成人 TDEE 2000kcal 场景推导：
 *
 * | 字段          | 单位  | 推导依据                                              |
 * |--------------|-------|------------------------------------------------------|
 * | minCalories  | kcal  | 餐次热量下限：超过该值认为是"正式餐/高热量点心"           |
 * | maxProtein   | g     | 蛋白质上限（低于该值视为蛋白质不足，触发补充建议）         |
 * | minCarbs     | g     | 碳水下限（超过该值视为碳水偏高，触发替换建议）             |
 * | minFat       | g     | 脂肪下限（超过该值视为脂肪偏高，触发低脂替代）             |
 *
 * 注意：这些阈值为**静态配置基准值**，动态用户个性化阈值由
 * `DynamicThresholdsService.compute()` 产出的 `UserThresholds` 管理。
 * 如需与用户画像对齐，上游调用方应优先使用动态阈值过滤后再调用此规则集。
 */
export interface AlternativeRule {
  /** 规则ID（调试用） */
  id: string;
  /** 触发条件（见上方 NutritionConstraints 说明） */
  trigger: {
    /** 匹配的食物品类（为空表示不限品类） */
    categories?: string[];
    /** 匹配的目标类型（为空表示所有目标） */
    goals?: string[];
    /** 热量阈值：餐次总热量 > 此值时触发 */
    minCalories?: number;
    /** 蛋白质上限：餐次总蛋白质 < 此值时触发（视为蛋白不足） */
    maxProtein?: number;
    /** 碳水下限：餐次总碳水 > 此值时触发（视为碳水偏高） */
    minCarbs?: number;
    /** 脂肪下限：餐次总脂肪 > 此值时触发（视为脂肪偏高） */
    minFat?: number;
  };
  /** V4.6: 替代约束（传递给推荐引擎） */
  substitutionConstraints: {
    /** 优先推荐的食物品类 */
    preferCategories?: string[];
    /** 替代品热量上限（相对原食物比例，如 0.7 = 原食物的 70%） */
    maxCaloriesRatio?: number;
    /** 替代品蛋白质下限（相对原食物比例，如 1.2 = 原食物的 120%） */
    minProteinRatio?: number;
    /** 优先匹配的标签 */
    preferTags?: string[];
    /** 排除的标签 */
    avoidTags?: string[];
    /** NOVA 加工等级上限（1-4） */
    processingLevelMax?: number;
    /** 血糖负荷上限 */
    maxGlycemicLoad?: number;
  };
  /** V5.2: i18n key for fallback hint (resolved via cl()) */
  fallbackHint: string;
}

// =====================================================================
//  按品类的替代规则
// =====================================================================

export const CATEGORY_ALTERNATIVE_RULES: AlternativeRule[] = [
  // ===== 高热量零食 =====
  {
    id: 'snack-high-cal',
    trigger: { categories: ['snack'], minCalories: 200 },
    substitutionConstraints: {
      preferCategories: ['meat', 'egg', 'dairy'],
      maxCaloriesRatio: 0.6,
      preferTags: ['high_protein', 'low_calorie'],
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.snackHighCal',
  },

  // ===== 含糖饮料 =====
  {
    id: 'beverage-sugar',
    trigger: { categories: ['beverage'], minCalories: 100 },
    substitutionConstraints: {
      preferCategories: ['beverage'],
      maxCaloriesRatio: 0.1,
      avoidTags: ['sugar', 'sweetened'],
      preferTags: ['low_calorie', 'unsweetened'],
    },
    fallbackHint: 'alt.hint.beverageSugar',
  },

  // ===== 精制谷物 =====
  {
    id: 'grain-refined',
    trigger: { categories: ['grain'], minCarbs: 60 },
    substitutionConstraints: {
      preferCategories: ['grain'],
      preferTags: ['whole_grain', 'high_fiber', 'low_gi'],
      avoidTags: ['refined'],
      maxGlycemicLoad: 15,
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.grainRefined',
  },

  // ===== 高热量谷物 =====
  {
    id: 'grain-high-cal',
    trigger: { categories: ['grain'], minCalories: 400 },
    substitutionConstraints: {
      preferCategories: ['grain', 'tuber'],
      maxCaloriesRatio: 0.6,
      preferTags: ['whole_grain', 'high_fiber'],
      avoidTags: ['refined'],
      processingLevelMax: 1,
    },
    fallbackHint: 'alt.hint.grainHighCal',
  },

  // ===== 高脂蛋白质 =====
  {
    id: 'protein-high-fat',
    trigger: { categories: ['meat', 'seafood', 'egg'], minFat: 20 },
    substitutionConstraints: {
      preferCategories: ['meat', 'seafood', 'egg'],
      preferTags: ['lean', 'low_fat', 'high_protein'],
      avoidTags: ['high_fat', 'fried'],
      processingLevelMax: 1,
    },
    fallbackHint: 'alt.hint.proteinHighFat',
  },

  // ===== 油脂过多 =====
  {
    id: 'fat-excessive',
    trigger: { categories: ['fat'], minCalories: 200 },
    substitutionConstraints: {
      preferCategories: ['fat'],
      maxCaloriesRatio: 0.5,
      preferTags: ['unsaturated', 'portion_control'],
      avoidTags: ['saturated', 'trans_fat'],
    },
    fallbackHint: 'alt.hint.fatExcessive',
  },

  // ===== 复合菜/外卖 =====
  {
    id: 'composite-high-cal',
    trigger: { categories: ['other'], minCalories: 500 },
    substitutionConstraints: {
      preferCategories: ['meat', 'seafood', 'egg', 'vegetable'],
      maxCaloriesRatio: 0.6,
      preferTags: ['steamed', 'boiled', 'low_oil', 'high_protein'],
      avoidTags: ['fried', 'heavy_oil'],
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.compositeHighCal',
  },
];

// =====================================================================
//  按目标 + 营养缺口的通用规则
// =====================================================================

export const GOAL_ALTERNATIVE_RULES: AlternativeRule[] = [
  // 减脂: 蛋白质不足
  {
    id: 'fat-loss-low-protein',
    trigger: { goals: ['fat_loss'], maxProtein: 15, minCalories: 200 },
    substitutionConstraints: {
      preferCategories: ['meat', 'seafood', 'egg', 'legume'],
      minProteinRatio: 1.5,
      maxCaloriesRatio: 0.7,
      preferTags: ['high_protein', 'low_fat', 'low_calorie'],
      processingLevelMax: 1,
    },
    fallbackHint: 'alt.hint.fatLossLowProtein',
  },

  // 减脂: 高热量
  {
    id: 'fat-loss-high-cal',
    trigger: { goals: ['fat_loss'], minCalories: 500 },
    substitutionConstraints: {
      maxCaloriesRatio: 0.5,
      preferTags: ['high_fiber', 'high_satiety', 'low_calorie'],
      avoidTags: ['fried', 'heavy_oil', 'sugar'],
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.fatLossHighCal',
  },

  // 增肌: 蛋白质不足
  {
    id: 'muscle-gain-low-protein',
    trigger: { goals: ['muscle_gain'], maxProtein: 20, minCalories: 200 },
    substitutionConstraints: {
      preferCategories: ['meat', 'egg', 'dairy'],
      minProteinRatio: 2.0,
      preferTags: ['high_protein', 'complete_protein', 'creatine'],
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.muscleGainLowProtein',
  },

  // 增肌: 热量不足
  {
    id: 'muscle-gain-low-cal',
    trigger: { goals: ['muscle_gain'] },
    substitutionConstraints: {
      preferCategories: ['dairy', 'grain', 'fruit'],
      preferTags: ['calorie_dense', 'high_protein', 'high_carb'],
    },
    fallbackHint: 'alt.hint.muscleGainLowCal',
  },

  // 健康: 碳水过高
  {
    id: 'health-high-carbs',
    trigger: { goals: ['health'], minCarbs: 80 },
    substitutionConstraints: {
      preferCategories: ['vegetable', 'grain'],
      preferTags: ['high_fiber', 'low_gi', 'micronutrient_rich'],
      avoidTags: ['refined', 'sugar'],
      maxGlycemicLoad: 12,
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.healthHighCarbs',
  },

  // 通用: 蛋白质不足
  {
    id: 'general-low-protein',
    trigger: { maxProtein: 10, minCalories: 300 },
    substitutionConstraints: {
      preferCategories: ['meat', 'seafood', 'egg', 'legume', 'dairy'],
      minProteinRatio: 1.5,
      preferTags: ['high_protein', 'low_fat'],
      processingLevelMax: 1,
    },
    fallbackHint: 'alt.hint.generalLowProtein',
  },

  // 通用: 碳水过高
  {
    id: 'general-high-carbs',
    trigger: { minCarbs: 100 },
    substitutionConstraints: {
      preferCategories: ['grain'],
      preferTags: ['whole_grain', 'high_fiber', 'low_gi'],
      avoidTags: ['refined', 'sugar'],
      maxGlycemicLoad: 15,
      processingLevelMax: 2,
    },
    fallbackHint: 'alt.hint.generalHighCarbs',
  },
];
