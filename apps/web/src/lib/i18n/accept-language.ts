import { i18n } from './config';

const LOCALE_TO_ACCEPT_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  'en-us': 'en-US',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  // 后端当前仅支持中/英/日，法语统一回退到英文
  fr: 'en-US',
  'fr-fr': 'en-US',
};

export function toAcceptLanguage(locale?: string | null): string {
  const normalized = (locale || '').trim().toLowerCase();
  return LOCALE_TO_ACCEPT_LANGUAGE[normalized] ?? LOCALE_TO_ACCEPT_LANGUAGE[normalized.split('-')[0]] ?? 'en-US';
}

export function getCurrentLocale(): string {
  if (typeof document !== 'undefined') {
    const htmlLang = document.documentElement.lang?.trim();
    if (htmlLang) return htmlLang;
  }

  if (typeof window !== 'undefined') {
    const match = window.location.pathname.match(/^\/(en|zh|ja|fr)(\/|$)/);
    if (match) return match[1];
  }

  return i18n.defaultLocale;
}

export function getClientAcceptLanguage(): string {
  return toAcceptLanguage(getCurrentLocale());
}
