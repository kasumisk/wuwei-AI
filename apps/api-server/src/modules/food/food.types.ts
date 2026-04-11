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
  folate?: number;
  zinc?: number;
  magnesium?: number;
  purine?: number;
  phosphorus?: number;
  cuisine?: string;
  flavorProfile?: {
    spicy?: number;
    sweet?: number;
    salty?: number;
    sour?: number;
    umami?: number;
    bitter?: number;
  };
  cookingMethod?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  skillRequired?: string;
  estimatedCostLevel?: number;
  shelfLifeDays?: number;
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
  embedding?: number[];
  embeddingV5?: string;
  embeddingUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** V6.4 Phase 3.3: 可获取渠道列表 */
  availableChannels?: string[];
  /** V6.5: 大众化评分 0-100，0=极罕见, 50=一般, 100=日常必备 */
  commonalityScore: number;
}
