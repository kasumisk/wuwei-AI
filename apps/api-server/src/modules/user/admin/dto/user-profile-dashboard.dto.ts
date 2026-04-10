import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 用户增长趋势查询
 */
export class UserGrowthTrendQueryDto {
  @ApiPropertyOptional({ description: '回溯天数', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({
    description: '粒度: day / week / month',
    default: 'day',
  })
  @IsOptional()
  @IsString()
  granularity?: string;
}

/**
 * 用户画像分布查询
 */
export class ProfileDistributionQueryDto {
  @ApiPropertyOptional({
    description: '回溯天数（限定用户注册范围）',
    default: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
