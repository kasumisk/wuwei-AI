import {
  HealthModifierEngineService,
  HealthModifierContext,
  HealthModifierResult,
  HealthConditionWithSeverity,
} from '../src/modules/diet/app/recommendation/health-modifier-engine.service';
import { FoodLibrary } from '../src/modules/food/entities/food-library.entity';

// ───────────────────── helpers ─────────────────────

/**
 * Create a mock FoodLibrary with safe defaults.
 * All nutritional values default to 0 / empty so tests only
 * set the fields they care about.
 */
function createMockFood(overrides: Partial<FoodLibrary> = {}): FoodLibrary {
  return {
    id: 'food-001',
    code: 'FOOD_TEST_001',
    name: 'Test Food',
    status: 'active',
    category: 'protein',
    calories: 100,
    protein: 20,
    fat: 5,
    carbs: 10,
    sugar: 2,
    fiber: 1,
    saturatedFat: 1,
    transFat: 0,
    cholesterol: 30,
    sodium: 200,
    glycemicIndex: 40,
    isFried: false,
    isProcessed: false,
    processingLevel: 1,
    allergens: [],
    tags: [],
    mealTypes: [],
    mainIngredient: undefined,
    compatibility: {},
    standardServingG: 100,
    commonPortions: [],
    primarySource: 'manual',
    dataVersion: 1,
    confidence: 1,
    isVerified: false,
    searchWeight: 100,
    popularity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    translations: [],
    sources: [],
    changeLogs: [],
    conflicts: [],
    ...overrides,
  } as FoodLibrary;
}

// ───────────────────── tests ─────────────────────

/** 从 HealthModifierResult 中提取原因字符串数组（兼容旧测试断言） */
function reasons(result: HealthModifierResult): string[] {
  return result.modifiers.map((m) => m.reason);
}

describe('HealthModifierEngineService', () => {
  let service: HealthModifierEngineService;

  beforeEach(() => {
    service = new HealthModifierEngineService();
  });

  // ═══════════════════════════════════════════════
  //  Basic behaviour
  // ═══════════════════════════════════════════════

  describe('evaluate() — basics', () => {
    it('should return multiplier 1.0 with no reasons when context is undefined', () => {
      const food = createMockFood();
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBe(1.0);
      expect(reasons(result)).toEqual([]);
      expect(result.isVetoed).toBe(false);
    });

    it('should return multiplier 1.0 when context is empty', () => {
      const food = createMockFood();
      const result = service.evaluate(food, {});

      expect(result.finalMultiplier).toBe(1.0);
      expect(reasons(result)).toEqual([]);
      expect(result.isVetoed).toBe(false);
    });

    it('should return multiplier 1.0 for a clean food with full context', () => {
      const food = createMockFood({
        // healthy defaults — low sodium, low sugar, high protein, low GI
        sodium: 100,
        sugar: 2,
        protein: 25,
        calories: 120,
        glycemicIndex: 45, // 使用 40-55 范围的 GI，不触发惩罚也不触发低GI增益(<40)
        saturatedFat: 1,
        cholesterol: 20,
        isFried: false,
        transFat: 0,
        allergens: [],
      });

      const ctx: HealthModifierContext = {
        allergens: ['shellfish'],
        healthConditions: ['diabetes_type2', 'hypertension', 'hyperlipidemia'],
        goalType: 'fat_loss',
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
      expect(reasons(result)).toEqual([]);
      expect(result.isVetoed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════
  //  Layer 1 — Hard veto
  // ═══════════════════════════════════════════════

  describe('Layer 1 — Allergen veto', () => {
    it('should veto when food.allergens matches user allergens', () => {
      const food = createMockFood({ allergens: ['dairy', 'gluten'] });
      const ctx: HealthModifierContext = { allergens: ['dairy'] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
      expect(reasons(result).length).toBeGreaterThan(0);
      expect(reasons(result)[0]).toContain('dairy');
    });

    it('should veto when food has multiple allergens matching multiple user allergens', () => {
      const food = createMockFood({ allergens: ['dairy', 'nuts', 'soy'] });
      const ctx: HealthModifierContext = { allergens: ['nuts', 'soy'] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should NOT veto when allergens do not overlap', () => {
      const food = createMockFood({ allergens: ['gluten'] });
      const ctx: HealthModifierContext = { allergens: ['dairy'] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(false);
      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT veto when food has no allergens', () => {
      const food = createMockFood({ allergens: [] });
      const ctx: HealthModifierContext = { allergens: ['dairy', 'nuts'] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(false);
    });

    it('should NOT veto when context has no allergens', () => {
      const food = createMockFood({ allergens: ['dairy'] });
      const ctx: HealthModifierContext = { allergens: [] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(false);
    });
  });

  describe('Layer 1 — Trans fat veto', () => {
    it('should veto when transFat > 2g per 100g', () => {
      const food = createMockFood({ transFat: 2.5 });
      const result = service.evaluate(food);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
      expect(reasons(result)[0]).toContain('2.5');
    });

    it('should veto when transFat is exactly 2.01', () => {
      const food = createMockFood({ transFat: 2.01 });
      const result = service.evaluate(food);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should NOT veto when transFat is exactly 2', () => {
      const food = createMockFood({ transFat: 2 });
      const result = service.evaluate(food);

      expect(result.isVetoed).toBe(false);
    });

    it('should NOT veto when transFat is 0', () => {
      const food = createMockFood({ transFat: 0 });
      const result = service.evaluate(food);

      expect(result.isVetoed).toBe(false);
    });

    it('should handle transFat as undefined (treated as 0)', () => {
      const food = createMockFood({ transFat: undefined });
      const result = service.evaluate(food);

      expect(result.isVetoed).toBe(false);
    });

    it('allergen veto takes precedence over trans fat veto (early return)', () => {
      const food = createMockFood({
        allergens: ['dairy'],
        transFat: 5,
      });
      const ctx: HealthModifierContext = { allergens: ['dairy'] };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
      // Should mention allergen, not trans fat (allergen check comes first)
      expect(reasons(result)[0]).toContain('dairy');
    });
  });

  // ═══════════════════════════════════════════════
  //  Layer 2 — Heavy penalties
  // ═══════════════════════════════════════════════

  describe('Layer 2 — Fried food penalty', () => {
    it('should apply 0.92 multiplier for fried food', () => {
      const food = createMockFood({ isFried: true });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.92, 5);
      expect(result.isVetoed).toBe(false);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should NOT penalize non-fried food', () => {
      const food = createMockFood({ isFried: false });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBe(1.0);
      expect(reasons(result)).toHaveLength(0);
    });
  });

  describe('Layer 2 — Sodium penalty', () => {
    it('should apply 0.94 multiplier for sodium 601-1200', () => {
      const food = createMockFood({ sodium: 700 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.94, 5);
      expect(result.isVetoed).toBe(false);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should apply 0.88 multiplier for sodium > 1200', () => {
      const food = createMockFood({ sodium: 1300 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.88, 5);
      expect(result.isVetoed).toBe(false);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should apply 0.88 for sodium exactly 1201', () => {
      const food = createMockFood({ sodium: 1201 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.88, 5);
    });

    it('should apply 0.94 for sodium exactly 601', () => {
      const food = createMockFood({ sodium: 601 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.94, 5);
    });

    it('should NOT penalize sodium at exactly 600', () => {
      const food = createMockFood({ sodium: 600 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize low sodium', () => {
      const food = createMockFood({ sodium: 100 });
      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBe(1.0);
    });
  });

  describe('Layer 2 — Fried + Sodium stacking', () => {
    it('should stack fried and moderate sodium penalties', () => {
      const food = createMockFood({ isFried: true, sodium: 800 });
      const result = service.evaluate(food);

      // 0.92 * 0.94 = 0.8648
      expect(result.finalMultiplier).toBeCloseTo(0.92 * 0.94, 5);
      expect(reasons(result)).toHaveLength(2);
    });

    it('should stack fried and severe sodium penalties', () => {
      const food = createMockFood({ isFried: true, sodium: 1500 });
      const result = service.evaluate(food);

      // 0.92 * 0.88 = 0.8096
      expect(result.finalMultiplier).toBeCloseTo(0.92 * 0.88, 5);
      expect(reasons(result)).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════
  //  Layer 3 — Goal penalties
  // ═══════════════════════════════════════════════

  describe('Layer 3 — fat_loss goal', () => {
    it('should penalize high sugar (>15) for fat_loss goal', () => {
      const food = createMockFood({ sugar: 20 });
      const ctx: HealthModifierContext = { goalType: 'fat_loss' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should penalize sugar at 16 for fat_loss goal', () => {
      const food = createMockFood({ sugar: 16 });
      const ctx: HealthModifierContext = { goalType: 'fat_loss' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
    });

    it('should NOT penalize sugar at 15 for fat_loss goal', () => {
      const food = createMockFood({ sugar: 15 });
      const ctx: HealthModifierContext = { goalType: 'fat_loss' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize high sugar for non-fat_loss goal', () => {
      const food = createMockFood({ sugar: 30 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      const result = service.evaluate(food, ctx);

      // muscle_gain may or may not trigger its own penalty, but sugar shouldn't
      expect(reasons(result).every((r) => !r.includes('高糖'))).toBe(true);
    });
  });

  describe('Layer 3 — muscle_gain goal', () => {
    it('should penalize low protein ratio for muscle_gain (calories > 100, protein ratio < 5%)', () => {
      // protein=2, calories=200 → ratio = (2*4)/200 = 0.04 = 4% < 5%
      const food = createMockFood({ calories: 200, protein: 2 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should NOT penalize when protein ratio >= 5%', () => {
      // protein=5, calories=200 → ratio = (5*4)/200 = 0.10 = 10% >= 5%
      const food = createMockFood({ calories: 200, protein: 5 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize when calories <= 100 (even with low protein)', () => {
      // Low calorie food — don't penalize
      const food = createMockFood({ calories: 80, protein: 0 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should penalize at boundary: calories=101, protein giving ratio just under 5%', () => {
      // protein=1, calories=101 → ratio = (1*4)/101 ≈ 0.0396 < 5%
      const food = createMockFood({ calories: 101, protein: 1 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
    });
  });

  // ═══════════════════════════════════════════════
  //  Layer 4 — Health condition penalties
  // ═══════════════════════════════════════════════

  describe('Layer 4 — diabetes_type2', () => {
    it('should apply 0.8 multiplier for high GI (>70)', () => {
      const food = createMockFood({ glycemicIndex: 75 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.8, 5);
      expect(reasons(result)).toHaveLength(1);
      expect(reasons(result)[0]).toContain('75');
    });

    it('should apply 0.9 multiplier for medium GI (55 < GI <= 70)', () => {
      const food = createMockFood({ glycemicIndex: 65 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
    });

    it('should apply 0.9 multiplier for GI exactly 56', () => {
      const food = createMockFood({ glycemicIndex: 56 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
    });

    it('should NOT penalize for GI exactly 55', () => {
      const food = createMockFood({ glycemicIndex: 55 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize for low GI (<=55)', () => {
      const food = createMockFood({ glycemicIndex: 40 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should normalize alias "diabetes" to diabetes_type2', () => {
      const food = createMockFood({ glycemicIndex: 75 });
      const ctx: HealthModifierContext = { healthConditions: ['diabetes'] };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.8, 5);
      expect(result.isVetoed).toBe(false);
    });
  });

  describe('Layer 4 — hypertension', () => {
    it('should apply 0.85 multiplier for sodium > 400', () => {
      const food = createMockFood({ sodium: 500 });
      const ctx: HealthModifierContext = { healthConditions: ['hypertension'] };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should NOT penalize for sodium exactly 400', () => {
      const food = createMockFood({ sodium: 400 });
      const ctx: HealthModifierContext = { healthConditions: ['hypertension'] };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize for low sodium', () => {
      const food = createMockFood({ sodium: 200 });
      const ctx: HealthModifierContext = { healthConditions: ['hypertension'] };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should stack with Layer 2 sodium penalty (sodium > 600)', () => {
      // sodium=700 triggers both: Layer 2 (*0.94) + Layer 4 hypertension (*0.85)
      const food = createMockFood({ sodium: 700 });
      const ctx: HealthModifierContext = { healthConditions: ['hypertension'] };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.94 * 0.85, 5);
      expect(reasons(result)).toHaveLength(2);
    });
  });

  describe('Layer 4 — hyperlipidemia', () => {
    it('should apply 0.9 for high saturated fat (>5)', () => {
      const food = createMockFood({ saturatedFat: 8, cholesterol: 50 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should apply 0.9 for high cholesterol (>100)', () => {
      const food = createMockFood({ saturatedFat: 2, cholesterol: 150 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should stack both: high saturatedFat + high cholesterol → 0.9 * 0.9', () => {
      const food = createMockFood({ saturatedFat: 8, cholesterol: 150 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9 * 0.9, 5);
      expect(reasons(result)).toHaveLength(2);
    });

    it('should NOT penalize for saturatedFat exactly 5', () => {
      const food = createMockFood({ saturatedFat: 5, cholesterol: 50 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should NOT penalize for cholesterol exactly 100', () => {
      const food = createMockFood({ saturatedFat: 2, cholesterol: 100 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should normalize alias "high_cholesterol" to hyperlipidemia', () => {
      const food = createMockFood({ saturatedFat: 8, cholesterol: 150 });
      const ctx: HealthModifierContext = {
        healthConditions: ['high_cholesterol'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.9 * 0.9, 5);
    });
  });

  describe('Layer 4 — multiple health conditions', () => {
    it('should stack penalties from diabetes + hypertension', () => {
      const food = createMockFood({ glycemicIndex: 75, sodium: 500 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2', 'hypertension'],
      };

      const result = service.evaluate(food, ctx);

      // diabetes high GI: *0.8, hypertension sodium>400: *0.85
      expect(result.finalMultiplier).toBeCloseTo(0.8 * 0.85, 5);
      expect(reasons(result)).toHaveLength(2);
    });

    it('should deduplicate conditions (e.g., "diabetes" and "diabetes_type2")', () => {
      const food = createMockFood({ glycemicIndex: 75 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes', 'diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      // Should only apply once due to normalizeHealthConditions dedup
      expect(result.finalMultiplier).toBeCloseTo(0.8, 5);
      expect(reasons(result)).toHaveLength(1);
    });

    it('should ignore unknown health conditions', () => {
      const food = createMockFood({ glycemicIndex: 75 });
      const ctx: HealthModifierContext = {
        healthConditions: ['unknown_condition'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
      expect(reasons(result)).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  //  Cross-layer stacking
  // ═══════════════════════════════════════════════

  describe('Penalty stacking across layers', () => {
    it('should stack Layer 2 + Layer 3 + Layer 4 penalties', () => {
      const food = createMockFood({
        isFried: true, // Layer 2: *0.92
        sodium: 800, // Layer 2: *0.94
        sugar: 20, // Layer 3 fat_loss: *0.9
        glycemicIndex: 75, // Layer 4 diabetes: *0.8
      });

      const ctx: HealthModifierContext = {
        goalType: 'fat_loss',
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      const expected = 0.92 * 0.94 * 0.9 * 0.8;
      expect(result.finalMultiplier).toBeCloseTo(expected, 5);
      expect(result.isVetoed).toBe(false);
      expect(reasons(result).length).toBe(4);
    });

    it('should veto even when other penalties apply (allergen takes precedence)', () => {
      const food = createMockFood({
        allergens: ['dairy'],
        isFried: true,
        sodium: 1500,
        sugar: 30,
      });

      const ctx: HealthModifierContext = {
        allergens: ['dairy'],
        goalType: 'fat_loss',
        healthConditions: ['hypertension'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should produce multiplier >= 0 even with extreme stacking', () => {
      const food = createMockFood({
        isFried: true,
        sodium: 1500,
        sugar: 30,
        glycemicIndex: 80,
        saturatedFat: 10,
        cholesterol: 200,
        calories: 300,
        protein: 1,
      });

      const ctx: HealthModifierContext = {
        goalType: 'fat_loss',
        healthConditions: ['diabetes_type2', 'hypertension', 'hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeGreaterThanOrEqual(0);
      expect(result.isVetoed).toBe(false);
      expect(reasons(result).length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════
  //  evaluateBatch
  // ═══════════════════════════════════════════════

  describe('evaluateBatch()', () => {
    it('should filter out vetoed foods', () => {
      const foods = [
        createMockFood({ id: 'safe-1', name: 'Safe A' }),
        createMockFood({ id: 'bad-1', name: 'Bad', allergens: ['dairy'] }),
        createMockFood({ id: 'safe-2', name: 'Safe B' }),
      ];

      const ctx: HealthModifierContext = { allergens: ['dairy'] };
      const results = service.evaluateBatch(foods, ctx);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.food.id)).toEqual(['safe-1', 'safe-2']);
      results.forEach(({ penalty }) => {
        expect(penalty.isVetoed).toBe(false);
      });
    });

    it('should filter foods vetoed by trans fat', () => {
      const foods = [
        createMockFood({ id: 'ok', transFat: 1 }),
        createMockFood({ id: 'bad', transFat: 3 }),
      ];

      const results = service.evaluateBatch(foods);

      expect(results).toHaveLength(1);
      expect(results[0].food.id).toBe('ok');
    });

    it('should return all foods when none are vetoed', () => {
      const foods = [
        createMockFood({ id: 'a' }),
        createMockFood({ id: 'b' }),
        createMockFood({ id: 'c' }),
      ];

      const results = service.evaluateBatch(foods);

      expect(results).toHaveLength(3);
    });

    it('should return empty array when all foods are vetoed', () => {
      const foods = [
        createMockFood({ id: 'a', allergens: ['dairy'] }),
        createMockFood({ id: 'b', allergens: ['dairy'] }),
      ];

      const ctx: HealthModifierContext = { allergens: ['dairy'] };
      const results = service.evaluateBatch(foods, ctx);

      expect(results).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const results = service.evaluateBatch([]);

      expect(results).toHaveLength(0);
    });

    it('should include correct penalty results for non-vetoed foods', () => {
      const foods = [
        createMockFood({ id: 'fried', isFried: true }),
        createMockFood({ id: 'clean' }),
      ];

      const results = service.evaluateBatch(foods);

      const friedResult = results.find((r) => r.food.id === 'fried');
      const cleanResult = results.find((r) => r.food.id === 'clean');

      expect(friedResult!.penalty.finalMultiplier).toBeCloseTo(0.92, 5);
      expect(cleanResult!.penalty.finalMultiplier).toBe(1.0);
    });

    it('should handle context=undefined', () => {
      const foods = [createMockFood()];
      const results = service.evaluateBatch(foods);

      expect(results).toHaveLength(1);
      expect(results[0].penalty.finalMultiplier).toBe(1.0);
    });
  });

  // ═══════════════════════════════════════════════
  //  Edge cases
  // ═══════════════════════════════════════════════

  describe('Edge cases', () => {
    it('should handle undefined/null nutritional fields gracefully (treated as 0)', () => {
      const food = createMockFood({
        sodium: undefined,
        sugar: undefined,
        protein: undefined,
        transFat: undefined,
        glycemicIndex: undefined,
        saturatedFat: undefined,
        cholesterol: undefined,
      });

      const ctx: HealthModifierContext = {
        goalType: 'fat_loss',
        healthConditions: ['diabetes_type2', 'hypertension', 'hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      // All values treated as 0, no thresholds breached
      expect(result.isVetoed).toBe(false);
      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should correctly handle string-valued numeric fields (TypeORM decimal columns)', () => {
      // TypeORM decimal columns may return strings
      const food = createMockFood({
        transFat: '2.5' as any,
        sodium: '700' as any,
      });

      const result = service.evaluate(food);

      // Number('2.5') > 2 → vetoed
      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should apply sodium penalty correctly with string-valued sodium', () => {
      const food = createMockFood({
        sodium: '700' as any,
      });

      const result = service.evaluate(food);

      expect(result.finalMultiplier).toBeCloseTo(0.94, 5);
    });

    it('should handle calories=0 in muscle_gain without division errors', () => {
      const food = createMockFood({ calories: 0, protein: 0 });
      const ctx: HealthModifierContext = { goalType: 'muscle_gain' };

      // calories=0 → treated as 1 in division, but 0 <= 100 → no penalty
      expect(() => service.evaluate(food, ctx)).not.toThrow();
      const result = service.evaluate(food, ctx);
      expect(result.isVetoed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: Severity support
  // ═══════════════════════════════════════════════

  describe('severity support', () => {
    it('should apply standard penalty with moderate severity (default)', () => {
      const food = createMockFood({ glycemicIndex: 80 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'], // 纯字符串，默认 moderate
      };

      const result = service.evaluate(food, ctx);

      // moderate=1.0 → 标准惩罚 0.8
      expect(result.finalMultiplier).toBeCloseTo(0.8, 5);
    });

    it('should reduce penalty with mild severity', () => {
      const food = createMockFood({ glycemicIndex: 80 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'diabetes_type2', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // mild=0.6 → adjusted = 1 - (1-0.8)*0.6 = 1 - 0.12 = 0.88
      expect(result.finalMultiplier).toBeCloseTo(0.88, 5);
    });

    it('should increase penalty with severe severity', () => {
      const food = createMockFood({ glycemicIndex: 80 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'diabetes_type2', severity: 'severe' }],
      };

      const result = service.evaluate(food, ctx);

      // severe=1.3 → adjusted = 1 - (1-0.8)*1.3 = 1 - 0.26 = 0.74
      expect(result.finalMultiplier).toBeCloseTo(0.74, 5);
    });

    it('should support mixed string and object conditions', () => {
      const food = createMockFood({
        glycemicIndex: 80,
        sodium: 500,
      });
      const ctx: HealthModifierContext = {
        healthConditions: [
          { condition: 'diabetes_type2', severity: 'mild' },
          'hypertension', // 默认 moderate
        ],
      };

      const result = service.evaluate(food, ctx);

      // 糖尿病 mild: 1-(1-0.8)*0.6 = 0.88
      // 高血压 moderate: 0.85
      // 最终 = 0.88 * 0.85
      expect(result.finalMultiplier).toBeCloseTo(0.88 * 0.85, 5);
    });

    it('should not affect veto decisions by severity', () => {
      const food = createMockFood({ purine: 400 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'gout', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // 一票否决不受严重度影响
      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should apply severity to kidney disease penalties', () => {
      const food = createMockFood({ phosphorus: 300 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'kidney_disease', severity: 'severe' }],
      };

      const result = service.evaluate(food, ctx);

      // severe=1.3 → adjusted = 1 - (1-0.75)*1.3 = 1 - 0.325 = 0.675
      expect(result.finalMultiplier).toBeCloseTo(0.675, 3);
    });

    it('should apply severity to gout non-veto penalties', () => {
      const food = createMockFood({ purine: 200 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'gout', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // 高嘌呤 base=0.7, mild=0.6 → adjusted = 1-(1-0.7)*0.6 = 1-0.18 = 0.82
      expect(result.finalMultiplier).toBeCloseTo(0.82, 5);
      expect(result.isVetoed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: New health conditions — fatty_liver
  // ═══════════════════════════════════════════════

  describe('Layer 4 — fatty_liver', () => {
    it('should penalize high saturated fat (>5g) for fatty liver', () => {
      const food = createMockFood({ saturatedFat: 8 });
      const ctx: HealthModifierContext = {
        healthConditions: ['fatty_liver'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
      expect(reasons(result)).toHaveLength(1);
      expect(reasons(result)[0]).toContain('脂肪肝');
      expect(reasons(result)[0]).toContain('饱和脂肪');
    });

    it('should penalize high sugar (>10g) for fatty liver', () => {
      const food = createMockFood({ sugar: 15 });
      const ctx: HealthModifierContext = {
        healthConditions: ['fatty_liver'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.88, 5);
      expect(reasons(result)).toHaveLength(1);
      expect(reasons(result)[0]).toContain('高糖');
    });

    it('should stack high fat + high sugar penalties for fatty liver', () => {
      const food = createMockFood({ saturatedFat: 8, sugar: 15 });
      const ctx: HealthModifierContext = {
        healthConditions: ['fatty_liver'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85 * 0.88, 5);
      expect(reasons(result)).toHaveLength(2);
    });

    it('should NOT penalize for low saturated fat and low sugar', () => {
      const food = createMockFood({ saturatedFat: 3, sugar: 5 });
      const ctx: HealthModifierContext = {
        healthConditions: ['fatty_liver'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should apply severity to fatty liver penalties', () => {
      const food = createMockFood({ saturatedFat: 8 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'fatty_liver', severity: 'severe' }],
      };

      const result = service.evaluate(food, ctx);

      // base=0.85, severe=1.3 → 1-(1-0.85)*1.3 = 1-0.195 = 0.805
      expect(result.finalMultiplier).toBeCloseTo(0.805, 3);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: New health conditions — celiac_disease
  // ═══════════════════════════════════════════════

  describe('Layer 4 — celiac_disease', () => {
    it('should veto food with gluten allergen', () => {
      const food = createMockFood({ allergens: ['gluten'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['celiac_disease'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
      expect(reasons(result).some((r) => r.includes('乳糜泻'))).toBe(true);
    });

    it('should veto food with gluten tag', () => {
      const food = createMockFood({ tags: ['gluten'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['celiac_disease'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should veto food with contains_gluten tag', () => {
      const food = createMockFood({ tags: ['contains_gluten'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['celiac_disease'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
      expect(result.finalMultiplier).toBe(0);
    });

    it('should NOT veto food without gluten', () => {
      const food = createMockFood({
        allergens: ['dairy'],
        tags: ['high_protein'],
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['celiac_disease'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(false);
      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should normalize alias "celiac" to celiac_disease', () => {
      const food = createMockFood({ allergens: ['gluten'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['celiac'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
    });

    it('should normalize alias "gluten_intolerance" to celiac_disease', () => {
      const food = createMockFood({ tags: ['gluten'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['gluten_intolerance'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.isVetoed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: New health conditions — IBS
  // ═══════════════════════════════════════════════

  describe('Layer 4 — IBS', () => {
    it('should penalize high_fodmap tagged food', () => {
      const food = createMockFood({ tags: ['high_fodmap'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['ibs'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.75, 5);
      expect(reasons(result)).toHaveLength(1);
      expect(reasons(result)[0]).toContain('FODMAP');
    });

    it('should penalize fodmap_high tagged food', () => {
      const food = createMockFood({ tags: ['fodmap_high'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['ibs'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.75, 5);
    });

    it('should NOT penalize food without FODMAP tags', () => {
      const food = createMockFood({ tags: ['high_protein'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['ibs'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBe(1.0);
    });

    it('should apply severity to IBS penalty', () => {
      const food = createMockFood({ tags: ['high_fodmap'] });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'ibs', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // base=0.75, mild=0.6 → 1-(1-0.75)*0.6 = 1-0.15 = 0.85
      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
    });

    it('should normalize alias "irritable_bowel" to ibs', () => {
      const food = createMockFood({ tags: ['high_fodmap'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['irritable_bowel'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.75, 5);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: New health conditions — iron_deficiency_anemia (penalties)
  // ═══════════════════════════════════════════════

  describe('Layer 4 — iron_deficiency_anemia penalties', () => {
    it('should penalize tea (by tag)', () => {
      const food = createMockFood({ tags: ['tea'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
      expect(reasons(result).some((r) => r.includes('茶/咖啡'))).toBe(true);
    });

    it('should penalize coffee (by tag)', () => {
      const food = createMockFood({ tags: ['coffee'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
    });

    it('should penalize food with 茶 in name', () => {
      const food = createMockFood({ name: '绿茶' });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
    });

    it('should penalize food with 咖啡 in name', () => {
      const food = createMockFood({ name: '美式咖啡' });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
    });

    it('should NOT penalize non-tea/coffee food', () => {
      const food = createMockFood({ name: '鸡胸肉', tags: ['high_protein'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      // 不含增益 modifier（铁不够高时不触发 bonus）
      expect(result.modifiers.filter((m) => m.type === 'penalty')).toHaveLength(
        0,
      );
    });

    it('should normalize alias "anemia" to iron_deficiency_anemia', () => {
      const food = createMockFood({ tags: ['tea'] });
      const ctx: HealthModifierContext = {
        healthConditions: ['anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(0.85, 5);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: Positive health bonuses
  // ═══════════════════════════════════════════════

  describe('Layer 5 — health bonuses', () => {
    it('should apply 1.15x bonus for hyperlipidemia + omega3-rich fish', () => {
      const food = createMockFood({
        category: 'protein',
        tags: ['fish'],
        saturatedFat: 2,
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.15, 5);
      const bonusMods = result.modifiers.filter((m) => m.type === 'bonus');
      expect(bonusMods).toHaveLength(1);
      expect(bonusMods[0].reason).toContain('Omega-3');
    });

    it('should apply 1.15x bonus for hyperlipidemia + omega3_rich tag', () => {
      const food = createMockFood({
        tags: ['omega3_rich'],
        saturatedFat: 2,
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.15, 5);
    });

    it('should apply 1.15x bonus for hyperlipidemia + high_omega3 tag', () => {
      const food = createMockFood({
        tags: ['high_omega3'],
        saturatedFat: 2,
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.15, 5);
    });

    it('should NOT apply omega3 bonus for non-fish non-tagged protein', () => {
      const food = createMockFood({
        category: 'protein',
        tags: ['high_protein'],
        saturatedFat: 2,
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should stack penalty + bonus for hyperlipidemia (high satFat + fish)', () => {
      // 高饱和脂肪触发惩罚，但同时是鱼类触发增益
      const food = createMockFood({
        category: 'protein',
        tags: ['fish'],
        saturatedFat: 8, // 触发惩罚 0.9
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['hyperlipidemia'],
      };

      const result = service.evaluate(food, ctx);

      // 惩罚 0.9 * 增益 1.15 = 1.035
      expect(result.finalMultiplier).toBeCloseTo(0.9 * 1.15, 5);
      expect(result.modifiers.filter((m) => m.type === 'penalty')).toHaveLength(
        1,
      );
      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        1,
      );
    });

    it('should apply 1.10x bonus for diabetes + low GI (<40)', () => {
      const food = createMockFood({ glycemicIndex: 30 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.1, 5);
      const bonusMods = result.modifiers.filter((m) => m.type === 'bonus');
      expect(bonusMods).toHaveLength(1);
      expect(bonusMods[0].reason).toContain('低GI');
    });

    it('should NOT apply low GI bonus when GI=0 (unknown/missing)', () => {
      const food = createMockFood({ glycemicIndex: 0 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      // GI=0 表示数据缺失，不应触发增益
      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should NOT apply low GI bonus when GI=40 (boundary)', () => {
      const food = createMockFood({ glycemicIndex: 40 });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should apply 1.12x bonus for hypertension + high potassium + low sodium', () => {
      const food = createMockFood({ potassium: 400, sodium: 100 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hypertension'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.12, 5);
      const bonusMods = result.modifiers.filter((m) => m.type === 'bonus');
      expect(bonusMods).toHaveLength(1);
      expect(bonusMods[0].reason).toContain('高钾');
      expect(bonusMods[0].reason).toContain('低钠');
    });

    it('should NOT apply hypertension bonus if sodium >= 200', () => {
      const food = createMockFood({ potassium: 400, sodium: 200 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hypertension'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should NOT apply hypertension bonus if potassium <= 300', () => {
      const food = createMockFood({ potassium: 300, sodium: 100 });
      const ctx: HealthModifierContext = {
        healthConditions: ['hypertension'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should apply 1.10x bonus for iron_deficiency_anemia + high iron (>3mg)', () => {
      const food = createMockFood({ iron: 5 });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.1, 5);
      const bonusMods = result.modifiers.filter((m) => m.type === 'bonus');
      expect(bonusMods).toHaveLength(1);
      expect(bonusMods[0].reason).toContain('高铁');
    });

    it('should NOT apply iron bonus when iron <= 3', () => {
      const food = createMockFood({ iron: 3 });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });

    it('should apply 1.10x bonus for osteoporosis + high calcium (>100mg)', () => {
      const food = createMockFood({ calcium: 200 });
      const ctx: HealthModifierContext = {
        healthConditions: ['osteoporosis'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.finalMultiplier).toBeCloseTo(1.1, 5);
      const bonusMods = result.modifiers.filter((m) => m.type === 'bonus');
      expect(bonusMods).toHaveLength(1);
      expect(bonusMods[0].reason).toContain('高钙');
    });

    it('should NOT apply calcium bonus when calcium <= 100', () => {
      const food = createMockFood({ calcium: 100 });
      const ctx: HealthModifierContext = {
        healthConditions: ['osteoporosis'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: Bonus severity scaling
  // ═══════════════════════════════════════════════

  describe('bonus severity scaling', () => {
    it('should reduce bonus with mild severity', () => {
      const food = createMockFood({ glycemicIndex: 30 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'diabetes_type2', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // base=1.10, mild=0.6 → 1 + (1.10-1)*0.6 = 1 + 0.06 = 1.06
      expect(result.finalMultiplier).toBeCloseTo(1.06, 5);
    });

    it('should increase bonus with severe severity', () => {
      const food = createMockFood({ glycemicIndex: 30 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'diabetes_type2', severity: 'severe' }],
      };

      const result = service.evaluate(food, ctx);

      // base=1.10, severe=1.3 → 1 + (1.10-1)*1.3 = 1 + 0.13 = 1.13
      expect(result.finalMultiplier).toBeCloseTo(1.13, 5);
    });

    it('should apply standard bonus with moderate severity', () => {
      const food = createMockFood({ iron: 5 });
      const ctx: HealthModifierContext = {
        healthConditions: [
          { condition: 'iron_deficiency_anemia', severity: 'moderate' },
        ],
      };

      const result = service.evaluate(food, ctx);

      // moderate=1.0 → 标准增益 1.10
      expect(result.finalMultiplier).toBeCloseTo(1.1, 5);
    });

    it('should scale hyperlipidemia omega3 bonus by severity', () => {
      const food = createMockFood({
        category: 'protein',
        tags: ['fish'],
        saturatedFat: 2,
        cholesterol: 50,
      });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'hyperlipidemia', severity: 'severe' }],
      };

      const result = service.evaluate(food, ctx);

      // base=1.15, severe=1.3 → 1 + (1.15-1)*1.3 = 1 + 0.195 = 1.195
      expect(result.finalMultiplier).toBeCloseTo(1.195, 3);
    });

    it('should scale hypertension bonus by mild severity', () => {
      const food = createMockFood({ potassium: 400, sodium: 100 });
      const ctx: HealthModifierContext = {
        healthConditions: [{ condition: 'hypertension', severity: 'mild' }],
      };

      const result = service.evaluate(food, ctx);

      // base=1.12, mild=0.6 → 1 + (1.12-1)*0.6 = 1 + 0.072 = 1.072
      expect(result.finalMultiplier).toBeCloseTo(1.072, 3);
    });
  });

  // ═══════════════════════════════════════════════
  //  V5 2.8: Combined penalty + bonus scenarios
  // ═══════════════════════════════════════════════

  describe('combined penalty + bonus scenarios', () => {
    it('should stack iron_deficiency_anemia penalty (tea) + bonus (high iron) separately', () => {
      // 食物同时是茶和高铁（理论上不太现实，但测试逻辑正确性）
      const food = createMockFood({ tags: ['tea'], iron: 5 });
      const ctx: HealthModifierContext = {
        healthConditions: ['iron_deficiency_anemia'],
      };

      const result = service.evaluate(food, ctx);

      // penalty 0.85 * bonus 1.10 = 0.935
      expect(result.finalMultiplier).toBeCloseTo(0.85 * 1.1, 5);
      expect(result.modifiers.filter((m) => m.type === 'penalty')).toHaveLength(
        1,
      );
      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        1,
      );
    });

    it('should handle multiple conditions with both penalties and bonuses', () => {
      const food = createMockFood({
        glycemicIndex: 30, // 糖尿病 → 低GI增益 1.10x
        sodium: 500, // 高血压 → 钠惩罚 0.85
        potassium: 400, // 高血压 → 高钾低钠增益（sodium=500 >= 200，不触发）
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2', 'hypertension'],
      };

      const result = service.evaluate(food, ctx);

      // 糖尿病低GI增益: 1.10
      // 高血压钠惩罚: 0.85
      // 高血压增益: 不触发（sodium=500 >= 200）
      expect(result.finalMultiplier).toBeCloseTo(0.85 * 1.1, 5);
    });

    it('should not produce bonus for conditions that only apply penalties', () => {
      const food = createMockFood({
        glycemicIndex: 80, // 高GI → 糖尿病惩罚
        sodium: 500, // 高钠 → 高血压惩罚
      });
      const ctx: HealthModifierContext = {
        healthConditions: ['diabetes_type2', 'hypertension'],
      };

      const result = service.evaluate(food, ctx);

      expect(result.modifiers.filter((m) => m.type === 'bonus')).toHaveLength(
        0,
      );
      expect(result.modifiers.filter((m) => m.type === 'penalty')).toHaveLength(
        2,
      );
    });
  });
});
