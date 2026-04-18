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
      'AI 饮食分析',
      '营养管理',
      '热量追踪',
      '健康饮食',
      '食物分析',
      '减脂饮食',
      '增肌饮食',
      '无畏健康',
      'AI nutrition',
    ],
  });
}

export default function Page() {
  return <HomePage />;
}
