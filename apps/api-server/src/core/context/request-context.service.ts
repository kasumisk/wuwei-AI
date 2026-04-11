/**
 * V6 Phase 1.13 — 请求上下文服务
 *
 * 基于 nestjs-cls（底层 AsyncLocalStorage）实现请求级上下文传播。
 *
 * 功能：
 * - 在任意 Service / Provider 中访问当前请求的 requestId、userId
 * - 无需手动传参，CLS 自动随 async 调用链传播
 * - Winston 日志自动附带 requestId，方便链路追踪
 *
 * 使用示例：
 * ```ts
 * constructor(private readonly ctx: RequestContextService) {}
 *
 * doSomething() {
 *   const requestId = this.ctx.requestId;
 *   const userId = this.ctx.userId; // 可能为 undefined（未认证请求）
 * }
 * ```
 */
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

/** CLS 中存储的键名常量 */
export const CLS_KEYS = {
  /** 请求唯一 ID（每个 HTTP 请求自动生成） */
  REQUEST_ID: 'requestId',
  /** 当前认证用户 ID（认证后由中间件写入） */
  USER_ID: 'userId',
  /** 请求开始时间戳（用于计算耗时） */
  START_TIME: 'startTime',
  /** V6.6 Phase 3-B: 请求语言（zh/en/ja），由 I18nMiddleware 写入 */
  LOCALE: 'locale',
} as const;

/** V6.6 Phase 3-B: 支持的语言列表 */
export const SUPPORTED_LOCALES = ['zh', 'en', 'ja'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService) {}

  // ─── 读取器 ───

  /** 获取当前请求 ID（始终存在） */
  get requestId(): string {
    return this.cls.get(CLS_KEYS.REQUEST_ID) || 'unknown';
  }

  /** 获取当前用户 ID（未认证时为 undefined） */
  get userId(): string | undefined {
    return this.cls.get(CLS_KEYS.USER_ID);
  }

  /** 获取请求开始时间戳 */
  get startTime(): number {
    return this.cls.get(CLS_KEYS.START_TIME) || Date.now();
  }

  /** 获取请求已耗时（毫秒） */
  get elapsed(): number {
    return Date.now() - this.startTime;
  }

  /** V6.6 Phase 3-B: 获取当前请求语言（默认 'zh'） */
  get locale(): string {
    return this.cls.get(CLS_KEYS.LOCALE) || 'zh';
  }

  // ─── 写入器（仅供中间件/Guard 调用） ───

  /** 设置请求 ID */
  setRequestId(id: string): void {
    this.cls.set(CLS_KEYS.REQUEST_ID, id);
  }

  /** 设置用户 ID */
  setUserId(id: string): void {
    this.cls.set(CLS_KEYS.USER_ID, id);
  }

  /** 设置请求开始时间 */
  setStartTime(ts: number): void {
    this.cls.set(CLS_KEYS.START_TIME, ts);
  }

  /** V6.6 Phase 3-B: 设置当前请求语言 */
  setLocale(locale: string): void {
    this.cls.set(CLS_KEYS.LOCALE, locale);
  }

  // ─── CLS 底层访问（高级用法） ───

  /** 判断当前是否在 CLS 上下文中（如 Cron / BullMQ Worker 可能不在） */
  get isActive(): boolean {
    return this.cls.isActive();
  }

  /** 读取任意 CLS 键 */
  get<T>(key: string): T | undefined {
    return this.cls.get(key);
  }

  /** 写入任意 CLS 键 */
  set<T>(key: string, value: T): void {
    this.cls.set(key, value);
  }
}
