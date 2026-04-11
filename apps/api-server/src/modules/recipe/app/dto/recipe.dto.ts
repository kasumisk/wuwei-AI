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

/** 搜索菜谱 DTO */
export class SearchRecipesDto {
  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: '菜系过滤' })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ description: '难度过滤 1-5' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '标签过滤（逗号分隔）' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({ description: '最大烹饪时间（分钟）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCookTime?: number;

  @ApiPropertyOptional({ description: '返回条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: '偏移量', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

class SubmitRecipeIngredientDto {
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

/** V6.3 P3-4: 用户提交 UGC 菜谱 DTO */
export class SubmitRecipeDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '准备时间（分钟）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  prepTimeMinutes?: number;

  @ApiPropertyOptional({ description: '烹饪时间（分钟）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cookTimeMinutes?: number;

  @ApiPropertyOptional({ description: '份数', default: 1 })
  @IsOptional()
  @Type(() => Number)
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
    description: '食材列表',
    type: [SubmitRecipeIngredientDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitRecipeIngredientDto)
  ingredients?: SubmitRecipeIngredientDto[];
}

/** V6.5 Phase 2M: 用户对菜谱评分 DTO */
export class RateRecipeDto {
  @ApiProperty({ description: '评分 1-5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: '评价内容' })
  @IsOptional()
  @IsString()
  comment?: string;
}
