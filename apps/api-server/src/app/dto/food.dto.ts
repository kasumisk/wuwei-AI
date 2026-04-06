import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '../../entities/food-record.entity';
import { ActivityLevel } from '../../entities/user-profile.entity';

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
}

// ========== Food Records ==========

export class SaveFoodRecordDto {
  @ApiPropertyOptional({ description: '分析后的 requestId（用于关联暂存结果）' })
  @IsOptional()
  @IsString()
  requestId?: string;

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

// ========== User Profile ==========

export class SaveUserProfileDto {
  @ApiPropertyOptional({ enum: ['male', 'female'] })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1940)
  @Max(2020)
  birthYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(250)
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(300)
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(300)
  targetWeightKg?: number;

  @ApiPropertyOptional({ enum: ActivityLevel })
  @IsOptional()
  @IsEnum(ActivityLevel)
  activityLevel?: ActivityLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(800)
  @Max(5000)
  dailyCalorieGoal?: number;
}
