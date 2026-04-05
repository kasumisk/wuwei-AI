import createMiddleware from 'next-intl/middleware';
import { i18n } from './lib/i18n/config';

export default createMiddleware({
  locales: i18n.locales,
  defaultLocale: i18n.defaultLocale,
  localePrefix: 'as-needed',
  localeDetection: false,
});

export const config = {
  // Match all pathnames except for
  // - … if they start with `/api/` or are exactly `/api` (proxied to backend)
  // - … if they start with `/_next` or `/_vercel`
  // - … the ones containing a dot (e.g. `favicon.ico`)
  matcher: ['/((?!api(?:/|$)|_next|_vercel|.*\\..*).*)'],
};
