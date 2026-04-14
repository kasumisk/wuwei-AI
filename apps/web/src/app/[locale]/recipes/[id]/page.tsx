import type { Metadata } from 'next';
import { RecipeDetailPage } from '@/features/recipes/components/recipe-detail-page';

export const metadata: Metadata = {
  title: '菜谱详情 - 无畏健康 uWay Health',
  description: '查看菜谱详情、食材、做法和评分',
};

export default function RecipeDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 15+ async params
  return <RecipeDetailRouteInner paramsPromise={params} />;
}

async function RecipeDetailRouteInner({
  paramsPromise,
}: {
  paramsPromise: Promise<{ id: string }>;
}) {
  const { id } = await paramsPromise;
  return <RecipeDetailPage recipeId={id} />;
}
