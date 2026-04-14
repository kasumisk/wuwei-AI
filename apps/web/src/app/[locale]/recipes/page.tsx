import type { Metadata } from 'next';
import { RecipeListPage } from '@/features/recipes/components/recipe-list-page';

export const metadata: Metadata = {
  title: '菜谱 - 无畏健康 uWay Health',
  description: '浏览和搜索健康菜谱，按菜系、难度筛选',
};

export default function RecipesRoute() {
  return <RecipeListPage />;
}
