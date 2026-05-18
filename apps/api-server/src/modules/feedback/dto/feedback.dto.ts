import {
  IsInt,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export const APP_FEEDBACK_CATEGORIES = [
  'general',
  'bug',
  'suggestion',
  'account',
  'other',
] as const;

export const APP_FEEDBACK_STATUSES = [
  'open',
  'reviewing',
  'resolved',
  'closed',
] as const;

export type AppFeedbackCategory = (typeof APP_FEEDBACK_CATEGORIES)[number];
export type AppFeedbackStatus = (typeof APP_FEEDBACK_STATUSES)[number];

export class CreateAppFeedbackDto {
  @ApiProperty({ enum: APP_FEEDBACK_CATEGORIES, required: false })
  @IsIn(APP_FEEDBACK_CATEGORIES)
  @IsOptional()
  category?: AppFeedbackCategory;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  content!: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  contact?: string;

  @ApiProperty({ required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class GetAdminFeedbackQueryDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', required: false, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 20;

  @ApiProperty({ description: '搜索关键词（内容/联系方式/用户信息）', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ enum: APP_FEEDBACK_CATEGORIES, required: false })
  @IsOptional()
  @IsIn(APP_FEEDBACK_CATEGORIES)
  category?: AppFeedbackCategory;

  @ApiProperty({ enum: APP_FEEDBACK_STATUSES, required: false })
  @IsOptional()
  @IsIn(APP_FEEDBACK_STATUSES)
  status?: AppFeedbackStatus;

  @ApiProperty({ description: '用户 ID 精确筛选', required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class UpdateAdminFeedbackStatusDto {
  @ApiProperty({ enum: APP_FEEDBACK_STATUSES })
  @IsIn(APP_FEEDBACK_STATUSES)
  status!: AppFeedbackStatus;
}

export class AddAdminFeedbackNoteDto {
  @ApiProperty({ minLength: 2, maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(1000)
  content!: string;
}
