/**
 * V7.8 P5: HealthModifierEngineService 单元测试
 */
import { HealthModifierEngineService } from '../../../src/modules/diet/app/recommendation/modifier/health-modifier-engine.service';
import { createMockFoodLibrary } from '../../helpers/mock-factories';
import {
  createMockRedisCacheService,
  createMockMetricsService,
} from '../../helpers/mock-factories';
import { HealthCondition } from '../../../src/modules/diet/app/recommendation/types/recommendation.types';

describe('HealthModifierEngineService', () => {
  let service: HealthModifierEngineService;
  let mockRedis: ReturnType<typeof createMockRedisCacheService>;
  let mockMetrics: ReturnType<typeof createMockMetricsService>;

  beforeEach(() => {
    mockRedis = createMockRedisCacheService();
    mockMetrics = createMockMetricsService();
    service = new HealthModifierEngineService(
      mockRedis as any,
      mockMetrics as any,
    );
  });

  // ════════════════════════════════════════════════════════════
  // No context — baseline
  // ════════════════════════════════════════════════════════════

  describe('evaluate — no context', () => {
    it('should return multiplier 1.0 for normal food with no context', () => {
      const food = createMockFoodLibrary();
      const result = service.evaluate(food);
      expect(result.finalMultiplier).toBe(1.0);
      expect(result.isVetoed).toBe(false);
      expect(result.modifiers).toHaveLength(0);
    });

    it('should penalize fried food even without context', () => {
      const food = createMockFoodLibrary({ isFried: true });
      const result = service.evaluate(food);
      expect(result.finalMultiplier).toBeLessThan(1.0);
      expect(result.modifiers).toHaveLength(1);
      expect(result.modifiers[0].multiplier).toBe(0.92);
    });

    it('should penalize high sodium food even without context', () => {
      const food = createMockFoodLibrary({ sodium: 800 });
      const result = service.evaluate(food);
      expect(result.finalMultiplier).toBeLessThan(1.0);
      expect(result.modifiers[0].multiplier).toBe(0.94);
    });

    it('should apply severe sodium penalty for >1200mg', () => {
      const food = createMockFoodLibrary({ sodium: 1500 });
      const result = service.evaluate(food);
      expect(result.modifiers[0].multiplier).toBe(0.88);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Veto (layer 1)
  // ════════════════════════════════════════════════════════════

  describe('evaluate — veto (allergen + trans fat)', () => {
    it('should veto food matching user allergens', () => {
      const food = createMockFoodLibrary({ allergens: ['milk', 'eggs'] });
      const result = service.evaluate(food, { allergens: ['milk'] });
      expect(result.finalMultiplier).toBe(0);
      expect(result.isVetoed).toBe(true);
    });

    it('should NOT veto when no allergen overlap', () => {
      const food = createMockFoodLibrary({ allergens: ['eggs'] });
      const result = service.evaluate(food, { allergens: ['milk'] });
      expect(result.isVetoed).toBe(false);
    });

    it('should veto food with trans fat > 2g', () => {
      const food = createMockFoodLibrary({ transFat: 3 });
      const result = service.evaluate(food);
      expect(result.finalMultiplier).toBe(0);
      expect(result.isVetoed).toBe(true);
    });

    it('should NOT veto food with trans fat <= 2g', () => {
      const food = createMockFoodLibrary({ transFat: 1.5 });
      const result = service.evaluate(food);
      expect(result.isVetoed).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Goal-related penalties (layer 3)
  // ════════════════════════════════════════════════════════════

  describe('evaluate — goal penalties', () => {
    it('should penalize high-sugar food for fat_loss goal', () => {
      const food = createMockFoodLibrary({ sugar: 20 });
      const result = service.evaluate(food, { goalType: 'fat_loss' });
      const goalMod = result.modifiers.find(
        (m) => m.reason.includes('糖') || m.reason.includes('sugar'),
      );
      expect(goalMod).toBeDefined();
      expect(goalMod!.multiplier).toBe(0.9);
    });

    it('should NOT penalize low-sugar food for fat_loss goal', () => {
      const food = createMockFoodLibrary({ sugar: 5 });
      const result = service.evaluate(food, { goalType: 'fat_loss' });
      expect(result.modifiers).toHaveLength(0);
    });

    it('should penalize low-protein food for muscle_gain goal', () => {
      const food = createMockFoodLibrary({
        protein: 1,
        calories: 300,
      });
      // protein ratio = (1*4)/300 = 0.013 < 0.05
      const result = service.evaluate(food, { goalType: 'muscle_gain' });
      expect(result.finalMultiplier).toBeLessThan(1.0);
    });

    it('should NOT penalize protein-rich food for muscle_gain goal', () => {
      const food = createMockFoodLibrary({
        protein: 25,
        calories: 200,
      });
      // protein ratio = (25*4)/200 = 0.5 > 0.05
      const result = service.evaluate(food, { goalType: 'muscle_gain' });
      expect(result.modifiers.filter((m) => m.type === 'penalty')).toHaveLength(
        0,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // Health condition penalties (layer 4)
  // ════════════════════════════════════════════════════════════

  describe('evaluate — health condition penalties', () => {
    it('should penalize high-GI food for diabetes', () => {
      const food = createMockFoodLibrary({ glycemicIndex: 75 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.DIABETES_TYPE2],
      });
      const diabMod = result.modifiers.find((m) => m.type === 'penalty');
      expect(diabMod).toBeDefined();
      expect(diabMod!.multiplier).toBe(0.8); // moderate severity
    });

    it('should apply mild penalty for diabetes with mild severity', () => {
      const food = createMockFoodLibrary({ glycemicIndex: 75 });
      const result = service.evaluate(food, {
        healthConditions: [
          { condition: HealthCondition.DIABETES_TYPE2, severity: 'mild' },
        ],
      });
      const diabMod = result.modifiers.find((m) => m.type === 'penalty');
      expect(diabMod).toBeDefined();
      // mild: 1 - (1-0.8)*0.6 = 0.88
      expect(diabMod!.multiplier).toBeCloseTo(0.88, 2);
    });

    it('should apply severe penalty for diabetes with severe severity', () => {
      const food = createMockFoodLibrary({ glycemicIndex: 75 });
      const result = service.evaluate(food, {
        healthConditions: [
          { condition: HealthCondition.DIABETES_TYPE2, severity: 'severe' },
        ],
      });
      const diabMod = result.modifiers.find((m) => m.type === 'penalty');
      // severe: 1 - (1-0.8)*1.3 = 0.74
      expect(diabMod!.multiplier).toBeCloseTo(0.74, 2);
    });

    it('should penalize high-sodium food for hypertension', () => {
      const food = createMockFoodLibrary({ sodium: 500 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.HYPERTENSION],
      });
      const mod = result.modifiers.find(
        (m) => m.reason.includes('钠') || m.reason.includes('sodium'),
      );
      expect(mod).toBeDefined();
    });

    it('should veto extreme purine food for gout', () => {
      const food = createMockFoodLibrary({ purine: 350 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.GOUT],
      });
      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should penalize (not veto) moderate purine for gout', () => {
      const food = createMockFoodLibrary({ purine: 200 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.GOUT],
      });
      expect(result.isVetoed).toBe(false);
      expect(result.finalMultiplier).toBeLessThan(1.0);
    });

    it('should veto gluten for celiac disease', () => {
      const food = createMockFoodLibrary({
        tags: ['gluten'],
      });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.CELIAC_DISEASE],
      });
      expect(result.isVetoed).toBe(true);
    });

    it('should penalize high-FODMAP for IBS', () => {
      const food = createMockFoodLibrary({
        tags: ['high_fodmap'],
      });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.IBS],
      });
      expect(result.isVetoed).toBe(false);
      expect(result.finalMultiplier).toBeLessThan(1.0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Health bonuses (layer 5)
  // ════════════════════════════════════════════════════════════

  describe('evaluate — health bonuses', () => {
    it('should boost omega-3 rich food for hyperlipidemia', () => {
      const food = createMockFoodLibrary({
        tags: ['omega3_rich'],
        category: 'protein',
      });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.HYPERLIPIDEMIA],
      });
      const bonus = result.modifiers.find((m) => m.type === 'bonus');
      expect(bonus).toBeDefined();
      expect(bonus!.multiplier).toBeGreaterThan(1.0);
    });

    it('should boost low-GI food for diabetes', () => {
      const food = createMockFoodLibrary({ glycemicIndex: 30 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.DIABETES_TYPE2],
      });
      const bonus = result.modifiers.find((m) => m.type === 'bonus');
      expect(bonus).toBeDefined();
      expect(bonus!.multiplier).toBeGreaterThan(1.0);
    });

    it('should boost high-K low-Na food for hypertension', () => {
      const food = createMockFoodLibrary({
        potassium: 500,
        sodium: 50,
      });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.HYPERTENSION],
      });
      const bonus = result.modifiers.find((m) => m.type === 'bonus');
      expect(bonus).toBeDefined();
      expect(bonus!.multiplier).toBeCloseTo(1.12, 2);
    });

    it('should boost high-iron food for anemia', () => {
      const food = createMockFoodLibrary({ iron: 5 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.IRON_DEFICIENCY_ANEMIA],
      });
      const bonus = result.modifiers.find((m) => m.type === 'bonus');
      expect(bonus).toBeDefined();
      expect(bonus!.multiplier).toBeGreaterThan(1.0);
    });

    it('should boost high-calcium food for osteoporosis', () => {
      const food = createMockFoodLibrary({ calcium: 200 });
      const result = service.evaluate(food, {
        healthConditions: [HealthCondition.OSTEOPOROSIS],
      });
      const bonus = result.modifiers.find((m) => m.type === 'bonus');
      expect(bonus).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════
  // L1 cache behavior
  // ════════════════════════════════════════════════════════════

  describe('evaluate — L1 cache', () => {
    it('should cache result in provided Map', () => {
      const cache = new Map();
      const food = createMockFoodLibrary({ id: 'food-cache-test' });

      service.evaluate(food, undefined, cache);
      expect(cache.has('food-cache-test')).toBe(true);
    });

    it('should return cached result on second call', () => {
      const cache = new Map();
      const food = createMockFoodLibrary({
        id: 'food-cache-test',
        isFried: true,
      });

      const first = service.evaluate(food, undefined, cache);
      const second = service.evaluate(food, undefined, cache);
      expect(second).toBe(first); // same object reference
    });
  });

  // ════════════════════════════════════════════════════════════
  // evaluateBatch
  // ════════════════════════════════════════════════════════════

  describe('evaluateBatch', () => {
    it('should filter out vetoed foods', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          allergens: ['milk'],
        }),
        createMockFoodLibrary({
          id: '2',
          allergens: [],
        }),
      ];
      const result = service.evaluateBatch(foods, {
        allergens: ['milk'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].food.id).toBe('2');
    });

    it('should return penalty info for non-vetoed foods', () => {
      const foods = [
        createMockFoodLibrary({
          id: '1',
          isFried: true,
        }),
      ];
      const result = service.evaluateBatch(foods);
      expect(result).toHaveLength(1);
      expect(result[0].penalty.finalMultiplier).toBeLessThan(1.0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // hashContext
  // ════════════════════════════════════════════════════════════

  describe('hashContext', () => {
    it('should return "none" for undefined context', () => {
      expect(service.hashContext(undefined)).toBe('none');
    });

    it('should return same hash for same context regardless of order', () => {
      const hash1 = service.hashContext({
        allergens: ['milk', 'eggs'],
        healthConditions: ['diabetes'],
      });
      const hash2 = service.hashContext({
        allergens: ['eggs', 'milk'],
        healthConditions: ['diabetes'],
      });
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different contexts', () => {
      const hash1 = service.hashContext({ allergens: ['milk'] });
      const hash2 = service.hashContext({ allergens: ['eggs'] });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce 16-char hex string', () => {
      const hash = service.hashContext({ allergens: ['milk'] });
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Multiple conditions combination
  // ════════════════════════════════════════════════════════════

  describe('evaluate — multiple conditions', () => {
    it('should combine penalties from multiple conditions', () => {
      const food = createMockFoodLibrary({
        glycemicIndex: 75, // diabetes penalty
        sodium: 500, // hypertension penalty
      });
      const result = service.evaluate(food, {
        healthConditions: [
          HealthCondition.DIABETES_TYPE2,
          HealthCondition.HYPERTENSION,
        ],
      });
      // Should have both penalty types
      expect(
        result.modifiers.filter((m) => m.type === 'penalty').length,
      ).toBeGreaterThanOrEqual(2);
      expect(result.finalMultiplier).toBeLessThan(0.85); // combined penalties
    });
  });
});
