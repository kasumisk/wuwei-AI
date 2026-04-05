import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  IsBoolean,
} from 'class-validator';
import type {
  GetOverviewQueryDto as IGetOverviewQueryDto,
  OverviewStatsDto as IOverviewStatsDto,
  GetTopClientsQueryDto as IGetTopClientsQueryDto,
  TopClientDto as ITopClientDto,
  TopClientsResponseDto as ITopClientsResponseDto,
  GetCapabilityUsageQueryDto as IGetCapabilityUsageQueryDto,
  CapabilityUsageDto as ICapabilityUsageDto,
  CapabilityUsageResponseDto as ICapabilityUsageResponseDto,
  GetTimeSeriesQueryDto as IGetTimeSeriesQueryDto,
  TimeSeriesDataPointDto as ITimeSeriesDataPointDto,
  TimeSeriesResponseDto as ITimeSeriesResponseDto,
  GetCostAnalysisQueryDto as IGetCostAnalysisQueryDto,
  CostAnalysisItemDto as ICostAnalysisItemDto,
  CostAnalysisResponseDto as ICostAnalysisResponseDto,
  GetErrorAnalysisQueryDto as IGetErrorAnalysisQueryDto,
  ErrorTypeDto as IErrorTypeDto,
  ErrorAnalysisResponseDto as IErrorAnalysisResponseDto,
  ExportReportQueryDto as IExportReportQueryDto,
  DashboardStatsDto as IDashboardStatsDto,
} from '@ai-platform/shared';
import { TimeInterval, GroupBy, CapabilityType } from '@ai-platform/shared';

/**
 * 获取总览数据查询参数
 */
export class GetOverviewQueryDto implements IGetOverviewQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;
}

/**
 * 总览数据 DTO
 */
export class OverviewStatsDto implements IOverviewStatsDto {
  @ApiProperty({ description: '总请求数' })
  totalRequests: number;

  @ApiProperty({ description: '成功率' })
  successRate: number;

  @ApiProperty({ description: '平均响应时间（毫秒）' })
  avgResponseTime: number;

  @ApiProperty({ description: '总成本' })
  totalCost: number;

  @ApiProperty({ description: '总 tokens 数' })
  totalTokens: number;

  @ApiProperty({ description: '独立客户端数' })
  uniqueClients: number;
}

/**
 * 获取客户端排行查询参数
 */
export class GetTopClientsQueryDto implements IGetTopClientsQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: '返回数量', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

/**
 * 客户端排行项 DTO
 */
export class TopClientDto implements ITopClientDto {
  @ApiProperty({ description: '客户端 ID' })
  clientId: string;

  @ApiProperty({ description: '客户端名称' })
  clientName: string;

  @ApiProperty({ description: '请求数' })
  requestCount: number;

  @ApiProperty({ description: '成功率' })
  successRate: number;

  @ApiProperty({ description: '总成本' })
  totalCost: number;

  @ApiProperty({ description: '总 tokens 数' })
  totalTokens: number;
}

/**
 * 客户端排行响应 DTO
 */
export class TopClientsResponseDto implements ITopClientsResponseDto {
  @ApiProperty({ type: [TopClientDto], description: '客户端列表' })
  clients: TopClientDto[];
}

/**
 * 获取能力使用统计查询参数
 */
export class GetCapabilityUsageQueryDto implements IGetCapabilityUsageQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    enum: CapabilityType,
    description: '能力类型',
  })
  @IsOptional()
  @IsEnum(CapabilityType)
  capabilityType?: CapabilityType;
}

/**
 * 能力使用统计项 DTO
 */
export class CapabilityUsageDto implements ICapabilityUsageDto {
  @ApiProperty({ enum: CapabilityType, description: '能力类型' })
  capabilityType: CapabilityType;

  @ApiProperty({ description: '请求数' })
  requestCount: number;

  @ApiProperty({ description: '成功率' })
  successRate: number;

  @ApiProperty({ description: '平均响应时间（毫秒）' })
  avgResponseTime: number;

  @ApiProperty({ description: '总成本' })
  totalCost: number;

  @ApiProperty({ description: '总 tokens 数' })
  totalTokens: number;
}

/**
 * 能力使用统计响应 DTO
 */
export class CapabilityUsageResponseDto implements ICapabilityUsageResponseDto {
  @ApiProperty({ type: [CapabilityUsageDto], description: '能力使用统计' })
  usage: CapabilityUsageDto[];
}

/**
 * 获取时间序列数据查询参数
 */
export class GetTimeSeriesQueryDto implements IGetTimeSeriesQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    enum: TimeInterval,
    description: '时间间隔',
    example: TimeInterval.DAY,
  })
  @IsEnum(TimeInterval)
  interval: TimeInterval;

  @ApiPropertyOptional({
    description: '指标类型',
    example: 'requests',
  })
  @IsOptional()
  @IsString()
  metric?: 'requests' | 'cost' | 'tokens' | 'responseTime';
}

/**
 * 时间序列数据点 DTO
 */
export class TimeSeriesDataPointDto implements ITimeSeriesDataPointDto {
  @ApiProperty({ description: '时间戳' })
  timestamp: string;

  @ApiProperty({ description: '值' })
  value: number;
}

/**
 * 时间序列数据响应 DTO
 */
export class TimeSeriesResponseDto implements ITimeSeriesResponseDto {
  @ApiProperty({
    type: [TimeSeriesDataPointDto],
    description: '时间序列数据',
  })
  data: TimeSeriesDataPointDto[];

  @ApiProperty({ description: '指标类型' })
  metric: string;

  @ApiProperty({ enum: TimeInterval, description: '时间间隔' })
  interval: TimeInterval;
}

/**
 * 获取成本分析查询参数
 */
export class GetCostAnalysisQueryDto implements IGetCostAnalysisQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    enum: GroupBy,
    description: '分组维度',
    example: GroupBy.CLIENT,
  })
  @IsEnum(GroupBy)
  groupBy: GroupBy;
}

/**
 * 成本分析项 DTO
 */
export class CostAnalysisItemDto implements ICostAnalysisItemDto {
  @ApiProperty({ description: '名称' })
  name: string;

  @ApiProperty({ description: 'ID' })
  id: string;

  @ApiProperty({ description: '成本' })
  cost: number;

  @ApiProperty({ description: '请求数' })
  requests: number;

  @ApiProperty({ description: 'Tokens 数' })
  tokens: number;

  @ApiProperty({ description: '占比' })
  percentage: number;
}

/**
 * 成本分析响应 DTO
 */
export class CostAnalysisResponseDto implements ICostAnalysisResponseDto {
  @ApiProperty({ type: [CostAnalysisItemDto], description: '成本分析项' })
  items: CostAnalysisItemDto[];

  @ApiProperty({ description: '总成本' })
  totalCost: number;

  @ApiProperty({ enum: GroupBy, description: '分组维度' })
  groupBy: GroupBy;
}

/**
 * 获取错误分析查询参数
 */
export class GetErrorAnalysisQueryDto implements IGetErrorAnalysisQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: '返回数量', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

/**
 * 错误类型统计 DTO
 */
export class ErrorTypeDto implements IErrorTypeDto {
  @ApiProperty({ description: '错误类型' })
  errorType: string;

  @ApiProperty({ description: '错误消息' })
  errorMessage: string;

  @ApiProperty({ description: '出现次数' })
  count: number;

  @ApiProperty({ description: '占比' })
  percentage: number;

  @ApiProperty({ description: '最后出现时间' })
  lastOccurrence: Date;
}

/**
 * 错误分析响应 DTO
 */
export class ErrorAnalysisResponseDto implements IErrorAnalysisResponseDto {
  @ApiProperty({ type: [ErrorTypeDto], description: '错误列表' })
  errors: ErrorTypeDto[];

  @ApiProperty({ description: '总错误数' })
  totalErrors: number;
}

/**
 * 导出报表查询参数
 */
export class ExportReportQueryDto implements IExportReportQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ description: '导出格式', enum: ['csv', 'xlsx'] })
  @IsEnum(['csv', 'xlsx'])
  format: 'csv' | 'xlsx';

  @ApiPropertyOptional({ description: '是否包含详情', default: false })
  @IsOptional()
  @IsBoolean()
  includeDetails?: boolean;
}

/**
 * 仪表盘统计数据（聚合）
 */
export class DashboardStatsDto implements IDashboardStatsDto {
  @ApiProperty({ type: OverviewStatsDto, description: '总览数据' })
  overview: OverviewStatsDto;

  @ApiProperty({ type: [TopClientDto], description: '客户端排行' })
  topClients: TopClientDto[];

  @ApiProperty({ type: [CapabilityUsageDto], description: '能力使用统计' })
  capabilityUsage: CapabilityUsageDto[];

  @ApiProperty({ type: [ErrorTypeDto], description: '最近错误' })
  recentErrors: ErrorTypeDto[];
}
