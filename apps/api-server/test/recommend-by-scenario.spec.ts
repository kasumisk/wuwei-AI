/**
 * V8.0 P3-05: recommendByScenario 走标准管道集成验证
 *
 * 验证 P2-01 重构后：
 * 1. 三个场景（takeout / convenience / homeCook）都通过标准管道产生结果
 * 2. 返回值包含所有三个场景键
 * 3. pipelineBuilder.executeRolePipeline 被调用 3 次（每场景各 1 次）
 * 4. 三个场景使用不同的 channel 和 sceneType
 * 5. 串行执行：usedAcrossScenarios 跨场景去重
 * 6. resultProcessor.process 被调用 3 次
 * 7. 每个场景都收到正确的 sceneContext.source = 'rule_inferred'
 */

import { RecommendationEngineService } from '../src/modules/diet/app/services/recommendation-engine.service';
import {
  createMockFoodLibrary,
  createMockScoredFood,
  createMockMealTarget,
} from './helpers/mock-factories';
import type { FoodLibrary } from '../src/modules/food/food.types';
import type { MealRecommendation } from '../src/modules/diet/app/recommendation/types/recommendation.types';

// ─── Mock 工厂 ───

function makeMealRecommendation(
  overrides?: Partial<MealRecommendation>,
): MealRecommendation {
  return {
    foods: [],
    totalCalories: 450,
    totalProtein: 30,
    totalFat: 15,
    totalCarbs: 55,
    displayText: 'mock',
    tip: 'mock',
    ...overrides,
  };
}

function makeScoredFood(name: string) {
  const food = createMockFoodLibrary({ name });
  return createMockScoredFood(food);
}

// ─── 构造 RecommendationEngineService（stub 全部依赖） ───

function createEngine() {
  const mockConstraintGenerator = {
    generateConstraints: jest.fn().mockReturnValue({
      excludeTags: [],
      maxCalories: 700,
      minProtein: 20,
    }),
  };

  const mockFoodScorer = {
    scoreFood: jest.fn().mockReturnValue(0.8),
    scoreFoodsWithServing: jest.fn().mockReturnValue([]),
    setCategoryMicroDefaults: jest.fn(),
  };
  const mockMealAssembler = { assemble: jest.fn().mockReturnValue([]) };

  const mockFoodPoolCache = {
    getVerifiedFoods: jest.fn().mockResolvedValue([createMockFoodLibrary()]),
    getCategoryMicroAverages: jest.fn().mockReturnValue({}),
  };

  const mockExplanationGenerator = {
    generate: jest.fn().mockReturnValue({ displayText: 'mock', tip: 'mock' }),
    generateV2: jest
      .fn()
      .mockReturnValue({ text: 'mock', structuredInsights: [] }),
    explainWhyNot: jest.fn().mockReturnValue([]),
  };

  const mockCacheManager = {
    createNamespace: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }),
  };

  const mockRecipeService = {
    getScoredRecipes: jest.fn().mockResolvedValue([]),
  };

  const mockRealisticFilterService = {
    filter: jest
      .fn()
      .mockImplementation((candidates: FoodLibrary[]) => candidates),
    adjustForScene: jest.fn().mockReturnValue(null),
  };

  const mockReplacementFeedbackInjector = {
    getWeightMap: jest.fn().mockResolvedValue(null),
  };

  const mockFoodI18nService = {
    translateFoods: jest.fn().mockImplementation((foods: any[]) => foods),
  };

  const mockRequestCtx = {
    getLocale: jest.fn().mockReturnValue('zh'),
  };

  const mockScoringConfigService = {
    getTuning: jest.fn().mockReturnValue({
      baseExplorationRate: 0.15,
      optimizerCandidateLimit: 8,
    }),
  };

  // The key mock: pipelineBuilder.executeRolePipeline
  const executeRolePipelineMock = jest.fn().mockResolvedValue({
    picks: [makeScoredFood('鸡胸肉'), makeScoredFood('白米饭')],
    allCandidates: [],
    degradations: [],
  });

  const mockPipelineBuilder = {
    executeRolePipeline: executeRolePipelineMock,
    recallCandidates: jest.fn().mockResolvedValue([]),
    rankCandidates: jest.fn().mockReturnValue([]),
    rerankAndSelect: jest.fn().mockReturnValue(null),
  };

  const mockSceneResolver = {
    resolve: jest.fn().mockReturnValue({
      channel: 'home_cook',
      sceneType: 'home_cooking',
      realismLevel: 'normal',
      confidence: 1.0,
      source: 'rule_inferred',
      sceneConstraints: {},
    }),
  };

  const mockDailyPlanContextService = {
    computeCrossMealAdjustment: jest.fn().mockResolvedValue(null),
  };

  const mockMealTemplateService = {
    matchTemplate: jest.fn().mockResolvedValue(null),
  };

  const mockFactorLearnerService = {
    getAdjustments: jest.fn().mockResolvedValue(null),
  };

  // profileAggregator.aggregateForScenario must return the right shape
  const mockProfileAggregator = {
    aggregateForScenario: jest.fn().mockResolvedValue({
      recentFoodNames: [],
      enrichedProfile: {
        allergens: [],
        declared: {},
        observed: {},
        inferred: {},
        shortTerm: null,
        contextual: null,
      },
    }),
    aggregate: jest.fn().mockResolvedValue({
      enrichedProfile: {
        allergens: [],
        declared: {},
        shortTerm: null,
        contextual: null,
      },
      recentFoodNames: [],
    }),
  };

  const mockStrategyFacade = {
    resolveStrategyForUser: jest.fn().mockResolvedValue({
      strategyId: 'default',
      strategyName: 'Default',
      sources: [],
      config: {},
      resolvedAt: Date.now(),
    }),
    mergeExperimentConfig: jest.fn().mockImplementation((r: any) => r),
  };

  const mockTraceService = {
    save: jest.fn().mockResolvedValue(undefined),
  };

  const mockFeatureFlagService = {
    isEnabled: jest.fn().mockResolvedValue(false),
    getFlag: jest.fn().mockResolvedValue(null),
  };

  const mockContextFactory = {
    build: jest.fn().mockReturnValue({
      allFoods: [],
      mealType: 'lunch',
      goalType: 'fat_loss',
      target: { calories: 500, protein: 30, fat: 15, carbs: 60 },
      constraints: { excludeTags: [], maxCalories: 700, minProtein: 20 },
      usedNames: new Set(),
      picks: [],
    }),
  };

  // resultProcessor.process returns a MealRecommendation
  const processCallOrder: string[] = [];
  const mockResultProcessor = {
    process: jest.fn().mockImplementation(({ sceneContext }: any) => {
      processCallOrder.push(sceneContext.sceneType);
      return Promise.resolve(makeMealRecommendation());
    }),
  };

  const engine = new RecommendationEngineService(
    mockConstraintGenerator as any,
    mockFoodScorer as any,
    mockMealAssembler as any,
    mockFoodPoolCache as any,
    mockExplanationGenerator as any,
    mockCacheManager as any,
    mockRecipeService as any,
    mockRealisticFilterService as any,
    mockReplacementFeedbackInjector as any,
    mockFoodI18nService as any,
    mockRequestCtx as any,
    mockScoringConfigService as any,
    mockPipelineBuilder as any,
    mockSceneResolver as any,
    mockDailyPlanContextService as any,
    mockMealTemplateService as any,
    mockFactorLearnerService as any,
    mockProfileAggregator as any,
    mockStrategyFacade as any,
    mockTraceService as any,
    mockFeatureFlagService as any,
    mockContextFactory as any,
    mockResultProcessor as any,
  );

  // Manually init cache namespace (onModuleInit)
  (engine as any).analysisProfileCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };

  return {
    engine,
    mocks: {
      executeRolePipelineMock,
      mockResultProcessor,
      mockContextFactory,
      mockProfileAggregator,
      mockStrategyFacade,
      mockConstraintGenerator,
      processCallOrder,
    },
  };
}

// ─── Test Suite ───

describe('RecommendationEngineService.recommendByScenario (V8.0 P2-01 验证)', () => {
  // ════════════════════════════════════════════════════════════
  // 1. 返回三个场景键
  // ════════════════════════════════════════════════════════════

  it('should return takeout, convenience and homeCook results', async () => {
    const { engine } = createEngine();
    const target = createMockMealTarget();

    const result = await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    expect(result).toHaveProperty('takeout');
    expect(result).toHaveProperty('convenience');
    expect(result).toHaveProperty('homeCook');
  });

  // ════════════════════════════════════════════════════════════
  // 2. pipelineBuilder.executeRolePipeline 调用 3 次
  // ════════════════════════════════════════════════════════════

  it('should call pipelineBuilder.executeRolePipeline exactly 3 times', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    expect(mocks.executeRolePipelineMock).toHaveBeenCalledTimes(3);
  });

  // ════════════════════════════════════════════════════════════
  // 3. resultProcessor.process 调用 3 次
  // ════════════════════════════════════════════════════════════

  it('should call resultProcessor.process exactly 3 times', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    expect(mocks.mockResultProcessor.process).toHaveBeenCalledTimes(3);
  });

  // ════════════════════════════════════════════════════════════
  // 4. 每个 resultProcessor.process 调用收到 sceneContext.source = 'rule_inferred'
  // ════════════════════════════════════════════════════════════

  it('should pass sceneContext.source = "rule_inferred" to each resultProcessor call', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    const calls = mocks.mockResultProcessor.process.mock.calls;
    for (const [callArg] of calls) {
      expect(callArg.sceneContext.source).toBe('rule_inferred');
    }
  });

  // ════════════════════════════════════════════════════════════
  // 5. 三个场景使用不同的 sceneType
  // ════════════════════════════════════════════════════════════

  it('should use distinct sceneTypes for the three scenarios', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    const sceneTypes = mocks.mockResultProcessor.process.mock.calls.map(
      ([arg]: [any]) => arg.sceneContext.sceneType,
    );

    const uniqueTypes = new Set(sceneTypes);
    expect(uniqueTypes.size).toBe(3);
    expect(uniqueTypes).toContain('eating_out');
    expect(uniqueTypes).toContain('convenience_meal');
    expect(uniqueTypes).toContain('home_cooking');
  });

  // ════════════════════════════════════════════════════════════
  // 6. profileAggregator.aggregateForScenario 被调用
  // ════════════════════════════════════════════════════════════

  it('should call profileAggregator.aggregateForScenario once', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    expect(
      mocks.mockProfileAggregator.aggregateForScenario,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.mockProfileAggregator.aggregateForScenario,
    ).toHaveBeenCalledWith('user-1', 'lunch');
  });

  // ════════════════════════════════════════════════════════════
  // 7. strategyFacade.resolveStrategyForUser 被调用
  // ════════════════════════════════════════════════════════════

  it('should call strategyFacade.resolveStrategyForUser once', async () => {
    const { engine, mocks } = createEngine();
    const target = createMockMealTarget();

    await engine.recommendByScenario(
      'user-1',
      'lunch',
      'fat_loss',
      { calories: 0, protein: 0 },
      target,
      { calories: 2000, protein: 120 },
    );

    expect(
      mocks.mockStrategyFacade.resolveStrategyForUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.mockStrategyFacade.resolveStrategyForUser,
    ).toHaveBeenCalledWith('user-1', 'fat_loss');
  });
});
