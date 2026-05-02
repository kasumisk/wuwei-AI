import type { Locale } from './i18n-messages';

export function normalizeDietLocale(locale?: string | null): Locale {
  if (typeof locale === 'string') {
    if (/^en(?:[-_]|$)/i.test(locale)) return 'en-US';
    if (/^ja(?:[-_]|$)/i.test(locale)) return 'ja-JP';
    if (/^zh(?:[-_]|$)/i.test(locale)) return 'zh-CN';
  }

  return 'en-US';
}

export function isChineseDietLocale(locale?: string | null): boolean {
  return normalizeDietLocale(locale) === 'zh-CN';
}
