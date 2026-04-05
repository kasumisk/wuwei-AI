import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUrl,
} from 'class-validator';

export class GenerateImageDto {
  @ApiProperty({
    description: '图像描述提示词',
    example: 'A serene landscape with mountains and a lake at sunset',
  })
  @IsString()
  prompt: string;

  @ApiPropertyOptional({
    description: '负向提示词（不希望出现的内容）',
    example: 'blurry, low quality, distorted',
  })
  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @ApiPropertyOptional({
    description: '图像尺寸',
    example: '1024x1024',
    enum: ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
  })
  @IsOptional()
  @IsIn(['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'])
  size?: string;

  @ApiPropertyOptional({
    description: '图像质量',
    example: 'standard',
    enum: ['standard', 'hd'],
  })
  @IsOptional()
  @IsIn(['standard', 'hd'])
  quality?: 'standard' | 'hd';

  @ApiPropertyOptional({
    description: '图像风格',
    example: 'vivid',
    enum: ['natural', 'vivid'],
  })
  @IsOptional()
  @IsIn(['natural', 'vivid'])
  style?: 'natural' | 'vivid';

  @ApiPropertyOptional({
    description: '生成图像数量',
    example: 1,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  n?: number;

  @ApiPropertyOptional({
    description: '指定使用的模型',
    example: 'dall-e-3',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: '参考图像 URL（用于图像编辑或变体）',
  })
  @IsOptional()
  @IsUrl()
  referenceImage?: string;

  @ApiPropertyOptional({
    description: '蒙版图像 URL（用于图像编辑）',
  })
  @IsOptional()
  @IsUrl()
  maskImage?: string;
}
