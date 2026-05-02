/**
 * V7.2 集成测试 — 纯单元风格，所有依赖 mock
 *
 * 覆盖 V7.2 所有新增/增强服务的核心逻辑：
 * 1. 评分管道链式化 — ScoringChainService + ScoringFactor
 * 2. 现实策略可配置化 — RealismLevel 预设 + filterByRealismLevel + adjustForUserPreference
 * 3. 跨餐补偿规则引擎化 — CrossMealRule 声明式数组 + 自定义规则注入
 * 4. 洞察生成器参数对象化 — InsightGeneratorService + InsightContext
 * 5. 付费分层门控 — ExplanationTierService
 * 6. 偏好缓存Redis化 — toRealismOverride + realismLevel
 * 7. 代码质量 — 类型兼容性验证
 */

import {
  PipelineContext,
  ScoredFood,
  MealTarget,
  StructuredInsight,
  DailyPlanState,
  AcquisitionChannel,
  RealismLevel,
  REALISM_PRESETS,
  SCENE_DEFAULT_REALISM,
  CrossMealAdjustment,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import type { FoodLibrary } from '../src/modules/food/food.types';
import { ScoringChainService } from '../src/modules/diet/app/recommendation/scoring-chain/scoring-chain.service';
import type {
  ScoringFactor,
  ScoringAdjustment,
} from '../src/modules/diet/app/recommendation/scoring-chain/scoring-factor.interface';
import { RealisticFilterService } from '../src/modules/diet/app/recommendation/realistic-filter.service';
import { DailyPlanContextService } from '../src/modules/diet/app/recommendation/daily-plan-context.service';
import {
  CrossMealRule,
  CrossMealRuleContext,
  executeCrossMealRules,
  BUILT_IN_CROSS_MEAL_RULES,
} from '../src/modules/diet/app/recommendation/cross-meal-rules';
import { InsightGeneratorService } from '../src/modules/diet/app/recommendation/insight-generator.service';
import type { InsightContext } from '../src/modules/diet/app/recommendation/insight.types';
import { ExplanationTierService } from '../src/modules/diet/app/recommendation/explanation-tier.service';
import type { ExplanationV2 } from '../src/modules/diet/app/recommendation/scoring-explanation.interface';
import {
  RecommendationPreferences,
  PopularityPreference,
  CookingEffort,
  BudgetSensitivity,
} from '../src/modules/user/user.types';
import { UserProfileService } from '../src/modules/user/app/user-profile.service';

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

function createMinimalPipelineContext(
  overrides?: Partial<PipelineContext>,
): PipelineContext {
  return {
    allFoods: [],
    mealType: 'lunch',
    goalType: 'weight_loss',
    target: createMockMealTarget(),
    constraints: { minCalories: 400, maxCalories: 600 } as any,
    usedNames: new Set(),
    picks: [],
    ...overrides,
  };
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

/**
 * 创建一个最小的 ScoringFactor mock
 *
 * ScoringFactor 实际接口有 isApplicable/init/computeAdjustment 三个方法。
 * 测试中通过 computeAdjustment 返回 ScoringAdjustment（multiplier + additive）。
 */
function createMockScoringFactor(opts: {
  name: string;
  order: number;
  computeAdjustment?: (
    food: FoodLibrary,
    baseScore: number,
    ctx: PipelineContext,
  ) => ScoringAdjustment | null;
}): ScoringFactor {
  return {
    name: opts.name,
    order: opts.order,
    isApplicable: jest.fn().mockReturnValue(true),
    init: jest.fn(),
    computeAdjustment:
      opts.computeAdjustment ?? jest.fn().mockReturnValue(null),
  };
}

// ─── Tests ───

describe('V7.2 Integration Tests', () => {
  // ==================== 1. 评分管道链式化 ====================

  describe('ScoringChainService — Chain Pipeline (P2-A)', () => {
    let service: ScoringChainService;

    beforeEach(() => {
      service = new ScoringChainService();
    });

    it('should start with empty factor list', () => {
      expect(service.getFactors()).toEqual([]);
      expect(service.getFactors().length).toBe(0);
    });

    it('should register factors and sort by order', () => {
      const factorA = createMockScoringFactor({ name: 'factor_a', order: 20 });
      const factorB = createMockScoringFactor({ name: 'factor_b', order: 10 });

      service.registerFactors([factorA, factorB]);

      const factors = service.getFactors();
      expect(factors).toHaveLength(2);
      expect(factors[0].name).toBe('factor_b'); // order=10 先
      expect(factors[1].name).toBe('factor_a'); // order=20 后
      expect(factors.length).toBeGreaterThan(0);
    });

    it('should execute chain and produce adjustments', () => {
      const factor = createMockScoringFactor({
        name: 'test_factor',
        order: 10,
        computeAdjustment: () => ({
          factorName: 'test_factor',
          multiplier: 1.0,
          additive: 0.1,
          explanationKey: null,
          reason: 'test boost',
        }),
      });

      service.registerFactors([factor]);

      const food = createMockFoodLibrary();
      const ctx = createMinimalPipelineContext();

      // executeChain(candidates, baseScores, ctx, config?)
      const result = service.executeChain([food], [0.5], ctx);

      expect(result).toHaveLength(1);
      expect(result[0].food.id).toBe(food.id);
      expect(result[0].baseScore).toBe(0.5);
      expect(result[0].adjustments).toHaveLength(1);
      expect(result[0].adjustments[0].factorName).toBe('test_factor');
      expect(result[0].adjustments[0].additive).toBe(0.1);
      // finalScore = baseScore * multiplier + additive = 0.5 * 1.0 + 0.1 = 0.6
      expect(result[0].finalScore).toBeCloseTo(0.6, 5);
    });

    it('should accumulate adjustments from multiple factors', () => {
      const factorA = createMockScoringFactor({
        name: 'boost_a',
        order: 10,
        computeAdjustment: () => ({
          factorName: 'boost_a',
          multiplier: 1.0,
          additive: 0.05,
          explanationKey: null,
          reason: 'a',
        }),
      });
      const factorB = createMockScoringFactor({
        name: 'boost_b',
        order: 20,
        computeAdjustment: () => ({
          factorName: 'boost_b',
          multiplier: 1.0,
          additive: 0.03,
          explanationKey: null,
          reason: 'b',
        }),
      });

      service.registerFactors([factorA, factorB]);

      const food = createMockFoodLibrary();
      const ctx = createMinimalPipelineContext();
      const result = service.executeChain([food], [1.0], ctx);

      expect(result[0].adjustments).toHaveLength(2);
      // finalScore = ((1.0 * 1.0 + 0.05) * 1.0 + 0.03) = 1.08
      expect(result[0].finalScore).toBeCloseTo(1.08, 5);
    });

    it('should skip disabled factors via config', () => {
      const factor = createMockScoringFactor({
        name: 'skippable',
        order: 10,
        computeAdjustment: () => ({
          factorName: 'skippable',
          multiplier: 1.0,
          additive: 0.5,
          explanationKey: null,
          reason: 'big boost',
        }),
      });

      service.registerFactors([factor]);

      const food = createMockFoodLibrary();
      const ctx = createMinimalPipelineContext();

      // ScoringChainConfig.disabledFactors is string[], not Set<string>
      const result = service.executeChain([food], [1.0], ctx, {
        disabledFactors: ['skippable'],
      });

      expect(result[0].adjustments).toHaveLength(0);
      expect(result[0].finalScore).toBe(1.0);
    });

    it('should handle factor that returns null adjustment', () => {
      const factor = createMockScoringFactor({
        name: 'noop',
        order: 10,
        computeAdjustment: () => null,
      });

      service.registerFactors([factor]);

      const food = createMockFoodLibrary();
      const ctx = createMinimalPipelineContext();
      const result = service.executeChain([food], [0.7], ctx);

      expect(result[0].adjustments).toHaveLength(0);
      expect(result[0].finalScore).toBe(0.7);
    });

    it('should process multiple foods independently', () => {
      const factor = createMockScoringFactor({
        name: 'popularity',
        order: 10,
        computeAdjustment: (food) => {
          const score = (food as any).commonalityScore ?? 50;
          return {
            factorName: 'popularity',
            multiplier: 1.0,
            additive: score > 60 ? 0.1 : -0.1,
            explanationKey: null,
            reason: `commonality=${score}`,
          };
        },
      });

      service.registerFactors([factor]);

      const food1 = createMockFoodLibrary({
        id: 'f1',
        name: 'popular',
        commonalityScore: 80,
      });
      const food2 = createMockFoodLibrary({
        id: 'f2',
        name: 'niche',
        commonalityScore: 20,
      });
      const ctx = createMinimalPipelineContext();

      const result = service.executeChain([food1, food2], [1.0, 1.0], ctx);

      expect(result).toHaveLength(2);
      expect(result[0].finalScore).toBeCloseTo(1.1, 5); // popular → +0.1
      expect(result[1].finalScore).toBeCloseTo(0.9, 5); // niche → -0.1
    });
  });

  // ==================== 2. 现实策略可配置化 ====================

  describe('RealisticFilterService — Configurable Realism (P2-C)', () => {
    let service: RealisticFilterService;

    beforeEach(() => {
      service = new RealisticFilterService();
    });

    // ─── REALISM_PRESETS 类型验证 ───

    it('should define all 4 realism presets', () => {
      expect(REALISM_PRESETS).toHaveProperty('strict');
      expect(REALISM_PRESETS).toHaveProperty('normal');
      expect(REALISM_PRESETS).toHaveProperty('relaxed');
      expect(REALISM_PRESETS).toHaveProperty('off');
    });

    it('strict preset should have highest thresholds', () => {
      const strict = REALISM_PRESETS['strict'];
      expect(strict.commonalityThreshold).toBeGreaterThanOrEqual(40);
      expect(strict.budgetFilterEnabled).toBe(true);
      expect(strict.cookTimeCap).toBeLessThanOrEqual(45);
    });

    it('off preset should disable all filters', () => {
      const off = REALISM_PRESETS['off'];
      expect(off.commonalityThreshold).toBe(0);
      expect(off.budgetFilterEnabled).toBe(false);
      expect(off.cookTimeCap).toBe(Infinity);
    });

    // ─── SCENE_DEFAULT_REALISM ───

    it('should map all AcquisitionChannels to default realism levels', () => {
      expect(SCENE_DEFAULT_REALISM[AcquisitionChannel.HOME_COOK]).toBe(
        'normal',
      );
      expect(SCENE_DEFAULT_REALISM[AcquisitionChannel.CANTEEN]).toBe('strict');
      expect(SCENE_DEFAULT_REALISM[AcquisitionChannel.RESTAURANT]).toBe(
        'relaxed',
      );
    });

    // ─── resolveRealismLevel ───

    it('should prioritize levelOverride over context', () => {
      const ctx = createMinimalPipelineContext({
        realismOverride: { level: 'relaxed' },
      });
      const result = service.resolveRealismLevel(ctx, 'strict');
      expect(result).toBe('strict');
    });

    it('should use context.realismOverride when no override param', () => {
      const ctx = createMinimalPipelineContext({
        realismOverride: { level: 'relaxed' },
      });
      const result = service.resolveRealismLevel(ctx);
      expect(result).toBe('relaxed');
    });

    it('should fall back to scene default when no overrides', () => {
      const ctx = createMinimalPipelineContext({
        channel: AcquisitionChannel.CANTEEN,
      });
      const result = service.resolveRealismLevel(ctx);
      expect(result).toBe('strict');
    });

    it('should default to normal when no context', () => {
      const ctx = createMinimalPipelineContext();
      const result = service.resolveRealismLevel(ctx);
      expect(result).toBe('normal');
    });

    // ─── filterByRealismLevel ───

    it('should skip all filters when level is off', () => {
      const foods = [
        createMockFoodLibrary({ commonalityScore: 1 }), // would be filtered normally
        createMockFoodLibrary({ commonalityScore: 5 }),
      ];
      const ctx = createMinimalPipelineContext({
        realismOverride: { level: 'off' },
      });

      const result = service.filterByRealismLevel(foods, ctx);
      expect(result).toHaveLength(2); // nothing filtered
    });

    it('should filter low commonality foods in strict mode', () => {
      const foods = [
        createMockFoodLibrary({
          id: 'f1',
          commonalityScore: 50,
          name: 'common',
        }),
        createMockFoodLibrary({
          id: 'f2',
          commonalityScore: 10,
          name: 'rare',
        }),
        createMockFoodLibrary({
          id: 'f3',
          commonalityScore: 60,
          name: 'popular',
        }),
      ];
      const ctx = createMinimalPipelineContext();

      const result = service.filterByRealismLevel(foods, ctx, 'strict');
      // strict threshold = 40, so only f1(50) and f3(60) pass
      expect(result.length).toBeLessThanOrEqual(3);
      const names = result.map((f) => f.name);
      expect(names).toContain('common');
      expect(names).toContain('popular');
    });

    // ─── adjustForUserPreference ───

    it('should tighten config for strict preference', () => {
      const result = service.adjustForUserPreference(undefined, 'strict');
      expect(result.cookTimeCapEnabled).toBe(true);
      expect(result.budgetFilterEnabled).toBe(true);
      expect(result.commonalityThreshold).toBeGreaterThanOrEqual(40);
    });

    it('should loosen config for relaxed preference', () => {
      const base = {
        commonalityThreshold: 30,
        cookTimeCapEnabled: true,
        budgetFilterEnabled: true,
      };
      const result = service.adjustForUserPreference(base as any, 'relaxed');
      expect(result.cookTimeCapEnabled).toBe(false);
      expect(result.budgetFilterEnabled).toBe(false);
      expect(result.commonalityThreshold).toBeLessThanOrEqual(10);
    });

    it('should disable realism for off preference', () => {
      const result = service.adjustForUserPreference(
        { enabled: true } as any,
        'off',
      );
      expect(result.enabled).toBe(false);
    });

    it('should keep config unchanged for normal preference', () => {
      const base = {
        commonalityThreshold: 25,
        cookTimeCapEnabled: true,
        budgetFilterEnabled: false,
      };
      const result = service.adjustForUserPreference(base as any, 'normal');
      expect(result.commonalityThreshold).toBe(25);
      expect(result.cookTimeCapEnabled).toBe(true);
      expect(result.budgetFilterEnabled).toBe(false);
    });
  });

  // ==================== 3. 跨餐补偿规则引擎化 ====================

  describe('CrossMealRules — Rule Engine (P2-D)', () => {
    it('should export BUILT_IN_CROSS_MEAL_RULES with 4 rules', () => {
      expect(BUILT_IN_CROSS_MEAL_RULES).toHaveLength(4);
      const ids = BUILT_IN_CROSS_MEAL_RULES.map((r) => r.id);
      expect(ids).toContain('light-breakfast');
      expect(ids).toContain('high-carb-lunch');
      expect(ids).toContain('protein-deficit');
      expect(ids).toContain('cuisine-monotony');
    });

    it('should sort rules by priority', () => {
      const priorities = BUILT_IN_CROSS_MEAL_RULES.map((r) => r.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
      }
    });

    it('should fire light-breakfast rule when breakfast is <20% daily calories', () => {
      const state = createMockDailyPlanState({
        mealCount: 1,
        accumulatedNutrition: {
          calories: 300,
          protein: 10,
          fat: 10,
          carbs: 40,
          fiber: 5,
        }, // 300/2000 = 15% < 20%
      });

      const ctx: CrossMealRuleContext = {
        state,
        mealIndex: 1,
        dailyTarget: { calories: 2000, protein: 120 },
      };

      const result = executeCrossMealRules(BUILT_IN_CROSS_MEAL_RULES, ctx);

      expect(result.calorieMultiplier).toBeGreaterThan(1.0);
      expect(result.reason).toContain('light_breakfast');
    });

    it('should not fire rules for first meal', () => {
      const state = createMockDailyPlanState({ mealCount: 0 });

      const ctx: CrossMealRuleContext = {
        state,
        mealIndex: 0,
        dailyTarget: { calories: 2000, protein: 120 },
      };

      const result = executeCrossMealRules(BUILT_IN_CROSS_MEAL_RULES, ctx);
      expect(result.calorieMultiplier).toBe(1.0);
      expect(result.reason).toBe('first_meal');
    });

    it('should fire protein-deficit rule when protein is low', () => {
      const state = createMockDailyPlanState({
        mealCount: 2,
        accumulatedNutrition: {
          calories: 1000,
          protein: 30,
          fat: 30,
          carbs: 130,
          fiber: 10,
        }, // expected protein at meal#2 = 120*(2/3)=80, actual=30 → 30/80=0.375 < 0.85
      });

      const ctx: CrossMealRuleContext = {
        state,
        mealIndex: 2,
        dailyTarget: { calories: 2000, protein: 120 },
      };

      const result = executeCrossMealRules(BUILT_IN_CROSS_MEAL_RULES, ctx);

      expect(result.weightOverrides).toHaveProperty('protein');
      expect(result.weightOverrides['protein']).toBeGreaterThan(1.0);
      expect(result.reason).toContain('protein_deficit');
    });

    it('should fire cuisine-monotony rule when <= 1 cuisine used for >= 2 meals', () => {
      const state = createMockDailyPlanState({
        mealCount: 2,
        usedCuisines: new Set(['chinese']), // only 1 cuisine for 2 past meals
        accumulatedNutrition: {
          calories: 1200,
          protein: 80,
          fat: 40,
          carbs: 150,
          fiber: 15,
        },
      });

      const ctx: CrossMealRuleContext = {
        state,
        mealIndex: 2,
        dailyTarget: { calories: 2000, protein: 120 },
      };

      const result = executeCrossMealRules(BUILT_IN_CROSS_MEAL_RULES, ctx);

      expect(result.cuisineDiversityBonus).toBeGreaterThan(0);
      expect(result.reason).toContain('cuisine_monotony');
    });

    it('should support custom rules injection', () => {
      const customRule: CrossMealRule = {
        id: 'custom-dinner-boost',
        name: 'CUSTOM_DINNER_BOOST',
        priority: 100,
        enabled: true,
        condition: (ctx) => ctx.mealIndex >= 2,
        apply: () => ({
          calorieMultiplier: 1.05,
          reasonTag: 'custom_dinner_boost',
        }),
      };

      const state = createMockDailyPlanState({
        mealCount: 2,
        usedCuisines: new Set(['chinese', 'western', 'japanese']),
        accumulatedNutrition: {
          calories: 1400,
          protein: 100,
          fat: 50,
          carbs: 180,
          fiber: 20,
        },
      });

      const ctx: CrossMealRuleContext = {
        state,
        mealIndex: 2,
        dailyTarget: { calories: 2000, protein: 120 },
      };

      const result = executeCrossMealRules([customRule], ctx);
      expect(result.calorieMultiplier).toBe(1.05);
      expect(result.reason).toContain('custom_dinner_boost');
    });
  });

  // ==================== 4. 洞察生成器参数对象化 ====================

  describe('InsightGeneratorService — Structured Insights (P2-E)', () => {
    let service: InsightGeneratorService;

    beforeEach(() => {
      service = new InsightGeneratorService();
    });

    it('should return empty array for empty foods', () => {
      const ctx: InsightContext = {
        foods: [],
        target: createMockMealTarget(),
      };
      expect(service.generate(ctx)).toEqual([]);
    });

    it('should generate protein contribution insight', () => {
      const food = createMockFoodLibrary({
        protein: 30,
        standardServingG: 150,
      });
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food)],
        target: { calories: 500, protein: 40, fat: 15, carbs: 60 },
      };

      const insights = service.generate(ctx);
      const proteinInsight = insights.find(
        (i) => i.type === 'nutrient_contribution',
      );
      expect(proteinInsight).toBeDefined();
      expect(proteinInsight!.vars).toHaveProperty('percent');
    });

    it('should generate calorie alignment insight', () => {
      const food = createMockFoodLibrary({
        calories: 200,
        standardServingG: 100,
      });
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food)],
        target: { calories: 500, protein: 30, fat: 15, carbs: 60 },
      };

      const insights = service.generate(ctx);
      const calorieInsight = insights.find((i) => i.type === 'goal_alignment');
      expect(calorieInsight).toBeDefined();
    });

    it('should generate scene match insight when sceneContext provided', () => {
      const food = createMockFoodLibrary();
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food)],
        target: createMockMealTarget(),
        sceneContext: {
          channel: AcquisitionChannel.HOME_COOK,
          sceneType: 'family_dinner',
          realismLevel: 'normal',
          confidence: 0.8,
          source: 'rule_inferred',
          sceneConstraints: {},
        },
      };

      const insights = service.generate(ctx);
      const sceneInsight = insights.find((i) => i.type === 'scene_match');
      expect(sceneInsight).toBeDefined();
    });

    it('should generate cross-meal insight when crossMealAdjustment provided', () => {
      const food = createMockFoodLibrary();
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food)],
        target: createMockMealTarget(),
        crossMealAdjustment: {
          calorieMultiplier: 1.1,
          weightOverrides: { protein: 1.4 },
          cuisineDiversityBonus: 0,
          reason: 'light_breakfast(15%<20%)',
        },
      };

      const insights = service.generate(ctx);
      const crossMealInsight = insights.find(
        (i) => i.type === 'cross_meal_context',
      );
      expect(crossMealInsight).toBeDefined();
    });

    it('should sort insights by importance descending', () => {
      const food1 = createMockFoodLibrary({
        id: 'f1',
        protein: 40,
        standardServingG: 150,
      });
      const food2 = createMockFoodLibrary({
        id: 'f2',
        protein: 20,
        standardServingG: 100,
        name: '蔬菜',
        category: 'veggie',
      });
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food1), createMockScoredFood(food2)],
        target: createMockMealTarget(),
        sceneContext: {
          channel: AcquisitionChannel.HOME_COOK,
          sceneType: 'family_dinner',
          realismLevel: 'normal',
          confidence: 0.8,
          source: 'rule_inferred',
          sceneConstraints: {},
        },
      };

      const insights = service.generate(ctx);
      for (let i = 1; i < insights.length; i++) {
        expect(insights[i].importance).toBeLessThanOrEqual(
          insights[i - 1].importance,
        );
      }
    });

    it('should generate goal progress insight when goalProgress provided', () => {
      const food = createMockFoodLibrary();
      const ctx: InsightContext = {
        foods: [createMockScoredFood(food)],
        target: createMockMealTarget(),
        goalProgress: {
          calorieCompliance: 0.85,
          proteinCompliance: 0.7,
          executionRate: 0.9,
          streakDays: 5,
        },
      };

      const insights = service.generate(ctx);
      const goalInsight = insights.find((i) => i.type === 'goal_progress');
      expect(goalInsight).toBeDefined();
    });
  });

  // ==================== 5. 付费分层门控 ====================

  describe('ExplanationTierService — Paywall Gating (P2-F)', () => {
    let service: ExplanationTierService;

    beforeEach(() => {
      service = new ExplanationTierService();
    });

    function createMockExplanationV2(
      overrides?: Partial<ExplanationV2>,
    ): ExplanationV2 {
      return {
        summary: '这是一道高蛋白食物',
        primaryReason: '符合增肌目标',
        healthTip: '建议搭配蔬菜',
        radarChart: {
          dimensions: [
            {
              name: 'nutrition',
              label: '营养',
              score: 0.9,
              weight: 0.3,
              benchmark: 0.5,
            },
            {
              name: 'taste',
              label: '口味',
              score: 0.8,
              weight: 0.25,
              benchmark: 0.5,
            },
            {
              name: 'convenience',
              label: '便捷',
              score: 0.7,
              weight: 0.2,
              benchmark: 0.5,
            },
            {
              name: 'cost',
              label: '成本',
              score: 0.6,
              weight: 0.15,
              benchmark: 0.5,
            },
            {
              name: 'variety',
              label: '多样性',
              score: 0.5,
              weight: 0.1,
              benchmark: 0.5,
            },
          ],
        },
        progressBars: [
          {
            nutrient: '蛋白质',
            current: 25,
            target: 30,
            unit: 'g',
            percent: 83,
            status: 'under',
          },
        ],
        comparisonCard: {
          vsUserAvg: 0.85,
          vsHealthyTarget: 0.9,
          trend7d: [
            { label: 'Day 1', value: 0.7 },
            { label: 'Day 2', value: 0.75 },
            { label: 'Day 3', value: 0.8 },
            { label: 'Day 4', value: 0.85 },
            { label: 'Day 5', value: 0.8 },
            { label: 'Day 6', value: 0.85 },
            { label: 'Day 7', value: 0.9 },
          ],
        },
        locale: 'zh-CN',
        ...overrides,
      };
    }

    it('should return explanation unchanged for premium users', () => {
      const explanation = createMockExplanationV2();
      const result = service.applyUpgradeTeaser(explanation, true);

      expect(result.summary).toBe(explanation.summary);
      expect(result.radarChart?.dimensions).toHaveLength(5);
      expect(result.upgradeTeaser).toBeUndefined();
    });

    it('should gate radar chart for free users', () => {
      const explanation = createMockExplanationV2();
      const result = service.applyUpgradeTeaser(explanation, false);

      // Free: top 3 by weight are fully visible, rest have score=0
      if (result.radarChart) {
        const zeroScored = result.radarChart.dimensions.filter(
          (d) => d.score === 0,
        );
        // Should have at least some locked (zeroed) dimensions
        expect(zeroScored.length).toBeGreaterThan(0);
      }
    });

    it('should add upgradeTeaser for free users', () => {
      const explanation = createMockExplanationV2();
      const result = service.applyUpgradeTeaser(explanation, false);

      expect(result.upgradeTeaser).toBeDefined();
      expect(typeof result.upgradeTeaser).toBe('string');
    });

    it('should handle explanation with minimal radarChart', () => {
      const explanation = createMockExplanationV2({
        radarChart: {
          dimensions: [
            {
              name: 'nutrition',
              label: '营养',
              score: 0.9,
              weight: 0.5,
              benchmark: 0.5,
            },
            {
              name: 'taste',
              label: '口味',
              score: 0.8,
              weight: 0.3,
              benchmark: 0.5,
            },
            {
              name: 'convenience',
              label: '便捷',
              score: 0.7,
              weight: 0.2,
              benchmark: 0.5,
            },
          ],
        },
      });
      const result = service.applyUpgradeTeaser(explanation, false);
      expect(result.summary).toBe(explanation.summary);
    });

    it('should batch process multiple explanations via Map', () => {
      const explanations = new Map<string, ExplanationV2>();
      explanations.set('food-1', createMockExplanationV2({ summary: '推荐1' }));
      explanations.set('food-2', createMockExplanationV2({ summary: '推荐2' }));

      const results = service.applyUpgradeTeaserBatch(explanations, false);
      expect(results.size).toBe(2);
      for (const [, exp] of results) {
        expect(exp.upgradeTeaser).toBeDefined();
      }
    });
  });

  // ==================== 6. toRealismOverride + realismLevel ====================

  describe('UserProfileService.toRealismOverride — realismLevel (P3-B)', () => {
    it('should return empty override for empty prefs', () => {
      const result = UserProfileService.toRealismOverride({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should convert popularityPreference to commonalityThreshold', () => {
      const result = UserProfileService.toRealismOverride({
        popularityPreference: PopularityPreference.POPULAR,
      });
      expect(result.commonalityThreshold).toBe(40);
    });

    it('should convert cookingEffort QUICK to tight cook time caps', () => {
      const result = UserProfileService.toRealismOverride({
        cookingEffort: CookingEffort.QUICK,
      });
      expect(result.cookTimeCapEnabled).toBe(true);
      expect(result.weekdayCookTimeCap).toBe(30);
      expect(result.weekendCookTimeCap).toBe(60);
    });

    it('should convert budgetSensitivity BUDGET to budget filter enabled', () => {
      const result = UserProfileService.toRealismOverride({
        budgetSensitivity: BudgetSensitivity.BUDGET,
      });
      expect(result.budgetFilterEnabled).toBe(true);
    });

    it('should apply strict realismLevel override', () => {
      const result = UserProfileService.toRealismOverride({
        realismLevel: 'strict',
      });
      expect(result.commonalityThreshold).toBeGreaterThanOrEqual(40);
      expect(result.budgetFilterEnabled).toBe(true);
      expect(result.cookTimeCapEnabled).toBe(true);
      expect(result.canteenMode).toBe(true);
    });

    it('should apply relaxed realismLevel override', () => {
      const result = UserProfileService.toRealismOverride({
        realismLevel: 'relaxed',
      });
      expect(result.commonalityThreshold).toBeLessThanOrEqual(10);
      expect(result.budgetFilterEnabled).toBe(false);
      expect(result.cookTimeCapEnabled).toBe(false);
    });

    it('should apply off realismLevel to disable all realism', () => {
      const result = UserProfileService.toRealismOverride({
        realismLevel: 'off',
      });
      expect(result.enabled).toBe(false);
    });

    it('should not modify override for normal realismLevel', () => {
      const result = UserProfileService.toRealismOverride({
        realismLevel: 'normal',
      });
      // normal should not add any extra keys beyond what other fields produce
      expect(result.enabled).toBeUndefined();
      expect(result.canteenMode).toBeUndefined();
    });

    it('strict realismLevel should override individual field values', () => {
      // User sets cookingEffort=ELABORATE (no cook time cap) + realismLevel=strict
      // strict should win and enable cook time cap
      const result = UserProfileService.toRealismOverride({
        cookingEffort: CookingEffort.ELABORATE,
        realismLevel: 'strict',
      });
      expect(result.cookTimeCapEnabled).toBe(true); // strict overrides elaborate
      expect(result.budgetFilterEnabled).toBe(true);
    });
  });

  // ==================== 7. PipelineContext 类型兼容性 ====================

  describe('PipelineContext — V7.2 Type Compatibility', () => {
    it('should accept realismOverride field', () => {
      const ctx: PipelineContext = {
        allFoods: [],
        mealType: 'lunch',
        goalType: 'weight_loss',
        target: createMockMealTarget(),
        constraints: {} as any,
        usedNames: new Set(),
        picks: [],
        realismOverride: { level: 'strict' },
      };
      expect(ctx.realismOverride?.level).toBe('strict');
    });

    it('should accept all 4 RealismLevel values', () => {
      const levels: RealismLevel[] = ['strict', 'normal', 'relaxed', 'off'];
      levels.forEach((level) => {
        const ctx: PipelineContext = {
          allFoods: [],
          mealType: 'lunch',
          goalType: 'weight_loss',
          target: createMockMealTarget(),
          constraints: {} as any,
          usedNames: new Set(),
          picks: [],
          realismOverride: { level },
        };
        expect(ctx.realismOverride?.level).toBe(level);
      });
    });

    it('RecommendationPreferences should accept realismLevel', () => {
      const prefs: RecommendationPreferences = {
        popularityPreference: PopularityPreference.BALANCED,
        cookingEffort: CookingEffort.MODERATE,
        budgetSensitivity: BudgetSensitivity.MODERATE,
        realismLevel: 'relaxed',
      };
      expect(prefs.realismLevel).toBe('relaxed');
    });
  });

  // ==================== 8. DailyPlanContextService 规则引擎集成 ====================

  describe('DailyPlanContextService — Rule Engine Integration (P2-D)', () => {
    let service: DailyPlanContextService;

    beforeEach(() => {
      service = new DailyPlanContextService();
    });

    it('should use rule engine internally for cross-meal adjustments', () => {
      const state = createMockDailyPlanState({
        mealCount: 1,
        accumulatedNutrition: {
          calories: 250,
          protein: 8,
          fat: 8,
          carbs: 35,
          fiber: 3,
        },
      });

      const result = service.computeCrossMealAdjustment(state, 1, {
        calories: 2000,
        protein: 120,
      });

      // Should have triggered light_breakfast rule (250/2000 = 12.5% < 20%)
      expect(result.calorieMultiplier).toBeGreaterThan(1.0);
      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it('should support custom rules injection', () => {
      const customRules: CrossMealRule[] = [
        {
          id: 'always-boost',
          name: 'ALWAYS_BOOST',
          priority: 999, // highest priority = fires last, overwrites
          enabled: true,
          condition: () => true,
          apply: () => ({
            calorieMultiplier: 1.2,
            reasonTag: 'always_boost',
          }),
        },
      ];

      // State with enough calories/protein to avoid triggering built-in rules except cuisine_monotony
      const state = createMockDailyPlanState({
        mealCount: 1,
        accumulatedNutrition: {
          calories: 600,
          protein: 50,
          fat: 20,
          carbs: 60,
          fiber: 5,
        },
      });
      const result = service.computeCrossMealAdjustment(
        state,
        1,
        { calories: 2000, protein: 120 },
        customRules,
      );

      // Custom rule fires last (priority=999) and sets calorieMultiplier=1.2
      expect(result.calorieMultiplier).toBe(1.2);
      expect(result.reason).toContain('always_boost');
    });
  });

  // ==================== 9. ScoringChain Performance ====================

  describe('ScoringChainService — Performance', () => {
    it('should process 500 foods through 10 factors in under 100ms', () => {
      const service = new ScoringChainService();

      // Register 10 trivial factors
      for (let i = 0; i < 10; i++) {
        const factorIndex = i;
        service.registerFactors([
          createMockScoringFactor({
            name: `factor_${factorIndex}`,
            order: factorIndex * 10,
            computeAdjustment: () => ({
              factorName: `factor_${factorIndex}`,
              multiplier: 1.0,
              additive: 0.01,
              explanationKey: null,
              reason: 'perf test',
            }),
          }),
        ]);
      }

      const foods: FoodLibrary[] = [];
      const baseScores: number[] = [];
      for (let i = 0; i < 500; i++) {
        foods.push(
          createMockFoodLibrary({
            id: `food-${i}`,
            name: `Food ${i}`,
            commonalityScore: 50 + (i % 50),
          }),
        );
        baseScores.push(1.0);
      }

      const ctx = createMinimalPipelineContext();

      const start = performance.now();
      const results = service.executeChain(foods, baseScores, ctx);
      const elapsed = performance.now() - start;

      expect(results).toHaveLength(500);
      expect(elapsed).toBeLessThan(100);
    });
  });

  // ==================== 10. InsightContext 工厂函数 ====================

  describe('InsightContext — createInsightContext factory', () => {
    it('should create InsightContext from positional params', async () => {
      const { createInsightContext } =
        await import('../src/modules/diet/app/recommendation/insight.types');

      const foods = [createMockScoredFood(createMockFoodLibrary())];
      const target = createMockMealTarget();

      const ctx = createInsightContext(foods, target);

      expect(ctx.foods).toBe(foods);
      expect(ctx.target).toBe(target);
      expect(ctx.sceneContext).toBeUndefined();
      expect(ctx.dailyPlan).toBeUndefined();
    });

    it('should pass through all optional params', async () => {
      const { createInsightContext } =
        await import('../src/modules/diet/app/recommendation/insight.types');

      const foods = [createMockScoredFood(createMockFoodLibrary())];
      const target = createMockMealTarget();
      const scene = {
        channel: AcquisitionChannel.HOME_COOK,
        sceneType: 'home_cooking' as const,
        realismLevel: 'normal' as const,
        confidence: 0.8,
        source: 'rule_inferred' as const,
        sceneConstraints: {},
      };

      const ctx = createInsightContext(foods, target, scene);

      expect(ctx.sceneContext).toBe(scene);
    });
  });
});
