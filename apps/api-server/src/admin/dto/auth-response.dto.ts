import { ApiProperty } from '@nestjs/swagger';
import {
  LoginResponseDto as ILoginResponseDto,
  UserDto as IUserDto,
  SendCodeResponseDto as ISendCodeResponseDto,
  MessageResponseDto as IMessageResponseDto,
} from '@ai-platform/shared';

/**
 * 用户信息 DTO - 用于 Swagger 文档
 */
export class UserDto implements IUserDto {
  @ApiProperty({ description: '用户ID' })
  id: string;

  @ApiProperty({ description: '用户名' })
  username: string;

  @ApiProperty({ description: '邮箱', required: false })
  email?: string;

  @ApiProperty({ description: '手机号', required: false })
  phone?: string;

  @ApiProperty({ description: '用户角色', example: 'user' })
  role: string;

  @ApiProperty({ description: '用户状态', example: 'active' })
  status: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date | string;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date | string;

  @ApiProperty({ description: '最后登录时间', required: false })
  lastLoginAt?: Date | string;

  @ApiProperty({ description: '头像', required: false })
  avatar?: string;
}

/**
 * 登录响应 DTO
 */
export class LoginResponseDto implements ILoginResponseDto {
  @ApiProperty({ description: 'JWT Token' })
  token: string;

  @ApiProperty({ description: '用户信息', type: UserDto })
  user: UserDto;
}

/**
 * 发送验证码响应 DTO
 */
export class SendCodeResponseDto implements ISendCodeResponseDto {
  @ApiProperty({ description: '响应消息' })
  message: string;
}

/**
 * 通用消息响应 DTO
 */
export class MessageResponseDto implements IMessageResponseDto {
  @ApiProperty({ description: '响应消息' })
  message: string;
}
