import type { MetadataRoute } from 'next';
import { publicRoutes, getLocalePath, getFullUrl } from '@/lib/seo/metadata';
import { i18n } from '@/lib/i18n/config';
import { foodLibraryServerAPI } from '@/lib/api/food-library';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  // 动态食物详情页
  try {
    const foods = await foodLibraryServerAPI.getAll(500);
    for (const food of foods) {
      const path = `/foods/${encodeURIComponent(food.name)}`;
      const languages: Record<string, string> = {};
      for (const locale of i18n.locales) {
        languages[locale] = getFullUrl(getLocalePath(path, locale));
      }
      entries.push({
        url: getFullUrl(getLocalePath(path, i18n.defaultLocale)),
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
        alternates: { languages },
      });
    }
  } catch {
    // API 不可用时静默处理
  }

  return entries;
}
