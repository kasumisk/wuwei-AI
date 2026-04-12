import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
} from '../../user/user.types';

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
