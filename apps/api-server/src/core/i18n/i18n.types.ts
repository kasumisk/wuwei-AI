/**
 * I18n V7 — 类型定义
 *
 * 与 RequestContextService.SUPPORTED_LOCALES 保持一致：BCP-47 格式。
 * 新增 zh-TW 仅作为 zh-CN 的别名 fallback（暂不维护单独翻译文件）。
 */

export const I18N_LOCALES = ['en-US', 'zh-CN', 'ja-JP'] as const;
export type I18nLocale = (typeof I18N_LOCALES)[number];

/** 默认语言（fallback 终点） */
export const I18N_DEFAULT_LOCALE: I18nLocale = 'en-US';

/** 输入别名 → 标准 locale */
export const I18N_LOCALE_ALIAS: Record<string, I18nLocale> = {
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-tw': 'zh-CN', // 暂 fallback 简体；后续如新增 zh-TW 文件再调整
  'zh-hk': 'zh-CN',
  'zh-hant': 'zh-CN',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
};

/** 单个模块加载到内存中的字典： key → locale → text */
export type I18nDictionary = Record<string, Record<I18nLocale, string>>;

/** 翻译函数签名 */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface I18nTranslator {
  /** 当前请求的 locale（已规范化） */
  readonly locale: I18nLocale;
  /** 翻译，未命中时按 fallback 链 → 最终返回 key 本身 */
  t: TranslateFn;
  /** 显式指定 locale 翻译（不读 CLS） */
  translate: (
    key: string,
    locale: I18nLocale,
    vars?: Record<string, string | number>,
  ) => string;
}
