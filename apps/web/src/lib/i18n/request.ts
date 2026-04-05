import { getRequestConfig } from 'next-intl/server';
import { i18n } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  
  if (!locale || !i18n.locales.includes(locale as (typeof i18n.locales)[number])) {
    locale = i18n.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
