import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MinLength,
  IsInt,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ResetPasswordDto as IResetPasswordDto,
  ManagementUserStatus,
} from '@ai-platform/shared';

type ManagementAdminRole = 'admin' | 'super_admin';

/**
 * 获取用户列表查询参数
 */
export class GetUsersQueryDto {
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

  @ApiProperty({ description: '搜索关键词', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({
    description: '角色筛选',
    enum: ['admin', 'super_admin'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['admin', 'super_admin'])
  role?: ManagementAdminRole;

  @ApiProperty({
    description: '状态筛选',
    enum: ManagementUserStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(ManagementUserStatus)
  status?: ManagementUserStatus;
}

/**
 * 创建用户 DTO
 */
export class CreateUserDto {
  @ApiProperty({
    description: '用户名，不传时后端按邮箱自动生成',
    example: 'newuser',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MinLength(3)
  username?: string;

  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: '密码，Firebase Google 登录场景下可为空',
    example: 'password123',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiProperty({ description: '角色', enum: ['admin', 'super_admin'] })
  @IsEnum(['admin', 'super_admin'])
  @IsNotEmpty()
  role: ManagementAdminRole;

  @ApiProperty({ description: '昵称', required: false })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({ description: '手机号', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: '状态',
    enum: ManagementUserStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(ManagementUserStatus)
  status?: ManagementUserStatus;
}

/**
 * 更新用户 DTO
 */
export class UpdateUserDto {
  @ApiProperty({ description: '邮箱', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: '昵称', required: false })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({ description: '手机号', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: '角色',
    enum: ['admin', 'super_admin'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['admin', 'super_admin'])
  role?: ManagementAdminRole;

  @ApiProperty({
    description: '状态',
    enum: ManagementUserStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(ManagementUserStatus)
  status?: ManagementUserStatus;

  @ApiProperty({ description: '头像', required: false })
  @IsOptional()
  @IsString()
  avatar?: string;
}

/**
 * 重置密码 DTO
 */
export class AdminResetPasswordDto implements IResetPasswordDto {
  @ApiProperty({ description: '新密码', example: 'newpassword123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
