import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsNumber,
  IsArray,
  IsIn,
} from 'class-validator';
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

// ==================== V7.9 P2-02: Trace 列表查询 ====================

export class TraceListQueryDto {
  @ApiPropertyOptional({ description: '按用户 ID 过滤' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '按餐次类型过滤' })
  @IsOptional()
  @IsString()
  mealType?: string;

  @ApiPropertyOptional({ description: '按场景名称过滤' })
  @IsOptional()
  @IsString()
  sceneName?: string;

  @ApiPropertyOptional({ description: '起始日期 (ISO 8601)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期 (ISO 8601)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

// ==================== V7.9 P2-03: 得分分解 ====================

export class ScoreBreakdownDto {
  @ApiProperty({ description: '用户 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: '食物 ID (UUID)' })
  @IsString()
  foodId: string;

  @ApiPropertyOptional({ description: '餐次类型（默认 lunch）' })
  @IsOptional()
  @IsString()
  mealType?: string;

  @ApiPropertyOptional({ description: '目标类型覆盖' })
  @IsOptional()
  @IsString()
  goalType?: string;
}

// ==================== V7.9 P2-04: 策略推荐差异对比 ====================

export class StrategyDiffDto {
  @ApiProperty({ description: '用户 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: '策略 A 的 ID (UUID)' })
  @IsString()
  strategyIdA: string;

  @ApiProperty({ description: '策略 B 的 ID (UUID)' })
  @IsString()
  strategyIdB: string;

  @ApiPropertyOptional({ description: '餐次类型（默认 lunch）' })
  @IsOptional()
  @IsString()
  mealType?: string;

  @ApiPropertyOptional({ description: '目标类型覆盖' })
  @IsOptional()
  @IsString()
  goalType?: string;
}

// ==================== V7.9 P2-05: 管道统计查询 ====================

export class PipelineStatsQueryDto {
  @ApiPropertyOptional({ description: '回溯天数', default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({ description: '按餐次类型过滤' })
  @IsOptional()
  @IsString()
  mealType?: string;

  @ApiPropertyOptional({ description: '按场景名称过滤' })
  @IsOptional()
  @IsString()
  sceneName?: string;
}
