/**
 * API 错误类
 * 统一的 API 错误处理
 */
export interface PaywallInfo {
  code: string;
  message: string;
  recommendedTier: string;
  triggerScene?: string;
}

export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
    public paywall?: PaywallInfo
  ) {
    super(message);
    this.name = 'APIError';
  }

  /**
   * 从响应数据创建 APIError
   *
   * NestJS 403 响应格式:
   *   { statusCode: 403, message: { code, message, ... }, error: 'Forbidden' }
   * 需特殊处理 message 为对象的情况，并提取 paywall 字段。
   */
  static fromResponse(statusCode: number, data: Record<string, unknown>): APIError {
    // NestJS ForbiddenException 有时把结构体放在 message 里
    const msgObj =
      data.message && typeof data.message === 'object'
        ? (data.message as Record<string, unknown>)
        : null;

    const message =
      (typeof data.message === 'string' ? data.message : '') ||
      (msgObj && typeof msgObj.message === 'string' ? msgObj.message : '') ||
      (typeof data.error === 'string' ? data.error : '') ||
      '请求失败';

    const code =
      (typeof data.code === 'string' ? data.code : undefined) ||
      (msgObj && typeof msgObj.code === 'string' ? msgObj.code : undefined);

    // 提取 paywall 字段
    // 后端返回格式：{ code: 403, data: { paywall: {...}, type, benefits }, message, success }
    // fromResponse 收到的 data 是完整响应体，paywall 在 data.data.paywall（嵌套一层）
    // 同时兼容 data.paywall 和 msgObj?.paywall 的旧路径
    const nestedData =
      data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : null;
    const rawPaywall = (nestedData?.paywall ?? data.paywall ?? msgObj?.paywall) as
      | Record<string, unknown>
      | undefined;
    const paywall: PaywallInfo | undefined =
      rawPaywall &&
      typeof rawPaywall.code === 'string' &&
      typeof rawPaywall.recommendedTier === 'string'
        ? {
            code: rawPaywall.code,
            message: typeof rawPaywall.message === 'string' ? rawPaywall.message : message,
            recommendedTier: rawPaywall.recommendedTier,
            triggerScene:
              typeof rawPaywall.triggerScene === 'string' ? rawPaywall.triggerScene : undefined,
          }
        : undefined;

    return new APIError(statusCode, message, code, data.details, paywall);
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
