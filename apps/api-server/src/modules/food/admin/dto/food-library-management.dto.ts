import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsArray,
  IsObject,
  Min,
  Max,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

// ==================== 查询 DTO ====================

export class GetFoodLibraryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: '关键词搜索（模糊匹配 name/aliases/code）',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: '按名称模糊搜索（与 keyword 等效，兼容 ProTable 列搜索）',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '按食物编码模糊搜索' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isVerified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primarySource?: string;

  @ApiPropertyOptional({ description: 'V8.0: 最小数据完整度（0-100）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minCompleteness?: number;

  @ApiPropertyOptional({ description: 'V8.0: 最大数据完整度（0-100）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxCompleteness?: number;

  @ApiPropertyOptional({
    description: 'V8.0: 补全状态筛选（pending/partial/completed/failed）',
  })
  @IsOptional()
  @IsString()
  enrichmentStatus?: string;

  @ApiPropertyOptional({
    description:
      'V8.1: 按指定字段为空筛选（如 missingField=protein，只返回蛋白质字段为空的食物）',
    example: 'protein',
  })
  @IsOptional()
  @IsString()
  missingField?: string;

  @ApiPropertyOptional({
    description:
      'V8.1: 多字段缺失组合筛选，逗号分隔（如 missingFields=protein,fat,carbs，返回同时缺少这些字段的食物）',
    example: 'protein,fat,carbs',
  })
  @IsOptional()
  @IsString()
  missingFields?: string;

  @ApiPropertyOptional({
    description: 'V8.1: 食物整体审核状态筛选（pending/approved/rejected）',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  reviewStatus?: string;

  @ApiPropertyOptional({
    description:
      'V8.1: 按补全失败字段筛选（如 failedField=protein，只返回蛋白质字段补全失败的食物）',
    example: 'protein',
  })
  @IsOptional()
  @IsString()
  failedField?: string;

  @ApiPropertyOptional({
    description:
      'V8.1: 排序字段（data_completeness/confidence/created_at/updated_at/search_weight）',
    example: 'data_completeness',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'V8.1: 排序方向（asc/desc），默认 desc',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: string;
}

// ==================== 食物 CRUD DTO ====================

export class CreateFoodLibraryDto {
  // ─── 基本信息 ──────────────────────────────────────────────────────────

  @ApiProperty({ description: '食物编码，全局唯一（如 CN_RICE_WHITE_COOKED）' })
  @IsString()
  code: string;

  @ApiProperty({ description: '食物标准中文名，全局唯一' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: '别名/俗称，逗号分隔（如"米饭,白饭,蒸米"）',
  })
  @IsOptional()
  @IsString()
  aliases?: string;

  @ApiPropertyOptional({ description: '商品条形码（EAN-13 / UPC）' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({
    description: '生命周期状态',
    enum: ['draft', 'active', 'archived', 'merged'],
    default: 'draft',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({
    description: '一级分类',
    example: 'grain',
  })
  @IsString()
  category: string;

  @ApiPropertyOptional({ description: '二级分类（如 grain → white_rice）' })
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional({ description: '食物组（如 USDA 食物组分类）' })
  @IsOptional()
  @IsString()
  foodGroup?: string;

  @ApiPropertyOptional({
    description:
      '食物形态：ingredient=原材料, dish=成品菜, semi_prepared=半成品',
    enum: ['ingredient', 'dish', 'semi_prepared'],
    default: 'ingredient',
  })
  @IsOptional()
  @IsString()
  foodForm?: string;

  @ApiPropertyOptional({
    description: '成品菜推荐优先级 0-100，仅 dish/semi_prepared 有值',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  dishPriority?: number;

  // ─── 宏量营养素（per 100g 可食部分）──────────────────────────────────

  @ApiProperty({ description: '热量，单位 kcal' })
  @Type(() => Number)
  @IsNumber()
  calories: number;

  @ApiPropertyOptional({ description: '蛋白质，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  protein?: number;

  @ApiPropertyOptional({ description: '脂肪总量，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fat?: number;

  @ApiPropertyOptional({ description: '碳水化合物，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  carbs?: number;

  @ApiPropertyOptional({ description: '膳食纤维，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fiber?: number;

  @ApiPropertyOptional({ description: '总糖（添加糖 + 天然糖），单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sugar?: number;

  @ApiPropertyOptional({ description: '添加糖，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  addedSugar?: number;

  @ApiPropertyOptional({ description: '天然糖，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  naturalSugar?: number;

  @ApiPropertyOptional({ description: '饱和脂肪，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  saturatedFat?: number;

  @ApiPropertyOptional({ description: '反式脂肪，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  transFat?: number;

  @ApiPropertyOptional({ description: '胆固醇，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cholesterol?: number;

  // ─── 微量营养素（per 100g）────────────────────────────────────────────

  @ApiPropertyOptional({ description: '钠，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sodium?: number;

  @ApiPropertyOptional({ description: '钾，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  potassium?: number;

  @ApiPropertyOptional({ description: '钙，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  calcium?: number;

  @ApiPropertyOptional({ description: '铁，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  iron?: number;

  @ApiPropertyOptional({ description: '维生素 A，单位 μg RAE' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminA?: number;

  @ApiPropertyOptional({ description: '维生素 C，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminC?: number;

  @ApiPropertyOptional({ description: '维生素 D，单位 μg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminD?: number;

  @ApiPropertyOptional({ description: '维生素 E，单位 mg α-TE' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminE?: number;

  @ApiPropertyOptional({ description: '维生素 B12，单位 μg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminB12?: number;

  @ApiPropertyOptional({ description: '叶酸，单位 μg DFE' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  folate?: number;

  @ApiPropertyOptional({ description: '锌，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  zinc?: number;

  @ApiPropertyOptional({ description: '镁，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  magnesium?: number;

  @ApiPropertyOptional({ description: '磷，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  phosphorus?: number;

  @ApiPropertyOptional({ description: '嘌呤，单位 mg（痛风饮食管理关键字段）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  purine?: number;

  // ─── V7.9 新增微量营养素 ─────────────────────────────────────────────

  @ApiPropertyOptional({ description: '维生素 B6，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminB6?: number;

  @ApiPropertyOptional({ description: 'Omega-3 脂肪酸，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  omega3?: number;

  @ApiPropertyOptional({ description: 'Omega-6 脂肪酸，单位 mg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  omega6?: number;

  @ApiPropertyOptional({ description: '可溶性膳食纤维，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  solubleFiber?: number;

  @ApiPropertyOptional({ description: '不溶性膳食纤维，单位 g' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  insolubleFiber?: number;

  @ApiPropertyOptional({ description: '含水率百分比（0-100）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  waterContentPercent?: number;

  // ─── 健康评估 ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: '血糖生成指数 GI（0-100，>70 为高 GI）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  glycemicIndex?: number;

  @ApiPropertyOptional({ description: '血糖负荷 GL = GI × 碳水 / 100' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  glycemicLoad?: number;

  @ApiPropertyOptional({ description: '是否为加工食品' })
  @IsOptional()
  @IsBoolean()
  isProcessed?: boolean;

  @ApiPropertyOptional({ description: '是否为油炸食品' })
  @IsOptional()
  @IsBoolean()
  isFried?: boolean;

  @ApiPropertyOptional({
    description:
      '加工程度 1-4（1=未加工, 2=轻加工, 3=中度加工, 4=深度加工/超加工）',
    minimum: 1,
    maximum: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  processingLevel?: number;

  @ApiPropertyOptional({
    description: 'FODMAP 含量等级：low/medium/high',
    enum: ['low', 'medium', 'high'],
  })
  @IsOptional()
  @IsString()
  fodmapLevel?: string;

  @ApiPropertyOptional({
    description: '草酸含量等级：low/medium/high',
    enum: ['low', 'medium', 'high'],
  })
  @IsOptional()
  @IsString()
  oxalateLevel?: string;

  @ApiPropertyOptional({
    description:
      '过敏原列表（标准值：gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  // ─── 标签与推荐决策 ──────────────────────────────────────────────────

  @ApiPropertyOptional({
    description:
      '综合品质分 1-10（营养密度 × 加工程度 × 食材天然性的综合评估）',
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  qualityScore?: number;

  @ApiPropertyOptional({
    description: '饱腹感评分 1-10',
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  satietyScore?: number;

  @ApiPropertyOptional({
    description: '营养密度评分（单位热量中营养价值的综合评分）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  nutrientDensity?: number;

  @ApiPropertyOptional({
    description: '适用餐次（如 ["breakfast","lunch","dinner","snack"]）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mealTypes?: string[];

  @ApiPropertyOptional({
    description: '自由标签（如 ["低卡","高蛋白","减脂友好"]）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** @deprecated 请优先使用 ingredientList（V7.1 起支持多食材） */
  @ApiPropertyOptional({
    description: '主要食材（单个，如"猪肉"）；多食材请使用 ingredientList',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  mainIngredient?: string;

  @ApiPropertyOptional({
    description: '完整食材清单（V7.1，如 ["猪肉","大葱","生姜"]）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredientList?: string[];

  @ApiPropertyOptional({
    description: '食材兼容性映射（如 {"avoid":["红酒"],"pair_well":["豆腐"]}）',
  })
  @IsOptional()
  @IsObject()
  compatibility?: Record<string, string[]>;

  @ApiPropertyOptional({
    description: '可获取渠道（home_cook/restaurant/delivery/convenience）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableChannels?: string[];

  @ApiPropertyOptional({
    description: '大众化评分 0-100（0=极罕见, 50=一般, 100=日常必备）',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  commonalityScore?: number;

  // ─── 份量信息 ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description: '标准份量，单位 g（默认 100g）',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  standardServingG?: number;

  @ApiPropertyOptional({ description: '标准份量文字描述（如"1碗(200g)"）' })
  @IsOptional()
  @IsString()
  standardServingDesc?: string;

  @ApiPropertyOptional({
    description: '常见份量预设（如 [{"name":"1碗","grams":200}]）',
  })
  @IsOptional()
  @IsArray()
  commonPortions?: Array<{ name: string; grams: number }>;

  // ─── 烹饪与风味 ──────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description: '所属菜系（如 chinese/japanese/western）',
  })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({
    description:
      '风味画像（如 {"salty":4,"sweet":1,"spicy":0,"umami":3}，0-5 分制）',
  })
  @IsOptional()
  @IsObject()
  flavorProfile?: Record<string, number>;

  @ApiPropertyOptional({
    description:
      '可行烹饪方式列表（如 ["steam","boil","stir_fry"]，首元素为主要方式）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cookingMethods?: string[];

  @ApiPropertyOptional({
    description: '所需厨房设备（如 ["oven","wok"]；none=无需特殊设备）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredEquipment?: string[];

  @ApiPropertyOptional({
    description: '建议食用温度：hot/warm/cold/room_temp',
    enum: ['hot', 'warm', 'cold', 'room_temp'],
  })
  @IsOptional()
  @IsString()
  servingTemperature?: string;

  @ApiPropertyOptional({
    description: '口感标签（如 ["crispy","chewy"]）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  textureTags?: string[];

  @ApiPropertyOptional({
    description: '成品类型：dish/soup/drink/dessert/snack/staple',
    enum: ['dish', 'soup', 'drink', 'dessert', 'snack', 'staple'],
  })
  @IsOptional()
  @IsString()
  dishType?: string;

  @ApiPropertyOptional({ description: '备料时间，单位分钟' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  prepTimeMinutes?: number;

  @ApiPropertyOptional({ description: '烹饪时间，单位分钟' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cookTimeMinutes?: number;

  @ApiPropertyOptional({
    description: '烹饪难度：easy/medium/hard',
    enum: ['easy', 'medium', 'hard'],
  })
  @IsOptional()
  @IsString()
  skillRequired?: string;

  @ApiPropertyOptional({
    description: '成本等级 1-5（1=极低/食堂价, 3=中等/家常价, 5=高端/餐厅价）',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  estimatedCostLevel?: number;

  @ApiPropertyOptional({ description: '保质期，单位天（0 表示当日食用）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shelfLifeDays?: number;

  @ApiPropertyOptional({
    description: '获取难度 1-5（1=超市随时可得, 3=需专门采购, 5=极难获取）',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  acquisitionDifficulty?: number;

  // ─── 媒体资源 ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: '食物完整图片 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: '食物缩略图 URL（列表展示用）' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  // ─── 数据溯源与质控 ──────────────────────────────────────────────────

  @ApiPropertyOptional({
    description: '主要数据来源标识（manual/usda/cfsb/ai/import）',
    enum: ['manual', 'usda', 'cfsb', 'ai', 'import'],
    default: 'manual',
  })
  @IsOptional()
  @IsString()
  primarySource?: string;

  @ApiPropertyOptional({
    description: '主要数据来源的原始 ID（如 USDA FDC ID）',
  })
  @IsOptional()
  @IsString()
  primarySourceId?: string;

  @ApiPropertyOptional({
    description: 'AI/算法对该条数据的置信度 0.00-1.00',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  confidence?: number;

  @ApiPropertyOptional({ description: '是否已经过人工或专业机构核验' })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({
    description: '搜索权重（影响列表排序，默认 100）',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  searchWeight?: number;
}

export class UpdateFoodLibraryDto extends PartialType(CreateFoodLibraryDto) {}

export class BatchImportFoodDto {
  @ApiProperty({ type: [CreateFoodLibraryDto] })
  @IsArray()
  foods: CreateFoodLibraryDto[];
}

// ==================== 翻译 DTO ====================

export class CreateFoodTranslationDto {
  @ApiProperty()
  @IsString()
  locale: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aliases?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  servingDesc?: string;
}

export class UpdateFoodTranslationDto extends PartialType(
  CreateFoodTranslationDto,
) {}

// ==================== 数据来源 DTO ====================

export class CreateFoodSourceDto {
  @ApiProperty()
  @IsString()
  sourceType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiProperty()
  @IsObject()
  rawData: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  mappedData?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  confidence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;
}

// ==================== 冲突解决 DTO ====================

export class ResolveFoodConflictDto {
  @ApiProperty()
  @IsString()
  resolution: string;

  @ApiProperty()
  @IsString()
  resolvedValue: string;
}

// ==================== V8.1: 批量更新 review_status DTO ====================

export class BatchReviewStatusDto {
  @ApiProperty({
    description: '食物 ID 数组',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({
    description: '目标审核状态',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsString()
  @IsEnum(['pending', 'approved', 'rejected'])
  reviewStatus: 'pending' | 'approved' | 'rejected';

  @ApiPropertyOptional({ description: '操作原因（可选）' })
  @IsOptional()
  @IsString()
  reason?: string;
}
