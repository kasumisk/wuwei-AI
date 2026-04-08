import { IsString, IsOptional, IsInt, IsBoolean, IsNumber, IsArray, IsObject, Min, Max, IsEnum, ValidateNested } from 'class-validator';
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string;

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
}

// ==================== 食物 CRUD DTO ====================

export class CreateFoodLibraryDto {
  @ApiProperty()
  @IsString()
  code: string;

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
  barcode?: string;

  @ApiPropertyOptional({ enum: ['draft', 'active', 'archived', 'merged'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  foodGroup?: string;

  // 宏量营养素
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  calories: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  protein?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  carbs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fiber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sugar?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  saturatedFat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  transFat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cholesterol?: number;

  // 微量营养素
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sodium?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  potassium?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  calcium?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  iron?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminA?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminC?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminD?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminE?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vitaminB12?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  folate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  zinc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  magnesium?: number;

  // 健康评估
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  glycemicIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  glycemicLoad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isProcessed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFried?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  processingLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  // 决策引擎
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  qualityScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  satietyScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  nutrientDensity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mealTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mainIngredient?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  compatibility?: Record<string, string[]>;

  // 份量
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  standardServingG?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  standardServingDesc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  commonPortions?: Array<{ name: string; grams: number }>;

  // 媒体
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  // 数据溯源
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primarySource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primarySourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  confidence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional()
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

export class UpdateFoodTranslationDto extends PartialType(CreateFoodTranslationDto) {}

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
