/**
 * V5.1: Food item and nutrition types
 *
 * V5.1 Changes:
 * - Added fields aligned with food enrichment pipeline FIELD_DESC:
 *   naturalSugar, insolubleFiber, waterContentPercent, vitaminE, vitaminB6,
 *   vitaminB12, folate, magnesium, phosphorus, subCategory, foodGroup,
 *   cuisine, dishType, mainIngredient, textureTags
 * - purine type expanded: number | 'low' | 'medium' | 'high' | null
 *   (numeric mg/100g preferred, string for backward compat)
 * - Validation ranges added to JSDoc comments matching FIELD_DESC
 *
 * V6.x 数据契约（重要）：
 * AnalyzedFoodItem 上的所有营养字段（calories/protein/fat/carbs/fiber/sodium/
 * 以及所有扩展营养字段）一律存储 **per-serving 实际摄入值**，
 * 即已乘以 estimatedWeightGrams/100 后的真实摄入量。
 *
 * 上游所有生成路径（buildFromLibraryMatch、llmParseFoods fallback、
 * buildHeuristicFallbackFood、image parseToAnalyzedFoods、applyLibraryMatch）
 * 必须在写入 AnalyzedFoodItem 前完成 per-100g → per-serving 的换算。
 *
 * 下游消费者（aggregateNutrition、前端、决策层）直接使用，不再二次缩放。
 *
 * 字段单位注释中的 "/100g" 仅表示**取值范围参考**（来自食物库 FIELD_DESC），
 * 不代表运行期值的单位语义。
 */

/**
 * 单个被分析的食物项
 *
 * 营养数据基准：**per-serving 实际摄入值**（V6.x 起）
 * 即所有 calories/protein/fat/carbs/... 字段已经按 estimatedWeightGrams/100 换算完成。
 * 详见文件顶部"V6.x 数据契约"说明。
 */
export interface AnalyzedFoodItem {
  /** 食物名称（用户可见） */
  name: string;
  /** 标准化名称（别名归一后） */
  normalizedName?: string;
  /** V4.6: 英文名（用于食物库精确匹配） */
  nameEn?: string;
  /** 命中的标准食物库 ID */
  foodLibraryId?: string;
  /** 命中的候选食物 ID */
  candidateId?: string;
  /** 数量描述（如"一份"、"200g"） */
  quantity?: string;
  /** 估算重量（克） */
  estimatedWeightGrams?: number;
  /** V4.6: 标准一人份克数 */
  standardServingG?: number;
  /** V4.6: 标准份量描述（"1碗约200g"） */
  standardServingDesc?: string;
  /** 食物分类 */
  category?: string;
  /** 识别/匹配置信度（0-1） */
  confidence: number;
  /** 是否为 AI 估算值 */
  estimated?: boolean;

  // === 宏量营养素（per 100g 可食部分，V4.9）===
  /** 热量（千卡/100g） */
  calories: number;
  /** 蛋白质（克/100g, 0-100） */
  protein?: number;
  /** 脂肪（克/100g, 0-100） */
  fat?: number;
  /** 碳水化合物（克/100g, 0-100） */
  carbs?: number;
  /** 膳食纤维（克/100g, 0-80） */
  fiber?: number;
  /** 总糖（克/100g, 0-100） */
  sugar?: number | null;
  /** 添加糖（克/100g, 0-100） */
  addedSugar?: number | null;
  /** V5.1: 天然固有糖分（克/100g, 0-100） */
  naturalSugar?: number | null;
  /** 饱和脂肪（克/100g, 0-100） */
  saturatedFat?: number | null;
  /** 反式脂肪（克/100g, 0-10） */
  transFat?: number | null;
  /** 胆固醇（mg/100g, 0-2000） */
  cholesterol?: number | null;
  /** 钠（毫克/100g, 0-50000） */
  sodium?: number;

  // === 脂肪酸细分（per 100g）===
  /** Omega-3（mg/100g, 0-30000） */
  omega3?: number | null;
  /** Omega-6（mg/100g, 0-50000） */
  omega6?: number | null;

  // === 纤维细分（per 100g）===
  /** 可溶性纤维（克/100g, 0-40） */
  solubleFiber?: number | null;
  /** V5.1: 不溶性纤维（克/100g, 0-60） */
  insolubleFiber?: number | null;

  // === 水分 ===
  /** V5.1: 含水量百分比（0-100） */
  waterContentPercent?: number | null;

  // === 微量营养素（per 100g）===
  /** 维生素A（μg RAE/100g, 0-50000） */
  vitaminA?: number | null;
  /** 维生素C（mg/100g, 0-2000） */
  vitaminC?: number | null;
  /** 维生素D（μg/100g, 0-1000） */
  vitaminD?: number | null;
  /** V5.1: 维生素E（mg/100g, 0-500） */
  vitaminE?: number | null;
  /** V5.1: 维生素B6（mg/100g, 0-50） */
  vitaminB6?: number | null;
  /** V5.1: 维生素B12（μg/100g, 0-100） */
  vitaminB12?: number | null;
  /** V5.1: 叶酸（μg DFE/100g, 0-5000） */
  folate?: number | null;
  /** 钙（mg/100g, 0-2000） */
  calcium?: number | null;
  /** 铁（mg/100g, 0-100） */
  iron?: number | null;
  /** 钾（mg/100g, 0-10000） */
  potassium?: number | null;
  /** 锌（mg/100g, 0-100） */
  zinc?: number | null;
  /** V5.1: 镁（mg/100g, 0-1000） */
  magnesium?: number | null;
  /** V5.1: 磷（mg/100g, 0-2000） */
  phosphorus?: number | null;

  // === 健康指标 ===
  /** 血糖指数 0-100 */
  glycemicIndex?: number;
  /** 血糖负荷 GL = GI × 可用碳水(g) / 100, 0-50 */
  glycemicLoad?: number | null;
  /** NOVA 加工分级 1-4 */
  processingLevel?: number;
  /** 食物质量评分 0-10 */
  qualityScore?: number;
  /** 饱腹感评分 0-10 */
  satietyScore?: number;
  /** 营养密度评分 0-10 */
  nutrientDensity?: number | null;

  // === 特殊风险标记 ===
  /** FODMAP 等级（IBS 风险） */
  fodmapLevel?: 'low' | 'medium' | 'high' | null;
  /** 草酸等级（肾结石风险） */
  oxalateLevel?: 'low' | 'medium' | 'high' | null;
  /** V5.1: 嘌呤（mg/100g, 0-2000）— 数值型对齐 FIELD_DESC，兼容旧字符串等级 */
  purine?: number | 'low' | 'medium' | 'high' | null;

  // === 安全 ===
  /** 过敏原（Big-9） */
  allergens?: string[];
  /** 标签 */
  tags?: string[];

  // === 烹饪/实用 ===
  /** 烹饪方式 */
  cookingMethods?: string[];
  /** 主要成分列表 */
  ingredientList?: string[];

  // === 分类细化（V5.1: 对齐 FIELD_DESC）===
  /** V5.1: 子分类编码（小写英文，如 white_rice/chicken_breast） */
  subCategory?: string | null;
  /** V5.1: 食物组编码（小写英文，如 whole_grain/leafy_green） */
  foodGroup?: string | null;
  /** V5.1: 菜系（小写英文，如 chinese/japanese） */
  cuisine?: string | null;

  // === 食物库对齐字段 ===
  /** 食物形态（ingredient=单一食材, dish=成品菜品, semi_prepared=半成品） */
  foodForm?: 'ingredient' | 'dish' | 'semi_prepared';
  /** V5.1: 菜品类别（小写英文，如 stir_fry/soup/salad） */
  dishType?: string | null;
  /** V5.1: 主要食材（英文名，如 chicken/rice/tofu） */
  mainIngredient?: string | null;
  /** V5.1: 质地标签（如 crispy/tender/chewy） */
  textureTags?: string[];
  /** 常见份量规格（最多3个） */
  commonPortions?: Array<{ name: string; grams: number }>;
  /** 推荐优先级 0-100 */
  dishPriority?: number;
  /** 风味画像（来自食物库匹配） */
  flavorProfile?: string;
  /** 搭配关系（来自食物库匹配） */
  compatibility?: Record<string, string[]>;
}

/** 汇总营养数据（per-serving 换算后累加值，由 nutrition-aggregator 计算） */
export interface NutritionTotals {
  /** 总热量（千卡） */
  calories: number;
  /** 总蛋白质（克） */
  protein: number;
  /** 总脂肪（克） */
  fat: number;
  /** 总碳水化合物（克） */
  carbs: number;
  /** 总膳食纤维（克） */
  fiber?: number;
  /** 总钠（毫克） */
  sodium?: number;
  /** 总饱和脂肪（克） */
  saturatedFat?: number;
  /** 总添加糖（克） */
  addedSugar?: number;
  /** V4.6: 总糖（克） */
  sugar?: number;
  /** V4.6: 总反式脂肪（克） */
  transFat?: number;
  /** V4.6: 总胆固醇（mg） */
  cholesterol?: number;
}

/** 综合评分 */
export interface AnalysisScore {
  /** 健康评分（0-100） */
  healthScore: number;
  /** 营养评分（0-100） */
  nutritionScore: number;
  /** 置信度评分（0-100，综合识别和估算的可信度） */
  confidenceScore: number;
  /** 8维评分分解 */
  breakdown?: {
    energy: number;
    proteinRatio: number;
    macroBalance: number;
    foodQuality: number;
    satiety: number;
    stability: number;
    glycemicImpact: number;
    /** 每餐决策质量综合分 */
    mealQuality?: number;
  };
}

/** 替代方案定量对比 */
export interface AlternativeComparison {
  /** 热量差（替代 - 原始，负值表示更低） */
  caloriesDiff: number;
  /** 蛋白质差（替代 - 原始，正值表示更高） */
  proteinDiff: number;
  /** 评分差（替代 - 原始） */
  scoreDiff?: number;
}

/** 替代食物建议 */
export interface FoodAlternative {
  /** 替代食物名称 */
  name: string;
  /** 推荐替代的原因 */
  reason: string;
  /** 标准食物库 ID（来自推荐引擎时） */
  foodLibraryId?: string;
  /** 推荐引擎打分 0-1 */
  score?: number;
  /** 定量对比（替代 vs 原始食物） */
  comparison?: AlternativeComparison;
  /** 来源标记 */
  source?: 'engine' | 'static';
  /** 推荐场景标记 */
  scenarioType?: 'takeout' | 'convenience' | 'homeCook' | 'standard';
  /** 替代方案质量评分（0-1，越高越优先推荐） */
  rankScore?: number;
  /** 质量评分理由 */
  rankReasons?: string[];
}

/** 宏量营养素进度 */
export interface MacroProgressItem {
  consumed: number;
  target: number;
  percent: number;
}

export interface MacroProgress {
  calories: MacroProgressItem;
  protein: MacroProgressItem;
  fat: MacroProgressItem;
  carbs: MacroProgressItem;
}

/** 饮食问题识别 */
export interface DietIssue {
  /** 问题分类 */
  category:
    | 'calorie_excess'
    | 'protein_deficit'
    | 'fat_excess'
    | 'carb_excess'
    | 'late_night'
    | 'allergen'
    | 'restriction'
    | 'health_risk'
    | 'low_quality'
    | 'meal_balance'
    | 'binge_risk'
    | 'cumulative_excess'
    | 'multi_day_excess'
    | 'pre_meal_risk'
    | 'post_meal_consequence';
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 人类可读描述 */
  message: string;
  /** 可执行的改善建议 */
  actionable?: string;
  /** 附加数据 */
  data?: Record<string, number | string>;
}
