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
import { MealType } from '../entities/food-record.entity';
import {
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
} from '../../user/entities/user-profile.entity';

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

  // ---- 目标信息 ----

  @ApiPropertyOptional({ enum: GoalType })
  @IsOptional()
  @IsEnum(GoalType)
  goal?: GoalType;

  @ApiPropertyOptional({ enum: GoalSpeed })
  @IsOptional()
  @IsEnum(GoalSpeed)
  goalSpeed?: GoalSpeed;

  @ApiPropertyOptional({ description: '体脂率 %', minimum: 3, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(3)
  @Max(60)
  bodyFatPercent?: number;

  // ---- 饮食习惯 ----

  @ApiPropertyOptional({ description: '每日餐次', minimum: 1, maximum: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  mealsPerDay?: number;

  @ApiPropertyOptional({ enum: ['never', 'sometimes', 'often'] })
  @IsOptional()
  @IsIn(['never', 'sometimes', 'often'])
  takeoutFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canCook?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: '饮食偏好 sweet/fried/carbs/meat/spicy',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foodPreferences?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: '忌口 no_beef/vegetarian/lactose_free/halal',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      '⚠️ 过敏原 milk/eggs/fish/shellfish/tree_nuts/peanuts/wheat/soybeans/sesame/sulfites',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  // ---- 行为习惯 ----

  @ApiPropertyOptional({
    type: [String],
    description: '容易乱吃时段 afternoon/evening/midnight',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  weakTimeSlots?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: '暴食触发 stress/boredom/social/emotion',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bingeTriggers?: string[];

  @ApiPropertyOptional({ enum: Discipline })
  @IsOptional()
  @IsEnum(Discipline)
  discipline?: Discipline;
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
