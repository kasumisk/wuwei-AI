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
 *   3. 默认 'en-US'
 *
 * V6.8 变更:
 *   - 添加 LOCALE_MAP 将各种格式（短代码、小写 BCP-47）标准化为 'zh-CN'|'en-US'|'ja-JP'
 *   - CLS 中存储的 locale 与 i18n-messages.ts 的 Locale 类型完全一致
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextService } from '../context/request-context.service';
import { I18nService } from './i18n.service';
import { I18N_REQUEST_KEY } from './i18n.decorator';

/**
 * V6.8: Locale 标准化映射
 *
 * 将各种输入格式映射到 i18n-messages.ts 期望的 BCP-47 格式。
 * 不在映射表中的值会 fallback 到 'en-US'。
 */
const LOCALE_MAP: Record<string, string> = {
  // 中文
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-tw': 'zh-CN', // 暂回退简体；新增 zh-TW 翻译文件后在 i18n.types.ts 升级
  'zh-hk': 'zh-CN',
  'zh-hant': 'zh-CN',
  // 英文
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  // 日文
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
};

function readHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  constructor(
    private readonly ctx: RequestContextService,
    private readonly i18n: I18nService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // 1. 优先级：?lang= > x-lang header > Accept-Language > 默认
    const queryLang = req.query?.['lang'] as string | undefined;
    const xLang = readHeaderValue(req.headers['x-lang'])?.trim();
    const acceptLangRaw = readHeaderValue(req.headers['accept-language'])
      ?.split(',')[0]
      ?.trim()
      ?.split(';')[0]; // 去掉 q= 权重

    const raw = (queryLang || xLang || acceptLangRaw || 'en').toLowerCase();

    // V6.8: 标准化映射 — 先尝试完整匹配，再尝试取主语言部分
    const normalizedLocale =
      LOCALE_MAP[raw] ?? LOCALE_MAP[raw.split(/[-_]/)[0]] ?? 'en-US';

    this.ctx.setLocale(normalizedLocale);

    // 便于客户端和网关确认本次请求的最终语言解析结果。
    res.setHeader('Content-Language', normalizedLocale);
    res.setHeader('Vary', 'Accept-Language');

    // I18n V7: 挂载 service 到 request，供 @I18n() 装饰器使用
    (req as unknown as Record<symbol, I18nService>)[I18N_REQUEST_KEY] =
      this.i18n;

    next();
  }
}
