/**
 * V6.1 Phase 1.8 — 保存分析结果到饮食记录的 DTO
 */
import { IsUUID, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '../../../diet/diet.types';

export class SaveAnalysisToRecordDto {
  /** 分析记录 ID（food_analysis_record.id） */
  @ApiProperty({ description: '分析记录 ID' })
  @IsUUID()
  analysisId: string;

  /** 覆盖餐次类型（可选，默认使用分析时指定的餐次） */
  @ApiPropertyOptional({
    enum: MealType,
    description: '覆盖餐次类型（可选）',
  })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  /** 覆盖记录时间（可选，默认当前时间） */
  @ApiPropertyOptional({ description: '覆盖记录时间（可选）' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
