/**
 * V6.6 Phase 3-B — I18nMiddleware
 *
 * 国际化语言检测中间件。从请求中提取目标语言并写入 CLS 上下文，
 * 供下游 Service（推荐引擎、解释生成等）读取，无需手动传参。
 *
 * 优先级：
 *   1. Query param ?lang=en
 *   2. Accept-Language header（取第一段主语言，如 "en-US" → "en"）
 *   3. 默认 'zh'
 *
 * 支持的语言：zh / en / ja
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  RequestContextService,
  SUPPORTED_LOCALES,
} from '../context/request-context.service';

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // 1. Query param 优先级最高（?lang=en）
    const queryLang = req.query?.['lang'] as string | undefined;

    // 2. Accept-Language header：取第一段，去掉 region 后缀（en-US → en）
    const acceptLang = (req.headers['accept-language'] as string | undefined)
      ?.split(',')[0]
      ?.trim()
      ?.split(/[-_]/)[0]
      ?.toLowerCase();

    const raw = queryLang || acceptLang || 'zh';
    const locale = (SUPPORTED_LOCALES as readonly string[]).includes(raw)
      ? raw
      : 'zh';

    this.ctx.setLocale(locale);
    next();
  }
}
