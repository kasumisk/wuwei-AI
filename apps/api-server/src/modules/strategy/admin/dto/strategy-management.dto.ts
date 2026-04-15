import {
  IsString,
  IsOptional,
  IsInt,
  IsObject,
  IsEnum,
  IsUUID,
  IsDateString,
  IsBoolean,
  IsNumber,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StrategyScope,
  StrategyStatus,
  StrategyConfig,
  AssignmentType,
} from '../../strategy.types';

// ==================== 查询 DTO ====================

export class GetStrategiesQueryDto {
  @ApiPropertyOptional({ description: '页码' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '策略名称关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: '策略范围',
    enum: StrategyScope,
  })
  @IsOptional()
  @IsEnum(StrategyScope)
  scope?: StrategyScope;

  @ApiPropertyOptional({
    description: '策略状态',
    enum: StrategyStatus,
  })
  @IsOptional()
  @IsEnum(StrategyStatus)
  status?: StrategyStatus;
}

// ==================== 策略 CRUD DTO ====================

export class CreateStrategyDto {
  @ApiProperty({ description: '策略名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '策略描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '策略范围', enum: StrategyScope })
  @IsEnum(StrategyScope)
  scope: StrategyScope;

  @ApiPropertyOptional({
    description: '策略范围目标（如目标类型、实验ID、用户ID）',
  })
  @IsOptional()
  @IsString()
  scopeTarget?: string;

  @ApiProperty({ description: '策略配置（JSONB）' })
  @IsObject()
  config: StrategyConfig;

  @ApiPropertyOptional({ description: '优先级（数值越大越优先）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;
}

export class UpdateStrategyDto {
  @ApiPropertyOptional({ description: '策略名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '策略描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '策略配置（JSONB）' })
  @IsOptional()
  @IsObject()
  config?: StrategyConfig;

  @ApiPropertyOptional({ description: '优先级' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;
}

// ==================== 策略分配 DTO ====================

export class AssignStrategyDto {
  @ApiProperty({ description: '用户ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: '分配类型',
    enum: AssignmentType,
  })
  @IsEnum(AssignmentType)
  assignmentType: AssignmentType;

  @ApiPropertyOptional({
    description: '分配来源标识（实验ID/段落名/操作人ID）',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '生效开始时间' })
  @IsOptional()
  @IsDateString()
  activeFrom?: string;

  @ApiPropertyOptional({ description: '生效结束时间' })
  @IsOptional()
  @IsDateString()
  activeUntil?: string;
}

export class GetAssignmentsQueryDto {
  @ApiPropertyOptional({ description: '页码' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '是否仅活跃分配' })
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ description: '分配类型', enum: AssignmentType })
  @IsOptional()
  @IsEnum(AssignmentType)
  assignmentType?: AssignmentType;
}

export class RemoveAssignmentDto {
  @ApiProperty({ description: '用户ID' })
  @IsUUID()
  userId: string;
}

// ==================== V6.5 Phase 3H: Realism 配置 DTO ====================

/**
 * Realism 配置更新 DTO（带验证）
 *
 * 与 RealismConfig 接口一致，但增加了 class-validator 装饰器，
 * 确保 Admin 面板传入的配置值在合理范围内。
 */
export class UpdateRealismConfigDto {
  @ApiPropertyOptional({ description: '是否启用现实性过滤' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      '大众化最低阈值（0-100），commonalityScore 低于此值的食物被过滤',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commonalityThreshold?: number;

  @ApiPropertyOptional({ description: '是否启用预算过滤' })
  @IsOptional()
  @IsBoolean()
  budgetFilterEnabled?: boolean;

  @ApiPropertyOptional({ description: '是否启用烹饪时间过滤' })
  @IsOptional()
  @IsBoolean()
  cookTimeCapEnabled?: boolean;

  @ApiPropertyOptional({
    description: '工作日烹饪时间上限（分钟，5-180）',
    minimum: 5,
    maximum: 180,
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(180)
  weekdayCookTimeCap?: number;

  @ApiPropertyOptional({
    description: '周末烹饪时间上限（分钟，5-360）',
    minimum: 5,
    maximum: 360,
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(360)
  weekendCookTimeCap?: number;

  @ApiPropertyOptional({
    description: '可执行性评分权重倍数（0.1-5.0，1.0=默认）',
    minimum: 0.1,
    maximum: 5.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(5.0)
  executabilityWeightMultiplier?: number;
}

/**
 * 按分群批量应用 Realism 配置 DTO
 */
export class ApplyRealismToSegmentDto {
  @ApiProperty({
    description: '分群名称（如 warm_start, re_engage, precision, discovery）',
  })
  @IsString()
  segment: string;

  @ApiProperty({ description: 'Realism 配置' })
  @ValidateNested()
  @Type(() => UpdateRealismConfigDto)
  realism: UpdateRealismConfigDto;
}

// ==================== V7.9 P2-06: 策略模拟 DTO ====================

export class StrategySimulateDto {
  @ApiProperty({ description: '用户 ID 列表（1-10 个）', type: [String] })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiPropertyOptional({ description: '餐次类型（默认 lunch）' })
  @IsOptional()
  @IsString()
  mealType?: string;

  @ApiPropertyOptional({ description: '目标类型覆盖' })
  @IsOptional()
  @IsString()
  goalType?: string;
}

// ==================== V7.9 P2-10: 调优审核 DTO ====================

export class TuningReviewDto {
  @ApiPropertyOptional({ description: '审核备注' })
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

// ==================== V7.9 P2-10: 调优待审列表查询 DTO ====================

export class TuningPendingQueryDto {
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
