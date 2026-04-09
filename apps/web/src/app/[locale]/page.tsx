import { getTranslations } from 'next-intl/server';
import { getLocale } from 'next-intl/server';
import { HomePage } from '@/features/home/components/home-page';
import { buildPageMetadata } from '@/lib/seo/metadata';
import type { Locale } from '@/lib/i18n/config';

export async function generateMetadata() {
  const t = await getTranslations('common');
  const locale = (await getLocale()) as Locale;
  return buildPageMetadata({
    title: t('appTitle'),
    description: t('appDescription'),
    path: '/',
    locale,
    keywords: [
      'online tools',
      'image converter',
      'video compressor',
      'PDF tools',
      'QR code generator',
      'JSON formatter',
      'regex tester',
      'base64',
      'free tools',
    ],
  });
}

export default function Page() {
  return <HomePage />;
}
