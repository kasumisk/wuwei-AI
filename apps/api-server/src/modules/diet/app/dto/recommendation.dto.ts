import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsUUID,
  ValidateNested,
  Min,
  Max,
  IsNumber,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '../../diet.types';

// ========== Plan DTO ==========

export class AdjustPlanDto {
  @ApiProperty({ description: '调整原因' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    enum: MealType,
    description: '可选：指定要替换的餐次（breakfast/lunch/dinner/snack）',
  })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}

export class RegeneratePlanDto {
  @ApiPropertyOptional({
    enum: MealType,
    description: '指定餐次时仅替换该餐，不传则重新生成全部',
  })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}

export class SubstitutesQueryDto {
  @ApiProperty({ description: '原食物 ID' })
  @IsUUID()
  foodId: string;

  @ApiPropertyOptional({
    enum: MealType,
    description: '餐次 (breakfast/lunch/dinner/snack)',
  })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}

/**
 * V6 2.19: 多维反馈评分 DTO — 口味/份量/价格/时间适合度
 * 每个维度 1-5 星，可选（用户可只评部分维度）
 */
export class FeedbackRatingsDto {
  @ApiPropertyOptional({
    description: '口味满意度 (1-5)',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  taste?: number;

  @ApiPropertyOptional({
    description: '份量满意度 (1=太少, 3=刚好, 5=太多)',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  portion?: number;

  @ApiPropertyOptional({
    description: '价格满意度 (1=太贵, 3=合理, 5=很划算)',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  price?: number;

  @ApiPropertyOptional({
    description: '时间适合度 (1=不适合, 5=非常适合)',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  timing?: number;

  @ApiPropertyOptional({ description: '用户文字备注' })
  @IsOptional()
  @IsString()
  comment?: string;
}

/**
 * V6 2.19: 隐式行为信号 DTO — 前端上报的交互行为
 */
export class ImplicitSignalsDto {
  @ApiPropertyOptional({ description: '推荐卡片停留时间（毫秒）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dwellTimeMs?: number;

  @ApiPropertyOptional({ description: '是否展开了详情' })
  @IsOptional()
  @IsBoolean()
  detailExpanded?: boolean;
}

export class RecommendationFeedbackDto {
  @ApiProperty({ enum: MealType, description: '餐次' })
  @IsEnum(MealType)
  mealType: MealType;

  @ApiProperty({ description: '推荐的食物名称' })
  @IsString()
  foodName: string;

  @ApiPropertyOptional({ description: '食物库 ID' })
  @IsOptional()
  @IsUUID()
  foodId?: string;

  @ApiProperty({
    enum: ['accepted', 'replaced', 'skipped'],
    description: '用户操作',
  })
  @IsIn(['accepted', 'replaced', 'skipped'])
  action: 'accepted' | 'replaced' | 'skipped';

  @ApiPropertyOptional({
    description: '替换后的食物名（仅 action=replaced 时需要）',
  })
  @IsOptional()
  @IsString()
  replacementFood?: string;

  @ApiPropertyOptional({ description: '推荐时的评分' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  recommendationScore?: number;

  @ApiPropertyOptional({ description: '用户目标类型快照' })
  @IsOptional()
  @IsString()
  goalType?: string;

  /** V6 2.19: 多维评分（口味/份量/价格/时间） */
  @ApiPropertyOptional({ type: FeedbackRatingsDto, description: '多维评分' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeedbackRatingsDto)
  ratings?: FeedbackRatingsDto;

  /** V6 2.19: 隐式行为信号 */
  @ApiPropertyOptional({
    type: ImplicitSignalsDto,
    description: '隐式行为信号',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImplicitSignalsDto)
  implicitSignals?: ImplicitSignalsDto;
}

// ========== V6 2.8: 反向解释 DTO ==========

export class ExplainWhyNotDto {
  @ApiProperty({ description: '食物名称（中文或英文）' })
  @IsString()
  foodName: string;

  @ApiProperty({
    enum: MealType,
    description: '餐次 (breakfast/lunch/dinner/snack)',
  })
  @IsEnum(MealType)
  mealType: MealType;
}

// ========== Behavior DTO ==========

export class DecisionFeedbackDto {
  @ApiProperty({ description: '饮食记录 ID' })
  @IsUUID()
  recordId: string;

  @ApiProperty({ description: '是否遵循了 AI 建议' })
  @IsBoolean()
  followed: boolean;

  @ApiProperty({
    enum: ['helpful', 'unhelpful', 'wrong'],
    description: '反馈类型',
  })
  @IsIn(['helpful', 'unhelpful', 'wrong'])
  feedback: 'helpful' | 'unhelpful' | 'wrong';
}

// ========== Summary DTO ==========

export class RecentSummaryQueryDto {
  @ApiPropertyOptional({
    description: '查询天数，默认 7',
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
