/**
 * 认证相关的请求 DTO
 */

/**
 * 用户名密码登录
 */
export interface LoginRequestDto {
  /** 用户名、邮箱或手机号 */
  username: string;
  /** 密码 */
  password: string;
}

/**
 * 手机验证码登录
 */
export interface LoginByPhoneRequestDto {
  /** 手机号 */
  phone: string;
  /** 验证码 */
  code: string;
}

/**
 * Token 登录
 */
export interface LoginByTokenRequestDto {
  /** JWT Token */
  token: string;
}

/**
 * 用户注册
 */
export interface RegisterRequestDto {
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 手机号 */
  phone?: string;
  /** 密码 */
  password: string;
}

/**
 * 发送验证码
 */
export interface SendCodeRequestDto {
  /** 手机号 */
  phone?: string;
  /** 邮箱 */
  email?: string;
  /** 验证码类型 */
  type: 'login' | 'register' | 'reset';
}

/**
 * 更新用户资料
 */
export interface UpdateProfileRequestDto {
  /** 用户名 */
  username?: string;
  /** 邮箱 */
  email?: string;
  /** 手机号 */
  phone?: string;
  /** 头像 */
  avatar?: string;
}
