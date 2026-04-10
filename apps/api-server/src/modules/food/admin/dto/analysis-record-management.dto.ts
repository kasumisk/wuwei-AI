import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class GetAnalysisRecordsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '用户ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '输入类型: text / image' })
  @IsOptional()
  @IsString()
  @IsIn(['text', 'image'])
  inputType?: string;

  @ApiPropertyOptional({
    description: '分析状态: completed / failed / partial',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: '审核状态: pending / accurate / inaccurate',
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'accurate', 'inaccurate'])
  reviewStatus?: string;

  @ApiPropertyOptional({ description: '最低置信度' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minConfidence?: number;

  @ApiPropertyOptional({ description: '最高置信度' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxConfidence?: number;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '关键词搜索(食物名)' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ReviewAnalysisRecordDto {
  @ApiProperty({ description: '审核结果', enum: ['accurate', 'inaccurate'] })
  @IsString()
  @IsIn(['accurate', 'inaccurate'])
  reviewStatus: 'accurate' | 'inaccurate';

  @ApiPropertyOptional({ description: '审核备注' })
  @IsOptional()
  @IsString()
  reviewNote?: string;
}
