// 通用类型定义
export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 统一 API 响应格式，与后端 ResponseWrapper 完全对齐：
 * { code: number, data: T, message: string, success: boolean }
 */
export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}
