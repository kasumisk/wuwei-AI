import {
  IsString,
  IsOptional,
  IsInt,
  IsObject,
  IsEnum,
  IsUUID,
  IsDateString,
  Min,
  Max,
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
