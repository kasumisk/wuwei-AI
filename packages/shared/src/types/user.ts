/**
 * 用户角色枚举
 */
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
}

/**
 * 用户状态枚举
 */
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
  PENDING = 'pending',
}

/**
 * 用户基础信息
 */
export interface User {
  id: string | number;
  username: string;
  email: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * 用户详细信息
 */
export interface UserDetail extends User {
  phone?: string;
  bio?: string;
  settings?: UserSettings;
  permissions?: string[];
}

/**
 * 用户设置
 */
export interface UserSettings {
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  notifications?: {
    email?: boolean;
    push?: boolean;
    sms?: boolean;
  };
}

/**
 * 登录凭证
 */
export interface LoginCredentials {
  username: string;
  password: string;
  captcha?: string;
}

/**
 * 认证响应
 */
export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: User;
  expiresIn?: number;
}

/**
 * 注册信息
 */
export interface RegisterInfo {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  captcha?: string;
}
