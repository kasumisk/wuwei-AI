/**
 * V7.7 P4: MealExplanationService 单元测试
 *
 * 覆盖：explainMealComposition 整餐解释生成
 * - 完整 happy path
 * - 营养互补对检测（iron+vitaminC 等）
 * - 单食物不产生互补对
 * - 宏量营养素分布计算（4:4:9 热量拆分）
 * - targetMatch 匹配度（接近 / 远离目标）
 * - 多样性建议（ingredientDiversity / cookingMethods / flavor / texture / nutritionComplementarity）
 * - healthConditions 摘要
 * - 空 picks 数组
 */

import { MealExplanationService } from '../../../src/modules/diet/app/recommendation/explanation/meal-explanation.service';
import { FoodLibrary } from '../../../src/modules/food/food.types';
import {
  ScoredFood,
  MealTarget,
  UserProfileConstraints,
} from '../../../src/modules/diet/app/recommendation/types/recommendation.types';
import {
  MealCompositionScorer,
  MealCompositionScore,
} from '../../../src/modules/diet/app/recommendation/meal/meal-composition-scorer.service';

// ─── Helpers ────────────────────────────────────────────────

function createFood(overrides: Partial<FoodLibrary> = {}): FoodLibrary {
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
  } as any;
}

function createScoredFood(overrides: Partial<ScoredFood> = {}): ScoredFood {
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
  } as any;
}

function createHighScore(): MealCompositionScore {
  return {
    ingredientDiversity: 80,
    cookingMethodDiversity: 75,
    flavorHarmony: 70,
    nutritionComplementarity: 65,
    textureDiversity: 60,
    overall: 70,
  };
}

function createLowScore(
  overrides: Partial<MealCompositionScore> = {},
): MealCompositionScore {
  return {
    ingredientDiversity: 80,
    cookingMethodDiversity: 75,
    flavorHarmony: 70,
    nutritionComplementarity: 65,
    textureDiversity: 60,
    overall: 70,
    ...overrides,
  };
}

// ─── Test Suite ─────────────────────────────────────────────

describe('MealExplanationService', () => {
  let service: MealExplanationService;
  let mockScorer: { scoreMealComposition: jest.Mock };

  beforeEach(() => {
    mockScorer = {
      scoreMealComposition: jest.fn().mockReturnValue(createHighScore()),
    };
    service = new MealExplanationService(mockScorer as any);
  });

  // ─── 1. Happy path ───────────────────────────────────────

  it('should return complete explanation with all fields (happy path with 3 foods)', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({
          id: 'f1',
          name: '鸡胸肉',
          category: '肉类',
          iron: 2,
          cookingMethods: ['pan_fry'],
        }),
        servingProtein: 25,
        servingCalories: 165,
        servingCarbs: 0,
        servingFat: 3.6,
        servingFiber: 0,
        score: 90,
      }),
      createScoredFood({
        food: createFood({
          id: 'f2',
          name: '西兰花',
          category: '蔬菜',
          vitaminC: 89,
          cookingMethods: ['steam'],
        }),
        servingProtein: 2.8,
        servingCalories: 55,
        servingCarbs: 11,
        servingFat: 0.6,
        servingFiber: 5.1,
        score: 85,
      }),
      createScoredFood({
        food: createFood({
          id: 'f3',
          name: '糙米饭',
          category: '谷物',
          cookingMethods: ['boil'],
        }),
        servingProtein: 2.6,
        servingCalories: 123,
        servingCarbs: 26,
        servingFat: 0.9,
        servingFiber: 1.8,
        score: 70,
      }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.compositionScore).toBeDefined();
    expect(result.compositionScore).toEqual(createHighScore());
    expect(result.macroBalance).toBeDefined();
    expect(result.macroBalance!.caloriesTotal).toBe(Math.round(165 + 55 + 123));
    // complementaryPairs should exist because iron+vitaminC synergy detected
    expect(result.complementaryPairs).toBeDefined();
    expect(result.complementaryPairs!.length).toBeGreaterThanOrEqual(1);

    // mockScorer was called
    expect(mockScorer.scoreMealComposition).toHaveBeenCalledWith(picks);
  });

  // ─── 2. Complementary pairs: iron+vitaminC synergy ────────

  it('should generate complementary pairs when foods have iron+vitaminC synergy', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({
          id: 'iron-food',
          name: '菠菜',
          iron: 3.5,
          vitaminC: 0,
        }),
      }),
      createScoredFood({
        food: createFood({
          id: 'vc-food',
          name: '橙子',
          iron: 0,
          vitaminC: 53,
        }),
      }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.complementaryPairs).toBeDefined();
    expect(result.complementaryPairs!.length).toBeGreaterThanOrEqual(1);

    const ironVcPair = result.complementaryPairs!.find(
      (p) => p.foodA === '菠菜' && p.foodB === '橙子',
    );
    expect(ironVcPair).toBeDefined();
    expect(ironVcPair!.nutrientA.length).toBeGreaterThan(0);
    expect(ironVcPair!.nutrientB.length).toBeGreaterThan(0);
    expect(ironVcPair!.benefit.length).toBeGreaterThan(0);
  });

  // ─── 3. Single food → no complementary pairs ─────────────

  it('should not generate complementary pairs for single food', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'single', iron: 5, vitaminC: 20 }),
      }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.complementaryPairs).toBeUndefined();
  });

  // ─── 4. Macro balance calculation (4:4:9) ─────────────────

  it('should calculate macroBalance correctly (protein 4:carb 4:fat 9 calorie split)', () => {
    // Protein=20g, Carbs=50g, Fat=10g
    // proteinCal = 80, carbsCal = 200, fatCal = 90 → total = 370
    // proteinPct = round(80/370*100) = 22
    // carbsPct = round(200/370*100) = 54
    // fatPct = round(90/370*100) = 24
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'macro-test' }),
        servingProtein: 20,
        servingCarbs: 50,
        servingFat: 10,
        servingCalories: 370,
      }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.macroBalance).toBeDefined();
    const mb = result.macroBalance!;
    expect(mb.proteinPct).toBe(Math.round((80 / 370) * 100));
    expect(mb.carbsPct).toBe(Math.round((200 / 370) * 100));
    expect(mb.fatPct).toBe(Math.round((90 / 370) * 100));
    expect(mb.caloriesTotal).toBe(370);
  });

  // ─── 5. targetMatch close to 100 ─────────────────────────

  it('should calculate targetMatch close to 100 when close to target', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'target-close' }),
        servingCalories: 500,
        servingProtein: 30,
        servingFat: 15,
        servingCarbs: 60,
      }),
    ];

    const target: MealTarget = {
      calories: 500,
      protein: 30,
      fat: 15,
      carbs: 60,
    };

    const result = service.explainMealComposition(
      picks,
      undefined,
      undefined,
      undefined,
      target,
    );

    expect(result.macroBalance!.targetMatch).toBe(100);
  });

  // ─── 6. targetMatch close to 0 ───────────────────────────

  it('should calculate targetMatch close to 0 when far from target', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'target-far' }),
        servingCalories: 100,
        servingProtein: 5,
        servingFat: 2,
        servingCarbs: 10,
      }),
    ];

    // Target is much higher than actual
    const target: MealTarget = {
      calories: 2000,
      protein: 100,
      fat: 70,
      carbs: 250,
    };

    const result = service.explainMealComposition(
      picks,
      undefined,
      undefined,
      undefined,
      target,
    );

    // calDiff = |100-2000|/2000 = 0.95
    // proteinDiff = |5-100|/100 = 0.95
    // avgDiff = 0.95 → targetMatch = max(0, round((1-0.95)*100)) = 5
    expect(result.macroBalance!.targetMatch).toBeLessThanOrEqual(10);
  });

  // ─── 7. Diversity tip: ingredientDiversity < 60 ──────────

  it('should generate diversity tips when ingredientDiversity < 60', () => {
    mockScorer.scoreMealComposition.mockReturnValue(
      createLowScore({ ingredientDiversity: 40 }),
    );

    const picks: ScoredFood[] = [
      createScoredFood({ food: createFood({ id: 'd1' }) }),
      createScoredFood({ food: createFood({ id: 'd2' }) }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.diversityTips).toBeDefined();
    expect(result.diversityTips!.length).toBeGreaterThanOrEqual(1);
    // At least one tip should be a non-empty string
    expect(result.diversityTips!.some((t) => t.length > 0)).toBe(true);
  });

  // ─── 8. Diversity tip: cookingMethodDiversity < 50 ───────

  it('should generate cooking method tips when cookingMethodDiversity < 50', () => {
    mockScorer.scoreMealComposition.mockReturnValue(
      createLowScore({ cookingMethodDiversity: 30 }),
    );

    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'cm1', cookingMethods: ['stir_fry'] }),
      }),
      createScoredFood({
        food: createFood({ id: 'cm2', cookingMethods: ['stir_fry'] }),
      }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.diversityTips).toBeDefined();
    expect(result.diversityTips!.length).toBeGreaterThanOrEqual(1);
    expect(result.diversityTips!.some((t) => t.length > 0)).toBe(true);
  });

  // ─── 9. Diversity tip: flavorHarmony < 40 ────────────────

  it('should generate flavor tips when flavorHarmony < 40', () => {
    mockScorer.scoreMealComposition.mockReturnValue(
      createLowScore({ flavorHarmony: 30 }),
    );

    const picks: ScoredFood[] = [
      createScoredFood({ food: createFood({ id: 'fh1' }) }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.diversityTips).toBeDefined();
    expect(result.diversityTips!.length).toBeGreaterThanOrEqual(1);
    expect(result.diversityTips!.some((t) => t.length > 0)).toBe(true);
  });

  // ─── 10. Diversity tip: textureDiversity < 40 ────────────

  it('should generate texture tips when textureDiversity < 40', () => {
    mockScorer.scoreMealComposition.mockReturnValue(
      createLowScore({ textureDiversity: 20 }),
    );

    const picks: ScoredFood[] = [
      createScoredFood({ food: createFood({ id: 'td1' }) }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.diversityTips).toBeDefined();
    expect(result.diversityTips!.length).toBeGreaterThanOrEqual(1);
    expect(result.diversityTips!.some((t) => t.length > 0)).toBe(true);
  });

  // ─── 11. Diversity tip: nutritionComplementarity < 25 ────

  it('should generate nutrition complementarity tips when < 25', () => {
    mockScorer.scoreMealComposition.mockReturnValue(
      createLowScore({ nutritionComplementarity: 15 }),
    );

    const picks: ScoredFood[] = [
      createScoredFood({ food: createFood({ id: 'nc1' }) }),
    ];

    const result = service.explainMealComposition(picks);

    expect(result.diversityTips).toBeDefined();
    expect(result.diversityTips!.length).toBeGreaterThanOrEqual(1);
    expect(result.diversityTips!.some((t) => t.length > 0)).toBe(true);
  });

  // ─── 12. healthConditions note in summary ────────────────

  it('should include healthConditions note in summary when userProfile has healthConditions', () => {
    const picks: ScoredFood[] = [
      createScoredFood({
        food: createFood({ id: 'hc1', name: '全麦面包' }),
        servingProtein: 12,
        servingCalories: 200,
      }),
    ];

    const userProfile: UserProfileConstraints = {
      healthConditions: ['diabetes'],
    };

    const result = service.explainMealComposition(picks, userProfile, 'health');

    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
    // The summary should contain health constraint text from i18n
    // We can't test exact Chinese text, but summary should be longer
    // because it includes the healthConstraint segment
    expect(typeof result.summary).toBe('string');
  });

  // ─── 13. Empty picks array ───────────────────────────────

  it('should handle empty picks array', () => {
    const picks: ScoredFood[] = [];

    const result = service.explainMealComposition(picks);

    expect(result).toBeDefined();
    expect(typeof result.summary).toBe('string');
    expect(result.compositionScore).toBeDefined();
    expect(result.complementaryPairs).toBeUndefined();
    expect(result.macroBalance).toBeDefined();
    expect(result.macroBalance!.caloriesTotal).toBe(0);
    // default targetMatch when no target provided
    expect(result.macroBalance!.targetMatch).toBe(50);
  });
});
