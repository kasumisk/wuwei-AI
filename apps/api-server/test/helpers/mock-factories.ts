/**
 * V7.7: 共享测试工厂函数
 *
 * 消除 v6.9 ~ v7.4 集成测试中重复的 createMockFoodLibrary / createMockScoredFood /
 * createMockMealTarget helper（原先在 6+ 文件中各自定义，代码完全一致）。
 *
 * 用法：
 *   import { createMockFoodLibrary, createMockScoredFood, createMockMealTarget } from './helpers/mock-factories';
 */

import type { FoodLibrary } from '../../src/modules/food/food.types';
import type {
  ScoredFood,
  MealTarget,
  MealRecommendation,
} from '../../src/modules/diet/app/recommendation/recommendation.types';

// ─── FoodLibrary ───

/**
 * 创建一个带合理默认值的 FoodLibrary mock 对象。
 * 所有字段可通过 overrides 覆盖。
 */
export function createMockFoodLibrary(
  overrides?: Partial<FoodLibrary>,
): FoodLibrary {
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
    cookingMethod: '炒',
    cuisine: '中餐',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FoodLibrary;
}

// ─── ScoredFood ───

/**
 * 基于 FoodLibrary 创建 ScoredFood，自动按 standardServingG 换算营养素。
 */
export function createMockScoredFood(
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

// ─── MealTarget ───

/**
 * 创建默认的 MealTarget（500 kcal 午餐）。
 */
export function createMockMealTarget(
  overrides?: Partial<MealTarget>,
): MealTarget {
  return {
    calories: 500,
    protein: 30,
    fat: 15,
    carbs: 60,
    ...overrides,
  };
}

// ─── MealRecommendation ───

/**
 * 从 ScoredFood[] 构造 MealRecommendation，用于 DailyPlanContextService 等测试。
 */
export function createMockMealRecommendation(
  foods: ScoredFood[],
): MealRecommendation {
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

// ─── Service Mock 工厂 ───

/**
 * 创建 HealthModifierEngineService 的默认 mock（evaluate 返回无惩罚结果）。
 */
export function createMockHealthModifierEngine() {
  return {
    evaluate: jest.fn().mockReturnValue({
      finalMultiplier: 1.0,
      modifiers: [],
      isVetoed: false,
    }),
    hashContext: jest.fn().mockReturnValue('none'),
    preloadL1: jest.fn(),
  };
}

/**
 * 创建 ScoringConfigService 的默认 mock（返回 null config + 默认 tuning）。
 */
export function createMockScoringConfigService() {
  const tuningDefaults = {
    // MealAssembler
    similarityWeights: {
      category: 0.3,
      mainIngredient: 0.5,
      subCategory: 0.2,
      tagOverlap: 0.05,
    },
    diversitySimilarityPenalty: 0.3,
    compatibilityGoodBonus: 0.05,
    compatibilityBadPenalty: -0.1,
    compatibilityClampMin: -0.15,
    compatibilityClampMax: 0.15,
    // PipelineBuilder
    optimizerCandidateLimit: 8,
    diversityHighMultiplier: 1.5,
    diversityLowMultiplier: 0.5,
    baseExplorationRate: 0.15,
    dishPriorityDivisorScene: 500,
    dishPriorityDivisorNormal: 1000,
    semiPreparedMultiplierScene: 1.08,
    semiPreparedMultiplierNormal: 1.03,
    ingredientMultiplierScene: 0.9,
    conflictMaxRounds: 3,
    ingredientDiversityThreshold: 60,
    cookingMethodDiversityThreshold: 50,
    // ConstraintGenerator
    proteinGapThreshold: 30,
    calorieGapThreshold: 300,
    calorieCeilingMultiplier: 1.15,
    bingeRiskCalorieMultiplier: 0.98,
    minProteinRatio: 0.5,
    // SceneContextFactor
    sceneBoostClampMin: 0.8,
    sceneBoostClampMax: 1.2,
    // AnalysisProfileFactor
    categoryInterestPerCount: 0.02,
    categoryInterestCap: 0.08,
    riskFoodPenalty: 0.7,
    // PreferenceSignalFactor
    declaredPrefPerMatch: 0.05,
    declaredPrefCap: 0.15,
    // LifestyleBoostFactor
    factorWaterHighThreshold: 80,
    nutrientBoostClampMin: 0.85,
    nutrientBoostClampMax: 1.15,
    nutrientBoostDeltaMultiplier: 0.05,
    // ShortTermProfileFactor
    shortTermMinInteractions: 3,
    // PopularityFactor
    popularityNormalizationDivisor: 100,
    // FoodScorer
    cuisineWeightBoostCoeff: 0.2,
    channelMatchBonus: 0.1,
    acquisitionScoreMap: { 1: 1.0, 2: 0.85, 3: 0.65, 4: 0.4, 5: 0.15 },
  };
  return {
    getConfig: jest.fn().mockReturnValue(null),
    getTuning: jest.fn().mockReturnValue(tuningDefaults),
    getTuningDefaults: jest.fn().mockReturnValue(tuningDefaults),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * 创建 RecommendationConfigService 的默认 mock。
 */
export function createMockRecommendationConfigService() {
  // health 默认权重（14 维，与 scoring.types.ts SCORE_WEIGHTS.health 一致）
  const defaultWeights = [
    0.06, 0.05, 0.04, 0.04, 0.12, 0.06, 0.08, 0.14, 0.09, 0.07, 0.05, 0.08,
    0.06, 0.06,
  ];
  return {
    get: jest.fn().mockReturnValue(undefined),
    getNumber: jest.fn().mockReturnValue(undefined),
    getString: jest.fn().mockReturnValue(undefined),
    getBaseWeights: jest.fn().mockReturnValue(defaultWeights),
    updateWeights: jest.fn(),
    getAllWeights: jest.fn().mockReturnValue({}),
  };
}

/**
 * 创建 NutritionTargetService 的默认 mock。
 */
export function createMockNutritionTargetService() {
  return {
    calculate: jest.fn().mockReturnValue({
      fiber: 25,
      vitaminA: 900,
      vitaminC: 90,
      calcium: 1000,
      iron: 8,
      potassium: 3400,
      protein: 50,
      vitaminD: 15,
      vitaminE: 15,
    }),
  };
}

/**
 * 创建 SeasonalityService 的默认 mock。
 */
export function createMockSeasonalityService() {
  return {
    getSeasonalityScore: jest.fn().mockReturnValue(1.0),
    preloadRegion: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * 创建 PrismaService 的最小 mock（按需扩展）。
 */
export function createMockPrismaService(overrides?: Record<string, any>) {
  return {
    clients: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    usage_records: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    client_capability_permissions: {
      findFirst: jest.fn(),
    },
    model_configs: {
      findMany: jest.fn(),
    },
    feature_flag: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

/**
 * 创建 RedisCacheService 的默认 mock（所有操作静默成功）。
 */
export function createMockRedisCacheService() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    hGetAll: jest.fn().mockResolvedValue(null),
    hSet: jest.fn().mockResolvedValue(false),
    expireNX: jest.fn().mockResolvedValue(true),
    mget: jest.fn().mockResolvedValue([]),
    buildKey: jest.fn((...parts: string[]) => parts.join(':')),
    delByPrefix: jest.fn().mockResolvedValue(0),
  };
}

/**
 * 创建 MetricsService 的默认 mock。
 */
export function createMockMetricsService() {
  return {
    recordLatency: jest.fn(),
    incrementCounter: jest.fn(),
    recordGauge: jest.fn(),
    cacheOperations: {
      inc: jest.fn(),
    },
  };
}

/**
 * 创建 ExplanationGeneratorService 的默认 mock。
 */
export function createMockExplanationGeneratorService() {
  return {
    generate: jest.fn().mockReturnValue({ displayText: 'mock', tip: 'mock' }),
    generateV2: jest.fn().mockReturnValue({
      text: 'mock',
      structuredInsights: [],
    }),
    explainWhyNot: jest.fn().mockReturnValue([]),
    explainMealComposition: jest.fn().mockReturnValue(null),
    resolveStyleVariant: jest.fn().mockReturnValue('standard'),
    generateBatch: jest.fn().mockResolvedValue([]),
    generateV2Batch: jest.fn().mockResolvedValue([]),
  };
}

/**
 * 创建 PreferenceProfileService 的默认 mock。
 * sampleBeta 使用 mean 近似 alpha/(alpha+beta) 以支持统计类测试。
 */
export function createMockPreferenceProfileService() {
  return {
    getSignal: jest.fn().mockReturnValue(null),
    recordSignal: jest.fn(),
    getProfile: jest.fn().mockReturnValue(null),
    sampleBeta: jest
      .fn()
      .mockImplementation(
        (alpha: number, beta: number) => alpha / (alpha + beta),
      ),
  };
}
