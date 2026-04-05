import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import {
  AppPlatform,
  UpdateType,
  AppVersionStatus,
} from '../../entities/app-version.entity';
import { AppChannel } from '../../entities/app-version-package.entity';

// ==================== Query DTOs ====================

/**
 * 获取版本列表查询参数
 */
export class GetAppVersionsQueryDto {
  @ApiPropertyOptional({ description: '页码', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页数量', example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ description: '搜索关键字（版本号/标题）' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型',
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiPropertyOptional({
    enum: AppVersionStatus,
    description: '版本状态',
  })
  @IsOptional()
  @IsEnum(AppVersionStatus)
  status?: AppVersionStatus;

  @ApiPropertyOptional({
    enum: UpdateType,
    description: '更新类型',
  })
  @IsOptional()
  @IsEnum(UpdateType)
  updateType?: UpdateType;

  @ApiPropertyOptional({ description: '渠道' })
  @IsOptional()
  @IsString()
  channel?: string;
}

// ==================== Create / Update DTOs ====================

/**
 * 创建版本 DTO
 */
export class CreateAppVersionDto {
  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型（可选，为空表示全平台通用）',
    example: AppPlatform.ANDROID,
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiProperty({
    description: '版本号 (Semantic Versioning)',
    example: '1.3.0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: '版本号格式必须为 x.y.z (Semantic Versioning)',
  })
  version: string;

  @ApiProperty({
    enum: UpdateType,
    description: '更新类型',
    example: UpdateType.OPTIONAL,
  })
  @IsEnum(UpdateType)
  updateType: UpdateType;

  @ApiProperty({ description: '更新标题', example: 'v1.3.0 新功能发布' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: '更新描述（支持 Markdown）',
    example: '- 新增功能A\n- 优化性能\n- 修复 bug',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({
    description: '最低支持版本号',
    example: '1.0.0',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: '版本号格式必须为 x.y.z',
  })
  minSupportVersion?: string;

  @ApiPropertyOptional({
    enum: AppVersionStatus,
    description: '版本状态',
    example: AppVersionStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(AppVersionStatus)
  status?: AppVersionStatus;

  @ApiPropertyOptional({ description: '是否启用灰度发布', default: false })
  @IsOptional()
  @IsBoolean()
  grayRelease?: boolean;

  @ApiPropertyOptional({
    description: '灰度发布比例 (0-100)',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  grayPercent?: number;

  @ApiPropertyOptional({ description: '发布时间' })
  @IsOptional()
  @IsString()
  releaseDate?: string;

  @ApiPropertyOptional({ description: '多语言描述' })
  @IsOptional()
  @IsObject()
  i18nDescription?: Record<string, string>;

  @ApiPropertyOptional({ description: '扩展元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 更新版本 DTO
 */
export class UpdateAppVersionDto {
  @ApiPropertyOptional({
    enum: UpdateType,
    description: '更新类型',
  })
  @IsOptional()
  @IsEnum(UpdateType)
  updateType?: UpdateType;

  @ApiPropertyOptional({ description: '更新标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '更新描述（支持 Markdown）' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '最低支持版本号' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: '版本号格式必须为 x.y.z',
  })
  minSupportVersion?: string;

  @ApiPropertyOptional({
    enum: AppVersionStatus,
    description: '版本状态',
  })
  @IsOptional()
  @IsEnum(AppVersionStatus)
  status?: AppVersionStatus;

  @ApiPropertyOptional({ description: '是否启用灰度发布' })
  @IsOptional()
  @IsBoolean()
  grayRelease?: boolean;

  @ApiPropertyOptional({ description: '灰度发布比例 (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  grayPercent?: number;

  @ApiPropertyOptional({ description: '发布时间' })
  @IsOptional()
  @IsString()
  releaseDate?: string;

  @ApiPropertyOptional({ description: '多语言描述' })
  @IsOptional()
  @IsObject()
  i18nDescription?: Record<string, string>;

  @ApiPropertyOptional({ description: '扩展元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

// ==================== Action DTOs ====================

/**
 * 发布版本 DTO
 */
export class PublishAppVersionDto {
  @ApiPropertyOptional({ description: '发布时间（留空则立即发布）' })
  @IsOptional()
  @IsString()
  releaseDate?: string;
}

// ==================== Client Check DTOs ====================

/**
 * 客户端检查更新请求 DTO
 */
export class CheckUpdateDto {
  @ApiPropertyOptional({
    enum: AppPlatform,
    description: '平台类型（可选）',
    example: 'android',
  })
  @IsOptional()
  @IsEnum(AppPlatform)
  platform?: AppPlatform;

  @ApiProperty({
    description: '当前 App 版本号',
    example: '1.2.3',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: '版本号格式必须为 x.y.z',
  })
  current_version: string;

  @ApiPropertyOptional({
    description: '分发渠道',
    example: 'official',
  })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({
    description: '设备唯一 ID（用于灰度发布）',
    example: 'abc123',
  })
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional({
    description: '客户端语言',
    example: 'zh-CN',
  })
  @IsOptional()
  @IsString()
  language?: string;
}

// ==================== Response DTOs ====================

/**
 * 版本信息响应 DTO
 */
export class AppVersionInfoDto {
  @ApiProperty({ description: '版本 ID' })
  id: string;

  @ApiProperty({ enum: AppPlatform, description: '平台类型' })
  platform: AppPlatform;

  @ApiProperty({ description: '版本号' })
  version: string;

  @ApiProperty({ description: '版本号数值' })
  versionCode: number;

  @ApiProperty({ enum: UpdateType, description: '更新类型' })
  updateType: UpdateType;

  @ApiProperty({ description: '更新标题' })
  title: string;

  @ApiProperty({ description: '更新描述' })
  description: string;

  @ApiPropertyOptional({ description: '最低支持版本号' })
  minSupportVersion?: string;

  @ApiProperty({ enum: AppVersionStatus, description: '版本状态' })
  status: AppVersionStatus;

  @ApiProperty({ description: '是否启用灰度发布' })
  grayRelease: boolean;

  @ApiProperty({ description: '灰度发布比例' })
  grayPercent: number;

  @ApiPropertyOptional({ description: '发布时间' })
  releaseDate?: Date;

  @ApiPropertyOptional({ description: '多语言描述' })
  i18nDescription?: Record<string, string>;

  @ApiPropertyOptional({ description: '扩展元数据' })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: '渠道包列表', type: 'array' })
  packages?: AppVersionPackageInfoDto[];

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/**
 * 版本列表响应 DTO
 */
export class AppVersionsListResponseDto {
  @ApiProperty({ type: [AppVersionInfoDto], description: '版本列表' })
  list: AppVersionInfoDto[];

  @ApiProperty({ description: '总数' })
  total: number;

  @ApiProperty({ description: '当前页码' })
  page: number;

  @ApiProperty({ description: '每页数量' })
  pageSize: number;
}

/**
 * 检查更新响应 DTO
 */
export class CheckUpdateResponseDto {
  @ApiProperty({ description: '是否需要更新' })
  need_update: boolean;

  @ApiPropertyOptional({ description: '最新版本号' })
  latest_version?: string;

  @ApiPropertyOptional({
    enum: UpdateType,
    description: '更新类型: optional / force',
  })
  update_type?: UpdateType;

  @ApiPropertyOptional({ description: '更新描述' })
  description?: string;

  @ApiPropertyOptional({ description: '下载链接' })
  download_url?: string;

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  file_size?: number;

  @ApiPropertyOptional({ description: '文件校验值' })
  checksum?: string;
}

// ==================== 渠道包 DTOs ====================

/**
 * 创建渠道包 DTO
 */
export class CreateAppVersionPackageDto {
  @ApiProperty({
    enum: AppPlatform,
    description: '平台类型',
    example: AppPlatform.ANDROID,
  })
  @IsEnum(AppPlatform)
  platform: AppPlatform;

  @ApiProperty({
    enum: AppChannel,
    description: '分发渠道',
    example: AppChannel.OFFICIAL,
  })
  @IsEnum(AppChannel)
  channel: AppChannel;

  @ApiProperty({
    description: '下载链接（安装包 URL 或商店 URL）',
    example: 'https://example.com/app-v1.3.0.apk',
  })
  @IsString()
  @IsNotEmpty()
  downloadUrl: string;

  @ApiPropertyOptional({ description: '文件大小（字节）', example: 20480000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @ApiPropertyOptional({ description: '文件校验值', example: 'md5:abc123' })
  @IsOptional()
  @IsString()
  checksum?: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 更新渠道包 DTO
 */
export class UpdateAppVersionPackageDto {
  @ApiPropertyOptional({ description: '下载链接' })
  @IsOptional()
  @IsString()
  downloadUrl?: string;

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @ApiPropertyOptional({ description: '文件校验值' })
  @IsOptional()
  @IsString()
  checksum?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 渠道包信息响应 DTO
 */
export class AppVersionPackageInfoDto {
  @ApiProperty({ description: '渠道包 ID' })
  id: string;

  @ApiProperty({ description: '所属版本 ID' })
  versionId: string;

  @ApiProperty({ enum: AppChannel, description: '渠道' })
  channel: string;

  @ApiProperty({ description: '下载 / 商店链接' })
  downloadUrl: string;

  @ApiProperty({ description: '文件大小（字节）' })
  fileSize: number;

  @ApiPropertyOptional({ description: '文件校验值' })
  checksum?: string;

  @ApiProperty({ description: '是否启用' })
  enabled: boolean;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}
