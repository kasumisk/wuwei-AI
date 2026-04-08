import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityLevel, GoalType, GoalSpeed, Discipline } from '../entities/user-profile.entity';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  birthYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(250)
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(300)
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetWeightKg?: number;

  @ApiPropertyOptional({ enum: ActivityLevel })
  @IsOptional()
  @IsEnum(ActivityLevel)
  activityLevel?: ActivityLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  dailyCalorieGoal?: number;

  @ApiPropertyOptional({ enum: GoalType })
  @IsOptional()
  @IsEnum(GoalType)
  goal?: GoalType;

  @ApiPropertyOptional({ enum: GoalSpeed })
  @IsOptional()
  @IsEnum(GoalSpeed)
  goalSpeed?: GoalSpeed;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  bodyFatPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mealsPerDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  takeoutFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canCook?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  foodPreferences?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  dietaryRestrictions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  weakTimeSlots?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  bingeTriggers?: string[];

  @ApiPropertyOptional({ enum: Discipline })
  @IsOptional()
  @IsEnum(Discipline)
  discipline?: Discipline;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;
}

export class OnboardingStepDto {
  @ApiProperty({ description: '步骤编号 1-4' })
  @IsNumber()
  @Min(1)
  @Max(4)
  step: number;

  @ApiProperty({ description: '步骤数据' })
  data: Record<string, any>;
}
