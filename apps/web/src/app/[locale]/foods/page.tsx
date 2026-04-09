import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo/metadata';
import type { Locale } from '@/lib/i18n/config';
import { foodLibraryServerAPI } from '@/lib/api/food-library';
import FoodsClient from './FoodsClient';

const metaByLocale: Record<string, { title: string; description: string; keywords: string[] }> = {
  zh: {
    title: '食物热量查询',
    description:
      '查询常见食物的热量和营养成分，包括蛋白质、脂肪、碳水化合物等详细数据，帮助您科学管理饮食。',
    keywords: ['食物热量', '热量查询', '营养成分', '卡路里查询', '食物库', '减肥食谱'],
  },
  en: {
    title: 'Food Calorie Lookup',
    description:
      'Search calories and nutrition facts for common foods including protein, fat, and carbs to manage your diet scientifically.',
    keywords: [
      'food calories',
      'calorie lookup',
      'nutrition facts',
      'calorie counter',
      'food database',
    ],
  },
  ja: {
    title: '食品カロリー検索',
    description: '一般的な食品のカロリーと栄養成分を検索します。',
    keywords: ['食品カロリー', 'カロリー検索', '栄養成分'],
  },
  fr: {
    title: 'Recherche de calories',
    description:
      'Rechercher les calories et les informations nutritionnelles des aliments courants.',
    keywords: ['calories alimentaires', 'recherche de calories', 'informations nutritionnelles'],
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const meta = metaByLocale[locale] || metaByLocale.en;
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: '/foods',
    locale: locale as Locale,
    keywords: meta.keywords,
  });
}

export default async function FoodsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // SSR: 预取分类和热门食物
  let categories: Awaited<ReturnType<typeof foodLibraryServerAPI.getCategories>> = [];
  let popularFoods: Awaited<ReturnType<typeof foodLibraryServerAPI.getPopular>> = [];

  try {
    [categories, popularFoods] = await Promise.all([
      foodLibraryServerAPI.getCategories(),
      foodLibraryServerAPI.getPopular(undefined, 30),
    ]);
  } catch {
    // SSR 失败不阻塞渲染
  }

  return (
    <FoodsClient
      locale={locale}
      initialCategories={categories}
      initialPopularFoods={popularFoods}
    />
  );
}
