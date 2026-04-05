/**
 * API 错误类
 * 统一的 API 错误处理
 */
export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }

  /**
   * 从响应数据创建 APIError
   */
  static fromResponse(statusCode: number, data: Record<string, unknown>): APIError {
    const message = 
      (typeof data.message === 'string' ? data.message : '') ||
      (typeof data.error === 'string' ? data.error : '') ||
      '请求失败';
      
    return new APIError(
      statusCode,
      message,
      typeof data.code === 'string' ? data.code : undefined,
      data.details
    );
  }

  /**
   * 是否为客户端错误 (4xx)
   */
  get isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * 是否为服务器错误 (5xx)
   */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /**
   * 是否为网络错误
   */
  get isNetworkError(): boolean {
    return this.statusCode === 0;
  }
}

/**
 * 获取错误消息
 * 从各种错误类型中提取可读的错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '发生未知错误';
}
