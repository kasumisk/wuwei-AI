import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * App 用户查询参数
 */
export class GetAppUsersQueryDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', required: false, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 10;

  @ApiProperty({ description: '搜索关键词（昵称/邮箱）', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({
    description: '认证方式筛选',
    enum: ['anonymous', 'google', 'email'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['anonymous', 'google', 'email'])
  authType?: string;

  @ApiProperty({
    description: '状态筛选',
    enum: ['active', 'inactive', 'banned'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['active', 'inactive', 'banned'])
  status?: string;
}

/**
 * 更新 App 用户（管理员操作）
 */
export class UpdateAppUserByAdminDto {
  @ApiProperty({ description: '昵称', required: false })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({ description: '头像', required: false })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiProperty({
    description: '状态',
    enum: ['active', 'inactive', 'banned'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['active', 'inactive', 'banned'])
  status?: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}
