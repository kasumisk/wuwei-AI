/**
 * V8.5: MealPortionController 集成测试
 *
 * 测试每餐食物数量控制、trimExcessFoods、handleCalorieOverflow、
 * ensureRoleCoverage 等逻辑。
 */
import { MealPortionController } from '../../../src/modules/diet/app/recommendation/meal/meal-portion-controller.service';
import { PortionScalingPolicyResolver } from '../../../src/modules/diet/app/recommendation/meal/portion-scaling-policy.resolver';
import { PortionScalingMode } from '../../../src/modules/diet/app/recommendation/meal/portion-scaling-policy.types';
import type { FoodLibrary } from '../../../src/modules/food/food.types';
import type { ScoredFood } from '../../../src/modules/diet/app/recommendation/types/recommendation.types';

function makeFood(overrides: Partial<FoodLibrary> = {}): FoodLibrary {
  return {
    id: 'food-001', code: 'T001', name: '测试食物', status: 'active',
    category: 'grain', calories: 100, protein: 3, fat: 1, carbs: 20,
    fiber: 1, isProcessed: false, isFried: false, processingLevel: 0,
    commonalityScore: 80, confidence: 1, dataVersion: 1, isVerified: true,
    searchWeight: 100, popularity: 50, commonPortions: [], mealTypes: [],
    tags: [], allergens: [], compatibility: {}, standardServingG: 100,
    primarySource: 'manual', createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as FoodLibrary;
}

function makeScoredFood(
  food: FoodLibrary,
  score: number = 5,
  servingCal: number = 100,
): ScoredFood {
  return {
    food,
    score,
    servingCalories: servingCal,
    servingProtein: 5,
    servingFat: 3,
    servingCarbs: 15,
    servingFiber: 1,
    servingGL: 0,
  };
}

describe('MealPortionController', () => {
  let controller: MealPortionController;
  let resolver: PortionScalingPolicyResolver;

  beforeEach(() => {
    controller = new MealPortionController();
    resolver = new PortionScalingPolicyResolver();
  });

  describe('trimExcessFoods — 控制每餐食物数量', () => {
    it('早餐超过4个食物时移除低优先级', () => {
      const foods = [
        makeFood({ id: 'r', name: '米饭', category: 'grain', foodForm: 'ingredient' }),
        makeFood({ id: 'p', name: '鸡胸肉', category: 'meat', foodForm: 'ingredient' }),
        makeFood({ id: 'v', name: '西兰花', category: 'vegetable', foodForm: 'ingredient' }),
        makeFood({ id: 'd', name: '牛奶', category: 'beverage', foodForm: 'ingredient' }),
        makeFood({ id: 'o', name: '橄榄油', category: 'condiment' }),
        makeFood({ id: 'e', name: '鸡蛋', category: 'egg', foodForm: 'ingredient' }), // 第6个
      ];
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f, 5, f.calories));

      const { kept, removed } = controller.trimExcessFoods(picks, 'breakfast', policies);

      // 早餐 max=4，6-4=2 个应被移除
      expect(kept.length).toBe(4);
      expect(removed.length).toBe(2);
      // 调味品 olive oil 被第一个移除
      expect(removed.some((r) => r.food.name === '橄榄油')).toBe(true);
    });

    it('午餐不超过5个食物', () => {
      const foods = [1, 2, 3, 4, 5, 6, 7].map((i) =>
        makeFood({ id: `f${i}`, name: `食物${i}`, category: 'grain', foodForm: 'ingredient' }),
      );
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f, 5, 100));

      const { kept, removed } = controller.trimExcessFoods(picks, 'lunch', policies);

      expect(kept.length).toBe(5);
      expect(removed.length).toBe(2);
    });

    it('加餐不超过2个食物', () => {
      const foods = [1, 2, 3].map((i) =>
        makeFood({ id: `f${i}`, name: `食物${i}`, category: 'snack' }),
      );
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f, 5, 100));

      const { kept, removed } = controller.trimExcessFoods(picks, 'snack', policies);

      expect(kept.length).toBe(2);
      expect(removed.length).toBe(1);
    });

    it('食物数量在范围内时不移除', () => {
      const foods = [1, 2, 3].map((i) =>
        makeFood({ id: `f${i}`, name: `食物${i}`, category: 'grain', foodForm: 'ingredient' }),
      );
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f));

      const { kept, removed } = controller.trimExcessFoods(picks, 'lunch', policies);

      expect(kept.length).toBe(3);
      expect(removed.length).toBe(0);
    });
  });

  describe('handleCalorieOverflow — 超标处理', () => {
    it('调味品在超标时被移除', () => {
      const foods = [
        makeFood({ id: 'r', name: '米饭', category: 'grain' }),
        makeFood({ id: 'p', name: '鸡胸肉', category: 'meat' }),
        makeFood({ id: 'o', name: '橄榄油', category: 'condiment' }),
      ];
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f, 5, 150)); // 150*3=450 > budget*1.05=262

      const result = controller.handleCalorieOverflow(picks, policies, 250);

      expect(result.didPrune).toBe(true);
      expect(result.prunedNames).toContain('橄榄油');
      expect(result.picks.length).toBeLessThan(3);
    });

    it('不超标时不修改', () => {
      const foods = [
        makeFood({ id: 'r', name: '米饭', category: 'grain' }),
        makeFood({ id: 'p', name: '鸡胸肉', category: 'meat' }),
      ];
      const policies = resolver.resolveAll(foods);
      const picks = foods.map((f) => makeScoredFood(f, 5, 100)); // 200 <= 250*1.05

      const result = controller.handleCalorieOverflow(picks, policies, 250);

      expect(result.didPrune).toBe(false);
      expect(result.prunedNames.length).toBe(0);
      expect(result.picks.length).toBe(2);
    });
  });

  describe('ensureRoleCoverage — 角色覆盖', () => {
    it('缺少主食时补位', () => {
      const picks = [
        makeScoredFood(makeFood({ id: 'p', name: '鸡胸肉', category: 'meat' })),
        makeScoredFood(makeFood({ id: 'v', name: '西兰花', category: 'vegetable' })),
      ];
      const candidates = [
        makeScoredFood(makeFood({ id: 'r', name: '米饭', category: 'grain' }), 5, 116),
      ];
      const policies = resolver.resolveAll(
        [...picks.map((p) => p.food), ...candidates.map((c) => c.food)],
      );
      const usedNames = new Set<string>(picks.map((p) => p.food.name));

      const result = controller.ensureRoleCoverage(picks, candidates, policies, usedNames);

      expect(result.length).toBe(3);
      expect(result.some((p) => p.food.id === 'r')).toBe(true);
    });

    it('已有全角色时不补位', () => {
      const picks = [
        makeScoredFood(makeFood({ id: 'r', name: '米饭', category: 'grain' })),
        makeScoredFood(makeFood({ id: 'p', name: '鸡胸肉', category: 'meat' })),
        makeScoredFood(makeFood({ id: 'v', name: '西兰花', category: 'vegetable' })),
      ];
      const policies = resolver.resolveAll(picks.map((p) => p.food));
      const usedNames = new Set<string>(picks.map((p) => p.food.name));

      const result = controller.ensureRoleCoverage(picks, [], policies, usedNames);

      expect(result.length).toBe(3);
    });
  });
});
