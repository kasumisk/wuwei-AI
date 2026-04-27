import { ApiResponse, PageResponse } from '@ai-platform/shared';
import { ClsServiceManager } from 'nestjs-cls';
import {
  I18N_DEFAULT_LOCALE,
  I18N_LOCALE_ALIAS,
  I18N_LOCALES,
  type I18nLocale,
} from '../../core/i18n/i18n.types';

const DEFAULT_RESPONSE_MESSAGES: Record<
  I18nLocale,
  { success: string; error: string }
> = {
  'en-US': { success: 'Success', error: 'Request failed' },
  'zh-CN': { success: '操作成功', error: '操作失败' },
  'ja-JP': { success: '操作が成功しました', error: '操作に失敗しました' },
};

function resolveResponseLocale(): I18nLocale {
  const raw = String(ClsServiceManager.getClsService()?.get('locale') || '').trim();
  if (I18N_LOCALES.includes(raw as I18nLocale)) {
    return raw as I18nLocale;
  }

  return I18N_LOCALE_ALIAS[raw.toLowerCase()] ?? I18N_DEFAULT_LOCALE;
}

function getDefaultSuccessMessage(): string {
  return DEFAULT_RESPONSE_MESSAGES[resolveResponseLocale()].success;
}

function getDefaultErrorMessage(): string {
  return DEFAULT_RESPONSE_MESSAGES[resolveResponseLocale()].error;
}

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
  static success<T>(data: T, message = getDefaultSuccessMessage()): ApiResponse<T> {
    return {
      code: 200,
      data,
      message,
      success: true,
    };
  }

  /**
   * 失败响应
   *
   * V6.1: 新增可选 data 参数，用于付费墙等场景返回额外信息
   */
  static error(message?: string, code?: number): ApiResponse<null>;
  static error<T>(message: string, code: number, data: T): ApiResponse<T>;
  static error<T = null>(
    message = getDefaultErrorMessage(),
    code = 500,
    data?: T,
  ): ApiResponse<T | null> {
    return {
      code,
      data: data ?? null,
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
      list: records,
      total,
      page: current,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    });
  }
}
