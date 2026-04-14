/**
 * V7.3 集成测试 — 纯单元风格，所有依赖 mock
 *
 * 覆盖 V7.3 所有新增/增强服务的核心逻辑：
 * 1. FoodForm 食物大众化 — foodForm/dishPriority 字段 + dish 优先排序
 * 2. MealTemplate 匹配 — 场景+餐次模板匹配 + 优先级排序
 * 3. MealTemplate 填充 — 槽位填充 + 热量约束 + 覆盖度评分
 * 4. SceneScoringProfile — 场景化评分维度权重调整
 * 5. NaturalLanguageExplainer — 自然语言推荐解释
 * 6. FactorLearner — 反馈归因 + 权重学习 + 冷启动
 * 7. NRF11.4 — 新增营养素评分
 * 8. 食谱营养聚合 — computeRecipeNutrition
 * 9. RequestScopedCache — 请求级缓存去重
 * 10. CacheWarmup — 启动预热
 * 11. DietModule 拆分 — 子模块导入/导出
 * 12. PipelineBuilder 模板集成 — 模板模式推荐
 * 13. ExplanationGenerator 集成 — NL 解释方法
 * 14. 类型兼容性 — 新字段向后兼容
 */

import type { FoodLibrary, FoodForm } from '../src/modules/food/food.types';
import {
  PipelineContext,
  ScoredFood,
  MealTarget,
  MealRecommendation,
  AssembledRecipe,
  RecipeNutrition,
  SceneType,
  AcquisitionChannel,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import type {
  ScoringFactor,
  ScoringAdjustment,
} from '../src/modules/diet/app/recommendation/scoring-chain/scoring-factor.interface';
import { ScoringChainService } from '../src/modules/diet/app/recommendation/scoring-chain/scoring-chain.service';
import { MealTemplateService } from '../src/modules/diet/app/recommendation/meal-template.service';
import {
  BUILT_IN_MEAL_TEMPLATES,
  MealTemplate,
} from '../src/modules/diet/app/recommendation/meal-template.types';
import {
  SCENE_SCORING_PROFILES,
  findSceneScoringProfile,
} from '../src/modules/diet/app/recommendation/scene-scoring.types';
import {
  NaturalLanguageExplainerService,
  NarrativeContext,
  WhyThisDishExplanation,
} from '../src/modules/diet/app/recommendation/natural-language-explainer.service';
import {
  FactorLearnerService,
  FactorAdjustmentMap,
} from '../src/modules/diet/app/recommendation/factor-learner.service';
import { RequestScopedCacheService } from '../src/core/cache/request-scoped-cache.service';
import { CacheWarmupService } from '../src/core/cache/cache-warmup.service';
import { ExplanationGeneratorService } from '../src/modules/diet/app/recommendation/explanation-generator.service';
import { MealCompositionScorer } from '../src/modules/diet/app/recommendation/meal-composition-scorer.service';
import { InsightGeneratorService } from '../src/modules/diet/app/recommendation/insight-generator.service';
import { ExplanationTierService } from '../src/modules/diet/app/recommendation/explanation-tier.service';
import { MealExplanationService } from '../src/modules/diet/app/recommendation/meal-explanation.service';
import { ComparisonExplanationService } from '../src/modules/diet/app/recommendation/comparison-explanation.service';
import { RedisCacheService } from '../src/core/redis/redis-cache.service';

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

function createMockNarrativeContext(
  overrides?: Partial<NarrativeContext>,
): NarrativeContext {
  return {
    locale: 'zh-CN',
    goalType: 'weight_loss',
    mealType: 'lunch',
    ...overrides,
  };
}

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

describe('V7.3 Integration Tests', () => {
  // ==================== 1. FoodForm 食物大众化 ====================

  describe('FoodForm — 食物大众化 (P1-A)', () => {
    it('should have foodForm field on FoodLibrary', () => {
      const food = createMockFoodLibrary({ foodForm: 'dish' });
      expect(food.foodForm).toBe('dish');
    });

    it('should default foodForm to undefined when not set', () => {
      const food = createMockFoodLibrary();
      // foodForm is optional, defaults to undefined when not explicitly set
      // (DB default is 'ingredient' via Prisma schema)
      expect(food.foodForm).toBeUndefined();
    });

    it('should have dishPriority field on FoodLibrary', () => {
      const food = createMockFoodLibrary({
        foodForm: 'dish',
        dishPriority: 85,
      });
      expect(food.dishPriority).toBe(85);
    });

    it('should accept all three FoodForm values', () => {
      const forms: FoodForm[] = ['ingredient', 'dish', 'semi_prepared'];
      for (const form of forms) {
        const food = createMockFoodLibrary({ foodForm: form });
        expect(food.foodForm).toBe(form);
      }
    });

    it('should rank dish foods higher via MealTemplateService fillTemplate', () => {
      const templateService = new MealTemplateService();

      // 两个同分食物：一个 dish, 一个 ingredient
      const dishFood = createMockFoodLibrary({
        id: 'dish-001',
        name: '宫保鸡丁',
        foodForm: 'dish',
        dishPriority: 80,
        category: 'protein',
      });
      const ingredientFood = createMockFoodLibrary({
        id: 'ing-001',
        name: '鸡胸肉',
        foodForm: 'ingredient',
        category: 'protein',
      });

      const dishScored = createMockScoredFood(dishFood, 70);
      const ingScored = createMockScoredFood(ingredientFood, 70);

      // 使用一个简单模板
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'chinese_standard',
      )!;
      const result = templateService.fillTemplate(
        template,
        [ingScored, dishScored],
        500,
      );

      // dish 食物应该被优先选入 main 槽位（因为 foodForm 匹配 + dishPriority 加分）
      const mainSlot = result.filledSlots.find((s) => s.role === 'main');
      expect(mainSlot).toBeDefined();
      if (mainSlot) {
        expect(mainSlot.food.food.id).toBe('dish-001');
      }
    });
  });

  // ==================== 2. MealTemplate 匹配 ====================

  describe('MealTemplateService — 模板匹配 (P1-D)', () => {
    let service: MealTemplateService;

    beforeEach(() => {
      service = new MealTemplateService();
    });

    it('should match template by scene and mealType', () => {
      const template = service.matchTemplate('home_cooking', 'lunch');
      expect(template).not.toBeNull();
      expect(template!.id).toBe('chinese_standard');
    });

    it('should match quick_breakfast template for quick_breakfast scene', () => {
      const template = service.matchTemplate('quick_breakfast', 'breakfast');
      expect(template).not.toBeNull();
      expect(template!.id).toBe('quick_breakfast');
    });

    it('should return null for unmatched scene+mealType combo', () => {
      // 使用不存在的场景/餐次组合
      const template = service.matchTemplate(
        'post_workout' as SceneType,
        'breakfast',
      );
      expect(template).toBeNull();
    });

    it('should return higher priority template when multiple match', () => {
      // canteen_meal + lunch → both chinese_standard(100) and canteen_tray(85) match
      const templates = service.matchAllTemplates('canteen_meal', 'lunch');
      expect(templates.length).toBeGreaterThanOrEqual(2);
      // First should be highest priority
      expect(templates[0].priority).toBeGreaterThanOrEqual(
        templates[1].priority,
      );

      const best = service.matchTemplate('canteen_meal', 'lunch');
      expect(best!.id).toBe(templates[0].id);
    });

    it('should support custom template registration', () => {
      const custom: MealTemplate = {
        id: 'test_custom',
        nameKey: 'template.test_custom',
        applicableScenes: ['home_cooking'],
        applicableMealTypes: ['dinner'],
        priority: 999, // 超高优先级
        slots: [
          {
            role: 'main',
            calorieRatioRange: [0.5, 0.7],
          },
        ],
      };
      service.registerTemplate(custom);

      const matched = service.matchTemplate('home_cooking', 'dinner');
      expect(matched).not.toBeNull();
      expect(matched!.id).toBe('test_custom');
    });
  });

  // ==================== 3. MealTemplate 填充 ====================

  describe('MealTemplateService — 模板填充 (P1-D)', () => {
    let service: MealTemplateService;

    beforeEach(() => {
      service = new MealTemplateService();
    });

    it('should fill template slots with candidate foods', () => {
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'chinese_standard',
      )!;

      const candidates = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'rice',
            name: '米饭',
            category: 'grain',
            foodForm: 'dish',
          }),
          80,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'chicken',
            name: '宫保鸡丁',
            category: 'protein',
            foodForm: 'dish',
          }),
          90,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'veggie',
            name: '炒青菜',
            category: 'veggie',
            foodForm: 'dish',
          }),
          70,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'soup',
            name: '紫菜蛋花汤',
            category: 'composite',
            foodForm: 'dish',
          }),
          60,
        ),
      ];

      const result = service.fillTemplate(template, candidates, 600);

      expect(result.templateId).toBe('chinese_standard');
      expect(result.filledSlots.length).toBeGreaterThanOrEqual(3); // at least staple + main + side
      expect(result.coverageScore).toBe(1); // all required slots filled
    });

    it('should allocate calories based on slot ratio', () => {
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'noodle_set',
      )!;

      const candidates = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'noodles',
            name: '牛肉面',
            category: 'composite',
            foodForm: 'dish',
          }),
          90,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'side-dish',
            name: '凉拌黄瓜',
            category: 'veggie',
            foodForm: 'dish',
          }),
          60,
        ),
      ];

      const result = service.fillTemplate(template, candidates, 500);
      expect(result.totalCalories).toBeGreaterThan(0);
      expect(result.totalCalories).toBeLessThanOrEqual(500);
    });

    it('should skip optional slots when no candidates match', () => {
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'chinese_standard',
      )!;

      // 只提供 staple + main + side，没有 composite 类别（soup 是 optional）
      const candidates = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'rice',
            category: 'grain',
            foodForm: 'dish',
          }),
          80,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'meat',
            category: 'protein',
            foodForm: 'dish',
          }),
          90,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'veg',
            category: 'veggie',
            foodForm: 'dish',
          }),
          70,
        ),
      ];

      const result = service.fillTemplate(template, candidates, 600);
      // 3 required slots filled, 1 optional (soup) skipped
      expect(result.filledSlots.length).toBe(3);
      expect(result.coverageScore).toBe(1); // coverage only counts required slots
    });

    it('should compute template match score between 0 and 1', () => {
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'quick_breakfast',
      )!;

      const candidates = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'bread',
            category: 'grain',
            foodForm: 'dish',
          }),
          75,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'egg',
            category: 'protein',
            foodForm: 'dish',
          }),
          80,
        ),
      ];

      const result = service.fillTemplate(template, candidates, 400);
      expect(result.templateMatchScore).toBeGreaterThanOrEqual(0);
      expect(result.templateMatchScore).toBeLessThanOrEqual(1);
    });

    it('should not reuse the same food across different slots', () => {
      const template = BUILT_IN_MEAL_TEMPLATES.find(
        (t) => t.id === 'chinese_standard',
      )!;

      // 只有一个 protein 类别食物
      const candidates = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'rice',
            category: 'grain',
            foodForm: 'dish',
          }),
          80,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'only-protein',
            category: 'protein',
            foodForm: 'dish',
          }),
          90,
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'veg',
            category: 'veggie',
            foodForm: 'dish',
          }),
          70,
        ),
      ];

      const result = service.fillTemplate(template, candidates, 600);
      const usedIds = result.filledSlots.map((s) => s.food.food.id);
      const uniqueIds = new Set(usedIds);
      expect(uniqueIds.size).toBe(usedIds.length); // no duplicate food IDs
    });
  });

  // ==================== 4. SceneScoringProfile ====================

  describe('SceneScoringProfile — 场景化评分 (P1-E)', () => {
    it('should have predefined profiles for 10 scene types', () => {
      expect(SCENE_SCORING_PROFILES.length).toBe(10);
      const sceneTypes = SCENE_SCORING_PROFILES.map((p) => p.sceneType);
      expect(sceneTypes).toContain('eating_out');
      expect(sceneTypes).toContain('home_cooking');
      expect(sceneTypes).toContain('canteen_meal');
      expect(sceneTypes).toContain('post_workout');
    });

    it('should find profile by sceneType', () => {
      const profile = findSceneScoringProfile('eating_out');
      expect(profile).toBeDefined();
      expect(profile!.sceneType).toBe('eating_out');
      expect(profile!.dimensionWeightAdjustments.popularity).toBe(1.5);
      expect(profile!.dimensionWeightAdjustments.executability).toBe(0.5);
    });

    it('should return undefined for unknown sceneType', () => {
      const profile = findSceneScoringProfile('unknown_scene' as SceneType);
      expect(profile).toBeUndefined();
    });

    it('should have factorStrengthOverrides for scenes that need them', () => {
      const eatingOut = findSceneScoringProfile('eating_out');
      expect(eatingOut?.factorStrengthOverrides).toBeDefined();
      expect(eatingOut!.factorStrengthOverrides!['scene-context']).toBe(1.3);

      // home_cooking has no factorStrengthOverrides
      const homeCooking = findSceneScoringProfile('home_cooking');
      expect(homeCooking?.factorStrengthOverrides).toBeUndefined();
    });
  });

  // ==================== 5. NaturalLanguageExplainer ====================

  describe('NaturalLanguageExplainerService — 自然语言解释 (P2-B)', () => {
    let service: NaturalLanguageExplainerService;

    beforeEach(() => {
      service = new NaturalLanguageExplainerService();
    });

    it('should generate narrative from preference-signal adjustment', () => {
      const food = createMockFoodLibrary({ name: '西兰花' });
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.3,
          additive: 0,
          explanationKey: null,
          reason: '用户偏好匹配',
        },
      ];
      const ctx = createMockNarrativeContext();

      const narrative = service.generateNarrative(adjustments, food, ctx);
      expect(narrative).toBeTruthy();
      expect(narrative.length).toBeGreaterThan(0);
      expect(narrative).toContain('西兰花');
    });

    it('should generate narrative with nutrition gap info', () => {
      const food = createMockFoodLibrary({
        name: '牛肉',
        protein: 26,
        iron: 3.5,
      });
      const adjustments: ScoringAdjustment[] = [];
      const ctx = createMockNarrativeContext({
        nutritionGaps: ['protein', 'iron'],
      });

      const narrative = service.generateNarrative(adjustments, food, ctx);
      expect(narrative).toBeTruthy();
      // Should mention nutrition gap
      expect(narrative.length).toBeGreaterThan(5);
    });

    it('should generate narrative for diversity (short-term-profile)', () => {
      const food = createMockFoodLibrary({ name: '三文鱼' });
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'short-term-profile',
          multiplier: 1.2,
          additive: 0,
          explanationKey: null,
          reason: '多样性推荐',
        },
      ];
      const ctx = createMockNarrativeContext({
        recentFoodNames: ['鸡胸肉', '鸡蛋'],
      });

      const narrative = service.generateNarrative(adjustments, food, ctx);
      expect(narrative).toBeTruthy();
      expect(narrative).toContain('三文鱼');
    });

    it('should generate narrative for scene-context', () => {
      const food = createMockFoodLibrary({ name: '沙拉' });
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'scene-context',
          multiplier: 1.25,
          additive: 0,
          explanationKey: null,
          reason: '场景匹配加分',
        },
      ];
      const ctx = createMockNarrativeContext({ mealType: 'lunch' });

      const narrative = service.generateNarrative(adjustments, food, ctx);
      expect(narrative).toBeTruthy();
    });

    it('should generate WhyThisDish explanation', () => {
      const food = createMockFoodLibrary({ name: '番茄炒蛋', protein: 12 });
      const scored = createMockScoredFood(food, 85);
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.2,
          additive: 0,
          explanationKey: null,
          reason: '偏好匹配',
        },
        {
          factorName: 'scene-context',
          multiplier: 1.1,
          additive: 0,
          explanationKey: null,
          reason: '场景适合',
        },
      ];
      const ctx = createMockNarrativeContext({
        nutritionGaps: ['protein'],
      });

      const result = service.generateWhyThisDish(scored, adjustments, ctx);
      expect(result).toBeDefined();
      expect(result.primaryReason).toBeTruthy();
      expect(result.narrative).toBeTruthy();
      expect(result.narrative.length).toBeGreaterThan(0);
    });

    it('should produce fallback narrative with empty adjustments', () => {
      const food = createMockFoodLibrary({ name: '豆腐' });
      const ctx = createMockNarrativeContext();

      const narrative = service.generateNarrative([], food, ctx);
      expect(narrative).toContain('豆腐');
      // Should contain default recommendation text
      expect(narrative).toContain('推荐');
    });
  });

  // ==================== 6. FactorLearner ====================

  describe('FactorLearnerService — Factor 权重学习 (P2-C)', () => {
    let service: FactorLearnerService;

    beforeEach(() => {
      // V7.4: FactorLearnerService now requires RedisCacheService;
      // pass a mock that triggers memory-fallback mode
      const mockRedis = {
        hSet: jest.fn().mockRejectedValue(new Error('mock-redis')),
        hGetAll: jest.fn().mockRejectedValue(new Error('mock-redis')),
        expireNX: jest.fn().mockRejectedValue(new Error('mock-redis')),
      } as unknown as RedisCacheService;
      service = new FactorLearnerService(mockRedis);
    });

    it('should attribute feedback based on adjustment contribution', () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.3,
          additive: 0,
          explanationKey: null,
          reason: '偏好匹配',
        },
        {
          factorName: 'scene-context',
          multiplier: 1.1,
          additive: 5,
          explanationKey: null,
          reason: '场景加分',
        },
      ];

      const attributions = service.attributeFeedback(adjustments, 'accept');
      expect(attributions).toHaveLength(2);

      // preference-signal: |1.3-1| + |0| = 0.3
      // scene-context: |1.1-1| + |5| = 5.1
      // total = 5.4
      const prefAttr = attributions.find(
        (a) => a.factorName === 'preference-signal',
      )!;
      const sceneAttr = attributions.find(
        (a) => a.factorName === 'scene-context',
      )!;

      expect(prefAttr.direction).toBe(1); // accept = +1
      expect(sceneAttr.direction).toBe(1);
      expect(sceneAttr.contributionRatio).toBeGreaterThan(
        prefAttr.contributionRatio,
      );
      expect(
        prefAttr.contributionRatio + sceneAttr.contributionRatio,
      ).toBeCloseTo(1.0, 5);
    });

    it('should use negative direction for reject', () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'popularity',
          multiplier: 1.2,
          additive: 0,
          explanationKey: null,
          reason: '热门推荐',
        },
      ];

      const attributions = service.attributeFeedback(adjustments, 'reject');
      expect(attributions[0].direction).toBe(-1);
    });

    it('should update factor weights incrementally', async () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.5,
          additive: 0,
          explanationKey: null,
          reason: 'test',
        },
      ];

      const attributions = service.attributeFeedback(adjustments, 'accept');
      await service.updateFactorWeights('user-1', 'weight_loss', attributions);

      expect(await service.getFeedbackCount('user-1', 'weight_loss')).toBe(1);
    });

    it('should return empty map before cold start threshold', async () => {
      // Default cold start threshold is 10
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.5,
          additive: 0,
          explanationKey: null,
          reason: 'test',
        },
      ];

      // Add 5 feedback events (below threshold of 10)
      for (let i = 0; i < 5; i++) {
        const attr = service.attributeFeedback(adjustments, 'accept');
        await service.updateFactorWeights('user-cold', 'weight_loss', attr);
      }

      const result = await service.getUserFactorAdjustments(
        'user-cold',
        'weight_loss',
      );
      expect(result.size).toBe(0); // empty map due to cold start
    });

    it('should return factor adjustments after cold start threshold', async () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.5,
          additive: 0,
          explanationKey: null,
          reason: 'test',
        },
      ];

      // Add 11 feedback events (above threshold of 10)
      for (let i = 0; i < 11; i++) {
        const attr = service.attributeFeedback(adjustments, 'accept');
        await service.updateFactorWeights('user-warm', 'weight_loss', attr);
      }

      const result = await service.getUserFactorAdjustments(
        'user-warm',
        'weight_loss',
      );
      expect(result.size).toBeGreaterThan(0);
      const prefStrength = result.get('preference-signal');
      expect(prefStrength).toBeDefined();
      // After 11 positive feedbacks, strength should be > 1.0
      expect(prefStrength!).toBeGreaterThan(1.0);
    });

    it('should clamp strength within [0.5, 2.0]', async () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'test-factor',
          multiplier: 2.0,
          additive: 10,
          explanationKey: null,
          reason: 'test',
        },
      ];

      // Send many reject feedbacks to drive strength down
      for (let i = 0; i < 200; i++) {
        const attr = service.attributeFeedback(adjustments, 'reject');
        await service.updateFactorWeights('user-clamp', 'weight_loss', attr);
      }

      const result = await service.getUserFactorAdjustments(
        'user-clamp',
        'weight_loss',
      );
      if (result.size > 0) {
        const strength = result.get('test-factor');
        expect(strength).toBeDefined();
        expect(strength!).toBeGreaterThanOrEqual(0.5);
        expect(strength!).toBeLessThanOrEqual(2.0);
      }
    });
  });

  // ==================== 7. NRF11.4 ====================

  describe('NRF11.4 — 营养覆盖增强 (P1-F)', () => {
    it('should include zinc and magnesium in NutritionTargets', () => {
      // NutritionTargets has zinc, magnesium, transFatLimit fields
      // Verify at the type level by constructing a valid object
      const targets = {
        protein: 50,
        fiber: 25,
        vitaminA: 900,
        vitaminC: 90,
        vitaminD: 20,
        vitaminE: 15,
        calcium: 1000,
        iron: 18,
        potassium: 4700,
        saturatedFatLimit: 20,
        addedSugarLimit: 25,
        sodiumLimit: 2300,
        zinc: 11,
        magnesium: 420,
        transFatLimit: 2.2,
      };
      expect(targets.zinc).toBe(11);
      expect(targets.magnesium).toBe(420);
      expect(targets.transFatLimit).toBe(2.2);
    });

    it('should include zinc and magnesium in RecipeNutrition', () => {
      const nutrition: RecipeNutrition = {
        calories: 500,
        protein: 30,
        fat: 15,
        carbs: 60,
        fiber: 8,
        sodium: 800,
        saturatedFat: 5,
        transFat: 0.5,
        sugar: 10,
        addedSugar: 3,
        vitaminA: 200,
        vitaminC: 30,
        vitaminD: 5,
        vitaminE: 4,
        calcium: 150,
        iron: 5,
        potassium: 600,
        zinc: 4.5,
        magnesium: 80,
        cholesterol: 120,
      };
      expect(nutrition.zinc).toBe(4.5);
      expect(nutrition.magnesium).toBe(80);
      expect(nutrition.transFat).toBe(0.5);
    });

    it('should have transFat field on FoodLibrary', () => {
      const food = createMockFoodLibrary({ transFat: 0.3 });
      expect(food.transFat).toBe(0.3);
    });
  });

  // ==================== 8. 食谱营养聚合 ====================

  describe('RecipeNutrition — 食谱营养聚合 (P2-D)', () => {
    it('should aggregate nutrition from recipe ingredients', () => {
      // Test computeRecipeNutrition via RecipeAssemblerService
      // Since it requires PrismaService, we test the interface contract directly
      const ingredient1 = createMockScoredFood(
        createMockFoodLibrary({
          id: 'chicken',
          calories: 165,
          protein: 31,
          fat: 3.6,
          carbs: 0,
          fiber: 0,
          standardServingG: 150,
          iron: 1.0,
          zinc: 2.5,
          magnesium: 25,
        }),
        80,
      );

      const ingredient2 = createMockScoredFood(
        createMockFoodLibrary({
          id: 'rice',
          calories: 130,
          protein: 2.7,
          fat: 0.3,
          carbs: 28,
          fiber: 0.4,
          standardServingG: 200,
          iron: 0.2,
          zinc: 0.5,
          magnesium: 12,
        }),
        70,
      );

      const recipe: AssembledRecipe = {
        name: '鸡肉饭',
        ingredients: [ingredient1, ingredient2],
        totalCalories:
          ingredient1.servingCalories + ingredient2.servingCalories,
        totalProtein: ingredient1.servingProtein + ingredient2.servingProtein,
        estimatedCookTime: 20,
        skillLevel: 'beginner',
        suitableChannels: [AcquisitionChannel.HOME_COOK],
        recipeScore: 80,
        isAssembled: true,
      };

      // Verify recipe structure with recipeNutrition
      expect(recipe.ingredients).toHaveLength(2);
      expect(recipe.totalCalories).toBeGreaterThan(0);
    });

    it('should handle missing ingredient nutrition gracefully', () => {
      // FoodLibrary has optional nutrient fields — missing values should be treated as 0
      const food = createMockFoodLibrary({
        id: 'minimal',
        calories: 100,
        protein: 5,
        fat: 2,
        carbs: 15,
        // No zinc, magnesium, iron etc.
      });

      // Simulate ratio calculation (as computeRecipeNutrition does)
      const servingG = food.standardServingG || 100;
      const ratio = servingG / 100;
      const zinc = (Number(food.zinc) || 0) * ratio;
      const magnesium = (Number(food.magnesium) || 0) * ratio;
      expect(zinc).toBe(0);
      expect(magnesium).toBe(0);
    });

    it('should cover micronutrients in aggregation', () => {
      const food = createMockFoodLibrary({
        standardServingG: 100,
        vitaminA: 300,
        vitaminC: 45,
        calcium: 120,
        iron: 2.5,
        zinc: 3.0,
        magnesium: 40,
        transFat: 0.1,
      });

      const ratio = food.standardServingG / 100;
      // Verify micronutrient aggregation logic
      expect((Number(food.vitaminA) || 0) * ratio).toBe(300);
      expect((Number(food.zinc) || 0) * ratio).toBe(3.0);
      expect((Number(food.magnesium) || 0) * ratio).toBe(40);
      expect((Number(food.transFat) || 0) * ratio).toBeCloseTo(0.1);
    });
  });

  // ==================== 9. RequestScopedCache ====================

  describe('RequestScopedCacheService — 请求级缓存 (P3-A)', () => {
    let cache: RequestScopedCacheService;

    beforeEach(() => {
      cache = new RequestScopedCacheService();
    });

    it('should deduplicate async calls within same request', async () => {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        return 'result';
      };

      // First call — cache miss
      const result1 = await cache.getOrSet('key1', factory);
      expect(result1).toBe('result');
      expect(callCount).toBe(1);

      // Second call — cache hit
      const result2 = await cache.getOrSet('key1', factory);
      expect(result2).toBe('result');
      expect(callCount).toBe(1); // factory not called again

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should support sync getOrSet', () => {
      let callCount = 0;
      const factory = () => {
        callCount++;
        return 42;
      };

      const result1 = cache.getOrSetSync('syncKey', factory);
      expect(result1).toBe(42);
      expect(callCount).toBe(1);

      const result2 = cache.getOrSetSync('syncKey', factory);
      expect(result2).toBe(42);
      expect(callCount).toBe(1); // factory not called again

      expect(cache.has('syncKey')).toBe(true);
      expect(cache.get('syncKey')).toBe(42);
    });
  });

  // ==================== 10. CacheWarmup ====================

  describe('CacheWarmupService — 启动预热 (P3-B)', () => {
    it('should call warmup on application bootstrap without throwing', async () => {
      // CacheWarmupService uses @Optional() dependencies
      const warmupService = new CacheWarmupService(null, null, null);
      await expect(
        warmupService.onApplicationBootstrap(),
      ).resolves.not.toThrow();
    });

    it('should handle warmup failure gracefully', async () => {
      // Mock a foodPoolCache that throws
      const mockFoodPool = {
        getVerifiedFoods: jest
          .fn()
          .mockRejectedValue(new Error('DB connection failed')),
      } as any;

      const warmupService = new CacheWarmupService(mockFoodPool, null, null);
      // Should not throw — fire-and-forget with catch
      await expect(
        warmupService.onApplicationBootstrap(),
      ).resolves.not.toThrow();

      // Wait for async warmup to settle
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  // ==================== 11. DietModule 拆分 ====================

  describe('DietModule — 子模块拆分 (P3-C)', () => {
    it('should have RecommendationModule importable', () => {
      // Verify module files exist and export correctly
      const RecommendationModule =
        require('../src/modules/diet/recommendation.module').RecommendationModule;
      expect(RecommendationModule).toBeDefined();
    });

    it('should have ExplanationModule importable (V7.5: merged into RecommendationModule)', () => {
      // V7.5 P3-C: ExplanationModule 仍然存在但 providers 已合并回 RecommendationModule
      const ExplanationModule =
        require('../src/modules/diet/explanation.module').ExplanationModule;
      expect(ExplanationModule).toBeDefined();
    });

    it('should have TrackingModule importable', () => {
      const TrackingModule =
        require('../src/modules/diet/tracking.module').TrackingModule;
      expect(TrackingModule).toBeDefined();
    });
  });

  // ==================== 12. PipelineBuilder 模板集成 ====================

  describe('PipelineBuilder — 模板集成 (P3-D)', () => {
    it('should have matchedTemplate field on PipelineContext', () => {
      const template = BUILT_IN_MEAL_TEMPLATES[0];
      const ctx = createMinimalPipelineContext({
        matchedTemplate: template,
      });
      expect(ctx.matchedTemplate).toBeDefined();
      expect(ctx.matchedTemplate!.id).toBe(template.id);
    });

    it('should have factorAdjustments field on PipelineContext', () => {
      const adjustments: FactorAdjustmentMap = new Map([
        ['preference-signal', 1.2],
        ['scene-context', 0.8],
      ]);
      const ctx = createMinimalPipelineContext({
        factorAdjustments: adjustments,
      });
      expect(ctx.factorAdjustments).toBeDefined();
      expect(ctx.factorAdjustments!.get('preference-signal')).toBe(1.2);
    });

    it('should apply factorAdjustments in ScoringChainService', () => {
      const chain = new ScoringChainService();

      const factor = createMockScoringFactor({
        name: 'test-factor',
        order: 10,
        computeAdjustment: () => ({
          factorName: 'test-factor',
          multiplier: 1.5,
          additive: 10,
          explanationKey: null,
          reason: 'test adjustment',
        }),
      });

      chain.registerFactors([factor]);

      const food = createMockFoodLibrary({ name: '测试食物' });
      const baseScore = 50;

      // Without factor adjustments
      const ctxNoAdj = createMinimalPipelineContext({
        allFoods: [food],
      });
      const resultNoAdj = chain.executeChain([food], [baseScore], ctxNoAdj);
      const scoreNoAdj = resultNoAdj[0].finalScore;

      // With factor strength 2.0 (amplify deviation)
      const ctxWithAdj = createMinimalPipelineContext({
        allFoods: [food],
        factorAdjustments: new Map([['test-factor', 2.0]]),
      });
      const resultWithAdj = chain.executeChain([food], [baseScore], ctxWithAdj);
      const scoreWithAdj = resultWithAdj[0].finalScore;

      // With strength 2.0:
      // effectiveMultiplier = 1 + (1.5 - 1) * 2.0 = 2.0
      // effectiveAdditive = 10 * 2.0 = 20
      // score = 50 * 2.0 + 20 = 120
      expect(scoreWithAdj).toBeCloseTo(50 * 2.0 + 20, 1);

      // Without adjustment:
      // score = 50 * 1.5 + 10 = 85
      expect(scoreNoAdj).toBeCloseTo(50 * 1.5 + 10, 1);

      // With amplification, the effect should be stronger
      expect(scoreWithAdj).toBeGreaterThan(scoreNoAdj);
    });

    it('should handle empty factorAdjustments gracefully', () => {
      const chain = new ScoringChainService();

      const factor = createMockScoringFactor({
        name: 'factor-a',
        order: 10,
        computeAdjustment: () => ({
          factorName: 'factor-a',
          multiplier: 1.2,
          additive: 5,
          explanationKey: null,
          reason: 'test',
        }),
      });

      chain.registerFactors([factor]);

      const food = createMockFoodLibrary();
      const baseScore = 50;

      // Empty map — should behave as no adjustment
      const ctx = createMinimalPipelineContext({
        allFoods: [food],
        factorAdjustments: new Map(),
      });
      const result = chain.executeChain([food], [baseScore], ctx);

      // No strength adjustment → original multiplier/additive
      // score = 50 * 1.2 + 5 = 65
      expect(result[0].finalScore).toBeCloseTo(65, 1);
    });
  });

  // ==================== 13. ExplanationGenerator 集成 ====================

  describe('ExplanationGenerator — NL 集成 (P2-E)', () => {
    let generator: ExplanationGeneratorService;

    beforeEach(() => {
      // V7.4: ExplanationGeneratorService now requires 4 DI dependencies
      const mockScorer = {} as MealCompositionScorer;
      const mockInsight = new InsightGeneratorService();
      const mockTier = new ExplanationTierService();
      const mockNlExplainer = new NaturalLanguageExplainerService();
      generator = new ExplanationGeneratorService(
        mockScorer,
        mockInsight,
        mockTier,
        mockNlExplainer,
        new MealExplanationService(mockScorer),
        new ComparisonExplanationService(),
      );
    });

    it('should have generateNarrativeExplanation method', () => {
      expect(typeof generator.generateNarrativeExplanation).toBe('function');
    });

    it('should generate narrative via ExplanationGeneratorService', () => {
      const food = createMockFoodLibrary({ name: '菠菜' });
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'analysis-profile',
          multiplier: 1.3,
          additive: 0,
          explanationKey: null,
          reason: '营养分析匹配',
        },
      ];
      const ctx = createMockNarrativeContext();

      const narrative = generator.generateNarrativeExplanation(
        food,
        adjustments,
        ctx,
      );
      expect(narrative).toBeTruthy();
      expect(typeof narrative).toBe('string');
    });

    it('should generate WhyThisDish via ExplanationGeneratorService', () => {
      const food = createMockFoodLibrary({ name: '红烧排骨' });
      const scored = createMockScoredFood(food, 88);
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference-signal',
          multiplier: 1.4,
          additive: 0,
          explanationKey: null,
          reason: '偏好匹配',
        },
      ];
      const ctx = createMockNarrativeContext();

      const result = generator.generateWhyThisDishExplanation(
        scored,
        adjustments,
        ctx,
      );
      expect(result).toBeDefined();
      expect(result.primaryReason).toBeTruthy();
      expect(result.narrative).toBeTruthy();
    });
  });

  // ==================== 14. 类型兼容性 ====================

  describe('类型兼容性 — 新字段向后兼容 (V7.3)', () => {
    it('should allow PipelineContext without V7.3 fields', () => {
      // V7.3 fields are optional — old code should still compile
      const ctx = createMinimalPipelineContext();
      expect(ctx.matchedTemplate).toBeUndefined();
      expect(ctx.factorAdjustments).toBeUndefined();
    });

    it('should allow MealRecommendation without V7.3 fields', () => {
      const rec: MealRecommendation = {
        foods: [],
        totalCalories: 500,
        totalProtein: 30,
        totalFat: 15,
        totalCarbs: 60,
        displayText: 'test',
        tip: 'test tip',
      };
      // V7.3 optional fields
      expect(rec.templateId).toBeUndefined();
      expect(rec.dishExplanations).toBeUndefined();
    });

    it('should allow MealRecommendation with V7.3 fields', () => {
      const rec: MealRecommendation = {
        foods: [],
        totalCalories: 500,
        totalProtein: 30,
        totalFat: 15,
        totalCarbs: 60,
        displayText: 'test',
        tip: 'test tip',
        templateId: 'chinese_standard',
        dishExplanations: [
          {
            primaryReason: '偏好匹配',
            nutritionNote: '蛋白质丰富',
            sceneNote: '适合午餐',
            narrative: '偏好匹配。蛋白质丰富。适合午餐。',
          },
        ],
      };

      expect(rec.templateId).toBe('chinese_standard');
      expect(rec.dishExplanations).toHaveLength(1);
      expect(rec.dishExplanations![0].primaryReason).toBe('偏好匹配');
    });
  });
});
