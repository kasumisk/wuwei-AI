import type { Metadata } from 'next';
import { i18n, type Locale } from '@/lib/i18n/config';

// ─── Site Configuration ───
export const siteConfig = {
  name: 'Procify toolkit',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  ogImage: '/og-image.png',
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192x192.png',
  },
} as const;

// ─── Locale → OpenGraph locale mapping ───
const ogLocaleMap: Record<Locale, string> = {
  en: 'en_US',
  zh: 'zh_CN',
  fr: 'fr_FR',
  ja: 'ja_JP',
};

// ─── Tool page route → translation key mapping ───
export const toolRouteKeyMap: Record<string, string> = {
  'image-converter': 'imageConverter',
  'image-compressor': 'imageCompressor',
  'color-picker': 'colorPicker',
  'image-cropper': 'imageCropper',
  'video-converter': 'videoConverter',
  'video-compressor': 'videoCompressor',
  'pdf-to-image': 'pdfToImage',
  'image-to-pdf': 'imageToPdf',
  'pdf-to-text': 'pdfToText',
  'pdf-merge-split': 'pdfMergeSplit',
  'json-formatter': 'jsonFormatter',
  regex: 'regexTester',
  timestamp: 'timestampConverter',
  base64: 'base64',
  qrcode: 'qrcode',
};

// ─── All public routes for sitemap / hreflang ───
export const publicRoutes = [
  '/',
  '/tools',
  '/foods',
  ...Object.keys(toolRouteKeyMap).map((k) => `/tools/${k}`),
];

// ─── Helper: build locale path ───
export function getLocalePath(path: string, locale: Locale): string {
  if (locale === i18n.defaultLocale) return path;
  return `/${locale}${path}`;
}

// ─── Helper: full URL ───
export function getFullUrl(path: string): string {
  return `${siteConfig.url}${path}`;
}

// ─── Build alternates (hreflang + canonical) ───
export function buildAlternates(path: string, locale: Locale) {
  const languages: Record<string, string> = {};
  for (const loc of i18n.locales) {
    languages[loc] = getFullUrl(getLocalePath(path, loc));
  }
  languages['x-default'] = getFullUrl(getLocalePath(path, i18n.defaultLocale));

  return {
    canonical: getFullUrl(getLocalePath(path, locale)),
    languages,
  };
}

// ─── Build full page metadata ───
export function buildPageMetadata({
  title,
  description,
  path,
  locale,
  keywords,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  locale: Locale;
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const fullTitle = `${title} | ${siteConfig.name}`;
  const url = getFullUrl(getLocalePath(path, locale));

  return {
    title: fullTitle,
    description,
    ...(keywords && { keywords }),
    ...(noIndex && { robots: { index: false, follow: false } }),
    alternates: buildAlternates(path, locale),
    openGraph: {
      type: 'website',
      locale: ogLocaleMap[locale] || 'en_US',
      url,
      title: fullTitle,
      description,
      siteName: siteConfig.name,
      images: [
        {
          url: getFullUrl(siteConfig.ogImage),
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [getFullUrl(siteConfig.ogImage)],
    },
  };
}
