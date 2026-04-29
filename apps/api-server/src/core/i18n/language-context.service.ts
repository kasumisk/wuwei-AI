/**
 * LanguageContext — 统一的语言上下文 facade
 *
 * 设计目标：
 *  把分散的 i18n 入口（I18nService.t / cl / translateEnum / RequestContext.locale）
 *  收口成一个注入式 service，让业务代码只 import 一个东西，避免再有人写
 *  `loc === 'en-US' ? ... : loc === 'zh-CN' ? ...` 三元。
 *
 * 用法：
 *   constructor(private readonly lang: LanguageContextService) {}
 *
 *   const locale = this.lang.locale;                  // BCP-47, e.g. 'en-US'
 *   const text   = this.lang.t('user.notFound');      // 跨模块翻译（带 namespace）
 *   const label  = this.lang.enum('mealType', 'snack'); // 枚举翻译
 *   const labels = this.lang.enumList('allergens', ['sesame','soy']);
 *   const msg    = this.lang.format(template, { name }); // 仅做插值，不查字典
 *
 * 与现有基建的关系：
 *  - 不替代 I18nService（仍是底层引擎）
 *  - 不替代 cl()（decision/coach 模块的 namespace-scoped helper 保留）
 *  - LanguageContext 主要给"跨模块 / 通用 / 不绑命名空间"的场景用
 */

import { Injectable } from '@nestjs/common';
import { I18nService } from './i18n.service';
import { I18N_DEFAULT_LOCALE, I18nLocale } from './i18n.types';
import { translateEnum, translateEnumList } from '../../common/i18n/enum-i18n';

@Injectable()
export class LanguageContextService {
  constructor(private readonly i18n: I18nService) {}

  /** 当前请求 locale（BCP-47），无 CLS 时回退默认 */
  get locale(): I18nLocale {
    return this.i18n.currentLocale();
  }

  /** 是否是给定 locale */
  is(locale: I18nLocale): boolean {
    return this.locale === locale;
  }

  /** 通用翻译（带 namespace 全 key） */
  t(key: string, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars);
  }

  /** 枚举翻译（自动 fallback 原值） */
  enum(category: string, value: string | undefined | null): string {
    return translateEnum(category, value, this.locale);
  }

  /** 枚举数组翻译 */
  enumList(
    category: string,
    values: ReadonlyArray<string> | undefined,
  ): string[] {
    return translateEnumList(category, values, this.locale);
  }

  /** 仅做 {{var}} 插值，不查字典（用于已经选好的模板字符串） */
  format(template: string, vars?: Record<string, string | number>): string {
    if (!vars) return template;
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => {
      const v = vars[name];
      return v === undefined || v === null ? '' : String(v);
    });
  }

  /** 静态默认 locale（启动期 / 非请求上下文使用） */
  static defaultLocale(): I18nLocale {
    return I18N_DEFAULT_LOCALE;
  }
}
