import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsEnum,
  MinLength,
} from 'class-validator';
import {
  LoginRequestDto as ILoginRequestDto,
  LoginByPhoneRequestDto as ILoginByPhoneRequestDto,
  LoginByTokenRequestDto as ILoginByTokenRequestDto,
  RegisterRequestDto as IRegisterRequestDto,
  SendCodeRequestDto as ISendCodeRequestDto,
  UpdateProfileRequestDto as IUpdateProfileRequestDto,
} from '@ai-platform/shared';

/**
 * NestJS DTO 类 - 用于 Swagger 文档和验证
 * 从共享接口继承类型定义
 */

export class LoginDto implements ILoginRequestDto {
  @ApiProperty({ description: '用户名、邮箱或手机号', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}

export class LoginByPhoneDto implements ILoginByPhoneRequestDto {
  @ApiProperty({ description: '手机号', example: '13800138000' })
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  phone: string;

  @ApiProperty({ description: '验证码', example: '123456' })
  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code: string;
}

export class LoginByTokenDto implements ILoginByTokenRequestDto {
  @ApiProperty({ description: 'JWT Token' })
  @IsString()
  @IsNotEmpty({ message: 'Token不能为空' })
  token: string;
}

export class RegisterDto implements IRegisterRequestDto {
  @ApiProperty({ description: '用户名', example: 'newuser' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @MinLength(3, { message: '用户名至少3个字符' })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiProperty({
    description: '手机号',
    required: false,
    example: '13800138000',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少6个字符' })
  password: string;
}

export class SendCodeDto implements ISendCodeRequestDto {
  @ApiProperty({
    description: '手机号',
    required: false,
    example: '13800138000',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: '邮箱',
    required: false,
    example: 'user@example.com',
  })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: '验证码类型',
    enum: ['login', 'register', 'reset'],
  })
  @IsEnum(['login', 'register', 'reset'], { message: '验证码类型不正确' })
  @IsNotEmpty({ message: '验证码类型不能为空' })
  type: 'login' | 'register' | 'reset';
}

export class UpdateProfileDto implements IUpdateProfileRequestDto {
  @ApiProperty({ description: '用户名', required: false })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: '用户名至少3个字符' })
  username?: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string;

  @ApiProperty({ description: '手机号', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: '头像', required: false })
  @IsString()
  @IsOptional()
  avatar?: string;
}
