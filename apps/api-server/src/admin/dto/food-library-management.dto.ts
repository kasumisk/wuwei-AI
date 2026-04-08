import { IsString, IsOptional, IsInt, IsBoolean, IsNumber, IsArray, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @IsBoolean()
  @Type(() => Boolean)
  isVerified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateFoodLibraryDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aliases?: string;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  caloriesPer100g: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  proteinPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fatPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  carbsPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fiberPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sugarPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sodiumPer100g?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  glycemicIndex?: number;

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
  @IsArray()
  @IsString({ each: true })
  mealTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mainIngredient?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  qualityScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  satietyScore?: number;

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
  @Type(() => Number)
  @IsInt()
  searchWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: ['official', 'estimated', 'ai'] })
  @IsOptional()
  @IsEnum(['official', 'estimated', 'ai'])
  source?: 'official' | 'estimated' | 'ai';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  confidence?: number;
}

export class UpdateFoodLibraryDto extends CreateFoodLibraryDto {
  // 所有字段均可选（继承自 CreateFoodLibraryDto，但都有 @IsOptional）
}

export class BatchImportFoodDto {
  @ApiProperty({ type: [CreateFoodLibraryDto] })
  @IsArray()
  foods: CreateFoodLibraryDto[];
}
