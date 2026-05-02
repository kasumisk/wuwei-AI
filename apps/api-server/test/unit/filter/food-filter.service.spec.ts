/**
 * V7.8 P4: FoodFilterService 单元测试
 */
import { FoodFilterService } from '../../../src/modules/diet/app/recommendation/pipeline/food-filter.service';
import { createMockFoodLibrary } from '../../helpers/mock-factories';
import type { Constraint } from '../../../src/modules/diet/app/recommendation/types/meal.types';

function createDefaultConstraint(overrides?: Partial<Constraint>): Constraint {
  return {
    includeTags: [],
    excludeTags: [],
    maxCalories: 800,
    minProtein: 0,
    ...overrides,
  };
}

describe('FoodFilterService', () => {
  let service: FoodFilterService;

  beforeEach(() => {
    service = new FoodFilterService();
  });

  // ════════════════════════════════════════════════════════════
  // Basic filtering
  // ════════════════════════════════════════════════════════════

  describe('basic filtering', () => {
    it('should return all foods when no constraints apply', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', name: 'Food A' }),
        createMockFoodLibrary({ id: '2', name: 'Food B' }),
      ];
      const result = service.filterFoods(foods, createDefaultConstraint());
      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      const result = service.filterFoods([], createDefaultConstraint());
      expect(result).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Allergen filtering
  // ════════════════════════════════════════════════════════════

  describe('allergen filtering', () => {
    it('should exclude foods matching user allergens', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          name: 'Milk',
          allergens: ['milk'],
        }),
        createMockFoodLibrary({
          id: '2',
          name: 'Chicken',
          allergens: [],
        }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint(),
        undefined,
        ['milk'],
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should keep all foods when no allergens specified', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          allergens: ['milk'],
        }),
      ];
      const result = service.filterFoods(foods, createDefaultConstraint());
      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Health condition filtering
  // ════════════════════════════════════════════════════════════

  describe('health condition filtering', () => {
    it('should exclude high-GI food for diabetes', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', glycemicIndex: 90 }),
        createMockFoodLibrary({ id: '2', glycemicIndex: 40 }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ healthConditions: ['diabetes'] }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should NOT exclude borderline-GI food for diabetes (GI=85)', () => {
      const foods = [createMockFoodLibrary({ id: '1', glycemicIndex: 85 })];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ healthConditions: ['diabetes'] }),
      );
      expect(result).toHaveLength(1);
    });

    it('should exclude high-purine food for gout', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', tags: ['high_purine'] }),
        createMockFoodLibrary({ id: '2', tags: [] }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ healthConditions: ['gout'] }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should exclude high-potassium food for kidney disease', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', potassium: 600 }),
        createMockFoodLibrary({ id: '2', potassium: 200 }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ healthConditions: ['kidney_disease'] }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should exclude gluten for celiac', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', allergens: ['wheat'] }),
        createMockFoodLibrary({ id: '2', allergens: [] }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ healthConditions: ['celiac'] }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });
  });

  // ════════════════════════════════════════════════════════════
  // Exclude tags
  // ════════════════════════════════════════════════════════════

  describe('exclude tags', () => {
    it('should exclude foods with excluded tags', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', tags: ['fried', 'oily'] }),
        createMockFoodLibrary({ id: '2', tags: ['steamed'] }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ excludeTags: ['fried'] }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should handle empty tags gracefully', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', tags: undefined as any }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ excludeTags: ['fried'] }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Calorie ceiling
  // ════════════════════════════════════════════════════════════

  describe('calorie ceiling', () => {
    it('should exclude foods exceeding max calories per serving', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          calories: 500, // per 100g
          standardServingG: 200, // serving = 1000 cal
        }),
        createMockFoodLibrary({
          id: '2',
          calories: 200, // per 100g
          standardServingG: 150, // serving = 300 cal
        }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ maxCalories: 500 }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });
  });

  // ════════════════════════════════════════════════════════════
  // Protein minimum
  // ════════════════════════════════════════════════════════════

  describe('protein minimum', () => {
    it('should exclude foods below min protein per serving', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          protein: 5, // per 100g
          standardServingG: 100, // serving = 5g protein
        }),
        createMockFoodLibrary({
          id: '2',
          protein: 25, // per 100g
          standardServingG: 100, // serving = 25g protein
        }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ minProtein: 10 }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should not apply protein filter when minProtein is 0', () => {
      const foods = [createMockFoodLibrary({ id: '1', protein: 1 })];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ minProtein: 0 }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Skill level filtering
  // ════════════════════════════════════════════════════════════

  describe('skill level filtering', () => {
    it('should exclude foods requiring higher skill than user has', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', processingLevel: 4 }),
        createMockFoodLibrary({ id: '2', processingLevel: 2 }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ skillLevel: 3 }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should allow all foods with processing <= 2 regardless of skill', () => {
      const foods = [
        createMockFoodLibrary({ id: '1', processingLevel: 1 }),
        createMockFoodLibrary({ id: '2', processingLevel: 2 }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({ skillLevel: 1 }),
      );
      expect(result).toHaveLength(2);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Combined constraints
  // ════════════════════════════════════════════════════════════

  describe('combined constraints', () => {
    it('should apply all constraints together', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          name: 'High-cal with allergen',
          allergens: ['milk'],
          calories: 1000,
          standardServingG: 100,
        }),
        createMockFoodLibrary({
          id: '2',
          name: 'Normal food',
          allergens: [],
          calories: 200,
          standardServingG: 150,
          protein: 20,
          tags: [],
        }),
        createMockFoodLibrary({
          id: '3',
          name: 'Excluded tag food',
          allergens: [],
          calories: 150,
          standardServingG: 100,
          tags: ['fried'],
        }),
      ];
      const result = service.filterFoods(
        foods,
        createDefaultConstraint({
          maxCalories: 500,
          excludeTags: ['fried'],
        }),
        undefined,
        ['milk'],
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });
  });
});
