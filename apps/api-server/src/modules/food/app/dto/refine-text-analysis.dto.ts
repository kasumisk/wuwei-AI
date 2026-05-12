import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import { RefinedFoodInputDto } from './refine-analysis.dto';

export class RefineTextAnalysisDto {
  @ApiProperty({
    description: '用户修正后的食物列表（1~20 项）',
    type: [RefinedFoodInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RefinedFoodInputDto)
  foods!: RefinedFoodInputDto[];

  @ApiProperty({
    description: '用户备注（可选）',
    required: false,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userNote?: string;

  @ApiProperty({
    description: '客户端 locale（可选）',
    required: false,
    maxLength: 16,
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
