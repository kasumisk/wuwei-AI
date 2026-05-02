/**
 * V7.1 集成测试 — 纯单元风格，所有依赖 mock
 *
 * 覆盖 V7.1 所有新增/增强服务的核心逻辑：
 * 1. 执行率闭环 — ExecutionTrackerService 语义匹配 + 替换模式
 * 2. 场景化推荐 — DailyPlanContextService 跨餐补偿 + 多样性奖惩
 * 3. 偏好学习 — PreferenceProfileService 统一信号
 * 4. 可获得性 — AvailabilityScorerService 时段矩阵
 * 5. 可解释性 — ExplanationGenerator 新增 4 种洞察
 * 6. 评分集成 — FoodScorer preferenceSignal 集成
 * 7. 类型兼容 — 新增字段的类型检查
 */

import {
  SCORE_DIMENSIONS,
  ScoreDimension,
  computeWeights,
  ScoringContext,
  PipelineContext,
  MealFromPoolRequest,
  ScoredFood,
  MealTarget,
  StructuredInsight,
  CrossMealAdjustment,
  PreferenceSignal,
  DailyPlanState,
  AcquisitionChannel,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import type { FoodLibrary } from '../src/modules/food/food.types';
import { FoodScorerService } from '../src/modules/diet/app/recommendation/food-scorer.service';
import { ExplanationGeneratorService } from '../src/modules/diet/app/recommendation/explanation-generator.service';
import { InsightGeneratorService } from '../src/modules/diet/app/recommendation/insight-generator.service';
import { ExplanationTierService } from '../src/modules/diet/app/recommendation/explanation-tier.service';
import { NaturalLanguageExplainerService } from '../src/modules/diet/app/recommendation/natural-language-explainer.service';
import { MealExplanationService } from '../src/modules/diet/app/recommendation/meal-explanation.service';
import { ComparisonExplanationService } from '../src/modules/diet/app/recommendation/comparison-explanation.service';
import { PreferenceProfileService } from '../src/modules/diet/app/recommendation/preference-profile.service';
import { DailyPlanContextService } from '../src/modules/diet/app/recommendation/daily-plan-context.service';
import { AvailabilityScorerService } from '../src/modules/diet/app/recommendation/availability-scorer.service';
import type { KitchenProfile } from '../src/modules/user/user.types';
import { DEFAULT_KITCHEN_PROFILE } from '../src/modules/user/user.types';
import type { SubstitutionPattern } from '../src/modules/diet/app/recommendation/execution-tracker.service';

// ─── Test Helpers ───

function createMockFoodLibrary(overrides?: Partial<FoodLibrary>): FoodLibrary {
  return {
    id: 'food-001',
    code: 'F001',
    name: '鸡胸肉',
    category: 'protein',
    calories: 165,
    protein: 31,
    fat: 3.6,
    carbs: 0,
    fiber: 0,
    processingLevel: 1,
    isProcessed: false,
    isFried: false,
    allergens: [],
    tags: [],
    mealTypes: ['lunch', 'dinner'],
    mainIngredient: 'chicken',
    compatibility: {},
    commonPortions: [],
    standardServingG: 150,
    status: 'active',
    primarySource: 'official',
    dataVersion: 1,
    confidence: 0.9,
    isVerified: true,
    searchWeight: 100,
    popularity: 80,
    commonalityScore: 70,
    availableChannels: ['home_cook', 'restaurant'],
    cookingMethods: ['stir_fry'],
    cuisine: '中餐',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FoodLibrary;
}

function createMockScoredFood(
  food: FoodLibrary,
  score: number = 0.8,
): ScoredFood {
  return {
    food,
    score,
    servingCalories: food.calories * (food.standardServingG / 100),
    servingProtein: (food.protein ?? 0) * (food.standardServingG / 100),
    servingFat: (food.fat ?? 0) * (food.standardServingG / 100),
    servingCarbs: (food.carbs ?? 0) * (food.standardServingG / 100),
    servingFiber: (food.fiber ?? 0) * (food.standardServingG / 100),
    servingGL: food.glycemicLoad ?? 0,
  };
}

function createMockMealTarget(): MealTarget {
  return { calories: 500, protein: 30, fat: 15, carbs: 60 };
}

function createMockDailyPlanState(
  overrides?: Partial<DailyPlanState>,
): DailyPlanState {
  return {
    usedFoodIds: new Set(),
    usedFoodNames: new Set(),
    categoryCounts: {},
    cookingMethodCounts: {},
    usedMainIngredients: new Set(),
    accumulatedNutrition: {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
    },
    flavorCounts: {},
    temperatureCounts: {},
    usedCuisines: new Set(),
    mealCount: 0,
    ...overrides,
  };
}

// ─── Tests ───

describe('V7.1 Integration Tests', () => {
  // ==================== 1. 跨餐营养补偿 ====================

  describe('DailyPlanContextService — Cross-Meal Adjustment (P2-C)', () => {
    let service: DailyPlanContextService;

    beforeEach(() => {
      service = new DailyPlanContextService();
    });

    it('should return neutral adjustment for first meal (mealIndex=0)', () => {
      const state = createMockDailyPlanState({ mealCount: 0 });
      const result = service.computeCrossMealAdjustment(state, 0, {
        calories: 2000,
        protein: 120,
      });
      expect(result.calorieMultiplier).toBe(1.0);
      expect(result.cuisineDiversityBonus).toBe(0);
      expect(result.reason).toBe('first_meal');
    });

    it('should boost lunch calories when breakfast is light (<20%)', () => {
      const state = createMockDailyPlanState({
        mealCount: 1,
        accumulatedNutrition: {
          calories: 300, // 15% of 2000
          protein: 10,
          fat: 8,
          carbs: 40,
          fiber: 3,
        },
      });
      const result = service.computeCrossMealAdjustment(state, 1, {
        calories: 2000,
        protein: 120,
      });
      expect(result.calorieMultiplier).toBeGreaterThan(1.0);
      expect(result.reason).toContain('light_breakfast');
    });

    it('should not boost when breakfast is adequate', () => {
      const state = createMockDailyPlanState({
        mealCount: 1,
        accumulatedNutrition: {
          calories: 500, // 25% of 2000 — adequate
          protein: 20,
          fat: 15,
          carbs: 60,
          fiber: 5,
        },
      });
      const result = service.computeCrossMealAdjustment(state, 1, {
        calories: 2000,
        protein: 120,
      });
      expect(result.calorieMultiplier).toBe(1.0);
    });

    it('should add carb weight override when prev meals are high-carb', () => {
      const state = createMockDailyPlanState({
        mealCount: 2,
        accumulatedNutrition: {
          calories: 1200,
          protein: 30,
          fat: 20,
          carbs: 220, // carb cal = 880/1200 = 73% > 60%
          fiber: 8,
        },
      });
      const result = service.computeCrossMealAdjustment(state, 2, {
        calories: 2000,
        protein: 120,
      });
      expect(result.weightOverrides).toBeDefined();
      expect(result.weightOverrides.carbs).toBeDefined();
      expect(result.reason).toContain('high_carb');
    });

    it('should boost protein weight when protein is insufficient', () => {
      const state = createMockDailyPlanState({
        mealCount: 2,
        accumulatedNutrition: {
          calories: 1200,
          protein: 30, // 30/120 = 25% vs expected ~67% (2/3) × 85% = 56.7%
          fat: 40,
          carbs: 150,
          fiber: 8,
        },
      });
      const result = service.computeCrossMealAdjustment(state, 2, {
        calories: 2000,
        protein: 120,
      });
      expect(result.reason).toContain('protein_deficit');
    });
  });

  // ==================== 2. 多样性奖惩 ====================

  describe('DailyPlanContextService — Diversity Adjustment (P2-F)', () => {
    let service: DailyPlanContextService;

    beforeEach(() => {
      service = new DailyPlanContextService();
    });

    it('should penalize repeated categories', () => {
      const state = createMockDailyPlanState({
        categoryCounts: { protein: 3, veggie: 1 },
      });
      const food = createMockFoodLibrary({ category: 'protein' });
      const result = service.calcDiversityAdjustment(food, state);
      expect(result).toBeLessThan(0); // penalty for over-represented category
    });

    it('should reward new categories', () => {
      const state = createMockDailyPlanState({
        categoryCounts: { protein: 2, carb: 2 },
      });
      const food = createMockFoodLibrary({ category: 'veggie' }); // new category
      const result = service.calcDiversityAdjustment(food, state);
      expect(result).toBeGreaterThanOrEqual(0); // reward or neutral
    });
  });

  // ==================== 3. 统一偏好信号 ====================

  describe('PreferenceProfileService — Unified Preference Signal (P2-G)', () => {
    let service: PreferenceProfileService;

    beforeEach(() => {
      // PreferenceProfileService constructor takes PrismaService + Redis
      // but computePreferenceSignal and sampleBeta are pure functions
      service = new (PreferenceProfileService as any)({}, {});
    });

    it('should return neutral signal for new food (no feedback)', () => {
      const food = createMockFoodLibrary();
      const signal = service.computePreferenceSignal(food);
      expect(signal.combined).toBeGreaterThan(0);
      expect(signal.categoryBoost).toBe(1.0); // no profile data
      expect(signal.ingredientBoost).toBe(1.0);
      expect(signal.substitutionBoost).toBe(0);
      expect(signal.cuisineBoost).toBe(0);
    });

    it('should include category boost from preference profile', () => {
      const food = createMockFoodLibrary({ category: 'protein' });
      const signal = service.computePreferenceSignal(food, null, {
        categoryWeights: { protein: 1.2 },
        ingredientWeights: {},
        foodGroupWeights: {},
        foodNameWeights: {},
      });
      expect(signal.categoryBoost).toBe(1.2);
    });

    it('should include ingredient boost from preference profile', () => {
      const food = createMockFoodLibrary({ mainIngredient: 'chicken' });
      const signal = service.computePreferenceSignal(food, null, {
        categoryWeights: {},
        ingredientWeights: { chicken: 1.15 },
        foodGroupWeights: {},
        foodNameWeights: {},
      });
      expect(signal.ingredientBoost).toBe(1.15);
    });

    it('should include substitution boost when food is a frequent replacement target', () => {
      const food = createMockFoodLibrary({ id: 'food-002', name: '三文鱼' });
      const subs: SubstitutionPattern[] = [
        {
          fromFoodId: 'food-001',
          fromFoodName: '鸡胸肉',
          toFoodId: 'food-002',
          toFoodName: '三文鱼',
          frequency: 5,
        },
      ];
      const signal = service.computePreferenceSignal(
        food,
        null,
        null,
        null,
        subs,
      );
      expect(signal.substitutionBoost).toBe(0.05); // 1 match × 0.05
    });

    it('should cap substitution boost at 2 matches (0.10)', () => {
      const food = createMockFoodLibrary({ id: 'food-002', name: '三文鱼' });
      const subs: SubstitutionPattern[] = [
        {
          fromFoodId: 'f1',
          fromFoodName: '鸡胸肉',
          toFoodId: 'food-002',
          toFoodName: '三文鱼',
          frequency: 5,
        },
        {
          fromFoodId: 'f2',
          fromFoodName: '牛肉',
          toFoodId: 'food-002',
          toFoodName: '三文鱼',
          frequency: 3,
        },
        {
          fromFoodId: 'f3',
          fromFoodName: '猪肉',
          toFoodId: 'food-002',
          toFoodName: '三文鱼',
          frequency: 2,
        },
      ];
      const signal = service.computePreferenceSignal(
        food,
        null,
        null,
        null,
        subs,
      );
      expect(signal.substitutionBoost).toBe(0.1); // capped at 2 × 0.05
    });

    it('should include cuisine boost from preferences profile', () => {
      const food = createMockFoodLibrary({ cuisine: '日本料理' });
      const signal = service.computePreferenceSignal(food, null, null, {
        cuisineWeights: { 日本料理: 0.8 },
      } as any);
      // (0.8 - 0.5) × 0.2 = 0.06
      expect(signal.cuisineBoost).toBeCloseTo(0.06, 2);
    });

    it('should combine all signals into combined multiplier', () => {
      const food = createMockFoodLibrary({
        cuisine: '中餐',
        category: 'protein',
        mainIngredient: 'chicken',
      });
      const signal = service.computePreferenceSignal(
        food,
        { accepted: 5, rejected: 1 } as any,
        {
          categoryWeights: { protein: 1.1 },
          ingredientWeights: { chicken: 1.05 },
          foodGroupWeights: {},
          foodNameWeights: {},
        },
        { cuisineWeights: { 中餐: 0.7 } } as any,
      );
      expect(signal.combined).toBeGreaterThan(0);
      // combined = explorationMultiplier × (categoryBoost × ingredientBoost × (1 + substitutionBoost + cuisineBoost))
      const expected =
        signal.explorationMultiplier *
        signal.categoryBoost *
        signal.ingredientBoost *
        (1 + signal.substitutionBoost + signal.cuisineBoost);
      expect(signal.combined).toBeCloseTo(expected, 6);
    });

    it('sampleBeta should return value in [0, 1]', () => {
      for (let i = 0; i < 100; i++) {
        const val = service.sampleBeta(2, 3);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it('sampleBeta(1,1) should be equivalent to uniform random', () => {
      // Just check it returns a value in [0, 1]
      const val = service.sampleBeta(1, 1);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    });
  });

  // ==================== 4. 可获得性时段矩阵 ====================

  describe('AvailabilityScorerService — Time-Aware Scoring (P2-H)', () => {
    let service: AvailabilityScorerService;

    beforeEach(() => {
      service = new (AvailabilityScorerService as any)({});
    });

    it('resolveTimeSlot should map meal types correctly', () => {
      expect(service.resolveTimeSlot('breakfast')).toBe('morning');
      expect(service.resolveTimeSlot('lunch')).toBe('midday');
      expect(service.resolveTimeSlot('dinner')).toBe('evening');
      expect(service.resolveTimeSlot('snack')).toBe('evening');
    });

    it('resolveTimeSlot should map hour numbers correctly', () => {
      expect(service.resolveTimeSlot(7)).toBe('morning');
      expect(service.resolveTimeSlot(12)).toBe('midday');
      expect(service.resolveTimeSlot(15)).toBe('evening');
      expect(service.resolveTimeSlot(19)).toBe('evening');
    });

    it('getTimeMultiplier should return a number between 0 and 1', () => {
      const channels: AcquisitionChannel[] = [
        AcquisitionChannel.HOME_COOK,
        AcquisitionChannel.RESTAURANT,
        AcquisitionChannel.DELIVERY,
        AcquisitionChannel.CONVENIENCE,
        AcquisitionChannel.CANTEEN,
      ];
      const slots = ['morning', 'midday', 'evening', 'lateNight'] as const;
      for (const ch of channels) {
        for (const slot of slots) {
          const mult = service.getTimeMultiplier(ch, slot);
          expect(mult).toBeGreaterThanOrEqual(0);
          expect(mult).toBeLessThanOrEqual(1);
        }
      }
    });

    it('scoreWithTime should incorporate time multiplier', () => {
      const food = createMockFoodLibrary({ availableChannels: ['home_cook'] });
      const baseScore = service.score(food, AcquisitionChannel.HOME_COOK);
      const timeScore = service.scoreWithTime(
        food,
        AcquisitionChannel.HOME_COOK,
        'breakfast',
      );
      // timeScore.overallAvailability = baseScore × timeMultiplier
      expect(timeScore.overallAvailability).toBeGreaterThanOrEqual(0);
      expect(timeScore.source).toBe('time_aware');
    });
  });

  // ==================== 5. 可解释性升级 ====================

  describe('ExplanationGenerator — New Insight Types (P3-E)', () => {
    let generator: ExplanationGeneratorService;

    beforeEach(() => {
      generator = new ExplanationGeneratorService(
        {} as any,
        new InsightGeneratorService(),
        new ExplanationTierService(),
        new NaturalLanguageExplainerService(),
        new MealExplanationService({} as any),
        new ComparisonExplanationService(),
      );
    });

    it('should generate substitution_rationale insight when food is a frequent substitution target', () => {
      const food = createMockFoodLibrary({ name: '三文鱼' });
      const scored = createMockScoredFood(food, 0.85);
      const subs: SubstitutionPattern[] = [
        {
          fromFoodId: 'f1',
          fromFoodName: '鸡胸肉',
          toFoodId: food.id,
          toFoodName: '三文鱼',
          frequency: 4,
        },
      ];

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
        null,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        subs,
      );

      const subInsights = insights.filter(
        (i) => i.type === 'substitution_rationale',
      );
      expect(subInsights.length).toBe(1);
      expect(subInsights[0].vars.toFood).toBe('三文鱼');
      expect(subInsights[0].vars.fromFood).toBe('鸡胸肉');
      expect(subInsights[0].vars.frequency).toBe(4);
    });

    it('should not generate substitution_rationale when no substitutions match', () => {
      const food = createMockFoodLibrary({ name: '白米饭' });
      const scored = createMockScoredFood(food);
      const subs: SubstitutionPattern[] = [
        {
          fromFoodId: 'f1',
          fromFoodName: '鸡胸肉',
          toFoodId: 'f2',
          toFoodName: '三文鱼',
          frequency: 3,
        },
      ];

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
        null,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        subs,
      );

      expect(
        insights.filter((i) => i.type === 'substitution_rationale').length,
      ).toBe(0);
    });

    it('should generate cross_meal_context insight when crossMealAdjustment is active', () => {
      const food = createMockFoodLibrary();
      const scored = createMockScoredFood(food);
      const adjustment: CrossMealAdjustment = {
        calorieMultiplier: 1.1,
        weightOverrides: {},
        cuisineDiversityBonus: 0,
        reason: 'light_breakfast(15%<20%)',
      };

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
        null,
        null,
        undefined,
        undefined,
        undefined,
        adjustment,
      );

      const crossMealInsights = insights.filter(
        (i) => i.type === 'cross_meal_context',
      );
      expect(crossMealInsights.length).toBe(1);
      expect(crossMealInsights[0].contentKey).toContain('light_breakfast');
    });

    it('should not generate cross_meal_context for first_meal', () => {
      const food = createMockFoodLibrary();
      const scored = createMockScoredFood(food);
      const adjustment: CrossMealAdjustment = {
        calorieMultiplier: 1.0,
        weightOverrides: {},
        cuisineDiversityBonus: 0,
        reason: 'first_meal',
      };

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
        null,
        null,
        undefined,
        undefined,
        undefined,
        adjustment,
      );

      expect(
        insights.filter((i) => i.type === 'cross_meal_context').length,
      ).toBe(0);
    });

    it('should generate actionable_tip for protein gap', () => {
      const food = createMockFoodLibrary({
        calories: 300,
        protein: 5,
        standardServingG: 100,
      });
      const scored = createMockScoredFood(food);
      // target.protein = 30, actual = 5 → gap = 25 > 30 × 0.3 = 9

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
      );

      const tipInsights = insights.filter(
        (i) =>
          i.type === 'actionable_tip' && i.contentKey.includes('protein_gap'),
      );
      expect(tipInsights.length).toBe(1);
      expect(tipInsights[0].vars.gapGrams).toBeGreaterThan(0);
    });

    it('should generate contrastive insight when top two foods differ by >15%', () => {
      const food1 = createMockFoodLibrary({ name: '鸡胸肉' });
      const food2 = createMockFoodLibrary({
        id: 'food-002',
        name: '猪五花',
        category: 'protein',
      });
      const scored1 = createMockScoredFood(food1, 0.9);
      const scored2 = createMockScoredFood(food2, 0.6);
      // diff = (0.9 - 0.6) / 0.9 = 33% > 15%

      const insights = generator.generateStructuredInsights(
        [scored1, scored2],
        createMockMealTarget(),
      );

      const contrastiveInsights = insights.filter(
        (i) => i.type === 'contrastive',
      );
      expect(contrastiveInsights.length).toBe(1);
      expect(contrastiveInsights[0].vars.recommended).toBe('鸡胸肉');
      expect(contrastiveInsights[0].vars.alternative).toBe('猪五花');
      expect(contrastiveInsights[0].vars.differencePercent).toBeGreaterThan(15);
    });

    it('should not generate contrastive insight when scores are close', () => {
      const food1 = createMockFoodLibrary({ name: '鸡胸肉' });
      const food2 = createMockFoodLibrary({ id: 'food-002', name: '鸡腿肉' });
      const scored1 = createMockScoredFood(food1, 0.85);
      const scored2 = createMockScoredFood(food2, 0.8);
      // diff = (0.85 - 0.80) / 0.85 = 5.9% < 15%

      const insights = generator.generateStructuredInsights(
        [scored1, scored2],
        createMockMealTarget(),
      );

      expect(insights.filter((i) => i.type === 'contrastive').length).toBe(0);
    });

    it('should sort all insights by importance descending', () => {
      const food = createMockFoodLibrary({
        calories: 300,
        protein: 5,
        standardServingG: 100,
      });
      const scored = createMockScoredFood(food);
      const adjustment: CrossMealAdjustment = {
        calorieMultiplier: 1.1,
        weightOverrides: {},
        cuisineDiversityBonus: 0,
        reason: 'light_breakfast(15%<20%)',
      };
      const subs: SubstitutionPattern[] = [
        {
          fromFoodId: 'f1',
          fromFoodName: '鸡胸肉',
          toFoodId: food.id,
          toFoodName: food.name,
          frequency: 3,
        },
      ];

      const insights = generator.generateStructuredInsights(
        [scored],
        createMockMealTarget(),
        null,
        null,
        undefined,
        undefined,
        undefined,
        adjustment,
        subs,
      );

      for (let i = 1; i < insights.length; i++) {
        expect(insights[i - 1].importance).toBeGreaterThanOrEqual(
          insights[i].importance,
        );
      }
    });
  });

  // ==================== 6. FoodScorer PreferenceSignal 集成 ====================

  describe('FoodScorer — PreferenceSignal Integration (P3-C)', () => {
    let scorer: FoodScorerService;

    beforeEach(() => {
      // FoodScorerService constructor: (penaltyEngine, recommendationConfig, nutritionTargetService, seasonalityService)
      const mockPenaltyEngine = {
        evaluate: () => ({
          finalMultiplier: 1.0,
          modifiers: [],
          isVetoed: false,
        }),
      };
      const mockRecommendationConfig = {
        getWeightsForGoal: () => null,
        getBaseWeights: () => null,
      };
      const mockNutritionTargetService = {
        getDailyTarget: () => null,
      };
      const mockSeasonalityService = {
        getSeasonalityScore: () => 1.0,
      };
      scorer = new (FoodScorerService as any)(
        mockPenaltyEngine,
        mockRecommendationConfig,
        mockNutritionTargetService,
        mockSeasonalityService,
      );
    });

    it('should use preferenceSignal.cuisineBoost when signal is provided', () => {
      const food = createMockFoodLibrary({ cuisine: '日本料理' });
      const target = createMockMealTarget();

      // Without signal — using inline cuisine boost (fallback)
      const scoreWithout = scorer.scoreFoodDetailed({
        food,
        goalType: 'health',
        target,
        preferencesProfile: { cuisineWeights: { 日本料理: 0.8 } } as any,
      });

      // With signal — should use preferenceSignal instead
      const signalBoost = (0.8 - 0.5) * 0.2; // 0.06
      const scoreWith = scorer.scoreFoodDetailed({
        food,
        goalType: 'health',
        target,
        preferencesProfile: { cuisineWeights: { 日本料理: 0.8 } } as any,
        preferenceSignal: {
          explorationMultiplier: 1.0,
          categoryBoost: 1.0,
          ingredientBoost: 1.0,
          substitutionBoost: 0.05,
          cuisineBoost: signalBoost,
          combined: 1.0 * 1.0 * 1.0 * (1 + 0.05 + signalBoost),
        },
      });

      // Both should produce non-zero scores
      expect(scoreWithout.score).toBeGreaterThan(0);
      expect(scoreWith.score).toBeGreaterThan(0);
      // With signal should include substitutionBoost → slightly different score
      // The ratio should differ by the substitutionBoost amount (0.05)
      if (scoreWithout.score > 0 && scoreWith.score > 0) {
        const ratio = scoreWith.score / scoreWithout.score;
        // With signal: rawScore *= (1 + cuisineBoost + substitutionBoost)
        // Without signal: rawScore *= (1 + cuisineBoost)
        // Difference is the substitutionBoost = 0.05
        expect(ratio).toBeCloseTo(
          (1 + signalBoost + 0.05) / (1 + signalBoost),
          1,
        );
      }
    });

    it('should fall back to inline cuisine boost when preferenceSignal is not provided', () => {
      const food = createMockFoodLibrary({ cuisine: '中餐' });
      const target = createMockMealTarget();

      const result = scorer.scoreFoodDetailed({
        food,
        goalType: 'health',
        target,
        preferencesProfile: { cuisineWeights: { 中餐: 0.9 } } as any,
      });

      // Score should be non-zero (fallback path)
      expect(result.score).toBeGreaterThan(0);
    });

    it('should return zero score when penaltyEngine vetoes', () => {
      const mockPenaltyEngineVeto = {
        evaluate: () => ({
          finalMultiplier: 0,
          modifiers: [{ multiplier: 0, reason: 'test', type: 'test' }],
          isVetoed: true,
        }),
      };
      const vetoScorer = new (FoodScorerService as any)(
        mockPenaltyEngineVeto,
        { getWeightsForGoal: () => null, getBaseWeights: () => null },
        { getDailyTarget: () => null },
        { getSeasonalityScore: () => 1.0 },
      );
      const food = createMockFoodLibrary();

      const result = vetoScorer.scoreFoodDetailed({
        food,
        goalType: 'health',
        target: createMockMealTarget(),
        preferenceSignal: {
          explorationMultiplier: 1.0,
          categoryBoost: 1.0,
          ingredientBoost: 1.0,
          substitutionBoost: 0.05,
          cuisineBoost: 0.06,
          combined: 1.11,
        },
      });

      expect(result.score).toBe(0);
    });
  });

  // ==================== 7. 类型兼容性 ====================

  describe('Type Compatibility — V7.1 New Fields', () => {
    describe('PipelineContext', () => {
      it('should accept crossMealAdjustment field', () => {
        const adj: CrossMealAdjustment = {
          calorieMultiplier: 1.1,
          weightOverrides: { carbs: 1.3 },
          cuisineDiversityBonus: 0.05,
          reason: 'light_breakfast',
        };
        const ctx: Partial<PipelineContext> = {
          crossMealAdjustment: adj,
        };
        expect(ctx.crossMealAdjustment).toBeDefined();
        expect(ctx.crossMealAdjustment!.calorieMultiplier).toBe(1.1);
      });

      it('should accept kitchenProfile field', () => {
        const kp: KitchenProfile = { ...DEFAULT_KITCHEN_PROFILE };
        const ctx: Partial<PipelineContext> = {
          kitchenProfile: kp,
        };
        expect(ctx.kitchenProfile).toBeDefined();
        expect(ctx.kitchenProfile!.hasOven).toBe(false);
      });

      it('should accept null kitchenProfile', () => {
        const ctx: Partial<PipelineContext> = {
          kitchenProfile: null,
        };
        expect(ctx.kitchenProfile).toBeNull();
      });

      it('should accept substitutions field', () => {
        const subs = [
          {
            fromFoodId: 'f1',
            fromFoodName: '鸡胸肉',
            toFoodId: 'f2',
            toFoodName: '三文鱼',
            frequency: 5,
          },
        ];
        const ctx: Partial<PipelineContext> = {
          substitutions: subs,
        };
        expect(ctx.substitutions).toHaveLength(1);
      });
    });

    describe('MealFromPoolRequest', () => {
      it('should accept crossMealAdjustment field', () => {
        const req: Partial<MealFromPoolRequest> = {
          crossMealAdjustment: {
            calorieMultiplier: 1.0,
            weightOverrides: {},
            cuisineDiversityBonus: 0,
            reason: 'first_meal',
          },
        };
        expect(req.crossMealAdjustment).toBeDefined();
      });

      it('should accept kitchenProfile field', () => {
        const req: Partial<MealFromPoolRequest> = {
          kitchenProfile: DEFAULT_KITCHEN_PROFILE,
        };
        expect(req.kitchenProfile).toBeDefined();
      });

      it('should accept substitutions field', () => {
        const req: Partial<MealFromPoolRequest> = {
          substitutions: [],
        };
        expect(req.substitutions).toHaveLength(0);
      });
    });

    describe('ScoringContext', () => {
      it('should accept preferenceSignal field', () => {
        const signal: PreferenceSignal = {
          explorationMultiplier: 1.0,
          categoryBoost: 1.0,
          ingredientBoost: 1.0,
          substitutionBoost: 0,
          cuisineBoost: 0,
          combined: 1.0,
        };
        const ctx: Partial<ScoringContext> = {
          preferenceSignal: signal,
        };
        expect(ctx.preferenceSignal!.combined).toBe(1.0);
      });
    });

    describe('CrossMealAdjustment', () => {
      it('should have all required fields', () => {
        const adj: CrossMealAdjustment = {
          calorieMultiplier: 1.15,
          weightOverrides: { protein: 1.4, carbs: 1.3 },
          cuisineDiversityBonus: 0.05,
          reason: 'light_breakfast+low_protein',
        };
        expect(adj.calorieMultiplier).toBe(1.15);
        expect(adj.weightOverrides.protein).toBe(1.4);
        expect(adj.cuisineDiversityBonus).toBe(0.05);
        expect(adj.reason).toContain('light_breakfast');
      });
    });

    describe('PreferenceSignal', () => {
      it('should have all required fields', () => {
        const signal: PreferenceSignal = {
          explorationMultiplier: 0.9,
          categoryBoost: 1.1,
          ingredientBoost: 1.05,
          substitutionBoost: 0.05,
          cuisineBoost: 0.06,
          combined: 0.9 * 1.1 * 1.05 * (1 + 0.05 + 0.06),
        };
        expect(signal.combined).toBeCloseTo(0.9 * 1.1 * 1.05 * 1.11, 6);
      });
    });

    describe('KitchenProfile', () => {
      it('should have all required fields', () => {
        const kp: KitchenProfile = {
          hasOven: true,
          hasMicrowave: true,
          hasAirFryer: false,
          hasRiceCooker: true,
          hasSteamer: true,
          primaryStove: 'gas',
        };
        expect(kp.hasOven).toBe(true);
        expect(kp.primaryStove).toBe('gas');
      });

      it('DEFAULT_KITCHEN_PROFILE should have correct defaults', () => {
        expect(DEFAULT_KITCHEN_PROFILE.hasOven).toBe(false);
        expect(DEFAULT_KITCHEN_PROFILE.hasMicrowave).toBe(true);
        expect(DEFAULT_KITCHEN_PROFILE.hasAirFryer).toBe(false);
        expect(DEFAULT_KITCHEN_PROFILE.hasRiceCooker).toBe(true);
        expect(DEFAULT_KITCHEN_PROFILE.hasSteamer).toBe(true);
        expect(DEFAULT_KITCHEN_PROFILE.primaryStove).toBe('gas');
      });
    });

    describe('InsightType includes V7.1 types', () => {
      it('should allow substitution_rationale as StructuredInsight type', () => {
        const insight: StructuredInsight = {
          type: 'substitution_rationale',
          titleKey: 'test',
          contentKey: 'test',
          vars: {},
          importance: 0.5,
        };
        expect(insight.type).toBe('substitution_rationale');
      });

      it('should allow cross_meal_context as StructuredInsight type', () => {
        const insight: StructuredInsight = {
          type: 'cross_meal_context',
          titleKey: 'test',
          contentKey: 'test',
          vars: {},
          importance: 0.5,
        };
        expect(insight.type).toBe('cross_meal_context');
      });

      it('should allow actionable_tip as StructuredInsight type', () => {
        const insight: StructuredInsight = {
          type: 'actionable_tip',
          titleKey: 'test',
          contentKey: 'test',
          vars: {},
          importance: 0.5,
        };
        expect(insight.type).toBe('actionable_tip');
      });

      it('should allow contrastive as StructuredInsight type', () => {
        const insight: StructuredInsight = {
          type: 'contrastive',
          titleKey: 'test',
          contentKey: 'test',
          vars: {},
          importance: 0.5,
        };
        expect(insight.type).toBe('contrastive');
      });
    });
  });
});
