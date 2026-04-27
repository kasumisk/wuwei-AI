// Enums and types extracted from entity files for use after TypeORM removal

/**
 * 匹配类型
 */
export enum MatchType {
  /** 精确匹配标准名 */
  EXACT = 'exact',
  /** 别名匹配 */
  ALIAS = 'alias',
  /** 语义匹配（文本链路 LLM 归一） */
  SEMANTIC = 'semantic',
  /** 视觉猜测（图片链路 AI 识别） */
  VISION_GUESS = 'vision_guess',
}

/**
 * 分析记录状态
 */
export enum AnalysisRecordStatus {
  /** 分析完成 */
  COMPLETED = 'completed',
  /** 分析失败 */
  FAILED = 'failed',
  /** 部分成功（图片分析中部分食物识别成功） */
  PARTIAL = 'partial',
}

/**
 * 入库状态
 */
export enum PersistStatus {
  /** 已关联到标准食物 */
  LINKED = 'linked',
  /** 已创建候选食物 */
  CANDIDATE_CREATED = 'candidate_created',
  /** 忽略（质量不足，不入库） */
  IGNORED = 'ignored',
  /** 待处理 */
  PENDING = 'pending',
}

/**
 * 候选食物来源类型
 */
export enum CandidateSourceType {
  TEXT_ANALYSIS = 'text_analysis',
  IMAGE_ANALYSIS = 'image_analysis',
}

/**
 * 食物分类枚举 (国际化英文编码)
 */
export enum FoodCategory {
  PROTEIN = 'protein',
  GRAIN = 'grain',
  VEGGIE = 'veggie',
  FRUIT = 'fruit',
  DAIRY = 'dairy',
  FAT = 'fat',
  BEVERAGE = 'beverage',
  SNACK = 'snack',
  CONDIMENT = 'condiment',
  COMPOSITE = 'composite',
}

/**
 * 食物状态枚举
 */
export enum FoodStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  MERGED = 'merged',
}

/**
 * V7.3: 食物形态类型
 * - ingredient: 原材料（如鸡胸肉、白米饭）
 * - dish: 成品菜（如宫保鸡丁、红烧肉）
 * - semi_prepared: 半成品（如速冻饺子、即食燕麦）
 */
export type FoodForm = 'ingredient' | 'dish' | 'semi_prepared';

/**
 * FoodLibrary 接口 — 镜像 TypeORM 实体的 camelCase 属性
 * 纯 TypeScript 类型，用于替代 Prisma 生成的 snake_case 类型
 */
export interface FoodLibrary {
  id: string;
  code: string;
  name: string;
  aliases?: string;
  barcode?: string;
  status: string;
  category: string;
  subCategory?: string;
  foodGroup?: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  addedSugar?: number;
  naturalSugar?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;
  sodium?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  vitaminE?: number;
  vitaminB12?: number;
  /** V7.5: 维生素 B6，单位 mg */
  vitaminB6?: number;
  folate?: number;
  zinc?: number;
  magnesium?: number;
  purine?: number;
  phosphorus?: number;

  // ─── V7.4 Phase 3-A: 精细化营养字段 ───

  /** V7.4: Omega-3 脂肪酸 (EPA+DHA+ALA)，单位 mg */
  omega3?: number;
  /** V7.4: Omega-6 脂肪酸 (亚油酸为主)，单位 mg */
  omega6?: number;
  /** V7.4: 可溶性膳食纤维，单位 g */
  solubleFiber?: number;
  /** V7.4: 不可溶性膳食纤维，单位 g */
  insolubleFiber?: number;

  cuisine?: string;
  flavorProfile?: {
    spicy?: number;
    sweet?: number;
    salty?: number;
    sour?: number;
    umami?: number;
    bitter?: number;
  };
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  skillRequired?: string;
  estimatedCostLevel?: number;
  shelfLifeDays?: number;
  /** V7.5: 含水率百分比 (0-100)，用于水分摄入评估 */
  waterContentPercent?: number;
  fodmapLevel?: string;
  oxalateLevel?: string;
  glycemicIndex?: number;
  glycemicLoad?: number;
  isProcessed: boolean;
  isFried: boolean;
  processingLevel: number;
  allergens: string[];
  qualityScore?: number;
  satietyScore?: number;
  nutrientDensity?: number;
  mealTypes: string[];
  tags: string[];
  mainIngredient?: string;
  compatibility: Record<string, string[]>;
  standardServingG: number;
  standardServingDesc?: string;
  commonPortions: Array<{ name: string; grams: number }>;
  imageUrl?: string;
  thumbnailUrl?: string;
  primarySource: string;
  primarySourceId?: string;
  dataVersion: number;
  confidence: number;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  searchWeight: number;
  popularity: number;
  /** V8.2: 嵌入向量（运行时缓存字段，DB 中已迁移到 food_embeddings 表） */
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
  /** V6.4 Phase 3.3: 可获取渠道列表 */
  availableChannels?: string[];
  /** V6.5: 大众化评分 0-100，0=极罕见, 50=一般, 100=日常必备 */
  commonalityScore: number;

  // ─── V7.1 Phase 1-B: 食物模型现实化扩展 ───

  /** V7.1: 多种可行烹饪方式（首元素为主要烹饪方式） */
  cookingMethods?: string[];
  /** V7.1: 所需设备列表（oven, microwave, air_fryer, steamer, wok, none） */
  requiredEquipment?: string[];
  /** V7.1: 建议食用温度（hot, warm, cold, room_temp） */
  servingTemperature?: string;
  /** V7.1: 口感标签（crispy, creamy, chewy, soft, crunchy） */
  textureTags?: string[];
  /** V7.1: 完整食材清单（扩展单一 mainIngredient，为空时回退到 mainIngredient） */
  ingredientList?: string[];
  /** V7.1: 成品类型（dish, soup, drink, dessert, snack, staple） */
  dishType?: string;

  // ─── V7.3 Phase 1-A: 食物大众化扩展 ───

  /** V7.3: 食物形态 (ingredient=原材料如鸡胸肉, dish=成品菜如宫保鸡丁, semi_prepared=半成品如速冻饺子) */
  foodForm?: FoodForm;
  /** V7.3: 成品菜推荐优先级 (0-100, 仅dish/semi_prepared有值, 用于推荐排序偏好) */
  dishPriority?: number;

  // ─── V7.4 Phase 1-B: 食物可获得性 ───

  /** V7.4: 食物可获得性难度 (1=随处可得, 2=常见, 3=普通, 4=较难, 5=稀有) */
  acquisitionDifficulty?: number;
}

// ─── V7.0 Phase 1-D: 类型辅助视图 ───

/**
 * V7.0: 营养数据视图
 *
 * 从 FoodLibrary 70+ 字段中提取营养相关字段的强类型子集。
 * 用于需要精确营养数据但不需要全量 FoodLibrary 的场景
 * （如 NutritionTarget 计算、替换食物营养接近度比较）。
 */
export interface FoodNutritionView {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sugar: number;
  addedSugar: number;
  naturalSugar: number;
  saturatedFat: number;
  transFat: number;
  cholesterol: number;
  sodium: number;
  potassium: number;
  calcium: number;
  iron: number;
  vitaminA: number;
  vitaminC: number;
  vitaminD: number;
  vitaminE: number;
  vitaminB12: number;
  folate: number;
  zinc: number;
  magnesium: number;
  purine: number;
  phosphorus: number;
  glycemicIndex: number;
  glycemicLoad: number;
  // V7.4 Phase 3-A: 精细化营养字段
  omega3: number;
  omega6: number;
  solubleFiber: number;
  insolubleFiber: number;
}

/**
 * V7.0: 烹饪数据视图
 *
 * 从 FoodLibrary 提取烹饪/可执行性相关字段。
 * 用于 RealisticFilter、SceneResolver 等需要评估食物可执行性的场景。
 */
export interface FoodCookingView {
  cookingMethods: string[];
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  skillRequired: string;
  estimatedCostLevel: number;
  isProcessed: boolean;
  isFried: boolean;
  processingLevel: number;
  // V7.1 Phase 1-B: 烹饪视图扩展
  requiredEquipment: string[];
  servingTemperature: string;
  dishType: string;
}

/**
 * V7.0: 元数据视图
 *
 * 从 FoodLibrary 提取数据质量/来源相关字段。
 * 用于数据管理、质量审计等场景。
 */
export interface FoodMetaView {
  primarySource: string;
  primarySourceId: string;
  dataVersion: number;
  confidence: number;
  isVerified: boolean;
  verifiedBy: string;
  verifiedAt: Date | null;
  searchWeight: number;
  popularity: number;
}

/**
 * V7.0: 从 FoodLibrary 提取营养数据视图
 *
 * 所有 optional/undefined 字段安全转换为 number（默认 0）。
 */
export function extractNutrition(food: FoodLibrary): FoodNutritionView {
  return {
    calories: food.calories || 0,
    protein: Number(food.protein) || 0,
    fat: Number(food.fat) || 0,
    carbs: Number(food.carbs) || 0,
    fiber: Number(food.fiber) || 0,
    sugar: Number(food.sugar) || 0,
    addedSugar: Number(food.addedSugar) || 0,
    naturalSugar: Number(food.naturalSugar) || 0,
    saturatedFat: Number(food.saturatedFat) || 0,
    transFat: Number(food.transFat) || 0,
    cholesterol: Number(food.cholesterol) || 0,
    sodium: Number(food.sodium) || 0,
    potassium: Number(food.potassium) || 0,
    calcium: Number(food.calcium) || 0,
    iron: Number(food.iron) || 0,
    vitaminA: Number(food.vitaminA) || 0,
    vitaminC: Number(food.vitaminC) || 0,
    vitaminD: Number(food.vitaminD) || 0,
    vitaminE: Number(food.vitaminE) || 0,
    vitaminB12: Number(food.vitaminB12) || 0,
    folate: Number(food.folate) || 0,
    zinc: Number(food.zinc) || 0,
    magnesium: Number(food.magnesium) || 0,
    purine: Number(food.purine) || 0,
    phosphorus: Number(food.phosphorus) || 0,
    glycemicIndex: Number(food.glycemicIndex) || 0,
    glycemicLoad: Number(food.glycemicLoad) || 0,
    // V7.4 Phase 3-A: 精细化营养字段
    omega3: Number(food.omega3) || 0,
    omega6: Number(food.omega6) || 0,
    solubleFiber: Number(food.solubleFiber) || 0,
    insolubleFiber: Number(food.insolubleFiber) || 0,
  };
}

/**
 * V7.0: 从 FoodLibrary 提取烹饪数据视图
 */
export function extractCooking(food: FoodLibrary): FoodCookingView {
  return {
    cookingMethods: food.cookingMethods ?? [],
    prepTimeMinutes: Number(food.prepTimeMinutes) || 0,
    cookTimeMinutes: Number(food.cookTimeMinutes) || 0,
    skillRequired: food.skillRequired || 'beginner',
    estimatedCostLevel: Number(food.estimatedCostLevel) || 1,
    isProcessed: food.isProcessed,
    isFried: food.isFried,
    processingLevel: food.processingLevel,
    // V7.1: 扩展字段（为空时提供合理默认）
    requiredEquipment: food.requiredEquipment ?? [],
    servingTemperature: food.servingTemperature ?? 'hot',
    dishType: food.dishType ?? 'dish',
  };
}

/**
 * V7.0: 从 FoodLibrary 提取元数据视图
 */
export function extractMeta(food: FoodLibrary): FoodMetaView {
  return {
    primarySource: food.primarySource,
    primarySourceId: food.primarySourceId || '',
    dataVersion: food.dataVersion,
    confidence: food.confidence,
    isVerified: food.isVerified,
    verifiedBy: food.verifiedBy || '',
    verifiedAt: food.verifiedAt || null,
    searchWeight: food.searchWeight,
    popularity: food.popularity,
  };
}

// ─── V8.0: AI 补全预览类型定义 ──────────────────────────────────────────

/**
 * 单字段差异对比
 */
export interface EnrichmentFieldDiff {
  /** 字段名（数据库列名） */
  field: string;
  /** 中文标签 */
  label: string;
  /** 当前值（null 表示缺失） */
  currentValue: any;
  /** AI 建议值 */
  suggestedValue: any;
  /** 单位（如 g/100g, mg/100g） */
  unit: string;
  /** 合法范围（仅数值型字段） */
  validRange: { min: number; max: number } | null;
}

/**
 * 补全预览完整响应
 */
export interface EnrichmentPreview {
  /** 当前食物基本信息 */
  food: {
    id: string;
    name: string;
    name_zh: string | null;
    category: string | null;
    subCategory: string | null;
  };
  /** AI 暂存记录信息 */
  staged: {
    logId: string;
    changes: Record<string, any>;
    confidence: number;
    target: string;
    stage: number | null;
    createdAt: Date;
  };
  /** 逐字段差异对比 */
  diff: EnrichmentFieldDiff[];
  /** 同类食物平均值参考（仅数值型字段） */
  categoryAverage: Record<string, number> | null;
}

/**
 * 补全字段中文标签映射
 */
export const ENRICHMENT_FIELD_LABELS: Record<string, string> = {
  protein: '蛋白质',
  fat: '脂肪',
  carbs: '碳水化合物',
  fiber: '膳食纤维',
  sugar: '糖',
  addedSugar: '添加糖',
  naturalSugar: '天然糖',
  sodium: '钠',
  calcium: '钙',
  iron: '铁',
  potassium: '钾',
  cholesterol: '胆固醇',
  vitaminA: '维生素A',
  vitaminC: '维生素C',
  vitaminD: '维生素D',
  vitaminE: '维生素E',
  vitaminB12: '维生素B12',
  vitaminB6: '维生素B6',
  folate: '叶酸',
  zinc: '锌',
  magnesium: '镁',
  saturatedFat: '饱和脂肪',
  transFat: '反式脂肪',
  purine: '嘌呤',
  phosphorus: '磷',
  omega3: 'Omega-3脂肪酸',
  omega6: 'Omega-6脂肪酸',
  solubleFiber: '可溶性膳食纤维',
  insolubleFiber: '不可溶性膳食纤维',
  waterContentPercent: '水分含量',
  glycemicIndex: '血糖指数(GI)',
  glycemicLoad: '血糖负荷(GL)',
  fodmapLevel: 'FODMAP等级',
  oxalateLevel: '草酸等级',
  processingLevel: '加工程度',
  subCategory: '子分类',
  foodGroup: '食物组',
  cuisine: '菜系',
  cookingMethods: '烹饪方式',
  mealTypes: '适合餐次',
  allergens: '过敏原',
  tags: '标签',
  commonPortions: '常见份量',
  qualityScore: '品质评分',
  satietyScore: '饱腹感评分',
  nutrientDensity: '营养密度',
  commonalityScore: '大众化程度',
  standardServingDesc: '标准份量描述',
  mainIngredient: '主要原料',
  flavorProfile: '风味画像',
  // V8.0: 扩展属性标签
  ingredientList: '食材清单',
  textureTags: '口感标签',
  dishType: '成品类型',
  prepTimeMinutes: '备料时间',
  cookTimeMinutes: '烹饪时间',
  skillRequired: '烹饪技能要求',
  estimatedCostLevel: '预估成本等级',
  shelfLifeDays: '保质期',
  servingTemperature: '食用温度',
  dishPriority: '推荐优先级',
  acquisitionDifficulty: '可获得性难度',
  compatibility: '搭配关系',
  availableChannels: '可获取渠道',
  // V8.2: 新增字段标签
  foodForm: '食物形态',
  requiredEquipment: '所需设备',
};

/**
 * 补全字段单位映射
 */
export const ENRICHMENT_FIELD_UNITS: Record<string, string> = {
  protein: 'g/100g',
  fat: 'g/100g',
  carbs: 'g/100g',
  fiber: 'g/100g',
  sugar: 'g/100g',
  addedSugar: 'g/100g',
  naturalSugar: 'g/100g',
  sodium: 'mg/100g',
  calcium: 'mg/100g',
  iron: 'mg/100g',
  potassium: 'mg/100g',
  cholesterol: 'mg/100g',
  vitaminA: 'μg/100g',
  vitaminC: 'mg/100g',
  vitaminD: 'μg/100g',
  vitaminE: 'mg/100g',
  vitaminB12: 'μg/100g',
  vitaminB6: 'mg/100g',
  folate: 'μg/100g',
  zinc: 'mg/100g',
  magnesium: 'mg/100g',
  saturatedFat: 'g/100g',
  transFat: 'g/100g',
  purine: 'mg/100g',
  phosphorus: 'mg/100g',
  omega3: 'mg/100g',
  omega6: 'mg/100g',
  solubleFiber: 'g/100g',
  insolubleFiber: 'g/100g',
  waterContentPercent: '%',
  glycemicIndex: '',
  glycemicLoad: '',
  fodmapLevel: '',
  oxalateLevel: '',
  processingLevel: '级(1-4)',
  qualityScore: '分(0-10)',
  satietyScore: '分(0-10)',
  nutrientDensity: '分(0-100)',
  commonalityScore: '分(0-100)',
  // V8.0: 扩展属性单位
  prepTimeMinutes: '分钟',
  cookTimeMinutes: '分钟',
  estimatedCostLevel: '级(1-5)',
  shelfLifeDays: '天',
  dishPriority: '分(0-100)',
  acquisitionDifficulty: '级(1-5)',
};
