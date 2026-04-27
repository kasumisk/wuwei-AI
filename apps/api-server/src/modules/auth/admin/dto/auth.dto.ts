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
  @IsNotEmpty({ message: 'common.validation.usernameRequired' })
  username: string;

  @ApiProperty({ description: '密码', example: 'password123' })
  @IsString()
  @IsNotEmpty({ message: 'common.validation.passwordRequired' })
  password: string;
}

export class LoginByPhoneDto implements ILoginByPhoneRequestDto {
  @ApiProperty({ description: '手机号', example: '13800138000' })
  @IsString()
  @IsNotEmpty({ message: 'common.validation.phoneRequired' })
  phone: string;

  @ApiProperty({ description: '验证码', example: '123456' })
  @IsString()
  @IsNotEmpty({ message: 'common.validation.codeRequired' })
  code: string;
}

export class LoginByTokenDto implements ILoginByTokenRequestDto {
  @ApiProperty({ description: 'JWT Token' })
  @IsString()
  @IsNotEmpty({ message: 'common.validation.tokenRequired' })
  token: string;
}

export class RegisterDto implements IRegisterRequestDto {
  @ApiProperty({ description: '用户名', example: 'newuser' })
  @IsString()
  @IsNotEmpty({ message: 'common.validation.usernameRequired' })
  @MinLength(3, { message: 'common.validation.usernameTooShort' })
  username: string;

  @ApiProperty({ description: '邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: 'common.validation.emailInvalid' })
  @IsNotEmpty({ message: 'common.validation.emailRequired' })
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
  @IsNotEmpty({ message: 'common.validation.passwordRequired' })
  @MinLength(6, { message: 'common.validation.passwordTooShort' })
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
  @IsEmail({}, { message: 'common.validation.emailInvalid' })
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: '验证码类型',
    enum: ['login', 'register', 'reset'],
  })
  @IsEnum(['login', 'register', 'reset'], {
    message: 'common.validation.codeTypeInvalid',
  })
  @IsNotEmpty({ message: 'common.validation.codeTypeRequired' })
  type: 'login' | 'register' | 'reset';
}

export class UpdateProfileDto implements IUpdateProfileRequestDto {
  @ApiProperty({ description: '用户名', required: false })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'common.validation.usernameTooShort' })
  username?: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsEmail({}, { message: 'common.validation.emailInvalid' })
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
