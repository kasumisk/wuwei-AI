import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';

export enum FileCategory {
  /** 通用文件 */
  GENERAL = 'general',
  /** App 安装包 */
  APP_PACKAGE = 'app-package',
  /** 图片 */
  IMAGE = 'image',
  /** 用户头像 */
  AVATAR = 'avatar',
  /** 文档 */
  DOCUMENT = 'document',
}

export class UploadFileDto {
  @ApiPropertyOptional({
    enum: FileCategory,
    description: '文件分类，决定存储路径',
    example: FileCategory.IMAGE,
  })
  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;
}

export class PresignedUploadDto {
  @ApiProperty({ description: '文件名', example: 'app-v1.3.0.apk' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    description: 'MIME 类型',
    example: 'application/vnd.android.package-archive',
  })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiPropertyOptional({
    enum: FileCategory,
    description: '文件分类',
    example: FileCategory.APP_PACKAGE,
  })
  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;
}

export class UploadResponseDto {
  @ApiProperty({ description: '文件 key（存储路径）' })
  key: string;

  @ApiProperty({ description: '文件访问 URL' })
  url: string;

  @ApiProperty({ description: '文件大小（字节）' })
  size: number;

  @ApiProperty({ description: '文件 MD5' })
  md5: string;

  @ApiProperty({ description: 'MIME 类型' })
  mimeType: string;

  @ApiProperty({ description: '原始文件名' })
  originalName: string;
}

export class PresignedUploadResponseDto {
  @ApiProperty({ description: '预签名上传 URL，客户端直传' })
  uploadUrl: string;

  @ApiProperty({ description: '文件 key' })
  key: string;

  @ApiProperty({ description: '文件公开访问 URL' })
  url: string;

  @ApiProperty({ description: 'URL 有效期（秒）' })
  expiresIn: number;
}
