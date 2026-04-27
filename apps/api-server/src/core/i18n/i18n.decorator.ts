/**
 * I18n V7 — @I18n() 参数装饰器
 *
 * 在 Controller / Resolver 方法上注入一个轻量翻译器对象：
 *
 *   @Get()
 *   foo(@I18n() i18n: I18nContext) {
 *     throw new BadRequestException(i18n.t('user.userNotFound'));
 *   }
 *
 * 内部仍然走 I18nService，但避免在每个 controller 都注入 service 字段，
 * 让"按当前请求 locale 翻译"变成显式入参，便于测试时 mock。
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { I18nService } from './i18n.service';
import type { I18nLocale, I18nTranslator } from './i18n.types';

export const I18N_REQUEST_KEY = Symbol('i18n.request');

export interface I18nContext extends I18nTranslator {}

/**
 * 必须在 I18nMiddleware 中将 service 实例挂到 req[I18N_REQUEST_KEY] 上，
 * 这样无需依赖 NestJS DI 容器即可在装饰器中拿到 service 引用。
 */
export const I18n = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): I18nContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const service = (req as unknown as Record<symbol, I18nService>)[
      I18N_REQUEST_KEY
    ];
    if (!service) {
      throw new Error(
        '[i18n] I18nService not attached to request — is I18nMiddleware registered?',
      );
    }

    const locale: I18nLocale = service.currentLocale();
    return {
      locale,
      t: (key, vars) => service.t(key, vars),
      translate: (key, l, vars) => service.translate(key, l, vars),
    };
  },
);
