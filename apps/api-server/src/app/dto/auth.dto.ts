import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';

/**
 * Firebase Token 登录 DTO
 */
export class FirebaseLoginDto {
  @ApiProperty({ description: 'Firebase ID Token' })
  @IsString()
  @IsNotEmpty({ message: 'Firebase Token 不能为空' })
  firebaseToken: string;
}

/**
 * 匿名登录 DTO
 */
export class AnonymousLoginDto {
  @ApiProperty({ description: '设备唯一标识', example: 'device-uuid-123' })
  @IsString()
  @IsNotEmpty({ message: '设备ID不能为空' })
  deviceId: string;
}

/**
 * Google 登录 DTO
 */
export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID Token（客户端获取）' })
  @IsString()
  @IsNotEmpty({ message: 'Google ID Token 不能为空' })
  idToken: string;
}

/**
 * 邮箱注册 DTO
 */
export class EmailRegisterDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少6个字符' })
  password: string;

  @ApiPropertyOptional({ description: '昵称' })
  @IsOptional()
  @IsString()
  nickname?: string;
}

/**
 * 邮箱登录 DTO
 */
export class EmailLoginDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}

/**
 * 邮箱验证码登录 DTO（预留）
 */
export class EmailCodeLoginDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiProperty({ description: '验证码' })
  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code: string;
}

/**
 * 发送邮箱验证码 DTO
 */
export class SendEmailCodeDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiProperty({ description: '类型', enum: ['login', 'register', 'reset'] })
  @IsString()
  @IsNotEmpty()
  type: 'login' | 'register' | 'reset';
}

/**
 * 重置密码 DTO
 */
export class ResetPasswordDto {
  @ApiProperty({ description: '邮箱地址' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: '验证码' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: '新密码' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: '密码至少6个字符' })
  newPassword: string;
}

/**
 * 更新 App 用户资料 DTO
 */
export class UpdateAppUserProfileDto {
  @ApiPropertyOptional({ description: '昵称' })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: '头像URL' })
  @IsOptional()
  @IsString()
  avatar?: string;
}

/**
 * 匿名用户升级（绑定邮箱）DTO
 */
export class UpgradeAnonymousDto {
  @ApiProperty({ description: '邮箱地址' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: '密码至少6个字符' })
  password: string;
}

// ==================== 手机号登录 DTOs ====================

/**
 * 发送短信验证码 DTO
 */
export class PhoneSendCodeDto {
  @ApiProperty({ description: '手机号', example: '13800138000' })
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;
}

/**
 * 手机号验证码登录 DTO
 */
export class PhoneVerifyDto {
  @ApiProperty({ description: '手机号', example: '13800138000' })
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @ApiProperty({ description: '验证码（开发环境万能码 888888）', example: '888888' })
  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code: string;

  @ApiPropertyOptional({ description: '设备ID（可选，用于匿名升级绑定）' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

// ==================== 微信登录 DTOs ====================

/**
 * 微信扫码回调登录 DTO（前端拿到 code 后提交）
 */
export class WechatCodeLoginDto {
  @ApiProperty({ description: '微信授权 code' })
  @IsString()
  @IsNotEmpty({ message: '微信授权 code 不能为空' })
  code: string;
}

/**
 * 微信小程序登录 DTO（wx.login 获取 code）
 */
export class WechatMiniLoginDto {
  @ApiProperty({ description: '小程序 wx.login 获取的 code' })
  @IsString()
  @IsNotEmpty({ message: '小程序 code 不能为空' })
  code: string;
}
  @IsNotEmpty({ message: '微信授权 code 不能为空' })
  code: string;
}

/**
 * 获取微信授权 URL DTO
 */
export class WechatAuthUrlDto {
  @ApiProperty({ description: '授权后回调的前端页面地址' })
  @IsString()
  @IsNotEmpty({ message: '回调地址不能为空' })
  redirectUri: string;

  @ApiPropertyOptional({ description: '防 CSRF state 参数' })
  @IsOptional()
  @IsString()
  state?: string;
}

/**
 * App 用户信息响应
 */
export interface AppUserResponseDto {
  id: string;
  authType: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  status: string;
  emailVerified: boolean;
  phoneVerified?: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * App 登录响应
 */
export interface AppLoginResponseDto {
  token: string;
  user: AppUserResponseDto;
  isNewUser: boolean;
}
