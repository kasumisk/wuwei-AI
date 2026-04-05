/**
 * 认证相关的响应 DTO
 */

/**
 * 用户信息
 */
export interface UserDto {
  /** 用户ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email?: string;

  isAdmin?: boolean;
  /** 手机号 */
  phone?: string;
  /** 用户角色 */
  role: string;
  /** 用户状态 */
  status: string;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
  /** 最后登录时间 */
  lastLoginAt?: Date | string;
  /** 头像 */
  avatar?: string;
}

/**
 * 登录响应
 */
export interface LoginResponseDto {
  /** JWT Token */
  token: string;
  /** 用户信息 */
  user: UserDto;
}

/**
 * 发送验证码响应
 */
export interface SendCodeResponseDto {
  /** 响应消息 */
  message: string;
}

/**
 * 通用消息响应
 */
export interface MessageResponseDto {
  /** 响应消息 */
  message: string;
}
