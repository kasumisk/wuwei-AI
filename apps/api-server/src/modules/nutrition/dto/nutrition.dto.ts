import { IsString, IsOptional, IsNumber, IsEnum, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType, RecordSource } from '../entities/food-record.entity';

export class CreateFoodRecordDto {
  @ApiPropertyOptional({ description: '图片URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: RecordSource })
  @IsOptional()
  @IsEnum(RecordSource)
  source?: RecordSource;

  @ApiProperty({ description: '食物列表' })
  @IsArray()
  foods: Array<{
    name: string;
    calories: number;
    quantity?: string;
    category?: string;
    protein?: number;
    fat?: number;
    carbs?: number;
    quality?: number;
    satiety?: number;
  }>;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  mealType: MealType;
}

export class QueryRecordsDto {
  @ApiPropertyOptional({ description: '日期 YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}
