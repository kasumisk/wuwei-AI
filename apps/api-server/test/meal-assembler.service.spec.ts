import { MealAssemblerService } from '../src/modules/diet/app/recommendation/meal-assembler.service';
import { FoodLibrary } from '../src/modules/food/entities/food-library.entity';
import {
  ScoredFood,
  FoodFeedbackStats,
} from '../src/modules/diet/app/recommendation/recommendation.types';

// ─── Helpers ────────────────────────────────────────────────

let foodCounter = 0;

function createMockFood(overrides: Partial<FoodLibrary> = {}): FoodLibrary {
  foodCounter++;
  return {
    id: `food-${foodCounter}`,
    code: `FOOD_TEST_${foodCounter}`,
    name: `测试食物${foodCounter}`,
    status: 'active',
    category: 'protein',
    calories: 200,
    protein: 20,
    fat: 10,
    carbs: 5,
    isProcessed: false,
    isFried: false,
    processingLevel: 1,
    allergens: [],
    mealTypes: ['lunch', 'dinner'],
    tags: [],
    compatibility: {},
    standardServingG: 100,
    standardServingDesc: '1份(100g)',
    commonPortions: [],
    primarySource: 'manual',
    dataVersion: 1,
    confidence: 1.0,
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

function createScoredFood(
  overrides: Partial<Omit<ScoredFood, 'food'>> & {
    food?: Partial<FoodLibrary>;
  } = {},
): ScoredFood {
  const { food: foodOverrides, ...sfOverrides } = overrides;
  const food = createMockFood(foodOverrides);
  return {
    food,
    score: 0.8,
    servingCalories: 200,
    servingProtein: 20,
    servingFat: 10,
    servingCarbs: 5,
    servingFiber: 3,
    servingGL: 5,
    ...sfOverrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('MealAssemblerService', () => {
  let service: MealAssemblerService;

  beforeEach(() => {
    foodCounter = 0;
    service = new MealAssemblerService();
  });

  // ═══════════════════════════════════════════════════════════
  // diversify
  // ═══════════════════════════════════════════════════════════
  describe('diversify', () => {
    it('should exclude foods whose names appear in recentFoodNames', () => {
      const foods = [
        createScoredFood({
          food: {
            name: '鸡胸肉',
            category: 'protein',
            mainIngredient: 'chicken',
          },
          score: 0.9,
        }),
        createScoredFood({
          food: {
            name: '三文鱼',
            category: 'protein',
            mainIngredient: 'salmon',
          },
          score: 0.85,
        }),
        createScoredFood({
          food: { name: '牛肉', category: 'protein', mainIngredient: 'beef' },
          score: 0.8,
        }),
        createScoredFood({
          food: { name: '虾仁', category: 'grain', mainIngredient: 'shrimp' },
          score: 0.75,
        }),
        createScoredFood({
          food: { name: '豆腐', category: 'veggie', mainIngredient: 'tofu' },
          score: 0.7,
        }),
      ];

      const result = service.diversify(foods, ['鸡胸肉', '牛肉'], 3);

      const names = result.map((r) => r.food.name);
      expect(names).not.toContain('鸡胸肉');
      expect(names).not.toContain('牛肉');
      expect(names).toContain('三文鱼');
      expect(names).toContain('虾仁');
      expect(names).toContain('豆腐');
    });

    it('should limit same category to at most 2', () => {
      const foods = [
        createScoredFood({
          food: { name: 'A', category: 'protein' },
          score: 0.9,
        }),
        createScoredFood({
          food: { name: 'B', category: 'protein' },
          score: 0.85,
        }),
        createScoredFood({
          food: { name: 'C', category: 'protein' },
          score: 0.8,
        }),
        createScoredFood({
          food: { name: 'D', category: 'veggie' },
          score: 0.75,
        }),
      ];

      const result = service.diversify(foods, [], 4);

      const proteinCount = result.filter(
        (r) => r.food.category === 'protein',
      ).length;
      // First pass picks A, B (2 protein), skips C, picks D
      // Then fallback fills C as 4th — but since limit=4 and we get A,B,D in first pass (3), fallback adds C
      // Actually limit=4 so first pass: A(ok), B(ok, 2nd protein), C(skip: 2 already), D(ok) → 3 items
      // fallback: adds C → 4 items
      expect(result.length).toBe(4);
      // The first-pass only allows 2 same-category; the 3rd protein is only added via fallback
      const firstPassNames = ['A', 'B', 'D'];
      expect(result.slice(0, 3).map((r) => r.food.name)).toEqual(
        firstPassNames,
      );
    });

    it('should limit same mainIngredient to at most 1', () => {
      const foods = [
        createScoredFood({
          food: {
            name: '鸡胸沙拉',
            category: 'composite',
            mainIngredient: 'chicken',
          },
          score: 0.9,
        }),
        createScoredFood({
          food: {
            name: '白切鸡',
            category: 'protein',
            mainIngredient: 'chicken',
          },
          score: 0.85,
        }),
        createScoredFood({
          food: {
            name: '三文鱼',
            category: 'protein',
            mainIngredient: 'salmon',
          },
          score: 0.8,
        }),
      ];

      const result = service.diversify(foods, [], 3);

      const chickenItems = result.filter(
        (r) => r.food.mainIngredient === 'chicken',
      );
      // First pass: 鸡胸沙拉 (chicken added), 白切鸡 (chicken used → skip), 三文鱼 (ok)
      // Only 2 items in first pass → fallback adds 白切鸡
      expect(result.length).toBe(3);
      // First pass respects constraint, fallback allows duplicates
      expect(result[0].food.name).toBe('鸡胸沙拉');
      expect(result[1].food.name).toBe('三文鱼');
    });

    it('should fallback to fill when constraints are too strict', () => {
      // All foods have same category + mainIngredient → first pass only picks 1
      const foods = [
        createScoredFood({
          food: { name: 'A', category: 'protein', mainIngredient: 'chicken' },
          score: 0.9,
        }),
        createScoredFood({
          food: { name: 'B', category: 'protein', mainIngredient: 'chicken' },
          score: 0.85,
        }),
        createScoredFood({
          food: { name: 'C', category: 'protein', mainIngredient: 'chicken' },
          score: 0.8,
        }),
      ];

      const result = service.diversify(foods, [], 3);

      // First pass: A (ok), B (chicken used → skip), C (chicken used → skip) → 1 item
      // Fallback fills B and C
      expect(result.length).toBe(3);
      expect(result.map((r) => r.food.name)).toEqual(['A', 'B', 'C']);
    });

    it('should limit same foodGroup to at most 2', () => {
      const foods = [
        createScoredFood({
          food: {
            name: 'A',
            category: 'protein',
            mainIngredient: 'a',
            foodGroup: 'meat',
          },
          score: 0.9,
        }),
        createScoredFood({
          food: {
            name: 'B',
            category: 'protein',
            mainIngredient: 'b',
            foodGroup: 'meat',
          },
          score: 0.85,
        }),
        createScoredFood({
          food: {
            name: 'C',
            category: 'veggie',
            mainIngredient: 'c',
            foodGroup: 'meat',
          },
          score: 0.8,
        }),
        createScoredFood({
          food: {
            name: 'D',
            category: 'grain',
            mainIngredient: 'd',
            foodGroup: 'grain',
          },
          score: 0.75,
        }),
      ];

      const result = service.diversify(foods, [], 4);

      // First pass: A(meat=1), B(meat=2), C(meat=2 already → skip), D(ok) → 3 items
      // Fallback adds C
      expect(result.length).toBe(4);
      expect(result[0].food.name).toBe('A');
      expect(result[1].food.name).toBe('B');
      expect(result[2].food.name).toBe('D');
      expect(result[3].food.name).toBe('C');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // diversifyWithPenalty
  // ═══════════════════════════════════════════════════════════
  describe('diversifyWithPenalty', () => {
    it('should exclude named foods', () => {
      const scored = [
        createScoredFood({ food: { name: 'A' }, score: 0.9 }),
        createScoredFood({ food: { name: 'B' }, score: 0.8 }),
        createScoredFood({ food: { name: 'C' }, score: 0.7 }),
      ];

      const result = service.diversifyWithPenalty(scored, ['A'], 2);

      expect(result.map((r) => r.food.name)).toEqual(['B', 'C']);
    });

    it('should apply similarity penalty against already-selected foods', () => {
      // Two similar foods (same category+mainIngredient) and one different
      const similar1 = createScoredFood({
        food: {
          name: 'ChickenA',
          category: 'protein',
          mainIngredient: 'chicken',
        },
        score: 0.9,
      });
      const similar2 = createScoredFood({
        food: {
          name: 'ChickenB',
          category: 'protein',
          mainIngredient: 'chicken',
        },
        score: 0.88,
      });
      const different = createScoredFood({
        food: { name: 'Rice', category: 'grain', mainIngredient: 'rice' },
        score: 0.85,
      });

      const result = service.diversifyWithPenalty(
        [similar1, similar2, different],
        [],
        2,
      );

      // Round 1: ChickenA wins (0.9, no penalty)
      // Round 2: ChickenB gets penalty 0.8 * 0.3 = 0.24, adjusted = 0.88 - 0.24 = 0.64
      //          Rice gets penalty 0 * 0.3 = 0, adjusted = 0.85
      //          Rice wins round 2
      expect(result[0].food.name).toBe('ChickenA');
      expect(result[1].food.name).toBe('Rice');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // addExploration (statistical tests)
  // ═══════════════════════════════════════════════════════════
  describe('addExploration', () => {
    it('should apply exploration to all foods when feedbackStats is undefined', () => {
      const scored = [
        createScoredFood({ food: { name: 'A' }, score: 1.0 }),
        createScoredFood({ food: { name: 'B' }, score: 0.5 }),
      ];

      const result = service.addExploration(scored);

      // With no stats → Beta(1,1) → multiplier in [0.5, 1.5]
      // Score should be modified (not equal to original in most runs)
      for (const sf of result) {
        // score = original * multiplier where multiplier ∈ [0.5, 1.5]
        const original = sf.food.name === 'A' ? 1.0 : 0.5;
        expect(sf.score).toBeGreaterThanOrEqual(original * 0.5 - 0.001);
        expect(sf.score).toBeLessThanOrEqual(original * 1.5 + 0.001);
      }
    });

    it('should return results sorted by new score (descending)', () => {
      const scored = [
        createScoredFood({ food: { name: 'A' }, score: 1.0 }),
        createScoredFood({ food: { name: 'B' }, score: 0.9 }),
        createScoredFood({ food: { name: 'C' }, score: 0.8 }),
      ];

      const result = service.addExploration(scored);

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
      }
    });

    it('should give highly accepted food a higher average multiplier (statistical)', () => {
      const TRIALS = 500;
      let multiplierSum = 0;

      for (let i = 0; i < TRIALS; i++) {
        const scored = [
          createScoredFood({ food: { name: 'Popular' }, score: 1.0 }),
        ];
        const stats: Record<string, FoodFeedbackStats> = {
          Popular: { accepted: 50, rejected: 1 },
        };

        const result = service.addExploration(scored, stats);
        multiplierSum += result[0].score; // score = 1.0 * multiplier
      }

      const avgMultiplier = multiplierSum / TRIALS;
      // Beta(51, 2) → mean ≈ 51/53 ≈ 0.962 → multiplier ≈ 0.5 + 0.962 = 1.462
      // Average should be clearly above 1.0
      expect(avgMultiplier).toBeGreaterThan(1.2);
    });

    it('should give highly rejected food a lower average multiplier (statistical)', () => {
      const TRIALS = 500;
      let multiplierSum = 0;

      for (let i = 0; i < TRIALS; i++) {
        const scored = [
          createScoredFood({ food: { name: 'Unpopular' }, score: 1.0 }),
        ];
        const stats: Record<string, FoodFeedbackStats> = {
          Unpopular: { accepted: 1, rejected: 50 },
        };

        const result = service.addExploration(scored, stats);
        multiplierSum += result[0].score;
      }

      const avgMultiplier = multiplierSum / TRIALS;
      // Beta(2, 51) → mean ≈ 2/53 ≈ 0.038 → multiplier ≈ 0.5 + 0.038 = 0.538
      // Average should be clearly below 1.0
      expect(avgMultiplier).toBeLessThan(0.8);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // adjustPortions
  // ═══════════════════════════════════════════════════════════
  describe('adjustPortions', () => {
    it('should not change portions when budget matches total (within 5%)', () => {
      const picks = [
        createScoredFood({ servingCalories: 200 }),
        createScoredFood({ servingCalories: 300 }),
      ];
      const budget = 500; // exact match

      const result = service.adjustPortions(picks, budget);

      expect(result[0].servingCalories).toBe(200);
      expect(result[1].servingCalories).toBe(300);
    });

    it('should not change portions when budget is within 5% of total', () => {
      const picks = [
        createScoredFood({ servingCalories: 200 }),
        createScoredFood({ servingCalories: 300 }),
      ];
      const budget = 510; // 2% above 500

      const result = service.adjustPortions(picks, budget);

      expect(result[0].servingCalories).toBe(200);
      expect(result[1].servingCalories).toBe(300);
    });

    it('should scale up portions when budget is 2x total (capped at 2.0x)', () => {
      const picks = [
        createScoredFood({
          servingCalories: 100,
          servingProtein: 10,
          servingFat: 5,
          servingCarbs: 10,
        }),
        createScoredFood({
          servingCalories: 100,
          servingProtein: 10,
          servingFat: 5,
          servingCarbs: 10,
        }),
      ];
      const budget = 400; // 2x of 200

      const result = service.adjustPortions(picks, budget);

      // globalRatio = 2.0 → clamped to 2.0 → quantized to 2.0
      for (const item of result) {
        expect(item.servingCalories).toBe(200);
        expect(item.servingProtein).toBe(20);
      }
    });

    it('should scale down portions when budget is 0.5x total (capped at 0.5x)', () => {
      const picks = [
        createScoredFood({
          servingCalories: 200,
          servingProtein: 20,
          servingFat: 10,
          servingCarbs: 5,
        }),
        createScoredFood({
          servingCalories: 200,
          servingProtein: 20,
          servingFat: 10,
          servingCarbs: 5,
        }),
      ];
      const budget = 200; // 0.5x of 400

      const result = service.adjustPortions(picks, budget);

      // globalRatio = 0.5 → clamped to 0.5 → quantized to 0.5
      for (const item of result) {
        expect(item.servingCalories).toBe(100);
        expect(item.servingProtein).toBe(10);
      }
    });

    it('should quantize ratios to 0.25 steps', () => {
      const picks = [
        createScoredFood({
          servingCalories: 100,
          servingProtein: 10,
          servingFat: 5,
          servingCarbs: 10,
        }),
      ];
      // ratio = 130/100 = 1.3 → quantized to round(1.3*4)/4 = round(5.2)/4 = 5/4 = 1.25
      const budget = 130;

      const result = service.adjustPortions(picks, budget);

      expect(result[0].servingCalories).toBe(Math.round(100 * 1.25));
    });

    it('should return original picks when totalCal is 0', () => {
      const picks = [
        createScoredFood({
          servingCalories: 0,
          servingProtein: 0,
          servingFat: 0,
          servingCarbs: 0,
        }),
      ];

      const result = service.adjustPortions(picks, 500);

      expect(result[0].servingCalories).toBe(0);
    });

    it('should respect commonPortions bounds', () => {
      const food = createMockFood({
        standardServingG: 100,
        commonPortions: [
          { name: '半份', grams: 80 },
          { name: '1份', grams: 100 },
          { name: '大份', grams: 150 },
        ],
      });

      const picks: ScoredFood[] = [
        {
          food,
          score: 0.9,
          servingCalories: 200,
          servingProtein: 20,
          servingFat: 10,
          servingCarbs: 5,
          servingFiber: 3,
          servingGL: 5,
        },
      ];

      // Budget = 600 → ratio = 3.0 → but maxRatio = min(2.0, 150/100) = 1.5
      const result = service.adjustPortions(picks, 600);

      // Clamped to maxRatio=1.5, quantized to 1.5
      expect(result[0].servingCalories).toBe(Math.round(200 * 1.5));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // similarity
  // ═══════════════════════════════════════════════════════════
  describe('similarity', () => {
    it('should return 0.8 when category and mainIngredient match', () => {
      const a = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
      });
      const b = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
      });

      expect(service.similarity(a, b)).toBe(0.8);
    });

    it('should return 0.0 when nothing is shared', () => {
      const a = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
        subCategory: 'lean_meat',
        tags: ['high_protein'],
      });
      const b = createMockFood({
        category: 'grain',
        mainIngredient: 'rice',
        subCategory: 'whole_grain',
        tags: ['high_carb'],
      });

      expect(service.similarity(a, b)).toBe(0);
    });

    it('should cap at 1.0 even when all factors match', () => {
      const a = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
        subCategory: 'lean_meat',
        tags: ['high_protein', 'low_fat', 'keto', 'grilled', 'healthy'],
      });
      const b = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
        subCategory: 'lean_meat',
        tags: ['high_protein', 'low_fat', 'keto', 'grilled', 'healthy'],
      });

      // 0.3 (category) + 0.5 (mainIngredient) + 0.2 (subCategory) + 5*0.05 (tags) = 1.25 → capped to 1.0
      expect(service.similarity(a, b)).toBe(1.0);
    });

    it('should score 0.3 for same category only', () => {
      const a = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
      });
      const b = createMockFood({
        category: 'protein',
        mainIngredient: 'beef',
      });

      expect(service.similarity(a, b)).toBe(0.3);
    });

    it('should add 0.2 for same subCategory', () => {
      const a = createMockFood({
        category: 'protein',
        mainIngredient: 'chicken',
        subCategory: 'lean_meat',
      });
      const b = createMockFood({
        category: 'protein',
        mainIngredient: 'beef',
        subCategory: 'lean_meat',
      });

      // 0.3 (category) + 0.2 (subCategory) = 0.5
      expect(service.similarity(a, b)).toBe(0.5);
    });

    it('should add 0.05 per shared tag', () => {
      const a = createMockFood({
        category: 'grain',
        mainIngredient: 'rice',
        tags: ['high_carb', 'easy_digest'],
      });
      const b = createMockFood({
        category: 'grain',
        mainIngredient: 'oat',
        tags: ['high_carb', 'breakfast'],
      });

      // 0.3 (category) + 0.05 (1 shared tag: high_carb) = 0.35
      expect(service.similarity(a, b)).toBeCloseTo(0.35, 5);
    });

    it('should not match empty mainIngredient', () => {
      const a = createMockFood({
        category: 'veggie',
        mainIngredient: undefined,
      });
      const b = createMockFood({
        category: 'veggie',
        mainIngredient: undefined,
      });

      // 0.3 (category) only — empty mainIngredient doesn't match
      expect(service.similarity(a, b)).toBe(0.3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // compatibilityBonus
  // ═══════════════════════════════════════════════════════════
  describe('compatibilityBonus', () => {
    it('should return 0 for empty picks', () => {
      const candidate = createMockFood({ name: 'A' });
      expect(service.compatibilityBonus(candidate, [])).toBe(0);
    });

    it('should return positive bonus for goodWith match on name', () => {
      const candidate = createMockFood({
        name: '米饭',
        compatibility: { goodWith: ['鸡胸肉'], badWith: [] },
      });
      const pick = createMockFood({ name: '鸡胸肉' });

      const bonus = service.compatibilityBonus(candidate, [pick]);

      expect(bonus).toBeGreaterThan(0);
      expect(bonus).toBe(0.05);
    });

    it('should return positive bonus for goodWith match on category', () => {
      const candidate = createMockFood({
        name: '米饭',
        compatibility: { goodWith: ['protein'], badWith: [] },
      });
      const pick = createMockFood({
        name: '鸡胸肉',
        category: 'protein',
      });

      const bonus = service.compatibilityBonus(candidate, [pick]);

      expect(bonus).toBe(0.05);
    });

    it('should return positive bonus for goodWith match on mainIngredient', () => {
      const candidate = createMockFood({
        name: '米饭',
        compatibility: { goodWith: ['chicken'], badWith: [] },
      });
      const pick = createMockFood({
        name: '鸡胸肉',
        mainIngredient: 'chicken',
      });

      const bonus = service.compatibilityBonus(candidate, [pick]);

      expect(bonus).toBe(0.05);
    });

    it('should return negative bonus for badWith match', () => {
      const candidate = createMockFood({
        name: '可乐',
        compatibility: { goodWith: [], badWith: ['protein'] },
      });
      const pick = createMockFood({
        name: '鸡胸肉',
        category: 'protein',
      });

      const bonus = service.compatibilityBonus(candidate, [pick]);

      expect(bonus).toBeLessThan(0);
      expect(bonus).toBe(-0.1);
    });

    it('should check bidirectional compatibility', () => {
      const candidate = createMockFood({
        name: '米饭',
        category: 'grain',
        compatibility: { goodWith: ['鸡胸肉'], badWith: [] },
      });
      const pick = createMockFood({
        name: '鸡胸肉',
        category: 'protein',
        compatibility: { goodWith: ['米饭'], badWith: [] },
      });

      const bonus = service.compatibilityBonus(candidate, [pick]);

      // candidate.goodWith matches pick.name → +0.05
      // pick.goodWith matches candidate.name → +0.05
      expect(bonus).toBe(0.1);
    });

    it('should clamp bonus to +0.15 maximum', () => {
      const candidate = createMockFood({
        name: '超级食物',
        category: 'composite',
        mainIngredient: 'super',
        compatibility: { goodWith: ['A', 'B', 'C', 'D'], badWith: [] },
      });
      // Many picks with bidirectional goodWith → would exceed 0.15 without clamping
      const picks = [
        createMockFood({
          name: 'A',
          compatibility: { goodWith: ['超级食物'], badWith: [] },
        }),
        createMockFood({
          name: 'B',
          compatibility: { goodWith: ['超级食物'], badWith: [] },
        }),
        createMockFood({
          name: 'C',
          compatibility: { goodWith: ['超级食物'], badWith: [] },
        }),
        createMockFood({
          name: 'D',
          compatibility: { goodWith: ['超级食物'], badWith: [] },
        }),
      ];

      const bonus = service.compatibilityBonus(candidate, picks);

      // Raw: 4 * (0.05 + 0.05) = 0.4 → clamped to 0.15
      expect(bonus).toBe(0.15);
    });

    it('should clamp bonus to -0.15 minimum', () => {
      const candidate = createMockFood({
        name: '坏搭配',
        category: 'snack',
        mainIngredient: 'junk',
        compatibility: { goodWith: [], badWith: ['A', 'B', 'C'] },
      });
      const picks = [
        createMockFood({
          name: 'A',
          compatibility: { goodWith: [], badWith: ['坏搭配'] },
        }),
        createMockFood({
          name: 'B',
          compatibility: { goodWith: [], badWith: ['坏搭配'] },
        }),
        createMockFood({
          name: 'C',
          compatibility: { goodWith: [], badWith: [] },
        }),
      ];

      const bonus = service.compatibilityBonus(candidate, picks);

      // candidate.badWith matches A,B,C names → -0.1 * 3 = -0.3
      // pick A badWith matches candidate name → -0.1
      // pick B badWith matches candidate name → -0.1
      // Raw = -0.5 → clamped to -0.15
      expect(bonus).toBe(-0.15);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // aggregateMealResult
  // ═══════════════════════════════════════════════════════════
  describe('aggregateMealResult', () => {
    it('should correctly sum all nutrients', () => {
      const picks = [
        createScoredFood({
          food: { name: '鸡胸肉', standardServingDesc: '100g' },
          servingCalories: 165,
          servingProtein: 31,
          servingFat: 3,
          servingCarbs: 0,
        }),
        createScoredFood({
          food: { name: '糙米饭', standardServingDesc: '1碗' },
          servingCalories: 216,
          servingProtein: 5,
          servingFat: 2,
          servingCarbs: 45,
        }),
        createScoredFood({
          food: { name: '西兰花', standardServingDesc: '150g' },
          servingCalories: 55,
          servingProtein: 4,
          servingFat: 1,
          servingCarbs: 10,
        }),
      ];

      const result = service.aggregateMealResult(picks, '均衡搭配');

      expect(result.totalCalories).toBe(165 + 216 + 55);
      expect(result.totalProtein).toBe(31 + 5 + 4);
      expect(result.totalFat).toBe(3 + 2 + 1);
      expect(result.totalCarbs).toBe(0 + 45 + 10);
      expect(result.tip).toBe('均衡搭配');
      expect(result.foods).toHaveLength(3);
    });

    it('should include food names in displayText', () => {
      const picks = [
        createScoredFood({
          food: { name: '鸡胸肉', standardServingDesc: '100g' },
          servingCalories: 165,
        }),
        createScoredFood({
          food: { name: '糙米饭', standardServingDesc: '1碗' },
          servingCalories: 216,
        }),
      ];

      const result = service.aggregateMealResult(picks, 'tip');

      expect(result.displayText).toContain('鸡胸肉');
      expect(result.displayText).toContain('糙米饭');
      expect(result.displayText).toContain('165kcal');
      expect(result.displayText).toContain('216kcal');
      expect(result.displayText).toContain(' + ');
    });

    it('should handle empty picks', () => {
      const result = service.aggregateMealResult([], '无推荐');

      expect(result.totalCalories).toBe(0);
      expect(result.totalProtein).toBe(0);
      expect(result.totalFat).toBe(0);
      expect(result.totalCarbs).toBe(0);
      expect(result.displayText).toBe('');
      expect(result.foods).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // buildTip
  // ═══════════════════════════════════════════════════════════
  describe('buildTip', () => {
    const target = { calories: 500, protein: 30, fat: 15, carbs: 60 };

    it('should include over-budget warning when actualCal > 110% of target', () => {
      const tip = service.buildTip('lunch', 'health', target, 600);

      expect(tip).toContain('推荐总热量略超预算');
    });

    it('should include under-budget warning when actualCal < 70% of target', () => {
      const tip = service.buildTip('lunch', 'health', target, 300);

      expect(tip).toContain('推荐量偏少');
    });

    it('should not include budget warning when actualCal is in range', () => {
      const tip = service.buildTip('lunch', 'health', target, 450);

      expect(tip).not.toContain('推荐总热量略超预算');
      expect(tip).not.toContain('推荐量偏少');
    });

    it('should include goal-specific tip for fat_loss', () => {
      const tip = service.buildTip('lunch', 'fat_loss', target, 450);

      expect(tip).toContain('减脂期优先高蛋白低脂食物');
    });

    it('should include goal-specific tip for muscle_gain', () => {
      const tip = service.buildTip('lunch', 'muscle_gain', target, 450);

      expect(tip).toContain('增肌期碳水蛋白并重');
    });

    it('should include meal-specific tip for breakfast', () => {
      const tip = service.buildTip('breakfast', 'health', target, 450);

      expect(tip).toContain('早餐注意蛋白质摄入');
    });

    it('should include meal-specific tip for dinner', () => {
      const tip = service.buildTip('dinner', 'health', target, 450);

      expect(tip).toContain('晚餐清淡为主');
    });

    it('should fallback to health tip for unknown goal type', () => {
      const tip = service.buildTip('lunch', 'unknown_goal', target, 450);

      expect(tip).toContain('均衡搭配，注意蔬果');
    });

    it('should join tips with semicolon separator', () => {
      const tip = service.buildTip('breakfast', 'fat_loss', target, 600);

      // Should contain: over-budget + fat_loss tip + breakfast tip
      const parts = tip.split('；');
      expect(parts.length).toBe(3);
    });
  });
});
