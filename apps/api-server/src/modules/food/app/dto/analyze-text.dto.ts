/**
 * V6.1 Phase 1.6 — 文本分析请求 DTO
 *
 * POST /api/app/food/analyze-text 的请求体
 */
import {
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MealType } from '../../../diet/diet.types';

/** V5.2: 上下文覆盖参数（用于补录/跨时区场景） */
export class ContextOverrideDto {
  /** 覆盖本地小时（0-23），用于补录过去餐次时修正时间维度评分 */
  @ApiPropertyOptional({ description: '本地小时(0-23)', example: 19 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  localHour?: number;
}

export class AnalyzeTextDto {
  /** 食物文本描述（如"鸡胸肉"、"一份牛肉面加卤蛋"） */
  @ApiProperty({
    description: '食物文本描述',
    example: '一份牛肉面加卤蛋',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1, { message: '文本不能为空' })
  @MaxLength(500, { message: '文本长度不能超过 500 字' })
  text: string;

  /** 餐次（可选，用于更精准的建议） */
  @ApiPropertyOptional({ enum: MealType, description: '餐次' })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  /** V1.1: 语言区域（可选，默认 zh-CN） */
  @ApiPropertyOptional({
    description: '语言区域',
    example: 'zh-CN',
    enum: ['zh-CN', 'en-US', 'ja-JP'],
  })
  @IsOptional()
  @IsString()
  locale?: string;

  /** V5.2: 上下文覆盖（补录/跨时区场景） */
  @ApiPropertyOptional({ type: ContextOverrideDto, description: '上下文覆盖参数' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContextOverrideDto)
  contextOverride?: ContextOverrideDto;
}
