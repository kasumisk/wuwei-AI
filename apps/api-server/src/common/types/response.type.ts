import { ApiResponse, PageResponse } from '@ai-platform/shared';

/**
 * 重新导出共享类型
 */
export type { ApiResponse, PageResponse };

/**
 * 响应数据包装器
 */
export class ResponseWrapper {
  /**
   * 成功响应
   */
  static success<T>(data: T, message = '操作成功'): ApiResponse<T> {
    return {
      code: 200,
      data,
      message,
      success: true,
    };
  }

  /**
   * 失败响应
   */
  static error(message = '操作失败', code = 500): ApiResponse<null> {
    return {
      code,
      data: null,
      message,
      success: false,
    };
  }

  /**
   * 分页响应
   */
  static page<T>(
    records: T[],
    total: number,
    current: number,
    size: number,
  ): ApiResponse<PageResponse<T>> {
    return this.success({
      records,
      total,
      current,
      size,
      pages: Math.ceil(total / size),
      orders: [],
    });
  }
}
