import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '@/lib/seo/metadata';
import type { Locale } from '@/lib/i18n/config';
import { foodLibraryServerAPI } from '@/lib/api/food-library';
import FoodDetailClient from './FoodDetailClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; name: string }>;
}): Promise<Metadata> {
  const { locale, name } = await params;
  const decodedName = decodeURIComponent(name);

  try {
    const { food } = await foodLibraryServerAPI.getByName(decodedName);
    return buildPageMetadata({
      title: `${food.name}的热量和营养成分`,
      description: `${food.name}每100g含${food.calories}千卡热量，蛋白质${food.protein ?? '-'}g，脂肪${food.fat ?? '-'}g，碳水${food.carbs ?? '-'}g。查看详细营养数据和份量计算。`,
      path: `/foods/${encodeURIComponent(food.name)}`,
      locale: locale as Locale,
      keywords: [food.name, '热量', '营养成分', '卡路里', food.category],
    });
  } catch {
    return buildPageMetadata({
      title: `${decodedName} - 食物热量查询`,
      description: `查询${decodedName}的热量和营养成分数据。`,
      path: `/foods/${name}`,
      locale: locale as Locale,
    });
  }
}

export default async function FoodDetailPage({
  params,
}: {
  params: Promise<{ locale: string; name: string }>;
}) {
  const { locale, name } = await params;
  const decodedName = decodeURIComponent(name);

  try {
    const { food, related } = await foodLibraryServerAPI.getByName(decodedName);

    return <FoodDetailClient locale={locale} food={food} relatedFoods={related} />;
  } catch {
    notFound();
  }
}
