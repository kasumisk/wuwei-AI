/**
 * 通用 API 响应接口
 */
export interface ApiResponse<T = any> {
  code: number;
  data: T;
  message: string;
  success: boolean;
}

/**
 * 分页请求参数
 */
export interface PageParams {
  pageNum?: number;
  pageSize?: number;
  current?: number;
  size?: number;
  [key: string]: any;
}

/**
 * 分页响应数据
 */
export interface PageResponse<T = any> {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
  orders?: any[];
}

/**
 * 列表响应数据
 */
export interface ListResponse<T = any> {
  items: T[];
  total: number;
}

/**
 * HTTP 请求方法
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * API 错误响应
 */
export interface ApiError {
  code: number;
  message: string;
  details?: any;
  timestamp?: string;
  path?: string;
}
