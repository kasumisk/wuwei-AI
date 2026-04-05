import type { MetadataRoute } from 'next';
import { siteConfig, publicRoutes, getLocalePath, getFullUrl } from '@/lib/seo/metadata';
import { i18n } from '@/lib/i18n/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const route of publicRoutes) {
    const languages: Record<string, string> = {};
    for (const locale of i18n.locales) {
      languages[locale] = getFullUrl(getLocalePath(route, locale));
    }

    entries.push({
      url: getFullUrl(getLocalePath(route, i18n.defaultLocale)),
      lastModified: new Date(),
      changeFrequency: route === '/' ? 'daily' : 'weekly',
      priority: route === '/' ? 1 : route === '/tools' ? 0.9 : 0.8,
      alternates: { languages },
    });
  }

  return entries;
}
