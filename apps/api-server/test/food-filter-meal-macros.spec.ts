/**
 * P0-B 根因#4 修复 · FoodFilter 消费 maxMealFat/maxMealCarbs 硬边界
 *
 * 背景：上一轮 P0-2 在 constraint-generator 写入了 maxMealFat/maxMealCarbs
 * 字段，但下游 food-filter / food-scorer / multi-objective-optimizer
 * 零消费点，导致脂肪偏差 +45%（三文鱼/奶酪/坚果无过滤路径）。
 *
 * 本次修复：FoodFilter 在 3g 分支新增单份脂肪/碳水上限判定
 * （> maxMealFat × 80% / > maxMealCarbs × 80% 则过滤，留 20% 给其他 role）。
 */

import { FoodFilterService } from '../src/modules/diet/app/recommendation/pipeline/food-filter.service';
import type { FoodLibrary } from '../src/modules/food/food.types';
import type { Constraint } from '../src/modules/diet/app/recommendation/types/recommendation.types';

function buildFood(
  id: string,
  fatPer100: number,
  carbsPer100: number,
  servingG: number,
  extras: Partial<FoodLibrary> = {},
): FoodLibrary {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    category: 'protein',
    calories: 200,
    protein: 20,
    fat: fatPer100,
    carbs: carbsPer100,
    fiber: 0,
    glycemicLoad: 0,
    sodium: 0,
    standardServingG: servingG,
    tags: [],
    ...extras,
  } as unknown as FoodLibrary;
}

function baseConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    includeTags: [],
    excludeTags: [],
    maxCalories: 9999,
    minProtein: 0,
    ...overrides,
  };
}

describe('FoodFilter · P0-B 餐级宏量硬边界消费', () => {
  const filter = new FoodFilterService();

  describe('maxMealFat', () => {
    it('无 maxMealFat 约束时不过滤（向后兼容）', () => {
      const foods = [buildFood('salmon', 50, 0, 150)]; // 单份 75g 脂肪
      const result = filter.filterFoods(foods, baseConstraint());
      expect(result).toHaveLength(1);
    });

    it('单份脂肪 > maxMealFat × 80% 时被过滤（三文鱼场景）', () => {
      // maxMealFat=15g → 阈值 12g。三文鱼单份 75g 脂肪远超。
      const salmon = buildFood('salmon', 50, 0, 150);
      const result = filter.filterFoods(
        [salmon],
        baseConstraint({ maxMealFat: 15 }),
      );
      expect(result).toHaveLength(0);
    });

    it('单份脂肪 ≤ maxMealFat × 80% 时保留', () => {
      // maxMealFat=20g → 阈值 16g。食物单份脂肪 15g（100g × 15/100 = 15g）通过
      const chicken = buildFood('chicken_breast', 15, 0, 100);
      const result = filter.filterFoods(
        [chicken],
        baseConstraint({ maxMealFat: 20 }),
      );
      expect(result).toHaveLength(1);
    });

    it('maxMealFat=0 视为无约束（不误过滤）', () => {
      const salmon = buildFood('salmon', 50, 0, 150);
      const result = filter.filterFoods(
        [salmon],
        baseConstraint({ maxMealFat: 0 }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('maxMealCarbs', () => {
    it('单份碳水 > maxMealCarbs × 80% 时被过滤（米饭场景）', () => {
      // maxMealCarbs=40g → 阈值 32g。一碗米饭 200g × 28/100 = 56g 被过滤。
      const rice = buildFood('rice', 1, 28, 200);
      const result = filter.filterFoods(
        [rice],
        baseConstraint({ maxMealCarbs: 40 }),
      );
      expect(result).toHaveLength(0);
    });

    it('单份碳水 ≤ maxMealCarbs × 80% 时保留', () => {
      const rice = buildFood('small_rice', 1, 28, 100); // 28g < 40×0.8=32g
      const result = filter.filterFoods(
        [rice],
        baseConstraint({ maxMealCarbs: 40 }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('fat_loss 场景端到端（复现 152/47/227 偏差）', () => {
    // 减脂用户：日 47g 脂肪 → 晚餐分配 ~15g 脂肪上限
    it('晚餐 maxMealFat=15g 应同时过滤三文鱼/奶酪/腰果高脂食物', () => {
      const foods = [
        buildFood('salmon', 13, 0, 150), // 19.5g 脂肪
        buildFood('cheese', 33, 3, 50), // 16.5g 脂肪
        buildFood('cashew', 44, 30, 30), // 13.2g 脂肪 (刚超 12g 阈值)
        buildFood('chicken_breast', 3, 0, 150), // 4.5g 脂肪（应保留）
        buildFood('egg_white', 0.2, 1, 100), // 0.2g 脂肪（应保留）
      ];
      const result = filter.filterFoods(
        foods,
        baseConstraint({ maxMealFat: 15 }),
      );
      const ids = result.map((f) => f.id).sort();
      expect(ids).toEqual(['chicken_breast', 'egg_white']);
    });
  });
});
