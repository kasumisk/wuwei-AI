/**
 * API 服务层示例
 * 将具体的业务 API 调用封装成服务
 */

import { clientGet, clientPost, clientPut, clientDelete } from './client-api';
import type { ApiResponse } from './http-client';

// ==================== 用户相关 API ====================

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  avatar?: string;
}

/**
 * 用户服务
 */
export const userService = {
  /**
   * 获取用户列表
   */
  getUsers: async (params?: { page?: number; limit?: number }) => {
    return clientGet<User[]>('/users', { params });
  },

  /**
   * 获取单个用户
   */
  getUser: async (id: string) => {
    return clientGet<User>(`/users/${id}`);
  },

  /**
   * 创建用户
   */
  createUser: async (data: CreateUserDto) => {
    return clientPost<User>('/users', data);
  },

  /**
   * 更新用户
   */
  updateUser: async (id: string, data: UpdateUserDto) => {
    return clientPut<User>(`/users/${id}`, data);
  },

  /**
   * 删除用户
   */
  deleteUser: async (id: string) => {
    return clientDelete<void>(`/users/${id}`);
  },
};

// ==================== 认证相关 API ====================

export interface LoginDto {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
}

/**
 * 认证服务
 */
export const authService = {
  /**
   * 登录
   */
  login: async (data: LoginDto) => {
    return clientPost<LoginResponse>('/gateway/auth/login', data);
  },

  /**
   * 注册
   */
  register: async (data: RegisterDto) => {
    return clientPost<User>('/gateway/auth/register', data);
  },

  /**
   * 登出
   */
  logout: async () => {
    return clientPost<void>('/gateway/auth/logout');
  },

  /**
   * 刷新 token
   */
  refreshToken: async (refreshToken: string) => {
    return clientPost<{ token: string; refreshToken: string }>('/gateway/auth/refresh', {
      refreshToken,
    });
  },

  /**
   * 获取当前用户信息
   */
  getCurrentUser: async () => {
    return clientGet<User>('/gateway/auth/me');
  },
};

// ==================== 文件上传相关 API ====================

export interface UploadResponse {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

/**
 * 文件服务
 */
export const fileService = {
  /**
   * 上传单个文件
   */
  uploadFile: async (
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<UploadResponse>> => {
    const formData = new FormData();
    formData.append('file', file);

    return clientPost<UploadResponse>('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
  },

  /**
   * 上传多个文件
   */
  uploadFiles: async (
    files: File[],
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<UploadResponse[]>> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    return clientPost<UploadResponse[]>('/upload/multiple', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
  },
};

// ==================== 导出所有服务 ====================

export const apiServices = {
  user: userService,
  auth: authService,
  file: fileService,
};

export default apiServices;
