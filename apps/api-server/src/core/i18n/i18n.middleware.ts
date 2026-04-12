/**
 * V6.6 Phase 3-B — I18nMiddleware
 * V6.8 Phase 1-F — Locale 标准化映射 + BCP-47 格式输出
 *
 * 国际化语言检测中间件。从请求中提取目标语言并写入 CLS 上下文，
 * 供下游 Service（推荐引擎、解释生成等）读取，无需手动传参。
 *
 * 优先级：
 *   1. Query param ?lang=en / ?lang=zh-CN / ?lang=ja-JP
 *   2. Accept-Language header（取第一段，如 "en-US,en;q=0.9" → "en-US"）
 *   3. 默认 'zh-CN'
 *
 * V6.8 变更:
 *   - 添加 LOCALE_MAP 将各种格式（短代码、小写 BCP-47）标准化为 'zh-CN'|'en-US'|'ja-JP'
 *   - CLS 中存储的 locale 与 i18n-messages.ts 的 Locale 类型完全一致
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextService } from '../context/request-context.service';

/**
 * V6.8: Locale 标准化映射
 *
 * 将各种输入格式映射到 i18n-messages.ts 期望的 BCP-47 格式。
 * 不在映射表中的值会 fallback 到 'zh-CN'。
 */
const LOCALE_MAP: Record<string, string> = {
  // 中文
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW', // 预留繁体支持，fallback 到 zh-CN 在 t() 层处理
  'zh-hk': 'zh-TW',
  // 英文
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-GB', // 预留英式英语，fallback 到 en-US 在 t() 层处理
  // 日文
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
};

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // 1. Query param 优先级最高（?lang=en / ?lang=zh-CN）
    const queryLang = req.query?.['lang'] as string | undefined;

    // 2. Accept-Language header：取第一段完整 locale（保留 region）
    const acceptLangRaw = (req.headers['accept-language'] as string | undefined)
      ?.split(',')[0]
      ?.trim()
      ?.split(';')[0]; // 去掉 q= 权重

    const raw = (queryLang || acceptLangRaw || 'zh').toLowerCase();

    // V6.8: 标准化映射 — 先尝试完整匹配，再尝试取主语言部分
    const normalizedLocale =
      LOCALE_MAP[raw] ?? LOCALE_MAP[raw.split(/[-_]/)[0]] ?? 'zh-CN';

    this.ctx.setLocale(normalizedLocale);
    next();
  }
}
