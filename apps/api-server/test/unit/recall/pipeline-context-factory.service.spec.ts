/**
 * V8.0 P3-01: PipelineContextFactory 单元测试
 *
 * 验证：
 * 1. build() 将 MealFromPoolRequest 的全部字段映射到 PipelineContext
 * 2. params.crossMealAdjustment 优先级高于 req.crossMealAdjustment
 * 3. tuning 由 ScoringConfigService.getTuning() 注入
 * 4. replacementWeightMap / usedNames / picks 正确传入
 */

import { PipelineContextFactory } from '../../../src/modules/diet/app/recommendation/context/pipeline-context-factory.service';
import {
  createMockFoodLibrary,
  createMockScoringConfigService,
} from '../../helpers/mock-factories';

// ─── 辅助：最小化 MealFromPoolRequest ───

function makeMinimalRequest(overrides?: Record<string, any>) {
  const food = createMockFoodLibrary();
  return {
    allFoods: [food],
    mealType: 'lunch',
    goalType: 'fat_loss',
    target: { calories: 500, protein: 30, fat: 15, carbs: 60 },
    consumed: { calories: 0, protein: 0 },
    dailyTarget: { calories: 2000, protein: 120 },
    excludeNames: [],
    userId: 'user-001',
    ...overrides,
  } as any;
}

function makeMinimalParams(overrides?: Record<string, any>) {
  return {
    constraints: {
      excludeTags: [],
      maxCalories: 700,
      minProtein: 20,
    } as any,
    picks: [],
    usedNames: new Set<string>(),
    ...overrides,
  };
}

// ─── Test Suite ───

describe('PipelineContextFactory', () => {
  let factory: PipelineContextFactory;
  let mockScoringConfig: ReturnType<typeof createMockScoringConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockScoringConfig = createMockScoringConfigService();
    factory = new PipelineContextFactory(mockScoringConfig as any);
  });

  // ════════════════════════════════════════════════════════════
  // 1. 核心字段映射
  // ════════════════════════════════════════════════════════════

  describe('核心字段映射', () => {
    it('should map allFoods, mealType, goalType, target from request', () => {
      const req = makeMinimalRequest();
      const ctx = factory.build(req, makeMinimalParams());

      expect(ctx.allFoods).toBe(req.allFoods);
      expect(ctx.mealType).toBe('lunch');
      expect(ctx.goalType).toBe('fat_loss');
      expect(ctx.target).toBe(req.target);
    });

    it('should map constraints from params', () => {
      const constraints = {
        excludeTags: ['fried'],
        maxCalories: 600,
        minProtein: 25,
      } as any;
      const ctx = factory.build(
        makeMinimalRequest(),
        makeMinimalParams({ constraints }),
      );

      expect(ctx.constraints).toBe(constraints);
    });

    it('should map picks from params', () => {
      const food = createMockFoodLibrary({ id: 'f1' });
      const picks = [
        {
          food,
          score: 0.9,
          servingCalories: 200,
          servingProtein: 25,
          servingFat: 8,
          servingCarbs: 20,
          servingFiber: 2,
          servingGL: 5,
        },
      ];
      const ctx = factory.build(
        makeMinimalRequest(),
        makeMinimalParams({ picks }),
      );

      expect(ctx.picks).toBe(picks);
    });

    it('should map usedNames from params', () => {
      const usedNames = new Set(['鸡胸肉', '白米饭']);
      const ctx = factory.build(
        makeMinimalRequest(),
        makeMinimalParams({ usedNames }),
      );

      expect(ctx.usedNames).toBe(usedNames);
    });

    it('should map userId from request', () => {
      const ctx = factory.build(
        makeMinimalRequest({ userId: 'user-xyz' }),
        makeMinimalParams(),
      );

      expect(ctx.userId).toBe('user-xyz');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. 偏好/画像字段映射
  // ════════════════════════════════════════════════════════════

  describe('偏好/画像字段映射', () => {
    it('should map userPreferences from request', () => {
      const prefs = { loves: ['鸡肉'], avoids: ['辣椒'] };
      const ctx = factory.build(
        makeMinimalRequest({ userPreferences: prefs }),
        makeMinimalParams(),
      );

      expect(ctx.userPreferences).toBe(prefs);
    });

    it('should map userProfile from request', () => {
      const profile = { allergens: ['dairy'], budgetLevel: 'medium' };
      const ctx = factory.build(
        makeMinimalRequest({ userProfile: profile }),
        makeMinimalParams(),
      );

      expect(ctx.userProfile).toBe(profile);
    });

    it('should map preferenceProfile from request', () => {
      const prefProfile = {
        categoryWeights: { protein: 1.2 },
        ingredientWeights: {},
        foodGroupWeights: {},
        foodNameWeights: {},
      };
      const ctx = factory.build(
        makeMinimalRequest({ preferenceProfile: prefProfile }),
        makeMinimalParams(),
      );

      expect(ctx.preferenceProfile).toBe(prefProfile);
    });

    it('should map regionalBoostMap from request', () => {
      const boostMap = { 上海: 1.1, 北京: 1.0 };
      const ctx = factory.build(
        makeMinimalRequest({ regionalBoostMap: boostMap }),
        makeMinimalParams(),
      );

      expect(ctx.regionalBoostMap).toBe(boostMap);
    });

    it('should map resolvedStrategy from request', () => {
      const strategy = {
        strategyId: 's1',
        strategyName: 'Default',
        sources: [],
        config: {},
        resolvedAt: Date.now(),
      };
      const ctx = factory.build(
        makeMinimalRequest({ resolvedStrategy: strategy }),
        makeMinimalParams(),
      );

      expect(ctx.resolvedStrategy).toBe(strategy);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. crossMealAdjustment 优先级：params > req
  // ════════════════════════════════════════════════════════════

  describe('crossMealAdjustment 优先级', () => {
    it('should prefer params.crossMealAdjustment over req.crossMealAdjustment', () => {
      const reqAdj = { calorieDelta: 100, proteinDelta: 5 } as any;
      const paramsAdj = { calorieDelta: 200, proteinDelta: 10 } as any;

      const ctx = factory.build(
        makeMinimalRequest({ crossMealAdjustment: reqAdj }),
        makeMinimalParams({ crossMealAdjustment: paramsAdj }),
      );

      expect(ctx.crossMealAdjustment).toBe(paramsAdj);
    });

    it('should fall back to req.crossMealAdjustment when params has none', () => {
      const reqAdj = { calorieDelta: 100, proteinDelta: 5 } as any;

      const ctx = factory.build(
        makeMinimalRequest({ crossMealAdjustment: reqAdj }),
        makeMinimalParams(),
      );

      expect(ctx.crossMealAdjustment).toBe(reqAdj);
    });

    it('should be undefined when neither req nor params provide it', () => {
      const ctx = factory.build(makeMinimalRequest(), makeMinimalParams());

      expect(ctx.crossMealAdjustment).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. tuning 由 ScoringConfigService 提供
  // ════════════════════════════════════════════════════════════

  describe('tuning 注入', () => {
    it('should call scoringConfigService.getTuning() and assign result', () => {
      factory.build(makeMinimalRequest(), makeMinimalParams());

      expect(mockScoringConfig.getTuning).toHaveBeenCalledTimes(1);
    });

    it('should assign tuning result to context', () => {
      const fakeTuning = {
        baseExplorationRate: 0.2,
        optimizerCandidateLimit: 10,
      } as any;
      mockScoringConfig.getTuning.mockReturnValue(fakeTuning);

      const ctx = factory.build(makeMinimalRequest(), makeMinimalParams());

      expect(ctx.tuning).toBe(fakeTuning);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. replacementWeightMap 映射
  // ════════════════════════════════════════════════════════════

  describe('replacementWeightMap 映射', () => {
    it('should map replacementWeightMap from params', () => {
      const map = new Map([['food-001', 1.2]]);
      const ctx = factory.build(
        makeMinimalRequest(),
        makeMinimalParams({ replacementWeightMap: map }),
      );

      expect(ctx.replacementWeightMap).toBe(map);
    });

    it('should accept null replacementWeightMap', () => {
      const ctx = factory.build(
        makeMinimalRequest(),
        makeMinimalParams({ replacementWeightMap: null }),
      );

      expect(ctx.replacementWeightMap).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. 场景/渠道字段映射
  // ════════════════════════════════════════════════════════════

  describe('场景/渠道字段映射', () => {
    it('should map channel and sceneContext from request', () => {
      const channel = 'delivery' as any;
      const sceneContext = {
        channel,
        sceneType: 'eating_out',
        realismLevel: 'relaxed',
        confidence: 1.0,
        source: 'rule_inferred',
        sceneConstraints: {},
      } as any;

      const ctx = factory.build(
        makeMinimalRequest({ channel, sceneContext }),
        makeMinimalParams(),
      );

      expect(ctx.channel).toBe(channel);
      expect(ctx.sceneContext).toBe(sceneContext);
    });

    it('should map shortTermProfile and contextualProfile from request', () => {
      const shortTermProfile = { rejectedFoods: { 炸鸡: 3 } } as any;
      const contextualProfile = {
        dayType: 'weekday',
        timeOfDay: 'morning',
      } as any;

      const ctx = factory.build(
        makeMinimalRequest({ shortTermProfile, contextualProfile }),
        makeMinimalParams(),
      );

      expect(ctx.shortTermProfile).toBe(shortTermProfile);
      expect(ctx.contextualProfile).toBe(contextualProfile);
    });
  });
});
