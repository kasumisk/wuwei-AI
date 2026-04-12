/**
 * V7.7 P4: ComparisonExplanationService 单元测试
 *
 * 覆盖：
 * - generateComparisonExplanation
 * - generateSubstitutionExplanation
 * - generateDeltaExplanation
 * - generateChannelFilterExplanation
 */

import { ComparisonExplanationService } from '../src/modules/diet/app/recommendation/comparison-explanation.service';
import { AcquisitionChannel } from '../src/modules/diet/app/recommendation/recommendation.types';

// ───────────────────── helpers ─────────────────────

function createFood(overrides: Record<string, any> = {}): any {
  return {
    id: 'food-1',
    code: 'F001',
    name: '鸡蛋',
    status: 'active',
    category: '蛋类',
    calories: 144,
    protein: 13,
    fat: 10,
    carbs: 1,
    fiber: 0,
    isProcessed: false,
    isFried: false,
    processingLevel: 0,
    allergens: [],
    mealTypes: ['breakfast'],
    tags: [],
    compatibility: {},
    standardServingG: 50,
    commonPortions: [],
    primarySource: 'manual',
    dataVersion: 1,
    confidence: 0.9,
    isVerified: true,
    searchWeight: 1,
    popularity: 80,
    commonalityScore: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createScoredFood(overrides: Record<string, any> = {}): any {
  return {
    food: createFood(),
    score: 75,
    servingCalories: 72,
    servingProtein: 6.5,
    servingFat: 5,
    servingCarbs: 0.5,
    servingFiber: 0,
    servingGL: 0,
    ...overrides,
  };
}

// ───────────────────── tests ─────────────────────

describe('ComparisonExplanationService', () => {
  let service: ComparisonExplanationService;

  beforeEach(() => {
    service = new ComparisonExplanationService();
  });

  // ============================================================
  // generateComparisonExplanation
  // ============================================================
  describe('generateComparisonExplanation', () => {
    it('should identify calorie advantage when recommended has lower calories', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '蒸蛋', calories: 80 }),
        servingCalories: 60, // < 100 * 0.9 = 90
        score: 80,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '炒蛋', calories: 200 }),
        servingCalories: 100,
        score: 60,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'fat_loss',
      );

      expect(result.recommendedFood).toBe('蒸蛋');
      expect(result.alternativeFood).toBe('炒蛋');
      expect(result.advantages.length).toBeGreaterThanOrEqual(1);
      // At least one advantage should mention calories (the i18n text is a string)
      expect(
        result.advantages.some((a) => typeof a === 'string' && a.length > 0),
      ).toBe(true);
    });

    it('should identify calorie disadvantage when recommended has higher calories', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '红烧肉' }),
        servingCalories: 250, // > 100 * 1.1 = 110
        score: 70,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '白灼虾' }),
        servingCalories: 100,
        score: 65,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'fat_loss',
      );

      expect(result.disadvantages.length).toBeGreaterThanOrEqual(1);
      expect(result.disadvantages[0]).toEqual(expect.any(String));
    });

    it('should identify protein advantage when recommended has higher protein', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '鸡胸肉' }),
        servingCalories: 100,
        servingProtein: 25, // > 10 * 1.1 = 11
        score: 80,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '米饭' }),
        servingCalories: 100,
        servingProtein: 10,
        score: 60,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'muscle_gain',
      );

      // protein advantage should be present
      expect(result.advantages.length).toBeGreaterThanOrEqual(1);
    });

    it('should identify fiber advantage when recommended has higher fiber', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '燕麦' }),
        servingCalories: 100,
        servingFiber: 5, // > 2 * 1.2 = 2.4
        score: 80,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '白面包' }),
        servingCalories: 100,
        servingFiber: 2,
        score: 60,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'health',
      );

      expect(result.advantages.length).toBeGreaterThanOrEqual(1);
    });

    it('should identify acquisition difficulty advantage', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '苹果', acquisitionDifficulty: 1 }),
        servingCalories: 80,
        score: 75,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '进口蓝莓', acquisitionDifficulty: 4 }),
        servingCalories: 80,
        score: 70,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'health',
      );

      // Should have an "easier to acquire" advantage
      expect(result.advantages.length).toBeGreaterThanOrEqual(1);
    });

    it('should calculate correct scoreDifference and scorePercentage', () => {
      const recommended = createScoredFood({
        food: createFood({ name: 'A' }),
        servingCalories: 100,
        score: 90,
      });
      const alternative = createScoredFood({
        food: createFood({ name: 'B' }),
        servingCalories: 100,
        score: 60,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'daily',
      );

      expect(result.scoreDifference).toBe(30); // 90 - 60
      expect(result.scorePercentage).toBe(Math.round((30 / 60) * 100)); // 50
    });

    it('should generate summary string with advantages', () => {
      const recommended = createScoredFood({
        food: createFood({ name: '鸡胸肉' }),
        servingCalories: 60,
        servingProtein: 25,
        score: 85,
      });
      const alternative = createScoredFood({
        food: createFood({ name: '五花肉' }),
        servingCalories: 200,
        servingProtein: 10,
        score: 55,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'fat_loss',
      );

      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should handle scorePercentage of 0 when alternative score is 0', () => {
      const recommended = createScoredFood({
        food: createFood({ name: 'A' }),
        servingCalories: 100,
        score: 50,
      });
      const alternative = createScoredFood({
        food: createFood({ name: 'B' }),
        servingCalories: 100,
        score: 0,
      });

      const result = service.generateComparisonExplanation(
        recommended,
        alternative,
        'daily',
      );

      expect(result.scorePercentage).toBe(0);
    });
  });

  // ============================================================
  // generateSubstitutionExplanation
  // ============================================================
  describe('generateSubstitutionExplanation', () => {
    const target = { calories: 500, protein: 25, fat: 15, carbs: 60 } as any;

    it('should identify good substitute (small calorie change, same/better protein)', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋', category: '蛋类' }),
        servingCalories: 72,
        servingProtein: 6.5,
        servingFiber: 0,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '鹌鹑蛋', category: '蛋类' }),
        servingCalories: 80, // |80-72|=8 <= 500*0.15=75 ✓
        servingProtein: 7, // change >= 0 ✓
        servingFiber: 0,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(result.isGoodSubstitute).toBe(true);
      expect(result.originalFood).toBe('鸡蛋');
      expect(result.substituteFood).toBe('鹌鹑蛋');
    });

    it('should identify bad substitute (large calorie change)', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋' }),
        servingCalories: 72,
        servingProtein: 6.5,
        servingFiber: 0,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '红烧肉' }),
        servingCalories: 300, // |300-72|=228 > 500*0.15=75 ✗
        servingProtein: 10,
        servingFiber: 0,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'fat_loss',
        target,
      );

      expect(result.isGoodSubstitute).toBe(false);
    });

    it('should identify bad substitute (significant protein loss)', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡胸肉' }),
        servingCalories: 100,
        servingProtein: 25,
        servingFiber: 0,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '白米饭' }),
        servingCalories: 110, // |110-100|=10 <= 75 ✓
        servingProtein: 3, // change=-22, |22| >= 3 ✗
        servingFiber: 0,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'muscle_gain',
        target,
      );

      expect(result.isGoodSubstitute).toBe(false);
    });

    it('should detect same category substitute', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋', category: '蛋类' }),
      });
      const substitute = createScoredFood({
        food: createFood({ name: '鹌鹑蛋', category: '蛋类' }),
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(result.sameCategorySubstitute).toBe(true);
    });

    it('should detect cross category substitute', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋', category: '蛋类' }),
      });
      const substitute = createScoredFood({
        food: createFood({ name: '豆腐', category: '豆制品' }),
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(result.sameCategorySubstitute).toBe(false);
    });

    it('should generate calorie impact text when calorie change > 10', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋' }),
        servingCalories: 72,
        servingProtein: 6.5,
        servingFiber: 0,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '培根' }),
        servingCalories: 150, // |150-72|=78 > 10
        servingProtein: 6.5,
        servingFiber: 0,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'daily',
        target,
      );

      expect(result.calorieChange).toBe(78);
      expect(result.impacts.length).toBeGreaterThanOrEqual(1);
      expect(result.impacts[0]).toEqual(expect.any(String));
    });

    it('should generate protein impact text when protein change > 1', () => {
      const original = createScoredFood({
        food: createFood({ name: '米饭' }),
        servingCalories: 100,
        servingProtein: 3,
        servingFiber: 0,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '藜麦' }),
        servingCalories: 105,
        servingProtein: 8, // |8-3|=5 > 1
        servingFiber: 0,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(result.proteinChange).toBe(5);
      expect(result.impacts.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate fiber impact text when fiber change > 0.5', () => {
      const original = createScoredFood({
        food: createFood({ name: '白米饭' }),
        servingCalories: 100,
        servingProtein: 3,
        servingFiber: 0.3,
      });
      const substitute = createScoredFood({
        food: createFood({ name: '糙米饭' }),
        servingCalories: 105,
        servingProtein: 3.5,
        servingFiber: 2.5, // |2.5-0.3|=2.2 > 0.5
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(result.fiberChange).toBeCloseTo(2.2);
      // Should have fiber impact entry
      expect(result.impacts.length).toBeGreaterThanOrEqual(1);
    });

    it('should calculate correct nutrient changes', () => {
      const original = createScoredFood({
        food: createFood({ name: 'A' }),
        servingCalories: 100,
        servingProtein: 10,
        servingFiber: 2,
      });
      const substitute = createScoredFood({
        food: createFood({ name: 'B' }),
        servingCalories: 130,
        servingProtein: 15,
        servingFiber: 1,
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'daily',
        target,
      );

      expect(result.calorieChange).toBe(30);
      expect(result.proteinChange).toBe(5);
      expect(result.fiberChange).toBe(-1);
    });

    it('should generate suggestion string', () => {
      const original = createScoredFood({
        food: createFood({ name: '鸡蛋' }),
      });
      const substitute = createScoredFood({
        food: createFood({ name: '豆腐' }),
      });

      const result = service.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        target,
      );

      expect(typeof result.suggestion).toBe('string');
      expect(result.suggestion.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // generateDeltaExplanation
  // ============================================================
  describe('generateDeltaExplanation', () => {
    function createProfile(overrides: Record<string, any> = {}): any {
      return {
        declared: { goalType: 'health' },
        inferred: null,
        observed: null,
        contextual: null,
        ...overrides,
      };
    }

    it('should return null when no new foods appear today', () => {
      const food1 = createFood({ id: 'f1', name: '鸡蛋' });
      const food2 = createFood({ id: 'f2', name: '牛奶' });

      const result = service.generateDeltaExplanation(
        [food1, food2],
        [food1, food2],
        createProfile(),
      );

      expect(result).toBeNull();
    });

    it('should return changed food names when new foods found', () => {
      const food1 = createFood({ id: 'f1', name: '鸡蛋' });
      const food2 = createFood({ id: 'f2', name: '牛奶' });
      const food3 = createFood({ id: 'f3', name: '燕麦' });

      const result = service.generateDeltaExplanation(
        [food1, food3], // today: f1, f3 (f3 is new)
        [food1, food2], // yesterday: f1, f2
        createProfile(),
      );

      expect(result).not.toBeNull();
      expect(result!.changedFoods).toEqual(['燕麦']);
    });

    it('should detect post_exercise scene', () => {
      const todayFood = createFood({ id: 'f1', name: '蛋白粉' });
      const yesterdayFood = createFood({ id: 'f2', name: '米饭' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({ contextual: { scene: 'post_exercise' } }),
      );

      expect(result).not.toBeNull();
      expect(typeof result!.primaryReason).toBe('string');
      expect(result!.primaryReason.length).toBeGreaterThan(0);
    });

    it('should detect late_night scene', () => {
      const todayFood = createFood({ id: 'f1', name: '小米粥' });
      const yesterdayFood = createFood({ id: 'f2', name: '炒面' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({ contextual: { scene: 'late_night' } }),
      );

      expect(result).not.toBeNull();
      expect(typeof result!.primaryReason).toBe('string');
    });

    it('should detect nutrition gap reason', () => {
      const todayFood = createFood({ id: 'f1', name: '菠菜' });
      const yesterdayFood = createFood({ id: 'f2', name: '白菜' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({
          inferred: { nutritionGaps: ['铁', '钙'] },
        }),
      );

      expect(result).not.toBeNull();
      expect(typeof result!.primaryReason).toBe('string');
      expect(result!.primaryReason.length).toBeGreaterThan(0);
    });

    it('should detect diversity rotation when low category overlap', () => {
      // Today and yesterday have completely different categories → overlap = 0
      const todayFoods = [
        createFood({ id: 'f1', name: '三文鱼', category: '鱼类' }),
        createFood({ id: 'f2', name: '牛排', category: '牛肉' }),
      ];
      const yesterdayFoods = [
        createFood({ id: 'f3', name: '米饭', category: '谷物' }),
        createFood({ id: 'f4', name: '豆腐', category: '豆制品' }),
      ];

      const result = service.generateDeltaExplanation(
        todayFoods,
        yesterdayFoods,
        createProfile(), // no scene, no gaps → falls through to diversity check
      );

      expect(result).not.toBeNull();
      expect(typeof result!.primaryReason).toBe('string');
    });

    it('should fall back to strategy refresh when no special conditions', () => {
      // Same categories → high overlap, no scene, no gaps
      const todayFoods = [
        createFood({ id: 'f1', name: '炒鸡蛋', category: '蛋类' }),
      ];
      const yesterdayFoods = [
        createFood({ id: 'f2', name: '煮鸡蛋', category: '蛋类' }),
      ];

      const result = service.generateDeltaExplanation(
        todayFoods,
        yesterdayFoods,
        createProfile(),
      );

      expect(result).not.toBeNull();
      expect(typeof result!.primaryReason).toBe('string');
    });

    it('should have high confidence with rich profile', () => {
      const todayFood = createFood({ id: 'f1', name: '鸡胸肉' });
      const yesterdayFood = createFood({ id: 'f2', name: '猪肉' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({
          declared: { goalType: 'fat_loss' },
          inferred: { nutritionGaps: [] },
          observed: { totalRecords: 10 },
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe('high');
    });

    it('should have medium confidence without rich profile', () => {
      const todayFood = createFood({ id: 'f1', name: '鸡胸肉' });
      const yesterdayFood = createFood({ id: 'f2', name: '猪肉' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({
          declared: { goalType: 'fat_loss' },
          inferred: null,
          observed: null,
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe('medium');
    });

    it('should have medium confidence when observed records < 7', () => {
      const todayFood = createFood({ id: 'f1', name: '鸡胸肉' });
      const yesterdayFood = createFood({ id: 'f2', name: '猪肉' });

      const result = service.generateDeltaExplanation(
        [todayFood],
        [yesterdayFood],
        createProfile({
          declared: { goalType: 'fat_loss' },
          inferred: { nutritionGaps: [] },
          observed: { totalRecords: 3 },
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe('medium');
    });
  });

  // ============================================================
  // generateChannelFilterExplanation
  // ============================================================
  describe('generateChannelFilterExplanation', () => {
    it('should return null when filteredCount <= 0', () => {
      expect(
        service.generateChannelFilterExplanation(
          AcquisitionChannel.DELIVERY,
          0,
        ),
      ).toBeNull();

      expect(
        service.generateChannelFilterExplanation(
          AcquisitionChannel.DELIVERY,
          -1,
        ),
      ).toBeNull();
    });

    it('should return explanation string for delivery channel', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.DELIVERY,
        5,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('should return explanation string for home_cook channel', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.HOME_COOK,
        3,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('should return explanation string for canteen channel', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.CANTEEN,
        7,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should return explanation string for convenience channel', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.CONVENIENCE,
        2,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should return explanation string for restaurant channel', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.RESTAURANT,
        4,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should handle unknown channel with default text', () => {
      const result = service.generateChannelFilterExplanation(
        AcquisitionChannel.UNKNOWN,
        1,
      );

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });
  });
});
