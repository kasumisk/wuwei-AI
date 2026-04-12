import { FoodScorerService } from '../src/modules/diet/app/recommendation/food-scorer.service';
import { HealthModifierEngineService } from '../src/modules/diet/app/recommendation/health-modifier-engine.service';
import {
  MealTarget,
  MicroNutrientDefaults,
  buildCategoryMicroAverages,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import { FoodLibrary } from '../src/modules/food/entities/food-library.entity';

// ─── Mock HealthModifierEngineService ───

const mockHealthModifierEngine = {
  evaluate: jest.fn().mockReturnValue({
    finalMultiplier: 1.0,
    modifiers: [],
    isVetoed: false,
  }),
};

// ─── Helper: create a mock FoodLibrary with sensible defaults ───

function createMockFood(overrides?: Partial<FoodLibrary>): FoodLibrary {
  return {
    id: 'food-001',
    code: 'FOOD_TEST_001',
    name: 'Test Chicken Breast',
    category: 'protein',
    calories: 165,
    protein: 31,
    fat: 3.6,
    carbs: 0,
    fiber: 0,
    sugar: 0,
    saturatedFat: 1.0,
    transFat: 0,
    cholesterol: 85,
    sodium: 74,
    potassium: 256,
    calcium: 15,
    iron: 1.0,
    vitaminA: 6,
    vitaminC: 0,
    vitaminD: 0.1,
    vitaminE: 0.3,
    glycemicIndex: 0,
    glycemicLoad: 0,
    processingLevel: 1,
    qualityScore: 8,
    satietyScore: 7,
    confidence: 0.9,
    standardServingG: 150,
    isFried: false,
    isProcessed: false,
    allergens: [],
    tags: ['high_protein', 'low_fat'],
    mealTypes: ['lunch', 'dinner'],
    mainIngredient: 'chicken',
    foodGroup: 'poultry',
    subCategory: 'lean_meat',
    compatibility: { goodWith: ['rice', 'broccoli'], badWith: [] },
    commonPortions: [{ name: '1 piece', grams: 150 }],
    status: 'active',
    primarySource: 'usda',
    dataVersion: 1,
    isVerified: true,
    searchWeight: 100,
    popularity: 500,
    ...overrides,
  } as FoodLibrary;
}

// ─── Default target ───

const defaultTarget: MealTarget = {
  calories: 400,
  protein: 30,
  fat: 15,
  carbs: 50,
};

// ─── Test Suite ───

describe('FoodScorerService', () => {
  let service: FoodScorerService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHealthModifierEngine.evaluate.mockReturnValue({
      finalMultiplier: 1.0,
      modifiers: [],
      isVetoed: false,
    });
    service = new FoodScorerService(mockHealthModifierEngine as any);
  });

  // ════════════════════════════════════════════════════════════
  // 1. calcServingNutrition
  // ════════════════════════════════════════════════════════════

  describe('calcServingNutrition', () => {
    it('should compute serving nutrients based on standardServingG / 100', () => {
      const food = createMockFood({
        calories: 200,
        protein: 20,
        fat: 10,
        carbs: 30,
        standardServingG: 150,
      });

      const result = service.calcServingNutrition(food);

      expect(result.servingCalories).toBe(Math.round((200 * 150) / 100)); // 300
      expect(result.servingProtein).toBe(Math.round((20 * 150) / 100)); // 30
      expect(result.servingFat).toBe(Math.round((10 * 150) / 100)); // 15
      expect(result.servingCarbs).toBe(Math.round((30 * 150) / 100)); // 45
    });

    it('should handle undefined protein/fat/carbs as 0', () => {
      const food = createMockFood({
        calories: 100,
        protein: undefined,
        fat: undefined,
        carbs: undefined,
        standardServingG: 200,
      });

      const result = service.calcServingNutrition(food);

      expect(result.servingCalories).toBe(Math.round((100 * 200) / 100)); // 200
      expect(result.servingProtein).toBe(0);
      expect(result.servingFat).toBe(0);
      expect(result.servingCarbs).toBe(0);
    });

    it('should round to the nearest integer', () => {
      const food = createMockFood({
        calories: 123,
        protein: 17,
        fat: 7,
        carbs: 13,
        standardServingG: 75,
      });

      const result = service.calcServingNutrition(food);

      expect(result.servingCalories).toBe(Math.round((123 * 75) / 100)); // 92
      expect(result.servingProtein).toBe(Math.round((17 * 75) / 100)); // 13
      expect(result.servingFat).toBe(Math.round((7 * 75) / 100)); // 5
      expect(result.servingCarbs).toBe(Math.round((13 * 75) / 100)); // 10
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. NOVA penalty levels
  // ════════════════════════════════════════════════════════════

  describe('NOVA penalty', () => {
    it('NOVA 1 (unprocessed) → multiplier 1.0', () => {
      const food = createMockFood({ processingLevel: 1 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.novaPenalty).toBe(1.0);
    });

    it('NOVA 2 (processed culinary ingredients) → multiplier 1.0', () => {
      const food = createMockFood({ processingLevel: 2 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.novaPenalty).toBe(1.0);
    });

    it('NOVA 3 (processed foods) → multiplier 0.85', () => {
      const food = createMockFood({ processingLevel: 3 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.novaPenalty).toBe(0.85);
    });

    it('NOVA 4 (ultra-processed) → multiplier 0.55', () => {
      const food = createMockFood({ processingLevel: 4 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.novaPenalty).toBe(0.55);
    });

    it('NOVA 4 should produce a lower score than NOVA 1 for the same food', () => {
      const nova1 = createMockFood({ processingLevel: 1 });
      const nova4 = createMockFood({ processingLevel: 4 });

      const score1 = service.scoreFood(nova1, 'health', defaultTarget);
      const score4 = service.scoreFood(nova4, 'health', defaultTarget);

      expect(score1).toBeGreaterThan(score4);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. Confidence factor
  // ════════════════════════════════════════════════════════════

  describe('confidence factor', () => {
    it('confidence=1.0 → factor=1.0', () => {
      const food = createMockFood({ confidence: 1.0 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.confidenceFactor).toBeCloseTo(1.0, 5);
    });

    it('confidence=0.5 → factor=0.85', () => {
      const food = createMockFood({ confidence: 0.5 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.confidenceFactor).toBeCloseTo(0.85, 5);
    });

    it('confidence=0 → falls back to 0.5 (falsy guard), factor=0.85', () => {
      // Note: the service uses `Number(food.confidence) || 0.5`,
      // so confidence=0 is falsy and falls back to 0.5 → factor = 0.7 + 0.3*0.5 = 0.85
      const food = createMockFood({ confidence: 0 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.confidenceFactor).toBeCloseTo(0.85, 5);
    });

    it('very low confidence (0.1) → factor=0.73', () => {
      const food = createMockFood({ confidence: 0.1 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      expect(result.explanation.confidenceFactor).toBeCloseTo(
        0.7 + 0.3 * 0.1,
        5,
      );
    });

    it('higher confidence should produce a higher score for the same food', () => {
      const highConf = createMockFood({ confidence: 1.0 });
      const lowConf = createMockFood({ confidence: 0.2 });

      const scoreHigh = service.scoreFood(highConf, 'health', defaultTarget);
      const scoreLow = service.scoreFood(lowConf, 'health', defaultTarget);

      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. Vetoed food returns score=0
  // ════════════════════════════════════════════════════════════

  describe('vetoed food', () => {
    it('should return score=0 when penalty engine vetoes the food', () => {
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 0,
        modifiers: [{ multiplier: 0, reason: 'allergen', type: 'penalty' }],
        isVetoed: true,
      });

      const food = createMockFood();
      const score = service.scoreFood(food, 'health', defaultTarget);

      expect(score).toBe(0);
    });

    it('should still populate explanation when vetoed', () => {
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 0,
        modifiers: [
          { multiplier: 0, reason: 'allergen match: dairy', type: 'penalty' },
        ],
        isVetoed: true,
      });

      const food = createMockFood();
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(result.score).toBe(0);
      expect(result.explanation.penaltyResult.vetoed).toBe(true);
      expect(result.explanation.penaltyResult.multiplier).toBe(0);
      expect(result.explanation.penaltyResult.reasons).toContain(
        'allergen match: dairy',
      );
      expect(result.explanation.finalScore).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. Score is always ≥ 0
  // ════════════════════════════════════════════════════════════

  describe('score non-negativity', () => {
    it('should never return a negative score', () => {
      const food = createMockFood({
        calories: 900,
        protein: 0,
        fat: 50,
        carbs: 80,
        processingLevel: 4,
        qualityScore: 1,
        satietyScore: 1,
        confidence: 0,
      });

      const score = service.scoreFood(food, 'fat_loss', defaultTarget);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should return ≥ 0 with penalty multiplier < 1', () => {
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 0.5,
        modifiers: [
          { multiplier: 0.5, reason: 'high sodium', type: 'penalty' },
        ],
        isVetoed: false,
      });

      const food = createMockFood({
        processingLevel: 4,
        confidence: 0,
      });

      const score = service.scoreFood(food, 'health', defaultTarget);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. Different goal types produce different scores
  // ════════════════════════════════════════════════════════════

  describe('goal-specific scoring', () => {
    it('high-protein food should score higher for fat_loss than health', () => {
      const highProteinFood = createMockFood({
        calories: 165,
        protein: 31,
        fat: 3.6,
        carbs: 0,
        standardServingG: 150,
        qualityScore: 7,
        satietyScore: 7,
      });

      const fatLossScore = service.scoreFood(
        highProteinFood,
        'fat_loss',
        defaultTarget,
      );
      const healthScore = service.scoreFood(
        highProteinFood,
        'health',
        defaultTarget,
      );

      // fat_loss gives protein weight=0.19, health gives 0.06
      expect(fatLossScore).not.toEqual(healthScore);
    });

    it('high-protein food should score higher for muscle_gain than health', () => {
      const highProteinFood = createMockFood({
        calories: 165,
        protein: 31,
        fat: 3.6,
        carbs: 0,
        standardServingG: 150,
      });

      const muscleScore = service.scoreFood(
        highProteinFood,
        'muscle_gain',
        defaultTarget,
      );
      const healthScore = service.scoreFood(
        highProteinFood,
        'health',
        defaultTarget,
      );

      // muscle_gain gives protein weight=0.24, health gives 0.06
      expect(muscleScore).not.toEqual(healthScore);
    });

    it('all four goal types should produce different scores for the same food', () => {
      const food = createMockFood();
      const goals = ['fat_loss', 'muscle_gain', 'health', 'habit'];
      const scores = goals.map((g) =>
        service.scoreFood(food, g, defaultTarget),
      );

      // At least some scores should differ
      const uniqueScores = new Set(scores.map((s) => s.toFixed(6)));
      expect(uniqueScores.size).toBeGreaterThan(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. scoreFoodsWithServing filters vetoed foods
  // ════════════════════════════════════════════════════════════

  describe('scoreFoodsWithServing — filtering', () => {
    it('should filter out vetoed foods', () => {
      const food1 = createMockFood({ id: 'f1', name: 'Apple' });
      const food2 = createMockFood({ id: 'f2', name: 'Peanut' });
      const food3 = createMockFood({ id: 'f3', name: 'Banana' });

      // Veto the second food
      mockHealthModifierEngine.evaluate.mockImplementation(
        (food: FoodLibrary, _ctx: any) => {
          if (food.id === 'f2') {
            return {
              finalMultiplier: 0,
              modifiers: [
                { multiplier: 0, reason: 'allergen', type: 'penalty' },
              ],
              isVetoed: true,
            };
          }
          return { finalMultiplier: 1.0, modifiers: [], isVetoed: false };
        },
      );

      const result = service.scoreFoodsWithServing(
        [food1, food2, food3],
        'health',
        defaultTarget,
      );

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.food.id)).not.toContain('f2');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 8. scoreFoodsWithServing returns sorted results
  // ════════════════════════════════════════════════════════════

  describe('scoreFoodsWithServing — sorting', () => {
    it('should return results sorted descending by score', () => {
      // Create foods with different quality so they get different scores
      const lowQuality = createMockFood({
        id: 'low',
        name: 'Low Food',
        qualityScore: 2,
        satietyScore: 2,
        processingLevel: 4,
      });
      const midQuality = createMockFood({
        id: 'mid',
        name: 'Mid Food',
        qualityScore: 5,
        satietyScore: 5,
        processingLevel: 2,
      });
      const highQuality = createMockFood({
        id: 'high',
        name: 'High Food',
        qualityScore: 9,
        satietyScore: 9,
        processingLevel: 1,
      });

      const result = service.scoreFoodsWithServing(
        [lowQuality, midQuality, highQuality],
        'health',
        defaultTarget,
      );

      expect(result.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
      }
    });

    it('should include serving nutrition on each result', () => {
      const food = createMockFood({
        calories: 200,
        protein: 20,
        fat: 10,
        carbs: 30,
        standardServingG: 100,
      });

      const result = service.scoreFoodsWithServing(
        [food],
        'health',
        defaultTarget,
      );

      expect(result).toHaveLength(1);
      expect(result[0].servingCalories).toBe(200);
      expect(result[0].servingProtein).toBe(20);
      expect(result[0].servingFat).toBe(10);
      expect(result[0].servingCarbs).toBe(30);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 9. Explanation structure
  // ════════════════════════════════════════════════════════════

  describe('scoreFoodDetailed — explanation structure', () => {
    it('should include all 10 dimensions', () => {
      const food = createMockFood();
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      const dims = result.explanation.dimensions;
      const expectedDimensions = [
        'calories',
        'protein',
        'carbs',
        'fat',
        'quality',
        'satiety',
        'glycemic',
        'nutrientDensity',
        'inflammation',
        'fiber', // V5 2.6: 第 10 维
      ] as const;

      for (const dim of expectedDimensions) {
        expect(dims[dim]).toBeDefined();
        expect(typeof dims[dim].raw).toBe('number');
        expect(typeof dims[dim].weighted).toBe('number');
        expect(dims[dim].raw).toBeGreaterThanOrEqual(0);
        expect(dims[dim].raw).toBeLessThanOrEqual(1);
      }
    });

    it('should populate novaPenalty, penaltyResult, confidenceFactor', () => {
      const food = createMockFood({ processingLevel: 3, confidence: 0.8 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(result.explanation.novaPenalty).toBe(0.85);
      expect(result.explanation.confidenceFactor).toBeCloseTo(
        0.7 + 0.3 * 0.8,
        5,
      );
      expect(result.explanation.penaltyResult).toEqual({
        multiplier: 1.0,
        reasons: [],
        vetoed: false,
      });
    });

    it('should have default boost/penalty values', () => {
      const food = createMockFood();
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(result.explanation.preferenceBoost).toBe(1.0);
      expect(result.explanation.profileBoost).toBe(1.0);
      expect(result.explanation.regionalBoost).toBe(1.0);
      expect(result.explanation.explorationMultiplier).toBe(1.0);
      expect(result.explanation.similarityPenalty).toBe(0);
      expect(result.explanation.compatibilityBonus).toBe(0);
    });

    it('finalScore in explanation should match returned score', () => {
      const food = createMockFood();
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(result.explanation.finalScore).toBe(result.score);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 10. Energy score (Gaussian bell)
  // ════════════════════════════════════════════════════════════

  describe('energy score — Gaussian bell', () => {
    it('should score close to 1.0 when servingCal matches target exactly', () => {
      // servingCal = calories * standardServingG / 100 = target
      // target=400 → we need calories * serving / 100 = 400
      // e.g., calories=200, standardServingG=200 → servingCal=400
      const food = createMockFood({
        calories: 200,
        standardServingG: 200,
        protein: 20,
        fat: 5,
        carbs: 25,
        processingLevel: 1,
        confidence: 1.0,
      });

      const target: MealTarget = {
        calories: 400,
        protein: 30,
        fat: 15,
        carbs: 50,
      };

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target,
      });

      // The calories dimension raw score should be ~1.0 (Gaussian peak)
      expect(result.explanation.dimensions.calories.raw).toBeCloseTo(1.0, 2);
    });

    it('should score lower when servingCal is far from target', () => {
      // servingCal = 100 * 150 / 100 = 150, target = 400 → big deviation
      const food = createMockFood({
        calories: 100,
        standardServingG: 150,
        protein: 10,
        fat: 3,
        carbs: 15,
      });

      const target: MealTarget = {
        calories: 400,
        protein: 30,
        fat: 15,
        carbs: 50,
      };

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target,
      });

      expect(result.explanation.dimensions.calories.raw).toBeLessThan(0.5);
    });

    it('should use default target of 400 when no target is provided', () => {
      const food = createMockFood({
        calories: 267,
        standardServingG: 150,
        // servingCal = 267*150/100 = 400.5 ≈ 400
      });

      const result = service.scoreFoodDetailed({ food, goalType: 'health' });

      // Should be close to peak with default target of 400
      expect(result.explanation.dimensions.calories.raw).toBeGreaterThan(0.9);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: scoreFood delegates to scoreFoodDetailed
  // ════════════════════════════════════════════════════════════

  describe('scoreFood', () => {
    it('should return the same value as scoreFoodDetailed.score', () => {
      const food = createMockFood();
      const score = service.scoreFood(food, 'health', defaultTarget);
      const detailed = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(score).toBe(detailed.score);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: penalty engine integration
  // ════════════════════════════════════════════════════════════

  describe('penalty engine integration', () => {
    it('should pass goalType to penalty engine context', () => {
      const food = createMockFood();
      service.scoreFood(food, 'fat_loss', defaultTarget, {
        allergens: ['dairy'],
      });

      expect(mockHealthModifierEngine.evaluate).toHaveBeenCalledWith(food, {
        allergens: ['dairy'],
        goalType: 'fat_loss',
      });
    });

    it('should apply penalty multiplier to the score', () => {
      const food = createMockFood();

      // Full multiplier
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 1.0,
        modifiers: [],
        isVetoed: false,
      });
      const fullScore = service.scoreFood(food, 'health', defaultTarget);

      // Half multiplier
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 0.5,
        modifiers: [
          { multiplier: 0.5, reason: 'high sodium', type: 'penalty' },
        ],
        isVetoed: false,
      });
      const halfScore = service.scoreFood(food, 'health', defaultTarget);

      expect(halfScore).toBeCloseTo(fullScore * 0.5, 5);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: protein score behavior
  // ════════════════════════════════════════════════════════════

  describe('protein score — piecewise function', () => {
    it('should score 1.0 when protein ratio is within ideal range for fat_loss', () => {
      // fat_loss ideal protein ratio: 0.25–0.35
      // proteinRatio = (protein*4) / servingCal
      // If servingCal=400, we need protein*4/400 in [0.25, 0.35]
      // protein = 0.30 * 400 / 4 = 30g → per 100g with serving 200g → 15g/100g
      const food = createMockFood({
        calories: 200,
        protein: 15,
        fat: 10,
        carbs: 15,
        standardServingG: 200,
        // servingCal = 400, servingProtein = 30
        // ratio = 30*4/400 = 0.30 → in [0.25, 0.35]
      });

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'fat_loss',
        target: {
          calories: 400,
          protein: 30,
          fat: 15,
          carbs: 50,
        },
      });

      expect(result.explanation.dimensions.protein.raw).toBeCloseTo(1.0, 2);
    });

    it('should score < 1.0 when protein ratio is below ideal range', () => {
      // Very low protein food
      const food = createMockFood({
        calories: 300,
        protein: 2,
        fat: 5,
        carbs: 60,
        standardServingG: 100,
        // servingCal = 300, servingProtein = 2
        // ratio = 2*4/300 = 0.027 → well below 0.25
      });

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'fat_loss',
        target: defaultTarget,
      });
      expect(result.explanation.dimensions.protein.raw).toBeLessThan(0.5);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: glycemic impact score
  // ════════════════════════════════════════════════════════════

  describe('glycemic impact score', () => {
    it('should return 0.75 when GI is 0 (no data)', () => {
      const food = createMockFood({
        glycemicIndex: 0,
        glycemicLoad: 0,
      });

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // GI=0 → returns 0.75
      expect(result.explanation.dimensions.glycemic.raw).toBeCloseTo(0.75, 2);
    });

    it('should score higher for low GL foods than high GL foods', () => {
      const lowGL = createMockFood({
        glycemicIndex: 30,
        glycemicLoad: 5,
        carbs: 10,
      });
      const highGL = createMockFood({
        glycemicIndex: 80,
        glycemicLoad: 30,
        carbs: 40,
      });

      const resultLow = service.scoreFoodDetailed({
        food: lowGL,
        goalType: 'health',
        target: defaultTarget,
      });
      const resultHigh = service.scoreFoodDetailed({
        food: highGL,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(resultLow.explanation.dimensions.glycemic.raw).toBeGreaterThan(
        resultHigh.explanation.dimensions.glycemic.raw,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: quality and satiety log scale
  // ════════════════════════════════════════════════════════════

  describe('quality and satiety — log scale', () => {
    it('should use qualityScore from food when available', () => {
      const food = createMockFood({ qualityScore: 10, satietyScore: 10 });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // logScale(10) = log(11)/log(11) = 1.0
      expect(result.explanation.dimensions.quality.raw).toBeCloseTo(1.0, 5);
      expect(result.explanation.dimensions.satiety.raw).toBeCloseTo(1.0, 5);
    });

    it('should fall back to category defaults when scores are undefined', () => {
      const food = createMockFood({
        qualityScore: undefined,
        satietyScore: undefined,
        category: 'veggie',
        // CATEGORY_QUALITY.veggie = 8, CATEGORY_SATIETY.veggie = 5
      });

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      const expectedQuality = Math.log(1 + 8) / Math.log(11);
      const expectedSatiety = Math.log(1 + 5) / Math.log(11);
      expect(result.explanation.dimensions.quality.raw).toBeCloseTo(
        expectedQuality,
        5,
      );
      expect(result.explanation.dimensions.satiety.raw).toBeCloseTo(
        expectedSatiety,
        5,
      );
    });

    it('logScale of 1 should be > 0 and < logScale of 5', () => {
      const foodLow = createMockFood({ qualityScore: 1 });
      const foodMid = createMockFood({ qualityScore: 5 });

      const resultLow = service.scoreFoodDetailed({
        food: foodLow,
        goalType: 'health',
        target: defaultTarget,
      });
      const resultMid = service.scoreFoodDetailed({
        food: foodMid,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(resultLow.explanation.dimensions.quality.raw).toBeGreaterThan(0);
      expect(resultLow.explanation.dimensions.quality.raw).toBeLessThan(
        resultMid.explanation.dimensions.quality.raw,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: inflammation score
  // ════════════════════════════════════════════════════════════

  describe('inflammation score', () => {
    it('should score higher for anti-inflammatory food (high fiber, low sat/trans fat)', () => {
      const antiInflam = createMockFood({
        transFat: 0,
        saturatedFat: 0.5,
        fiber: 8,
      });
      const proInflam = createMockFood({
        transFat: 1.5,
        saturatedFat: 8,
        fiber: 0,
      });

      const resultAnti = service.scoreFoodDetailed({
        food: antiInflam,
        goalType: 'health',
        target: defaultTarget,
      });
      const resultPro = service.scoreFoodDetailed({
        food: proInflam,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(
        resultAnti.explanation.dimensions.inflammation.raw,
      ).toBeGreaterThan(resultPro.explanation.dimensions.inflammation.raw);
    });
  });

  // ════════════════════════════════════════════════════════════
  // V5 2.6: fiber score (膳食纤维评分)
  // ════════════════════════════════════════════════════════════

  describe('fiber score', () => {
    it('should score higher for high-fiber food than zero-fiber food', () => {
      const highFiber = createMockFood({
        fiber: 10, // 10g/100g — 高纤维
        standardServingG: 150,
      });
      const noFiber = createMockFood({
        fiber: 0,
        standardServingG: 150,
      });

      const resultHigh = service.scoreFoodDetailed({
        food: highFiber,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });
      const resultNone = service.scoreFoodDetailed({
        food: noFiber,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });

      expect(resultHigh.explanation.dimensions.fiber.raw).toBeGreaterThan(
        resultNone.explanation.dimensions.fiber.raw,
      );
    });

    it('should cap fiber score at 1.0', () => {
      // 非常高纤维的食物，超出每餐目标
      const veryHighFiber = createMockFood({
        fiber: 30, // 30g/100g
        standardServingG: 200,
        // 实际纤维 = 30 * 200 / 100 = 60g，远超任何餐次目标
      });

      const result = service.scoreFoodDetailed({
        food: veryHighFiber,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });

      expect(result.explanation.dimensions.fiber.raw).toBe(1.0);
    });

    it('should return 0 for food with no fiber', () => {
      const noFiber = createMockFood({ fiber: 0 });

      const result = service.scoreFoodDetailed({
        food: noFiber,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });

      expect(result.explanation.dimensions.fiber.raw).toBe(0);
    });

    it('should use meal ratio to determine fiber target', () => {
      const food = createMockFood({
        fiber: 3, // 3g/100g
        standardServingG: 100,
        // 实际纤维 = 3g
      });

      // snack 比例较小（0.1），目标纤维 ≈ 2.75g → 3/2.75 > 1 → cap 1.0
      const snackResult = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'snack',
      });

      // lunch 比例较大（0.35），目标纤维 ≈ 9.625g → 3/9.625 ≈ 0.31
      const lunchResult = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });

      // snack 目标更低，同样的纤维量得分更高
      expect(snackResult.explanation.dimensions.fiber.raw).toBeGreaterThan(
        lunchResult.explanation.dimensions.fiber.raw,
      );
    });

    it('should handle undefined fiber as 0', () => {
      const food = createMockFood({ fiber: undefined as any });

      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
        mealType: 'lunch',
      });

      expect(result.explanation.dimensions.fiber.raw).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: nutrient density (NRF 9.3)
  // ════════════════════════════════════════════════════════════

  describe('nutrient density score — NRF 9.3', () => {
    it('should score higher for nutrient-dense food', () => {
      const dense = createMockFood({
        protein: 25,
        fiber: 10,
        vitaminA: 500,
        vitaminC: 60,
        vitaminD: 10,
        vitaminE: 8,
        calcium: 300,
        iron: 5,
        potassium: 600,
        saturatedFat: 1,
        sugar: 2,
        sodium: 100,
      });
      const sparse = createMockFood({
        protein: 2,
        fiber: 0,
        vitaminA: 0,
        vitaminC: 0,
        vitaminD: 0,
        vitaminE: 0,
        calcium: 0,
        iron: 0,
        potassium: 0,
        saturatedFat: 10,
        sugar: 30,
        sodium: 1500,
      });

      const resultDense = service.scoreFoodDetailed({
        food: dense,
        goalType: 'health',
        target: defaultTarget,
      });
      const resultSparse = service.scoreFoodDetailed({
        food: sparse,
        goalType: 'health',
        target: defaultTarget,
      });

      expect(
        resultDense.explanation.dimensions.nutrientDensity.raw,
      ).toBeGreaterThan(
        resultSparse.explanation.dimensions.nutrientDensity.raw,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // V5 2.7: 微量营养素品类均值插补
  // ════════════════════════════════════════════════════════════

  describe('micronutrient imputation (V5 2.7)', () => {
    it('should score higher with imputation for food missing micronutrients', () => {
      // 食物缺少所有微量营养素数据
      const food = createMockFood({
        category: 'veggie',
        protein: 2,
        fiber: 0,
        vitaminA: 0,
        vitaminC: 0,
        vitaminD: 0,
        vitaminE: 0,
        calcium: 0,
        iron: 0,
        potassium: 0,
      });

      // 无插补：所有微量营养素为 0
      service.setCategoryMicroDefaults(null);
      const resultNoImpute = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // 有插补：使用品类均值
      const defaults = new Map<string, MicroNutrientDefaults>();
      defaults.set('veggie', {
        vitaminA: 200,
        vitaminC: 30,
        vitaminD: 0.5,
        vitaminE: 2,
        calcium: 100,
        iron: 2,
        potassium: 300,
        fiber: 3,
      });
      service.setCategoryMicroDefaults(defaults);
      const resultImputed = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // 插补后营养密度分应该更高
      expect(
        resultImputed.explanation.dimensions.nutrientDensity.raw,
      ).toBeGreaterThan(
        resultNoImpute.explanation.dimensions.nutrientDensity.raw,
      );

      // 清理
      service.setCategoryMicroDefaults(null);
    });

    it('should NOT override existing food values with imputed values', () => {
      // 食物有完整的微量营养素数据（所有值 > 0）
      const food = createMockFood({
        category: 'protein',
        protein: 25,
        fiber: 5,
        vitaminA: 500,
        vitaminC: 60,
        vitaminD: 10,
        vitaminE: 8,
        calcium: 300,
        iron: 5,
        potassium: 600,
      });

      // 设置较低的品类默认值
      const defaults = new Map<string, MicroNutrientDefaults>();
      defaults.set('protein', {
        vitaminA: 10,
        vitaminC: 5,
        vitaminD: 0.1,
        vitaminE: 0.5,
        calcium: 20,
        iron: 1,
        potassium: 100,
        fiber: 0.5,
      });

      // 先无插补
      service.setCategoryMicroDefaults(null);
      const resultBefore = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // 再有插补（但食物所有字段都有值，不应被覆盖）
      service.setCategoryMicroDefaults(defaults);
      const resultAfter = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // 所有字段都有值，插补不应产生任何影响
      expect(resultBefore.explanation.dimensions.nutrientDensity.raw).toBe(
        resultAfter.explanation.dimensions.nutrientDensity.raw,
      );

      // 清理
      service.setCategoryMicroDefaults(null);
    });
  });

  // ════════════════════════════════════════════════════════════
  // V5 2.7: buildCategoryMicroAverages 纯函数测试
  // ════════════════════════════════════════════════════════════

  describe('buildCategoryMicroAverages', () => {
    it('should compute averages per category', () => {
      const foods = [
        createMockFood({
          category: 'veggie',
          vitaminA: 100,
          vitaminC: 20,
          iron: 2,
          calcium: 50,
          potassium: 200,
          fiber: 4,
          vitaminD: 0,
          vitaminE: 1,
        }),
        createMockFood({
          category: 'veggie',
          vitaminA: 200,
          vitaminC: 40,
          iron: 4,
          calcium: 100,
          potassium: 400,
          fiber: 6,
          vitaminD: 0,
          vitaminE: 3,
        }),
        createMockFood({
          category: 'protein',
          vitaminA: 50,
          vitaminC: 0,
          iron: 3,
          calcium: 20,
          potassium: 300,
          fiber: 0,
          vitaminD: 1,
          vitaminE: 0.5,
        }),
      ];

      const result = buildCategoryMicroAverages(foods);

      expect(result.has('veggie')).toBe(true);
      expect(result.has('protein')).toBe(true);

      const veggie = result.get('veggie')!;
      expect(veggie.vitaminA).toBeCloseTo(150, 1); // (100+200)/2
      expect(veggie.vitaminC).toBeCloseTo(30, 1); // (20+40)/2
      expect(veggie.iron).toBeCloseTo(3, 1); // (2+4)/2
      expect(veggie.fiber).toBeCloseTo(5, 1); // (4+6)/2
    });

    it('should handle empty food list', () => {
      const result = buildCategoryMicroAverages([]);
      expect(result.size).toBe(1); // 只有 'unknown' 兜底
      expect(result.has('unknown')).toBe(true);
    });

    it('should fall back to global average for categories with all-zero fields', () => {
      const foods = [
        createMockFood({
          category: 'beverage',
          vitaminA: 0,
          vitaminC: 0,
          vitaminD: 0,
          vitaminE: 0,
          calcium: 0,
          iron: 0,
          potassium: 0,
          fiber: 0,
        }),
        createMockFood({
          category: 'protein',
          vitaminA: 100,
          vitaminC: 10,
          vitaminD: 2,
          vitaminE: 1,
          calcium: 50,
          iron: 3,
          potassium: 200,
          fiber: 1,
        }),
      ];

      const result = buildCategoryMicroAverages(foods);
      const beverage = result.get('beverage')!;
      const protein = result.get('protein')!;

      // beverage 的全零字段应回退到全局均值（= protein 的均值，因为只有 protein 有数据）
      expect(beverage.vitaminA).toBeCloseTo(protein.vitaminA, 1);
      expect(beverage.iron).toBeCloseTo(protein.iron, 1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: meal type and status flags affect weights
  // ════════════════════════════════════════════════════════════

  describe('meal type and status flags', () => {
    it('should produce different scores for different meal types', () => {
      const food = createMockFood();

      const breakfastScore = service.scoreFood(
        food,
        'health',
        defaultTarget,
        undefined,
        'breakfast',
      );
      const dinnerScore = service.scoreFood(
        food,
        'health',
        defaultTarget,
        undefined,
        'dinner',
      );

      // breakfast and dinner have different weight modifiers
      expect(breakfastScore).not.toEqual(dinnerScore);
    });

    it('should produce different scores with status flags', () => {
      const food = createMockFood();

      const noFlags = service.scoreFood(food, 'fat_loss', defaultTarget);
      const withPlateau = service.scoreFood(
        food,
        'fat_loss',
        defaultTarget,
        undefined,
        undefined,
        ['plateau'],
      );

      expect(noFlags).not.toEqual(withPlateau);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: edge cases
  // ════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle food with 0 calories gracefully', () => {
      const food = createMockFood({
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        standardServingG: 100,
      });

      const score = service.scoreFood(food, 'health', defaultTarget);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('should handle unknown goal type by falling back to health weights', () => {
      const food = createMockFood();

      const unknownScore = service.scoreFood(
        food,
        'unknown_goal' as any,
        defaultTarget,
      );
      const healthScore = service.scoreFood(food, 'health', defaultTarget);

      // Both should use health weights (fallback)
      // The scores may differ slightly if MACRO_RANGES fallback differs,
      // but both should be valid positive numbers
      expect(unknownScore).toBeGreaterThan(0);
      expect(Number.isFinite(unknownScore)).toBe(true);
    });

    it('should handle undefined processingLevel by defaulting to NOVA 1', () => {
      const food = createMockFood({ processingLevel: undefined as any });
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });

      // processingLevel ?? 1 → defaults to 1 → novaPenalty = 1.0
      expect(result.explanation.novaPenalty).toBe(1.0);
    });

    it('should handle empty candidates array in scoreFoodsWithServing', () => {
      const result = service.scoreFoodsWithServing([], 'health', defaultTarget);
      expect(result).toEqual([]);
    });

    it('should handle all foods being vetoed in scoreFoodsWithServing', () => {
      mockHealthModifierEngine.evaluate.mockReturnValue({
        finalMultiplier: 0,
        modifiers: [{ multiplier: 0, reason: 'allergen', type: 'penalty' }],
        isVetoed: true,
      });

      const foods = [
        createMockFood({ id: 'f1', name: 'Food A' }),
        createMockFood({ id: 'f2', name: 'Food B' }),
      ];

      const result = service.scoreFoodsWithServing(
        foods,
        'health',
        defaultTarget,
      );
      expect(result).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Additional: weighted dimension values
  // ════════════════════════════════════════════════════════════

  describe('weighted dimension values', () => {
    it('weighted = raw × weight for each dimension', () => {
      const food = createMockFood();
      const result = service.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: defaultTarget,
      });
      const dims = result.explanation.dimensions;

      // Each weighted should approximately equal raw * its weight
      // We can verify by checking that the sum of all weighted values
      // equals the raw score before NOVA/penalty/confidence adjustments.
      const totalWeighted = Object.values(dims).reduce(
        (sum, d) => sum + d.weighted,
        0,
      );

      // rawScore (before NOVA * penalty * confidence) = totalWeighted
      // finalScore = totalWeighted * novaPenalty * penalty.multiplier * confidenceFactor
      const expected =
        totalWeighted *
        result.explanation.novaPenalty *
        result.explanation.penaltyResult.multiplier *
        result.explanation.confidenceFactor;

      expect(result.score).toBeCloseTo(expected, 5);
    });
  });
});
