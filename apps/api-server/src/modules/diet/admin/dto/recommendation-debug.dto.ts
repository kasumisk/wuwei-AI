import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

// ==================== 模拟推荐 ====================

export class SimulateRecommendDto {
  @ApiProperty({ description: '用户 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: '餐次类型: breakfast/lunch/dinner/snack' })
  @IsString()
  mealType: string;

  @ApiPropertyOptional({
    description: '目标类型覆盖（不传则使用用户档案中的 goal）',
  })
  @IsOptional()
  @IsString()
  goalType?: string;

  @ApiPropertyOptional({ description: '已摄入热量（kcal），默认 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consumedCalories?: number;

  @ApiPropertyOptional({ description: '已摄入蛋白质（g），默认 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consumedProtein?: number;
}

// ==================== 反向解释 ====================

export class WhyNotDto {
  @ApiProperty({ description: '用户 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: '食物名称' })
  @IsString()
  foodName: string;

  @ApiProperty({ description: '餐次类型' })
  @IsString()
  mealType: string;

  @ApiPropertyOptional({ description: '目标类型覆盖' })
  @IsOptional()
  @IsString()
  goalType?: string;
}

// ==================== 质量仪表盘 ====================

export class QualityDashboardQueryDto {
  @ApiPropertyOptional({ description: '回溯天数', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
