import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  IsUUID,
  ValidateNested,
  Min,
  Max,
  IsNumber,
  IsDateString,
  IsIn,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType, RecordSource } from '../../diet.types';

// ========== Analyze ==========

export class AnalyzeImageDto {
  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}

export class FoodItemDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  calories: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quantity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  protein?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  carbs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quality?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  satiety?: number;
}

// ========== Food Records ==========

export class SaveFoodRecordDto {
  @ApiPropertyOptional({
    description: '分析后的 requestId（用于关联暂存结果）',
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  /** V6.1: 关联的分析记录 ID（food_analysis_records.id） */
  @ApiPropertyOptional({
    description: 'V6.1: 关联的分析记录 ID（food_analysis_records.id）',
  })
  @IsOptional()
  @IsUUID()
  analysisId?: string;

  /** V6.1: 记录来源 */
  @ApiPropertyOptional({
    enum: RecordSource,
    description: 'V6.1: 记录来源',
  })
  @IsOptional()
  @IsEnum(RecordSource)
  source?: RecordSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ type: [FoodItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodItemDto)
  foods: FoodItemDto[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  totalCalories: number;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  advice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHealthy?: boolean;

  @ApiPropertyOptional({ description: '记录时间，默认当前' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  // ─── V1: AI 决策字段 ───

  @ApiPropertyOptional({ enum: ['SAFE', 'OK', 'LIMIT', 'AVOID'] })
  @IsOptional()
  @IsIn(['SAFE', 'OK', 'LIMIT', 'AVOID'])
  decision?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  riskLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  suggestion?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  insteadOptions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  compensation?: { diet?: string; activity?: string; nextMeal?: string };

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contextComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  encouragement?: string;

  // ─── V6: 多维营养字段 ───

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalProtein?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalFat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalCarbs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  avgQuality?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  avgSatiety?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  nutritionScore?: number;
}

export class UpdateFoodRecordDto {
  @ApiPropertyOptional({ type: [FoodItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodItemDto)
  foods?: FoodItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalCalories?: number;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  advice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHealthy?: boolean;
}

export class FoodRecordQueryDto {
  @ApiPropertyOptional({ description: '页码，默认1' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数，默认20' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: '查询日期 YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  date?: string;
}

// ========== Food Library ==========

export class AddFromLibraryDto {
  @ApiProperty({ description: '食物库 ID' })
  @IsUUID()
  foodLibraryId: string;

  @ApiProperty({ description: '用户选择的克数' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  servingGrams: number;

  @ApiProperty({ enum: MealType, description: '餐次' })
  @IsEnum(MealType)
  mealType: MealType;
}
