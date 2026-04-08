import { IsString, IsOptional, IsNumber, IsEnum, IsArray, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchFoodDto {
  @ApiProperty({ description: '搜索关键词' })
  @IsString()
  keyword: string;

  @ApiPropertyOptional({ description: '分类过滤' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class CreateFoodDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiProperty()
  @IsNumber()
  calories: number;

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
  fiber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  foodGroup?: string;

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
  @IsNumber()
  processingLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  allergens?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  mealTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primarySource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  standardServingG?: number;
}

export class UpdateFoodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  calories?: number;

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
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  mealTypes?: string[];
}
