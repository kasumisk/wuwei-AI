import {
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsIn,
  IsEnum,
  IsObject,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
} from '../../user.types';

// ========== Onboarding Step DTOs ==========

/**
 * Step 1: 快速启动（2 字段，不可跳过）
 * 拿到 BMR 核心参数：性别 + 出生年
 */
export class OnboardingStep1Dto {
  @ApiProperty({ enum: ['male', 'female'], description: '性别' })
  @IsNotEmpty()
  @IsString()
  @IsIn(['male', 'female'])
  gender: string;

  @ApiProperty({ description: '出生年份', minimum: 1940, maximum: 2020 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1940)
  @Max(2020)
  birthYear: number;
}

/**
 * Step 2: 目标与身体（4-5 字段，不可跳过）
 * 拿到完整 BMR + 目标方向 → 可输出基础推荐
 */
export class OnboardingStep2Dto {
  @ApiProperty({ description: '身高 cm', minimum: 50, maximum: 250 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(250)
  heightCm: number;

  @ApiProperty({ description: '体重 kg', minimum: 20, maximum: 300 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(300)
  weightKg: number;

  @ApiProperty({ enum: GoalType, description: '目标类型' })
  @IsNotEmpty()
  @IsEnum(GoalType)
  goal: GoalType;

  @ApiPropertyOptional({
    description: '目标体重 kg（仅 fat_loss/muscle_gain 时）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(30)
  @Max(200)
  targetWeightKg?: number;

  @ApiProperty({ enum: ActivityLevel, description: '活动等级' })
  @IsNotEmpty()
  @IsEnum(ActivityLevel)
  activityLevel: ActivityLevel;

  @ApiPropertyOptional({
    description: '每日热量目标（用户覆盖，null=系统自算）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(800)
  @Max(5000)
  dailyCalorieGoal?: number;
}

/**
 * Step 3: 饮食习惯（4-5 字段，可跳过）
 * 细化推荐策略，缺失时使用安全默认值
 */
export class OnboardingStep3Dto {
  @ApiPropertyOptional({ description: '每日餐次', minimum: 1, maximum: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  mealsPerDay?: number;

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

  @ApiPropertyOptional({
    type: [String],
    description: '饮食偏好 sweet/fried/carbs/meat/spicy',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foodPreferences?: string[];

  @ApiPropertyOptional({
    enum: ['never', 'sometimes', 'often'],
    description: '外卖频率',
  })
  @IsOptional()
  @IsIn(['never', 'sometimes', 'often'])
  takeoutFrequency?: string;
}

/**
 * Step 4: 行为与心理（3-4 字段，可跳过）
 * 个性化推荐策略（约束松紧度、教练风格）
 */
export class OnboardingStep4Dto {
  @ApiPropertyOptional({ enum: Discipline, description: '自律程度' })
  @IsOptional()
  @IsEnum(Discipline)
  discipline?: Discipline;

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

  @ApiPropertyOptional({ description: '是否会做饭' })
  @IsOptional()
  @IsBoolean()
  canCook?: boolean;
}

// ========== Full Profile Update DTO ==========

/**
 * 声明数据部分更新 DTO（用于已完成引导的用户修改档案）
 */
export class UpdateDeclaredProfileDto {
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

  @ApiPropertyOptional({ enum: GoalType })
  @IsOptional()
  @IsEnum(GoalType)
  goal?: GoalType;

  @ApiPropertyOptional({ enum: GoalSpeed })
  @IsOptional()
  @IsEnum(GoalSpeed)
  goalSpeed?: GoalSpeed;

  @ApiPropertyOptional({ minimum: 3, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(3)
  @Max(60)
  bodyFatPercent?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 6 })
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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foodPreferences?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @ApiPropertyOptional({ type: [String], description: '⚠️ 过敏原' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  healthConditions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  weakTimeSlots?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bingeTriggers?: string[];

  @ApiPropertyOptional({ enum: Discipline })
  @IsOptional()
  @IsEnum(Discipline)
  discipline?: Discipline;

  @ApiPropertyOptional({ description: '运动概况' })
  @IsOptional()
  @IsObject()
  exerciseProfile?: {
    type?: 'none' | 'cardio' | 'strength' | 'mixed';
    frequencyPerWeek?: number;
    avgDurationMinutes?: number;
  };

  @ApiPropertyOptional({ enum: ['none', 'basic', 'intermediate', 'advanced'] })
  @IsOptional()
  @IsIn(['none', 'basic', 'intermediate', 'advanced'])
  cookingSkillLevel?: string;

  @ApiPropertyOptional({
    description: '口味强度偏好 {spicy:0-5, sweet:0-5, ...}',
  })
  @IsOptional()
  @IsObject()
  tasteIntensity?: Record<string, number>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cuisinePreferences?: string[];

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  budgetLevel?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  familySize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mealPrepWilling?: boolean;

  @ApiPropertyOptional({ description: '地区代码' })
  @IsOptional()
  @IsString()
  regionCode?: string;

  // ─── V6.4 P1: 暴露 exerciseSchedule ───
  @ApiPropertyOptional({
    description: '每周运动计划',
    example: {
      mon: { startHour: 7, durationHours: 1, type: 'cardio' },
      wed: { startHour: 18, durationHours: 1.5, type: 'strength' },
    },
  })
  @IsOptional()
  @IsObject()
  exerciseSchedule?: Record<
    string,
    { startHour: number; durationHours: number; type?: string }
  >;

  // ─── V6.6 Phase 2-C: 生活方式画像字段 ───

  @ApiPropertyOptional({
    enum: ['poor', 'fair', 'good'],
    description: '睡眠质量',
  })
  @IsOptional()
  @IsIn(['poor', 'fair', 'good'])
  sleepQuality?: string;

  @ApiPropertyOptional({
    enum: ['low', 'medium', 'high'],
    description: '压力水平',
  })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  stressLevel?: string;

  @ApiPropertyOptional({
    minimum: 500,
    maximum: 5000,
    description: '每日目标饮水量 (ml)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(5000)
  hydrationGoal?: number;

  @ApiPropertyOptional({ type: [String], description: '正在服用的补剂列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplementsUsed?: string[];

  @ApiPropertyOptional({
    enum: ['early_bird', 'standard', 'late_eater'],
    description: '用餐时间偏好',
  })
  @IsOptional()
  @IsIn(['early_bird', 'standard', 'late_eater'])
  mealTimingPreference?: string;
}

// ========== V6.5 Phase 3F: 用户推荐偏好 DTO ==========

import {
  PopularityPreference,
  CookingEffort,
  BudgetSensitivity,
} from '../../user.types';

/**
 * 用户推荐偏好设置 DTO
 *
 * 三个维度均为可选 — 未设置的维度使用策略默认值：
 * - popularityPreference: 大众化(popular) / 平衡(balanced) / 探索型(adventurous)
 * - cookingEffort: 快手(quick) / 适中(moderate) / 精致(elaborate)
 * - budgetSensitivity: 便宜(budget) / 适中(moderate) / 不限(unlimited)
 */
export class UpdateRecommendationPreferencesDto {
  @ApiPropertyOptional({
    enum: PopularityPreference,
    description:
      '大众化偏好：popular=常见食物优先, balanced=默认, adventurous=探索新食物',
  })
  @IsOptional()
  @IsEnum(PopularityPreference)
  popularityPreference?: PopularityPreference;

  @ApiPropertyOptional({
    enum: CookingEffort,
    description:
      '烹饪投入：quick=≤30min快手, moderate=≤60min适中, elaborate=不限',
  })
  @IsOptional()
  @IsEnum(CookingEffort)
  cookingEffort?: CookingEffort;

  @ApiPropertyOptional({
    enum: BudgetSensitivity,
    description: '预算敏感度：budget=便宜优先, moderate=适中, unlimited=不限',
  })
  @IsOptional()
  @IsEnum(BudgetSensitivity)
  budgetSensitivity?: BudgetSensitivity;
}
