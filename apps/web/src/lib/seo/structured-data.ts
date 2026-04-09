import { siteConfig, getFullUrl, getLocalePath, toolRouteKeyMap } from './metadata';
import type { Locale } from '@/lib/i18n/config';

// ─── Organization Schema ───
export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteConfig.name,
    url: siteConfig.url,
    logo: getFullUrl('/icon-192x192.png'),
  };
}

// ─── WebSite Schema (with SearchAction) ───
export function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.name,
    url: siteConfig.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteConfig.url}/tools?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// ─── WebApplication Schema (for a tool page) ───
export function buildToolSchema({
  name,
  description,
  toolSlug,
  locale,
}: {
  name: string;
  description: string;
  toolSlug: string;
  locale: Locale;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    description,
    url: getFullUrl(getLocalePath(`/tools/${toolSlug}`, locale)),
    applicationCategory: 'UtilityApplication',
    operatingSystem: 'All',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    inLanguage: localeToLang(locale),
  };
}

// ─── BreadcrumbList Schema ───
export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: getFullUrl(item.url),
    })),
  };
}

// ─── ItemList Schema (for tool listing page) ───
export function buildToolListSchema(
  tools: { name: string; slug: string; description: string }[],
  locale: Locale
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${siteConfig.name} Online Tools`,
    numberOfItems: tools.length,
    itemListElement: tools.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: tool.name,
      url: getFullUrl(getLocalePath(`/tools/${tool.slug}`, locale)),
      description: tool.description,
    })),
  };
}

// ─── helper ───
function localeToLang(locale: Locale): string {
  const map: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    fr: 'fr-FR',
    ja: 'ja-JP',
  };
  return map[locale] || 'en-US';
}
