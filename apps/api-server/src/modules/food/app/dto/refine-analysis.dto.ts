import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 置信度驱动的饮食图片分析 V1
 * 用户修正 foods DTO
 *
 * 关联设计文档：docs/CONFIDENCE_DRIVEN_FOOD_ANALYSIS_V1.md §4.4
 *
 * 设计变更（v1.1）：
 * - estimatedWeightGrams 改为**必填**，确保后端只用克数拼文本，
 *   避免 AI 对 "半只+米饭" 等非结构化份量描述产生幻觉。
 * - quantity 字段保留用于审计/展示，不再参与文本拼接。
 */
export class RefinedFoodInputDto {
  @ApiProperty({ description: '食物名称（必填）', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description: '估计克数（必填，1~5000）',
    minimum: 1,
    maximum: 5000,
  })
  @IsInt()
  @Min(1)
  @Max(5000)
  estimatedWeightGrams!: number;

  @ApiProperty({
    description: '对应低置信度返回 foods 中的 id，用于审计（可选）',
    required: false,
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  originalId?: string;
}

export class RefineAnalysisDto {
  @ApiProperty({ description: '分析 session ID（由 /analyze 响应返回）' })
  @IsUUID()
  analysisSessionId!: string;

  @ApiProperty({
    description: '用户修正后的食物列表（1~20 项）',
    type: [RefinedFoodInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RefinedFoodInputDto)
  foods!: RefinedFoodInputDto[];

  @ApiProperty({ description: '用户备注（可选）', required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userNote?: string;
}


export class RefineAnalysisDto {
  @ApiProperty({ description: '分析 session ID（由 /analyze 响应返回）' })
  @IsUUID()
  analysisSessionId!: string;

  @ApiProperty({
    description: '用户修正后的食物列表（1~20 项）',
    type: [RefinedFoodInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RefinedFoodInputDto)
  foods!: RefinedFoodInputDto[];

  @ApiProperty({ description: '用户备注（可选）', required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userNote?: string;
}
