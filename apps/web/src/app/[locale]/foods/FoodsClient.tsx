'use client';

import { FoodLibraryPage } from '@/features/food-library/components/food-library-page';
import type { FoodLibraryItem, FoodCategory } from '@/lib/api/food-library';

interface FoodsClientProps {
  locale: string;
  initialCategories: FoodCategory[];
  initialPopularFoods: FoodLibraryItem[];
}

export default function FoodsClient(props: FoodsClientProps) {
  return <FoodLibraryPage {...props} />;
}
