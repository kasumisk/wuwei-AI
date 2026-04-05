/**
 * App 用户相关类型定义
 */

/**
 * App 用户认证方式
 */
export enum AppUserAuthType {
  ANONYMOUS = 'anonymous',
  GOOGLE = 'google',
  EMAIL = 'email',
}

/**
 * App 用户状态
 */
export enum AppUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

/**
 * App 用户信息
 */
export interface AppUserInfo {
  id: string;
  authType: AppUserAuthType;
  email?: string;
  nickname?: string;
  avatar?: string;
  status: AppUserStatus;
  emailVerified: boolean;
  lastLoginAt?: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * App 登录响应
 */
export interface AppLoginResponse {
  token: string;
  user: AppUserInfo;
  isNewUser: boolean;
}

/**
 * 匿名登录请求
 */
export interface AnonymousLoginRequest {
  deviceId: string;
}

/**
 * Google 登录请求
 */
export interface GoogleLoginRequest {
  idToken: string;
}

/**
 * 邮箱注册请求
 */
export interface EmailRegisterRequest {
  email: string;
  password: string;
  nickname?: string;
}

/**
 * 邮箱登录请求
 */
export interface EmailLoginRequest {
  email: string;
  password: string;
}

/**
 * 邮箱验证码登录请求
 */
export interface EmailCodeLoginRequest {
  email: string;
  code: string;
}

/**
 * 发送邮箱验证码请求
 */
export interface SendEmailCodeRequest {
  email: string;
  type: 'login' | 'register' | 'reset';
}

/**
 * 重置密码请求
 */
export interface AppResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/**
 * 更新 App 用户资料请求
 */
export interface UpdateAppUserProfileRequest {
  nickname?: string;
  avatar?: string;
}

/**
 * 匿名用户升级请求
 */
export interface UpgradeAnonymousRequest {
  email: string;
  password: string;
}
