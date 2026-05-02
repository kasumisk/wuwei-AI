/**
 * V6.9 Phase 3-F: 端到端集成测试 + 性能验证
 *
 * 覆盖 V6.9 所有新增/增强服务的核心逻辑：
 * 1. SceneResolver — 场景解析 4 层优先级
 * 2. RecipeAssembler — 智能组装（含 Phase 3-D 增强）
 * 3. AvailabilityScorer — 渠道可获得性（含 Phase 3-E 区域/季节增强）
 * 4. DailyPlanContextService — 跨餐多样性
 * 5. ChannelMigrationService — 食物数据渠道标注迁移
 * 6. SegmentDiscoveryService — 用户聚类（K-Means 核心）
 * 7. 性能验证 — 关键路径耗时断言
 */

import { SceneResolverService } from '../src/modules/diet/app/recommendation/scene-resolver.service';
import { RecipeAssemblerService } from '../src/modules/diet/app/recommendation/recipe-assembler.service';
import { AvailabilityScorerService } from '../src/modules/diet/app/recommendation/availability-scorer.service';
import { DailyPlanContextService } from '../src/modules/diet/app/recommendation/daily-plan-context.service';
import { ChannelMigrationService } from '../src/modules/food/app/channel-migration.service';
import { SegmentDiscoveryService } from '../src/modules/strategy/app/segment-discovery.service';
import {
  AcquisitionChannel,
  SceneContext,
  MealRecommendation,
  ScoredFood,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import { FoodLibrary } from '../src/modules/food/food.types';

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

/** 构造 MealRecommendation 用于 DailyPlanContextService.updateAfterMeal() */
function createMockMealRecommendation(foods: ScoredFood[]): MealRecommendation {
  return {
    foods,
    totalCalories: foods.reduce((s, f) => s + f.servingCalories, 0),
    totalProtein: foods.reduce((s, f) => s + f.servingProtein, 0),
    totalFat: foods.reduce((s, f) => s + f.servingFat, 0),
    totalCarbs: foods.reduce((s, f) => s + f.servingCarbs, 0),
    displayText: 'mock',
    tip: 'mock',
  };
}

function createDefaultSceneContext(
  overrides?: Partial<SceneContext>,
): SceneContext {
  return {
    channel: AcquisitionChannel.HOME_COOK,
    sceneType: 'home_cooking',
    realismLevel: 'normal',
    confidence: 0.8,
    source: 'rule_inferred',
    sceneConstraints: {},
    ...overrides,
  };
}

// ─── Mocks ───

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  hSet: jest.fn().mockResolvedValue(1),
  hGetAll: jest.fn().mockResolvedValue({}),
  incr: jest.fn().mockResolvedValue(1),
  getClient: jest.fn().mockReturnValue(null),
  isConnected: true,
};

const mockPrisma = {
  foods: {
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  recipes: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  recommendation_executions: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _avg: { execution_rate: null } }),
  },
  user_profiles: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  daily_plan_items: {
    groupBy: jest.fn().mockResolvedValue([]),
  },
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
};

const mockSeasonalityService = {
  preloadRegion: jest.fn().mockResolvedValue(undefined),
  clearCache: jest.fn(),
  getSeasonalityScore: jest.fn().mockReturnValue(0.7),
  getSeasonalityScores: jest.fn().mockReturnValue(new Map()),
};

// ════════════════════════════════════════════════════════════
// 1. SceneResolver
// ════════════════════════════════════════════════════════════

describe('SceneResolverService', () => {
  let service: SceneResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SceneResolverService(mockRedis as any);
  });

  describe('resolve()', () => {
    it('should return user_explicit scene when channel explicitly provided', async () => {
      const result = await service.resolve(
        'user-1',
        'lunch',
        AcquisitionChannel.CANTEEN, // explicitChannel
      );

      expect(result.channel).toBe(AcquisitionChannel.CANTEEN);
      expect(result.source).toBe('user_explicit');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should infer scene via rules when no explicit input', async () => {
      const result = await service.resolve(
        null, // no userId
        'breakfast', // mealType
        null, // no explicit channel
        null, // no explicit realism
        { scene: undefined, dayType: 'workday' }, // contextual
      );

      expect(result.sceneType).toBeDefined();
      expect(['rule_inferred', 'default']).toContain(result.source);
      expect(result.sceneConstraints).toBeDefined();
    });

    it('should infer dinner scene from rules', async () => {
      const result = await service.resolve(null, 'dinner');

      expect(result).toBeDefined();
      expect(result.channel).toBeDefined();
      expect(result.sceneType).toBeDefined();
    });

    it('should default to general for snack', async () => {
      const result = await service.resolve(null, 'snack');

      expect(result).toBeDefined();
      expect(result.sceneType).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should populate sceneConstraints', async () => {
      const result = await service.resolve(
        null,
        'lunch',
        AcquisitionChannel.CANTEEN,
      );

      expect(result.sceneConstraints).toBeDefined();
    });
  });

  describe('recordChannelUsage()', () => {
    it('should not throw when recording usage', async () => {
      await expect(
        service.recordChannelUsage(
          'user-1',
          'lunch',
          AcquisitionChannel.HOME_COOK,
        ),
      ).resolves.not.toThrow();
    });
  });
});

// ════════════════════════════════════════════════════════════
// 2. RecipeAssembler (with Phase 3-D enhancements)
// ════════════════════════════════════════════════════════════

describe('RecipeAssemblerService', () => {
  let service: RecipeAssemblerService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure recipe DB mock is clean and defaults to empty
    mockPrisma.recipes.findMany.mockReset().mockResolvedValue([]);
    service = new RecipeAssemblerService(mockPrisma as any);
  });

  describe('assembleRecipes()', () => {
    it('should return empty results for empty input', async () => {
      const result = await service.assembleRecipes(
        [],
        createDefaultSceneContext(),
        'lunch',
      );

      expect(result.recipes).toEqual([]);
      expect(result.planTheme).toBe('');
      expect(result.executionDifficulty).toBe(0);
    });

    it('should assemble protein+veggie into main dish', async () => {
      const protein = createMockScoredFood(
        createMockFoodLibrary({
          id: 'p1',
          name: '鸡胸肉',
          category: 'protein',
          cookingMethods: ['stir_fry'],
        }),
      );
      const veggie = createMockScoredFood(
        createMockFoodLibrary({
          id: 'v1',
          name: '西兰花',
          category: 'veggie',
          cookingMethods: ['stir_fry'],
        }),
      );

      const result = await service.assembleRecipes(
        [protein, veggie],
        createDefaultSceneContext(),
        'lunch',
      );

      expect(result.recipes.length).toBeGreaterThanOrEqual(1);
      const mainDish = result.recipes.find(
        (r) => r.ingredients.length > 1 || r.name.includes('鸡胸肉'),
      );
      expect(mainDish).toBeDefined();
    });

    it('should generate theme label for home_cooking scene', async () => {
      const food = createMockScoredFood(createMockFoodLibrary());
      const result = await service.assembleRecipes(
        [food],
        createDefaultSceneContext({ sceneType: 'home_cooking' }),
        'dinner',
      );

      expect(result.planTheme).toBe('家常菜');
    });

    it('should calculate execution difficulty between 0 and 1', async () => {
      const food = createMockScoredFood(
        createMockFoodLibrary({ skillRequired: 'medium', cookTimeMinutes: 30 }),
      );
      const result = await service.assembleRecipes(
        [food],
        createDefaultSceneContext(),
        'lunch',
      );

      expect(result.executionDifficulty).toBeGreaterThanOrEqual(0);
      expect(result.executionDifficulty).toBeLessThanOrEqual(1);
    });

    // Phase 3-D: Breakfast assembly
    it('should use breakfast assembly for quick_breakfast scene', async () => {
      const carb = createMockScoredFood(
        createMockFoodLibrary({
          id: 'c1',
          name: '燕麦粥',
          category: 'grain',
        }),
      );
      const protein = createMockScoredFood(
        createMockFoodLibrary({
          id: 'p1',
          name: '鸡蛋',
          category: 'protein',
        }),
      );

      const result = await service.assembleRecipes(
        [carb, protein],
        createDefaultSceneContext({ sceneType: 'quick_breakfast' }),
        'breakfast',
      );

      expect(result.recipes.length).toBeGreaterThanOrEqual(1);
      expect(result.planTheme).toBe('快手早餐');
    });

    // Phase 3-D: Composite foods pass through directly
    it('should pass through composite foods as standalone dishes', async () => {
      const composite = createMockScoredFood(
        createMockFoodLibrary({
          id: 'comp1',
          name: '猪肉水饺',
          category: 'composite',
        }),
      );

      const result = await service.assembleRecipes(
        [composite],
        createDefaultSceneContext(),
        'lunch',
      );

      expect(result.recipes.length).toBe(1);
      expect(result.recipes[0].name).toBe('猪肉水饺');
    });

    // Phase 3-D: Natural dish name generation
    it('should generate natural dish name with cooking method', async () => {
      const protein = createMockScoredFood(
        createMockFoodLibrary({
          id: 'p1',
          name: '牛肉',
          category: 'protein',
          cookingMethods: ['stew'],
        }),
      );
      const veggie = createMockScoredFood(
        createMockFoodLibrary({
          id: 'v1',
          name: '土豆',
          category: 'veggie',
        }),
      );

      // Ensure recipe DB returns empty (triggers smartAssemble fallback)
      mockPrisma.recipes.findMany.mockResolvedValue([]);

      const result = await service.assembleRecipes(
        [protein, veggie],
        createDefaultSceneContext(),
        'dinner',
      );

      const mainDish = result.recipes.find((r) => r.ingredients.length > 1);
      expect(mainDish).toBeDefined();
      // 炖 method → "蛋白+方法+蔬菜" pattern: "牛肉炖土豆"
      expect(mainDish!.name).toBe('牛肉炖土豆');
    });

    // Phase 3-D: Snack assembly (no complex combining)
    it('should use simple assembly for late_night_snack', async () => {
      const food1 = createMockScoredFood(
        createMockFoodLibrary({ id: 'f1', name: '酸奶', category: 'dairy' }),
      );
      const food2 = createMockScoredFood(
        createMockFoodLibrary({
          id: 'f2',
          name: '蓝莓',
          category: 'fruit',
        }),
      );

      const result = await service.assembleRecipes(
        [food1, food2],
        createDefaultSceneContext({ sceneType: 'late_night_snack' }),
        'snack',
      );

      // Should list each food separately (no complex combinations)
      expect(result.recipes.length).toBe(2);
      expect(result.recipes.every((r) => r.ingredients.length === 1)).toBe(
        true,
      );
    });

    // Phase 3-D: Multiple proteins get separate dishes
    it('should create separate dishes for multiple protein sources', async () => {
      const proteins = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'p1',
            name: '鸡胸肉',
            category: 'protein',
            cookingMethods: ['stir_fry'],
          }),
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'p2',
            name: '豆腐',
            category: 'protein',
            cookingMethods: ['boil'],
          }),
        ),
      ];
      const veggie = createMockScoredFood(
        createMockFoodLibrary({
          id: 'v1',
          name: '青菜',
          category: 'veggie',
        }),
      );

      const result = await service.assembleRecipes(
        [...proteins, veggie],
        createDefaultSceneContext(),
        'dinner',
      );

      // Each protein should get its own dish
      const proteinDishes = result.recipes.filter((r) =>
        r.ingredients.some(
          (i) => i.food.name === '鸡胸肉' || i.food.name === '豆腐',
        ),
      );
      expect(proteinDishes.length).toBe(2);
    });
  });
});

// ════════════════════════════════════════════════════════════
// 3. AvailabilityScorer (with Phase 3-E enhancements)
// ════════════════════════════════════════════════════════════

describe('AvailabilityScorerService', () => {
  let service: AvailabilityScorerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AvailabilityScorerService(mockSeasonalityService as any);
  });

  describe('score()', () => {
    it('should return high availability for food with matching channel', () => {
      const food = createMockFoodLibrary({
        availableChannels: ['home_cook', 'restaurant'],
      });

      const result = service.score(food, AcquisitionChannel.HOME_COOK);

      expect(result.channelAvailability).toBe(0.9);
      expect(result.source).toBe('food_data');
    });

    it('should return low availability for food without matching channel', () => {
      const food = createMockFoodLibrary({
        availableChannels: ['home_cook'],
      });

      const result = service.score(food, AcquisitionChannel.CONVENIENCE);

      expect(result.channelAvailability).toBe(0.1);
      expect(result.source).toBe('food_data');
    });

    it('should use channel_default when food has no availableChannels', () => {
      const food = createMockFoodLibrary({
        availableChannels: undefined,
        category: 'protein',
      });

      const result = service.score(food, AcquisitionChannel.HOME_COOK);

      expect(result.source).toBe('channel_default');
      expect(result.channelAvailability).toBeGreaterThan(0.5);
    });

    it('should always return availability for UNKNOWN channel', () => {
      const food = createMockFoodLibrary({
        availableChannels: ['home_cook'],
      });

      const result = service.score(food, AcquisitionChannel.UNKNOWN);

      expect(result.channelAvailability).toBe(0.9);
    });
  });

  describe('scoreBatch()', () => {
    it('should return scores for all foods', () => {
      const foods = [
        createMockFoodLibrary({ id: 'f1' }),
        createMockFoodLibrary({ id: 'f2' }),
        createMockFoodLibrary({ id: 'f3' }),
      ];

      const results = service.scoreBatch(foods, AcquisitionChannel.HOME_COOK);

      expect(results.size).toBe(3);
      expect(results.has('f1')).toBe(true);
      expect(results.has('f2')).toBe(true);
      expect(results.has('f3')).toBe(true);
    });
  });

  // Phase 3-E: Region/Season enhanced scoring
  describe('scoreWithRegion() [Phase 3-E]', () => {
    it('should blend seasonality into overall availability', () => {
      mockSeasonalityService.getSeasonalityScore.mockReturnValue(1.0);
      const food = createMockFoodLibrary({
        availableChannels: ['home_cook'],
        commonalityScore: 80,
      });

      const result = service.scoreWithRegion(
        food,
        AcquisitionChannel.HOME_COOK,
        7,
      );

      expect(result.source).toBe('regional_enhanced');
      expect(result.overallAvailability).toBeGreaterThan(0);
      expect(result.overallAvailability).toBeLessThanOrEqual(1);
    });

    it('should reduce availability for out-of-season food', () => {
      mockSeasonalityService.getSeasonalityScore.mockReturnValue(0.3);
      const food = createMockFoodLibrary({
        availableChannels: ['home_cook'],
      });

      const offSeason = service.scoreWithRegion(
        food,
        AcquisitionChannel.HOME_COOK,
        7,
      );

      mockSeasonalityService.getSeasonalityScore.mockReturnValue(1.0);
      const peakSeason = service.scoreWithRegion(
        food,
        AcquisitionChannel.HOME_COOK,
        7,
      );

      expect(peakSeason.overallAvailability).toBeGreaterThan(
        offSeason.overallAvailability,
      );
    });

    it('should delegate preloadRegion to SeasonalityService', async () => {
      await service.preloadRegion('CN-GD');
      expect(mockSeasonalityService.preloadRegion).toHaveBeenCalledWith(
        'CN-GD',
      );
    });

    it('should delegate clearRegionCache to SeasonalityService', () => {
      service.clearRegionCache();
      expect(mockSeasonalityService.clearCache).toHaveBeenCalled();
    });
  });

  describe('scoreBatchWithRegion() [Phase 3-E]', () => {
    it('should return regional_enhanced scores for all foods', () => {
      const foods = [
        createMockFoodLibrary({ id: 'f1' }),
        createMockFoodLibrary({ id: 'f2' }),
      ];

      const results = service.scoreBatchWithRegion(
        foods,
        AcquisitionChannel.HOME_COOK,
        6,
      );

      expect(results.size).toBe(2);
      for (const [, score] of results) {
        expect(score.source).toBe('regional_enhanced');
      }
    });
  });
});

// ════════════════════════════════════════════════════════════
// 4. DailyPlanContextService
// ════════════════════════════════════════════════════════════

describe('DailyPlanContextService', () => {
  let service: DailyPlanContextService;

  beforeEach(() => {
    service = new DailyPlanContextService();
  });

  describe('createEmpty()', () => {
    it('should return an empty DailyPlanState', () => {
      const state = service.createEmpty();

      expect(state.usedFoodIds.size).toBe(0);
      expect(state.usedFoodNames.size).toBe(0);
      expect(Object.keys(state.categoryCounts)).toHaveLength(0);
      expect(Object.keys(state.cookingMethodCounts)).toHaveLength(0);
      expect(state.usedMainIngredients.size).toBe(0);
      expect(state.accumulatedNutrition.calories).toBe(0);
    });
  });

  describe('updateAfterMeal()', () => {
    it('should accumulate food usage across meals', () => {
      const state = service.createEmpty();
      const foods = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'f1',
            name: '鸡胸肉',
            category: 'protein',
            cookingMethods: ['stir_fry'],
            mainIngredient: 'chicken',
          }),
        ),
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'f2',
            name: '米饭',
            category: 'grain',
          }),
        ),
      ];
      const meal = createMockMealRecommendation(foods);

      service.updateAfterMeal(state, meal);

      expect(state.usedFoodIds.has('f1')).toBe(true);
      expect(state.usedFoodIds.has('f2')).toBe(true);
      expect(state.usedFoodNames.has('鸡胸肉')).toBe(true);
      expect(state.categoryCounts['protein']).toBe(1);
      expect(state.categoryCounts['grain']).toBe(1);
      expect(state.accumulatedNutrition.calories).toBeGreaterThan(0);
    });

    it('should track cooking methods', () => {
      const state = service.createEmpty();
      const foods = [
        createMockScoredFood(
          createMockFoodLibrary({
            id: 'f1',
            cookingMethods: ['stir_fry'],
          }),
        ),
      ];
      const meal = createMockMealRecommendation(foods);

      service.updateAfterMeal(state, meal);

      expect(state.cookingMethodCounts['stir_fry']).toBe(1);
    });
  });

  describe('calcDiversityPenalty()', () => {
    it('should return 0 for unused food', () => {
      const state = service.createEmpty();
      const food = createMockFoodLibrary({ id: 'new-food' });

      const penalty = service.calcDiversityPenalty(food, state);

      expect(penalty).toBe(0);
    });

    it('should return negative penalty for repeated food', () => {
      const state = service.createEmpty();
      const food = createMockFoodLibrary({
        id: 'f1',
        name: '鸡胸肉',
        category: 'protein',
      });
      const meal = createMockMealRecommendation([createMockScoredFood(food)]);
      service.updateAfterMeal(state, meal);

      const penalty = service.calcDiversityPenalty(food, state);

      // Penalty should be negative (penalizing repeated food)
      expect(penalty).toBeLessThan(0);
    });
  });
});

// ════════════════════════════════════════════════════════════
// 5. ChannelMigrationService (Phase 3-C)
// ════════════════════════════════════════════════════════════

describe('ChannelMigrationService', () => {
  let service: ChannelMigrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelMigrationService(mockPrisma as any);
  });

  describe('inferChannels()', () => {
    it('should infer home_cook + restaurant for fresh veggie', () => {
      const channels = service.inferChannels({
        category: 'veggie',
        processing_level: 0,
        commonality_score: 50,
      });

      expect(channels).toContain('home_cook');
      expect(channels).toContain('restaurant');
    });

    it('should infer convenience for high processing level', () => {
      const channels = service.inferChannels({
        category: 'snack',
        processing_level: 4,
        commonality_score: 50,
      });

      expect(channels).toContain('convenience');
    });

    it('should infer delivery + restaurant + canteen for composite', () => {
      const channels = service.inferChannels({
        category: 'composite',
        processing_level: 2,
        commonality_score: 50,
      });

      expect(channels).toContain('delivery');
      expect(channels).toContain('restaurant');
      expect(channels).toContain('canteen');
    });

    it('should infer convenience + restaurant for beverage', () => {
      const channels = service.inferChannels({
        category: 'beverage',
        processing_level: 2,
        commonality_score: 50,
      });

      expect(channels).toContain('convenience');
      expect(channels).toContain('restaurant');
    });

    it('should add canteen + delivery for high commonality', () => {
      const channels = service.inferChannels({
        category: 'protein',
        processing_level: 1,
        commonality_score: 85,
      });

      expect(channels).toContain('canteen');
      expect(channels).toContain('delivery');
    });

    it('should not duplicate channels', () => {
      const channels = service.inferChannels({
        category: 'composite',
        processing_level: 3,
        commonality_score: 90,
      });

      expect(channels.length).toBe(new Set(channels).size);
    });

    it('should infer home_cook for fat/condiment categories', () => {
      const fatChannels = service.inferChannels({
        category: 'fat',
        processing_level: 1,
        commonality_score: 50,
      });
      const condimentChannels = service.inferChannels({
        category: 'condiment',
        processing_level: 1,
        commonality_score: 50,
      });

      expect(fatChannels).toContain('home_cook');
      expect(condimentChannels).toContain('home_cook');
    });
  });

  describe('migrateAvailableChannels()', () => {
    beforeEach(() => {
      // Reset foods.findMany to clear any leftover once-queue from previous tests
      mockPrisma.foods.findMany.mockReset().mockResolvedValue([]);
      mockPrisma.foods.update.mockReset().mockResolvedValue({});
    });

    it('should process foods in batches', async () => {
      const mockFoods = [
        {
          id: 'f1',
          category: 'protein',
          processing_level: 1,
          commonality_score: 70,
          available_channels: [
            'home_cook',
            'restaurant',
            'delivery',
            'convenience',
          ],
        },
      ];
      mockPrisma.foods.findMany
        .mockResolvedValueOnce(mockFoods)
        .mockResolvedValueOnce([]);
      mockPrisma.foods.update.mockResolvedValue({});

      const stats = await service.migrateAvailableChannels();

      expect(stats.total).toBe(1);
      expect(stats.errors).toBe(0);
      expect(stats.updated + stats.skipped).toBe(1);
    });

    it('should skip foods where channels match', async () => {
      const mockFoods = [
        {
          id: 'f1',
          category: 'veggie',
          processing_level: 0,
          commonality_score: 50,
          available_channels: ['home_cook', 'restaurant'],
        },
      ];
      mockPrisma.foods.findMany
        .mockResolvedValueOnce(mockFoods)
        .mockResolvedValueOnce([]);

      const stats = await service.migrateAvailableChannels();

      expect(stats.skipped).toBe(1);
      expect(stats.updated).toBe(0);
    });
  });
});

// ════════════════════════════════════════════════════════════
// 6. SegmentDiscoveryService (Phase 3-A) — K-Means core logic
// ════════════════════════════════════════════════════════════

describe('SegmentDiscoveryService', () => {
  let service: SegmentDiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SegmentDiscoveryService(mockPrisma as any, mockRedis as any);
  });

  describe('K-Means core utilities', () => {
    it('should be instantiable', () => {
      expect(service).toBeDefined();
    });

    it('should handle discoverSegments with no users gracefully', async () => {
      mockPrisma.user_profiles.findMany.mockResolvedValue([]);

      const result = await service.discoverSegments();

      expect(result).toBeDefined();
      // discoverSegments returns DiscoveredSegment[] directly
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════
// 7. Performance validation
// ════════════════════════════════════════════════════════════

describe('Performance validation', () => {
  describe('AvailabilityScorer batch performance', () => {
    it('should score 1000 foods in under 100ms', () => {
      const scorer = new AvailabilityScorerService(
        mockSeasonalityService as any,
      );
      const foods = Array.from({ length: 1000 }, (_, i) =>
        createMockFoodLibrary({
          id: `perf-${i}`,
          category: ['protein', 'grain', 'veggie', 'fruit', 'dairy'][i % 5],
          commonalityScore: 50 + (i % 50),
        }),
      );

      const start = performance.now();
      scorer.scoreBatch(foods, AcquisitionChannel.HOME_COOK);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('should score 1000 foods with region in under 150ms', () => {
      const scorer = new AvailabilityScorerService(
        mockSeasonalityService as any,
      );
      const foods = Array.from({ length: 1000 }, (_, i) =>
        createMockFoodLibrary({
          id: `perf-r-${i}`,
          category: ['protein', 'grain', 'veggie', 'fruit', 'dairy'][i % 5],
        }),
      );

      const start = performance.now();
      scorer.scoreBatchWithRegion(foods, AcquisitionChannel.HOME_COOK, 7);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(150);
    });
  });

  describe('ChannelMigration inferChannels performance', () => {
    it('should infer channels for 10000 foods in under 200ms', () => {
      const migration = new ChannelMigrationService(mockPrisma as any);
      const categories = [
        'protein',
        'grain',
        'veggie',
        'fruit',
        'dairy',
        'composite',
        'snack',
        'beverage',
        'fat',
        'condiment',
      ];

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        migration.inferChannels({
          category: categories[i % categories.length],
          processing_level: i % 5,
          commonality_score: 30 + (i % 70),
        });
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('DailyPlanContext performance', () => {
    it('should compute diversity penalty for 500 foods in under 50ms', () => {
      const ctx = new DailyPlanContextService();
      const state = ctx.createEmpty();

      // Simulate 3 meals of 5 foods each = 15 foods used
      for (let meal = 0; meal < 3; meal++) {
        const foods = Array.from({ length: 5 }, (_, i) =>
          createMockScoredFood(
            createMockFoodLibrary({
              id: `m${meal}-f${i}`,
              name: `食物${meal * 5 + i}`,
              category: ['protein', 'grain', 'veggie'][i % 3],
              cookingMethods: [['stir_fry', 'steam', 'boil'][i % 3]],
              mainIngredient: `ingredient-${i}`,
            }),
          ),
        );
        ctx.updateAfterMeal(state, createMockMealRecommendation(foods));
      }

      const candidates = Array.from({ length: 500 }, (_, i) =>
        createMockFoodLibrary({
          id: `candidate-${i}`,
          name: `候选${i}`,
          category: ['protein', 'grain', 'veggie'][i % 3],
        }),
      );

      const start = performance.now();
      for (const food of candidates) {
        ctx.calcDiversityPenalty(food, state);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
