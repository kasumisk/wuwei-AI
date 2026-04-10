import { IsOptional, IsDateString, IsString, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ==================== 转化漏斗查询 DTO ====================

export class GetConversionFunnelQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: '按注册渠道筛选（authType）',
    example: 'wechat_mini',
  })
  @IsOptional()
  @IsString()
  authType?: string;

  @ApiPropertyOptional({
    description: '按触发场景筛选',
    example: 'analysis_limit',
  })
  @IsOptional()
  @IsString()
  triggerScene?: string;
}

// ==================== 转化趋势查询 DTO ====================

export class GetConversionTrendQueryDto {
  @ApiProperty({ description: '开始日期', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期', example: '2025-01-31' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({
    description: '时间粒度',
    enum: ['day', 'week', 'month'],
    default: 'day',
  })
  @IsOptional()
  @IsString()
  granularity?: 'day' | 'week' | 'month';
}
