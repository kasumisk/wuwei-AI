import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsUUID,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============ 菜谱食材 DTO ============

class RecipeIngredientDto {
  @ApiPropertyOptional({ description: '关联食物库 ID' })
  @IsOptional()
  @IsUUID()
  foodId?: string;

  @ApiProperty({ description: '食材名称' })
  @IsString()
  ingredientName: string;

  @ApiPropertyOptional({ description: '用量' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: '单位' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '是否可选', default: false })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// ============ 创建菜谱 ============

export class CreateRecipeDto {
  @ApiProperty({ description: '菜谱名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '菜系' })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ description: '难度 1-5', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '准备时间（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  prepTimeMinutes?: number;

  @ApiPropertyOptional({ description: '烹饪时间（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  cookTimeMinutes?: number;

  @ApiPropertyOptional({ description: '份数', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  servings?: number;

  @ApiPropertyOptional({ description: '标签', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '制作步骤 (JSON)' })
  @IsOptional()
  instructions?: any;

  @ApiPropertyOptional({ description: '图片 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: '来源', default: 'ai_generated' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '每份卡路里' })
  @IsOptional()
  @IsNumber()
  caloriesPerServing?: number;

  @ApiPropertyOptional({ description: '每份蛋白质(g)' })
  @IsOptional()
  @IsNumber()
  proteinPerServing?: number;

  @ApiPropertyOptional({ description: '每份脂肪(g)' })
  @IsOptional()
  @IsNumber()
  fatPerServing?: number;

  @ApiPropertyOptional({ description: '每份碳水(g)' })
  @IsOptional()
  @IsNumber()
  carbsPerServing?: number;

  @ApiPropertyOptional({ description: '每份纤维(g)' })
  @IsOptional()
  @IsNumber()
  fiberPerServing?: number;

  @ApiPropertyOptional({ description: '食材列表', type: [RecipeIngredientDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}

// ============ 更新菜谱 ============

export class UpdateRecipeDto {
  @ApiPropertyOptional({ description: '菜谱名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '菜系' })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ description: '难度 1-5' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '准备时间（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  prepTimeMinutes?: number;

  @ApiPropertyOptional({ description: '烹饪时间（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  cookTimeMinutes?: number;

  @ApiPropertyOptional({ description: '份数' })
  @IsOptional()
  @IsInt()
  @Min(1)
  servings?: number;

  @ApiPropertyOptional({ description: '标签', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '制作步骤 (JSON)' })
  @IsOptional()
  instructions?: any;

  @ApiPropertyOptional({ description: '图片 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '每份卡路里' })
  @IsOptional()
  @IsNumber()
  caloriesPerServing?: number;

  @ApiPropertyOptional({ description: '每份蛋白质(g)' })
  @IsOptional()
  @IsNumber()
  proteinPerServing?: number;

  @ApiPropertyOptional({ description: '每份脂肪(g)' })
  @IsOptional()
  @IsNumber()
  fatPerServing?: number;

  @ApiPropertyOptional({ description: '每份碳水(g)' })
  @IsOptional()
  @IsNumber()
  carbsPerServing?: number;

  @ApiPropertyOptional({ description: '每份纤维(g)' })
  @IsOptional()
  @IsNumber()
  fiberPerServing?: number;

  @ApiPropertyOptional({
    description: '食材列表（全量替换）',
    type: [RecipeIngredientDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}

// ============ AI 菜谱生成 ============

export class GenerateRecipesDto {
  @ApiProperty({ description: '菜系（如中餐/粤菜/川菜/日式/西式）' })
  @IsString()
  cuisine: string;

  @ApiProperty({
    description: '目标类型: fat_loss / muscle_gain / health',
    default: 'health',
  })
  @IsString()
  goalType: string;

  @ApiProperty({ description: '生成数量', default: 3 })
  @IsInt()
  @Min(1)
  @Max(30)
  count: number;

  @ApiPropertyOptional({ description: '最大难度 1-5' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxDifficulty?: number;

  @ApiPropertyOptional({ description: '最大烹饪时间（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCookTime?: number;

  @ApiPropertyOptional({
    description: '额外约束（如低钠、高纤维）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  constraints?: string[];
}

// ============ 查询列表 ============

export class GetRecipesQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: '菜系过滤' })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ description: '难度过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  difficulty?: number;

  @ApiPropertyOptional({ description: '来源过滤' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '关键词搜索' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '审核状态过滤' })
  @IsOptional()
  @IsString()
  reviewStatus?: string;
}

export class ReviewRecipeDto {
  @ApiProperty({ description: '审核动作: approved / rejected' })
  @IsString()
  action: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: '审核备注' })
  @IsOptional()
  @IsString()
  note?: string;
}

class ImportRecipeItemDto extends CreateRecipeDto {}

// ============ V6.4: 批量重算质量评分 ============

export class RecalculateScoresDto {
  @ApiPropertyOptional({
    description: '仅重算 quality_score=0 的菜谱',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  onlyZero?: boolean;

  @ApiPropertyOptional({
    description: '每批处理数量',
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  batchSize?: number;
}

export class ImportExternalRecipesDto {
  @ApiProperty({ description: '数据来源类型: takeout / canteen' })
  @IsString()
  sourceType: 'takeout' | 'canteen';

  @ApiPropertyOptional({ description: '地区编码（如 CN-310000）' })
  @IsOptional()
  @IsString()
  regionCode?: string;

  @ApiPropertyOptional({ description: '数据平台名（如 美团/饿了么/食堂系统）' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiProperty({ description: '外部菜品列表', type: [ImportRecipeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRecipeItemDto)
  items: ImportRecipeItemDto[];
}
