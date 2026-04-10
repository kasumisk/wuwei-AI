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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '../../diet/diet.types';

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
}
