import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsObject,
  ValidateNested,
  IsNumber,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** P2-5: 分析上下文，从分析页传入教练 */
export class AnalysisContextDto {
  @IsOptional()
  @IsArray()
  foods?: Array<{
    name: string;
    calories: number;
    /** V1.2: 蛋白质 */
    protein?: number;
    /** V1.2: 脂肪 */
    fat?: number;
    /** V1.2: 碳水 */
    carbs?: number;
  }>;

  @IsOptional()
  @IsNumber()
  totalCalories?: number;

  /** V1.2: 总蛋白质 */
  @IsOptional()
  @IsNumber()
  totalProtein?: number;

  /** V1.2: 总脂肪 */
  @IsOptional()
  @IsNumber()
  totalFat?: number;

  /** V1.2: 总碳水 */
  @IsOptional()
  @IsNumber()
  totalCarbs?: number;

  @IsOptional()
  @IsString()
  decision?: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  @IsOptional()
  @IsNumber()
  nutritionScore?: number;

  @IsOptional()
  @IsString()
  advice?: string;

  @IsOptional()
  @IsString()
  mealType?: string;

  /** V1.3: 7维评分分解 */
  @IsOptional()
  @IsObject()
  breakdown?: Record<string, number>;

  /** V1.3: 结构化决策因子 */
  @IsOptional()
  @IsArray()
  decisionFactors?: Array<{
    dimension: string;
    score: number;
    impact: string;
    message: string;
  }>;

  /** V1.3: 最优份量建议 */
  @IsOptional()
  @IsObject()
  optimalPortion?: {
    recommendedPercent: number;
    recommendedCalories: number;
  };

  /** V1.3: 下一餐建议 */
  @IsOptional()
  @IsObject()
  nextMealAdvice?: {
    targetCalories: number;
    targetProtein: number;
    emphasis: string;
    suggestion: string;
  };
}

export class CoachChatDto {
  @ApiProperty({ description: '用户消息' })
  @IsString()
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ description: '对话 ID（不传则新建会话）' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'P2-5: 分析上下文' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AnalysisContextDto)
  analysisContext?: AnalysisContextDto;

  @ApiPropertyOptional({
    description: 'V1.1: 语言偏好 (zh-CN / en-US / ja-JP)',
  })
  @IsOptional()
  @IsString()
  locale?: string;
}

export class CoachMessagesQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: '每页数量', default: '50' })
  @IsOptional()
  @IsString()
  limit?: string;
}
