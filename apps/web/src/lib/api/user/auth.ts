'use client';

/**
 * App 用户认证 API 服务
 * 对接 api-server 的 /api/app/auth/* 端点
 */

import { clientGet, clientPost, clientPut } from '../client-api';
import type { ApiResponse } from '../http-client';

// ==================== 辅助函数 ====================

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ==================== 类型定义 ====================

export interface AppUserInfo {
  id: string;
  authType: 'anonymous' | 'google' | 'email';
  email?: string;
  nickname?: string;
  avatar?: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppLoginResponse {
  token: string;
  user: AppUserInfo;
  isNewUser: boolean;
}

// ==================== 认证服务 ====================

export const appAuthService = {
  /**
   * 匿名登录
   */
  anonymousLogin: async (deviceId: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/anonymous', { deviceId }));
  },

  /**
   * Google 授权登录
   */
  googleLogin: async (idToken: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/google', { idToken }));
  },

  /**
   * Firebase 登录（Google/Email via Firebase）
   */
  loginWithFirebase: async (firebaseToken: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/firebase', { firebaseToken }));
  },

  /**
   * 邮箱密码注册
   */
  emailRegister: async (
    email: string,
    password: string,
    nickname?: string,
  ): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/email/register', {
      email,
      password,
      nickname,
    }));
  },

  /**
   * 邮箱密码登录
   */
  emailLogin: async (email: string, password: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/email/login', { email, password }));
  },

  /**
   * 邮箱验证码登录
   */
  emailCodeLogin: async (email: string, code: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/email/code-login', { email, code }));
  },

  /**
   * 发送邮箱验证码
   */
  sendEmailCode: async (
    email: string,
    type: 'login' | 'register' | 'reset' = 'login',
  ): Promise<{ message: string }> => {
    return unwrap(clientPost<{ message: string }>('/app/auth/email/send-code', { email, type }));
  },

  /**
   * 重置密码
   */
  resetPassword: async (
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> => {
    return unwrap(clientPost<{ message: string }>('/app/auth/email/reset-password', {
      email,
      code,
      newPassword,
    }));
  },

  /**
   * 获取当前用户信息
   */
  getProfile: async (): Promise<AppUserInfo> => {
    return unwrap(clientGet<AppUserInfo>('/app/auth/profile'));
  },

  /**
   * 更新用户资料
   */
  updateProfile: async (data: { nickname?: string; avatar?: string }): Promise<AppUserInfo> => {
    return unwrap(clientPut<AppUserInfo>('/app/auth/profile', data));
  },

  /**
   * 匿名用户升级（绑定邮箱）
   */
  upgradeAnonymous: async (email: string, password: string): Promise<AppLoginResponse> => {
    return unwrap(clientPost<AppLoginResponse>('/app/auth/upgrade', { email, password }));
  },

  /**
   * 刷新 Token
   */
  refreshToken: async (): Promise<{ token: string }> => {
    return unwrap(clientPost<{ token: string }>('/app/auth/refresh'));
  },

  /**
   * 退出登录
   */
  logout: async (): Promise<void> => {
    await unwrap(clientPost<void>('/app/auth/logout'));
  },
};

export default appAuthService;
