import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  IsNumber,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExperimentStatus } from '../../diet.types';

// ==================== Query DTOs ====================

export class GetExperimentsQueryDto {
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
  pageSize?: number;

  @ApiPropertyOptional({ description: '搜索关键词（名称/描述）' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: '实验状态',
    enum: ExperimentStatus,
  })
  @IsOptional()
  @IsEnum(ExperimentStatus)
  status?: ExperimentStatus;

  @ApiPropertyOptional({ description: '目标类型筛选' })
  @IsOptional()
  @IsString()
  goalType?: string;
}

export class UpdateExperimentStatusDto {
  @ApiProperty({
    description: '目标状态',
    enum: ExperimentStatus,
  })
  @IsEnum(ExperimentStatus)
  status: ExperimentStatus;
}

// ==================== Create / Update DTOs ====================

export class ExperimentGroupDto {
  @ApiProperty({ description: '分组名称，如 control, variant_a' })
  @IsString()
  name: string;

  @ApiProperty({ description: '流量占比 0-1，所有组之和应 = 1.0' })
  @IsNumber()
  @Min(0)
  @Max(1)
  trafficRatio: number;

  @ApiPropertyOptional({
    description: '评分权重覆盖（按目标类型索引），null 表示使用默认权重',
  })
  @IsOptional()
  scoreWeightOverrides?: Record<string, number[]> | null;

  @ApiPropertyOptional({
    description: '餐次权重修正覆盖，null 表示使用默认值',
  })
  @IsOptional()
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
}

export class CreateExperimentDto {
  @ApiProperty({ description: '实验名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '实验描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: '目标类型过滤，* 表示所有目标类型',
    default: '*',
  })
  @IsOptional()
  @IsString()
  goalType?: string;

  @ApiProperty({ description: '实验分组配置', type: [ExperimentGroupDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperimentGroupDto)
  groups: ExperimentGroupDto[];

  @ApiPropertyOptional({ description: '实验开始时间' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '实验结束时间' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateExperimentDto {
  @ApiPropertyOptional({ description: '实验名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '实验描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '目标类型过滤' })
  @IsOptional()
  @IsString()
  goalType?: string;

  @ApiPropertyOptional({
    description: '实验分组配置',
    type: [ExperimentGroupDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperimentGroupDto)
  groups?: ExperimentGroupDto[];

  @ApiPropertyOptional({ description: '实验开始时间' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '实验结束时间' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
