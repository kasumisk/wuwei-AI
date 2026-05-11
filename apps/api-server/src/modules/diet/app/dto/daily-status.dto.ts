import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class DailyStatusQueryDto {
  @ApiProperty({ description: '用户本地日期，格式 YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiPropertyOptional({ description: 'IANA 时区，如 Asia/Shanghai' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ enum: ['compact', 'full'] })
  @IsOptional()
  @IsIn(['compact', 'full'])
  records?: 'compact' | 'full';
}
