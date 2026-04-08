import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetRecommendationDto {
  @ApiProperty({ description: '餐次类型' })
  @IsString()
  mealType: string;

  @ApiPropertyOptional({ description: '推荐数量', default: 5 })
  @IsOptional()
  @IsNumber()
  topN?: number;
}

export class SubmitFeedbackDto {
  @ApiProperty({ description: '餐次类型' })
  @IsString()
  mealType: string;

  @ApiProperty({ description: '食物名称' })
  @IsString()
  foodName: string;

  @ApiPropertyOptional({ description: '食物库ID' })
  @IsOptional()
  @IsString()
  foodId?: string;

  @ApiProperty({ description: '反馈类型', enum: ['accepted', 'replaced', 'skipped'] })
  @IsString()
  action: 'accepted' | 'replaced' | 'skipped';

  @ApiPropertyOptional({ description: '替换食物名' })
  @IsOptional()
  @IsString()
  replacementFood?: string;

  @ApiPropertyOptional({ description: '推荐评分' })
  @IsOptional()
  @IsNumber()
  recommendationScore?: number;
}
