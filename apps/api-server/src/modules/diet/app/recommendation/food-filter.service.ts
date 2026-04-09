import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/entities/food-library.entity';
import { Constraint } from './recommendation.types';

@Injectable()
export class FoodFilterService {
  filterFoods(
    foods: FoodLibrary[],
    constraint: Constraint,
    mealType?: string,
    userAllergens?: string[],
  ): FoodLibrary[] {
    return foods.filter((food) => {
      const tags = food.tags || [];

      // mealType 结构化过滤
      if (mealType) {
        const foodMealTypes: string[] = food.mealTypes || [];
        if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType))
          return false;
      }

      // 过敏原直接匹配
      if (userAllergens?.length) {
        const foodAllergens: string[] = food.allergens || [];
        if (userAllergens.some((a) => foodAllergens.includes(a))) return false;
      }

      // includeTag: 至少命中一个（宽松）
      if (constraint.includeTags.length > 0) {
        const hasAny = constraint.includeTags.some((tag) => tags.includes(tag));
        if (!hasAny) return false;
      }

      // excludeTag: 任一命中则排除
      if (constraint.excludeTags.length > 0) {
        const hasExcluded = constraint.excludeTags.some((tag) =>
          tags.includes(tag),
        );
        if (hasExcluded) return false;
      }

      // 热量上限
      const servingCal = (food.calories * food.standardServingG) / 100;
      if (servingCal > constraint.maxCalories) return false;

      // 蛋白质下限
      if (constraint.minProtein > 0 && food.protein) {
        const servingProtein = (food.protein * food.standardServingG) / 100;
        if (servingProtein < constraint.minProtein) return false;
      }

      return true;
    });
  }
}
