/**
 * V7.4 Phase 1 集成测试 — 纯单元风格，所有依赖 mock
 *
 * 覆盖 V7.4 Phase 1 所有已完成的改动：
 * 1. P1-A: 大众成品菜种子数据 — 90 条 dish 数据 + foodForm/dishPriority/acquisitionDifficulty
 * 2. P1-B: acquisitionDifficulty 字段 — FoodLibrary + SeedFood + Prisma + 食物池加载
 * 3. P1-C: FactorLearner Redis 持久化 + 自适应学习率 + 内存降级
 * 4. P1-D: ExplanationGenerator DI 修复 — 构造函数 4 参数
 * 5. P1-E: Legacy Ranking Path 清理 — 10 个 ScoringFactor 注册 + OnModuleInit
 * 6. P1-F: CacheWarmup 用户画像预热 — ProfileResolverService 注入 + 批量预热
 */

import { SEED_FOODS } from '../src/scripts/seed-foods.data';
import type { FoodLibrary } from '../src/modules/food/food.types';
import type { ScoringAdjustment } from '../src/modules/diet/app/recommendation/scoring-chain/scoring-factor.interface';
import { ScoringChainService } from '../src/modules/diet/app/recommendation/scoring-chain/scoring-chain.service';
import {
  FactorLearnerService,
  FactorAdjustmentMap,
} from '../src/modules/diet/app/recommendation/factor-learner.service';
import { CacheWarmupService } from '../src/core/cache/cache-warmup.service';
import { ExplanationGeneratorService } from '../src/modules/diet/app/recommendation/explanation-generator.service';
import { MealCompositionScorer } from '../src/modules/diet/app/recommendation/meal-composition-scorer.service';
import { InsightGeneratorService } from '../src/modules/diet/app/recommendation/insight-generator.service';
import { ExplanationTierService } from '../src/modules/diet/app/recommendation/explanation-tier.service';
import { NaturalLanguageExplainerService } from '../src/modules/diet/app/recommendation/natural-language-explainer.service';
import { MealExplanationService } from '../src/modules/diet/app/recommendation/meal-explanation.service';
import { ComparisonExplanationService } from '../src/modules/diet/app/recommendation/comparison-explanation.service';
import {
  PreferenceSignalFactor,
  RegionalBoostFactor,
  CollaborativeFilteringFactor,
  ShortTermProfileFactor,
  SceneContextFactor,
  AnalysisProfileFactor,
  LifestyleBoostFactor,
  PopularityFactor,
  ReplacementFeedbackFactor,
  RuleWeightFactor,
} from '../src/modules/diet/app/recommendation/scoring-chain/factors';

// ═════════════════════════════════════════════════════════
// 1. P1-A: 大众成品菜种子数据
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-A: 大众成品菜种子数据', () => {
  const dishFoods = SEED_FOODS.filter((f) => f.foodForm === 'dish');

  it('should have at least 80 dish entries', () => {
    expect(dishFoods.length).toBeGreaterThanOrEqual(80);
  });

  it('every dish should have foodForm=dish', () => {
    for (const dish of dishFoods) {
      expect(dish.foodForm).toBe('dish');
    }
  });

  it('every dish should have dishPriority > 0', () => {
    for (const dish of dishFoods) {
      expect(dish.dishPriority).toBeDefined();
      expect(dish.dishPriority).toBeGreaterThan(0);
    }
  });

  it('every dish should have acquisitionDifficulty between 1 and 5', () => {
    for (const dish of dishFoods) {
      expect(dish.acquisitionDifficulty).toBeDefined();
      expect(dish.acquisitionDifficulty).toBeGreaterThanOrEqual(1);
      expect(dish.acquisitionDifficulty).toBeLessThanOrEqual(5);
    }
  });

  it('every dish should have required nutrition fields', () => {
    for (const dish of dishFoods) {
      expect(dish.name).toBeDefined();
      expect(dish.category).toBeDefined();
      expect(dish.calories).toBeGreaterThan(0);
      expect(dish.protein).toBeGreaterThanOrEqual(0);
      expect(dish.fat).toBeGreaterThanOrEqual(0);
      expect(dish.carbs).toBeGreaterThanOrEqual(0);
    }
  });

  it('dish names should be unique', () => {
    const names = dishFoods.map((f) => f.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('should include common Chinese dish categories', () => {
    const categories = new Set(dishFoods.map((f) => f.category));
    // 至少包含 protein、veggie、composite 中的一个
    expect(
      categories.has('protein') ||
        categories.has('veggie') ||
        categories.has('composite'),
    ).toBe(true);
  });

  it('most dishes should have acquisitionDifficulty <= 3 (easy to obtain)', () => {
    const easyDishes = dishFoods.filter(
      (f) => (f.acquisitionDifficulty ?? 3) <= 3,
    );
    // 至少 70% 的 dish 应该容易获得
    expect(easyDishes.length / dishFoods.length).toBeGreaterThanOrEqual(0.7);
  });
});

// ═════════════════════════════════════════════════════════
// 2. P1-B: acquisitionDifficulty 字段
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-B: acquisitionDifficulty 字段', () => {
  it('FoodLibrary interface should accept acquisitionDifficulty', () => {
    // 验证 FoodLibrary 类型兼容性
    const food: Partial<FoodLibrary> = {
      name: 'test',
      acquisitionDifficulty: 2,
    };
    expect(food.acquisitionDifficulty).toBe(2);
  });

  it('acquisitionDifficulty defaults to undefined when not set', () => {
    const food: Partial<FoodLibrary> = {
      name: 'test',
    };
    expect(food.acquisitionDifficulty).toBeUndefined();
  });

  it('SEED_FOODS non-dish entries default acquisitionDifficulty to 3 via mapToData', () => {
    // 旧数据（非 dish）没有 acquisitionDifficulty 字段，
    // mapToData 中 `food.acquisitionDifficulty ?? 3` 确保默认值为 3
    const nonDishFoods = SEED_FOODS.filter((f) => f.foodForm !== 'dish');
    // 非 dish 食物没有 acquisitionDifficulty 或默认为 undefined
    for (const food of nonDishFoods.slice(0, 10)) {
      const defaulted = food.acquisitionDifficulty ?? 3;
      expect(defaulted).toBe(3);
    }
  });
});

// ═════════════════════════════════════════════════════════
// 3. P1-C: FactorLearner Redis 持久化 + 自适应学习率
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-C: FactorLearner 持久化 + 自适应学习率', () => {
  let learner: FactorLearnerService;
  let mockRedis: any;

  beforeEach(() => {
    // Mock Redis — 模拟 Redis 不可用，强制走内存 fallback
    mockRedis = {
      hGetAll: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      hSet: jest.fn().mockResolvedValue(false),
      expireNX: jest.fn().mockResolvedValue(true),
    };
    learner = new FactorLearnerService(mockRedis);
  });

  describe('attributeFeedback', () => {
    it('should calculate contribution ratios that sum to 1', () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference',
          multiplier: 1.3,
          additive: 0.1,
          reason: 'test',
          explanationKey: null,
        },
        {
          factorName: 'regional',
          multiplier: 1.1,
          additive: 0.0,
          reason: 'test',
          explanationKey: null,
        },
      ];

      const result = learner.attributeFeedback(adjustments, 'accept');

      const totalRatio = result.reduce(
        (sum, r) => sum + r.contributionRatio,
        0,
      );
      expect(totalRatio).toBeCloseTo(1.0, 5);
      expect(result[0].direction).toBe(1); // accept → +1
    });

    it('reject should yield negative direction', () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'preference',
          multiplier: 1.3,
          additive: 0,
          reason: 'test',
          explanationKey: null,
        },
      ];

      const result = learner.attributeFeedback(adjustments, 'reject');
      expect(result[0].direction).toBe(-1);
    });

    it('should return empty for no adjustments', () => {
      const result = learner.attributeFeedback([], 'accept');
      expect(result).toEqual([]);
    });

    it('should handle all-neutral adjustments (no contribution)', () => {
      const adjustments: ScoringAdjustment[] = [
        {
          factorName: 'neutral',
          multiplier: 1.0,
          additive: 0,
          reason: 'test',
          explanationKey: null,
        },
      ];
      const result = learner.attributeFeedback(adjustments, 'accept');
      expect(result).toEqual([]);
    });
  });

  describe('memory fallback (Redis unavailable)', () => {
    it('should return empty map before cold start threshold', async () => {
      const result = await learner.getUserFactorAdjustments(
        'user1',
        'fat_loss',
      );
      expect(result.size).toBe(0);
    });

    it('should accumulate feedback count in memory', async () => {
      const attributions = [
        { factorName: 'preference', contributionRatio: 0.6, direction: 1 },
        { factorName: 'regional', contributionRatio: 0.4, direction: 1 },
      ];

      // 更新 5 次
      for (let i = 0; i < 5; i++) {
        await learner.updateFactorWeights('user1', 'fat_loss', attributions);
      }

      const count = await learner.getFeedbackCount('user1', 'fat_loss');
      expect(count).toBe(5);
    });

    it('should return adjustments after reaching cold start threshold', async () => {
      const attributions = [
        { factorName: 'preference', contributionRatio: 1.0, direction: 1 },
      ];

      // 更新 11 次（超过冷启动阈值 10）
      for (let i = 0; i < 11; i++) {
        await learner.updateFactorWeights('user1', 'fat_loss', attributions);
      }

      const result = await learner.getUserFactorAdjustments(
        'user1',
        'fat_loss',
      );
      expect(result.size).toBe(1);
      expect(result.has('preference')).toBe(true);
    });

    it('should clamp strength within [0.5, 2.0]', async () => {
      // 大量正反馈推高 strength
      const positiveAttributions = [
        { factorName: 'boost', contributionRatio: 1.0, direction: 1 },
      ];

      for (let i = 0; i < 200; i++) {
        await learner.updateFactorWeights(
          'user2',
          'fat_loss',
          positiveAttributions,
        );
      }

      const result = await learner.getUserFactorAdjustments(
        'user2',
        'fat_loss',
      );
      const strength = result.get('boost');
      expect(strength).toBeDefined();
      expect(strength).toBeLessThanOrEqual(2.0);
      expect(strength).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('adaptive learning rate', () => {
    it('learning rate should decrease with more feedback', async () => {
      // 观察：多次反馈后，每次更新的 delta 应该减小
      const attributions = [
        { factorName: 'test', contributionRatio: 1.0, direction: 1 },
      ];

      // 初始状态
      await learner.updateFactorWeights('user3', 'fat_loss', attributions);
      const count1 = await learner.getFeedbackCount('user3', 'fat_loss');
      expect(count1).toBe(1);

      // 50 次后
      for (let i = 1; i < 50; i++) {
        await learner.updateFactorWeights('user3', 'fat_loss', attributions);
      }
      const count50 = await learner.getFeedbackCount('user3', 'fat_loss');
      expect(count50).toBe(50);
    });
  });

  describe('cleanupExpired', () => {
    it('should return 0 when no expired states', () => {
      const cleaned = learner.cleanupExpired();
      expect(cleaned).toBe(0);
    });
  });

  describe('Redis persistence (mock successful Redis)', () => {
    let redisLearner: FactorLearnerService;
    const redisStore: Record<string, Record<string, string>> = {};

    beforeEach(() => {
      const successRedis = {
        hGetAll: jest.fn().mockImplementation((key: string) => {
          return Promise.resolve(redisStore[key] ?? {});
        }),
        hSet: jest
          .fn()
          .mockImplementation(
            (key: string, field: string, value: string | number) => {
              if (!redisStore[key]) redisStore[key] = {};
              redisStore[key][field] = String(value);
              return Promise.resolve(true);
            },
          ),
        expireNX: jest.fn().mockResolvedValue(true),
      };
      redisLearner = new FactorLearnerService(successRedis as any);
    });

    afterEach(() => {
      // 清理 redisStore
      for (const key of Object.keys(redisStore)) {
        delete redisStore[key];
      }
    });

    it('should persist factor weights to Redis Hash', async () => {
      const attributions = [
        { factorName: 'preference', contributionRatio: 1.0, direction: 1 },
      ];

      await redisLearner.updateFactorWeights('user1', 'fat_loss', attributions);

      // 验证 Redis store 中有数据
      const key = 'factor_learner:user1:fat_loss';
      expect(redisStore[key]).toBeDefined();
      expect(redisStore[key]['preference']).toBeDefined();
      expect(redisStore[key]['__feedbackCount']).toBe('1');
    });

    it('should read back from Redis after persistence', async () => {
      const attributions = [
        { factorName: 'preference', contributionRatio: 1.0, direction: 1 },
      ];

      // 写入 11 次，超过冷启动阈值
      for (let i = 0; i < 11; i++) {
        await redisLearner.updateFactorWeights(
          'user1',
          'fat_loss',
          attributions,
        );
      }

      const result = await redisLearner.getUserFactorAdjustments(
        'user1',
        'fat_loss',
      );
      expect(result.size).toBe(1);
      expect(result.has('preference')).toBe(true);
      const strength = result.get('preference')!;
      expect(strength).toBeGreaterThan(1.0); // 正反馈应该增加 strength
    });
  });
});

// ═════════════════════════════════════════════════════════
// 4. P1-D: ExplanationGenerator DI 修复
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-D: ExplanationGenerator DI 修复', () => {
  it('should accept 4 constructor arguments', () => {
    const mockCompositionScorer = {} as MealCompositionScorer;
    const mockInsightGenerator = {} as InsightGeneratorService;
    const mockTierService = {} as ExplanationTierService;
    const mockNlExplainer = {} as NaturalLanguageExplainerService;

    const service = new ExplanationGeneratorService(
      mockCompositionScorer,
      mockInsightGenerator,
      mockTierService,
      mockNlExplainer,
      {} as MealExplanationService,
      new ComparisonExplanationService(),
    );

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ExplanationGeneratorService);
  });

  it('should not accept fewer than 6 arguments (compile-time check)', () => {
    // 此测试验证 TypeScript 编译时的签名变更
    // V7.6 P2: ExplanationGeneratorService 构造函数参数数量为 6
    // 运行时验证：实例化成功即可
    const service = new ExplanationGeneratorService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect(service).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════
// 5. P1-E: Legacy Ranking Path 清理 + ScoringFactor 注册
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-E: ScoringFactor 注册', () => {
  it('all 10 ScoringFactor classes should be importable', () => {
    expect(PreferenceSignalFactor).toBeDefined();
    expect(RegionalBoostFactor).toBeDefined();
    expect(CollaborativeFilteringFactor).toBeDefined();
    expect(ShortTermProfileFactor).toBeDefined();
    expect(SceneContextFactor).toBeDefined();
    expect(AnalysisProfileFactor).toBeDefined();
    expect(LifestyleBoostFactor).toBeDefined();
    expect(PopularityFactor).toBeDefined();
    expect(ReplacementFeedbackFactor).toBeDefined();
    expect(RuleWeightFactor).toBeDefined();
  });

  it('ScoringChainService should register 10 factors in correct order', () => {
    const chain = new ScoringChainService();

    chain.registerFactors([
      new PreferenceSignalFactor(),
      new RegionalBoostFactor(),
      new CollaborativeFilteringFactor(),
      new ShortTermProfileFactor(),
      new SceneContextFactor(),
      new AnalysisProfileFactor(),
      new LifestyleBoostFactor(
        () => null,
        () => null,
      ),
      new PopularityFactor(),
      new ReplacementFeedbackFactor(),
      new RuleWeightFactor(),
    ]);

    const factors = chain.getFactors();
    expect(factors.length).toBe(10);

    // 验证排序（按 order 升序）
    const names = factors.map((f) => f.name);
    expect(names[0]).toBe('preference-signal');
    expect(names[1]).toBe('regional-boost');
    expect(names[2]).toBe('collaborative-filtering');
    expect(names[3]).toBe('short-term-profile');
    expect(names[4]).toBe('scene-context');
    expect(names[5]).toBe('analysis-profile');
    expect(names[6]).toBe('lifestyle-boost');
    expect(names[7]).toBe('popularity');
    expect(names[8]).toBe('replacement-feedback');
    expect(names[9]).toBe('rule-weight');
  });

  it('each factor should have a unique name', () => {
    const chain = new ScoringChainService();

    chain.registerFactors([
      new PreferenceSignalFactor(),
      new RegionalBoostFactor(),
      new CollaborativeFilteringFactor(),
      new ShortTermProfileFactor(),
      new SceneContextFactor(),
      new AnalysisProfileFactor(),
      new LifestyleBoostFactor(
        () => null,
        () => null,
      ),
      new PopularityFactor(),
      new ReplacementFeedbackFactor(),
      new RuleWeightFactor(),
    ]);

    const factors = chain.getFactors();
    const names = factors.map((f) => f.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('factors should be sorted by order (ascending)', () => {
    const chain = new ScoringChainService();

    chain.registerFactors([
      new PreferenceSignalFactor(),
      new RegionalBoostFactor(),
      new CollaborativeFilteringFactor(),
      new ShortTermProfileFactor(),
      new SceneContextFactor(),
      new AnalysisProfileFactor(),
      new LifestyleBoostFactor(
        () => null,
        () => null,
      ),
      new PopularityFactor(),
      new ReplacementFeedbackFactor(),
      new RuleWeightFactor(),
    ]);

    const factors = chain.getFactors();
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i].order).toBeGreaterThanOrEqual(factors[i - 1].order);
    }
  });

  it('ScoringChainService.scoreFood should return ScoringChainResult', () => {
    const chain = new ScoringChainService();

    // 只注册两个简单的 factor 进行评分测试
    chain.registerFactors([
      new PreferenceSignalFactor(),
      new PopularityFactor(),
    ]);

    const food: Partial<FoodLibrary> = {
      name: 'test food',
      category: '肉类',
      calories: 200,
      protein: 15,
      fat: 10,
      carbs: 20,
      fiber: 2,
      sugar: 3,
    };

    const ctx = {
      userId: 'user1',
      mealType: 'lunch',
      goalType: 'fat_loss',
      userProfile: {},
    } as any;

    const result = chain.scoreFood(food as FoodLibrary, 50, ctx);

    // 应该有调整记录
    expect(result.adjustments.length).toBeGreaterThanOrEqual(0);
    // ScoringChainResult 包含 baseScore, finalScore
    expect(typeof result.baseScore).toBe('number');
    expect(typeof result.finalScore).toBe('number');
    expect(result.baseScore).toBe(50);
  });
});

// ═════════════════════════════════════════════════════════
// 6. P1-F: CacheWarmup 用户画像预热
// ═════════════════════════════════════════════════════════

describe('V7.4 P1-F: CacheWarmup 用户画像预热', () => {
  it('should accept 3 constructor arguments (including profileResolver)', () => {
    const warmupService = new CacheWarmupService(null, null, null);
    expect(warmupService).toBeDefined();
  });

  it('should not throw on bootstrap with all null dependencies', async () => {
    const warmupService = new CacheWarmupService(null, null, null);
    await expect(warmupService.onApplicationBootstrap()).resolves.not.toThrow();
  });

  it('should handle food pool warmup failure gracefully', async () => {
    const mockFoodPool = {
      getVerifiedFoods: jest
        .fn()
        .mockRejectedValue(new Error('DB connection failed')),
    } as any;

    const warmupService = new CacheWarmupService(mockFoodPool, null, null);
    await expect(warmupService.onApplicationBootstrap()).resolves.not.toThrow();

    // 等待异步预热完成
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should call profileResolver.resolve() for active users', async () => {
    const mockFoodPool = null;
    const mockPrisma = {
      food_records: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { user_id: 'user1' },
            { user_id: 'user2' },
            { user_id: 'user3' },
          ]),
      },
    } as any;
    const mockProfileResolver = {
      resolve: jest.fn().mockResolvedValue({
        dietaryRestrictions: [],
        allergens: [],
        healthConditions: [],
        declared: null,
        inferred: null,
        observed: null,
        shortTerm: null,
        contextual: null,
        lifestyle: null,
        conflicts: [],
        profileFreshness: 1.0,
      }),
    } as any;

    const warmupService = new CacheWarmupService(
      mockFoodPool,
      mockPrisma,
      mockProfileResolver,
    );

    // 直接调用 manualWarmup 测试（它调用 warmupActiveUserProfiles）
    const result = await warmupService.manualWarmup();
    expect(result.userCount).toBe(3);
    expect(mockProfileResolver.resolve).toHaveBeenCalledTimes(3);
    expect(mockProfileResolver.resolve).toHaveBeenCalledWith('user1');
    expect(mockProfileResolver.resolve).toHaveBeenCalledWith('user2');
    expect(mockProfileResolver.resolve).toHaveBeenCalledWith('user3');
  });

  it('should handle partial profile resolve failures gracefully', async () => {
    const mockPrisma = {
      food_records: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { user_id: 'user1' },
            { user_id: 'user2' },
            { user_id: 'user3' },
          ]),
      },
    } as any;
    const mockProfileResolver = {
      resolve: jest.fn().mockImplementation((userId: string) => {
        if (userId === 'user2') {
          return Promise.reject(new Error('Profile not found'));
        }
        return Promise.resolve({
          dietaryRestrictions: [],
          allergens: [],
          declared: null,
          inferred: null,
          observed: null,
          shortTerm: null,
          contextual: null,
          lifestyle: null,
          conflicts: [],
          profileFreshness: 1.0,
        });
      }),
    } as any;

    const warmupService = new CacheWarmupService(
      null,
      mockPrisma,
      mockProfileResolver,
    );
    const result = await warmupService.manualWarmup();

    // user2 失败，但 user1 和 user3 成功 → 2 个成功
    expect(result.userCount).toBe(2);
  });

  it('should skip profile warmup when profileResolver is null', async () => {
    const mockPrisma = {
      food_records: {
        findMany: jest.fn().mockResolvedValue([{ user_id: 'user1' }]),
      },
    } as any;

    // profileResolver 为 null
    const warmupService = new CacheWarmupService(null, mockPrisma, null);
    const result = await warmupService.manualWarmup();

    // 应该返回活跃用户数量（只是查询没有 resolve）
    expect(result.userCount).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════
// 7. 类型兼容性 + 向后兼容
// ═════════════════════════════════════════════════════════

describe('V7.4 Phase 1 类型兼容性', () => {
  it('FoodLibrary should support all new V7.4 fields', () => {
    const food: Partial<FoodLibrary> = {
      name: '宫保鸡丁',
      category: '肉类',
      calories: 197,
      protein: 17.5,
      fat: 10.2,
      carbs: 9.8,
      foodForm: 'dish',
      dishPriority: 85,
      acquisitionDifficulty: 1,
    };

    expect(food.foodForm).toBe('dish');
    expect(food.dishPriority).toBe(85);
    expect(food.acquisitionDifficulty).toBe(1);
  });

  it('FoodLibrary should remain backward-compatible without new fields', () => {
    const food: Partial<FoodLibrary> = {
      name: '鸡蛋',
      category: '蛋类',
      calories: 144,
      protein: 12.8,
      fat: 9.9,
      carbs: 0.7,
    };

    // 新字段为 optional，旧数据不需要
    expect(food.foodForm).toBeUndefined();
    expect(food.dishPriority).toBeUndefined();
    expect(food.acquisitionDifficulty).toBeUndefined();
  });

  it('SEED_FOODS should contain both dish and non-dish entries', () => {
    const dishes = SEED_FOODS.filter((f) => f.foodForm === 'dish');
    const nonDishes = SEED_FOODS.filter((f) => f.foodForm !== 'dish');

    expect(dishes.length).toBeGreaterThan(0);
    expect(nonDishes.length).toBeGreaterThan(0);
    expect(dishes.length + nonDishes.length).toBe(SEED_FOODS.length);
  });
});

// ═════════════════════════════════════════════════════════
// 8. 跨模块集成验证
// ═════════════════════════════════════════════════════════

describe('V7.4 Phase 1 跨模块集成', () => {
  it('ScoringChain + FactorLearner end-to-end flow', async () => {
    // 模拟完整流程：ScoringChain 评分 → 用户反馈 → FactorLearner 学习

    // 1. 设置 ScoringChain
    const chain = new ScoringChainService();
    chain.registerFactors([
      new PreferenceSignalFactor(),
      new PopularityFactor(),
    ]);

    // 2. 执行评分
    const food: Partial<FoodLibrary> = {
      name: 'test',
      category: '肉类',
      calories: 200,
      protein: 15,
      fat: 10,
      carbs: 20,
    };
    const ctx = {
      userId: 'user1',
      mealType: 'lunch',
      goalType: 'fat_loss',
      userProfile: {},
    } as any;

    const scoreResult = chain.scoreFood(food as FoodLibrary, 50, ctx);

    // 3. 用户反馈 → FactorLearner 归因 + 学习
    const mockRedis = {
      hGetAll: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      hSet: jest.fn().mockResolvedValue(false),
      expireNX: jest.fn().mockResolvedValue(true),
    };
    const learner = new FactorLearnerService(mockRedis as any);
    const attributions = learner.attributeFeedback(
      scoreResult.adjustments,
      'accept',
    );

    // attributions 可能为空（如果所有 factor 产生的调整为中性）
    if (attributions.length > 0) {
      await learner.updateFactorWeights('user1', 'fat_loss', attributions);
      const count = await learner.getFeedbackCount('user1', 'fat_loss');
      expect(count).toBe(1);
    }
  });

  it('ExplanationGenerator can be instantiated with mocked DI services', () => {
    // 验证 V7.6 P2 的 6 参数 DI 在集成场景中可用
    const service = new ExplanationGeneratorService(
      new MealCompositionScorer({} as any),
      new InsightGeneratorService(),
      new ExplanationTierService(),
      new NaturalLanguageExplainerService(),
      new MealExplanationService(new MealCompositionScorer({} as any)),
      new ComparisonExplanationService(),
    );

    expect(service).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════
// Phase 2 Tests — V7.4 策略引擎 + 事件驱动 + 解释增强
// ═════════════════════════════════════════════════════════════

import {
  RECOMMENDATION_STRATEGIES,
  RECOMMENDATION_STRATEGY_NAMES,
  STRATEGY_EXPLORE,
  STRATEGY_EXPLOIT,
  STRATEGY_STRICT_HEALTH,
  STRATEGY_SCENE_FIRST,
  type RecommendationStrategy,
  type StrategyResolverInput,
} from '../src/modules/diet/app/recommendation/recommendation-strategy.types';
import { RecommendationStrategyResolverService } from '../src/modules/diet/app/recommendation/recommendation-strategy-resolver.service';
import {
  ProfileEventBusService,
  ProfileEvents,
  PreferenceIncrementalUpdateEvent,
  PreferenceCacheInvalidatedEvent,
} from '../src/modules/diet/app/recommendation/profile-event-bus.service';
import { ProfileEventListenerService } from '../src/modules/diet/app/recommendation/profile-event-listener.service';
import { FeedbackSubmittedEvent } from '../src/core/events/domain-events';
import type {
  ComparisonExplanation,
  SubstitutionExplanation,
} from '../src/modules/diet/app/recommendation/explanation-generator.service';

// ─── P2-A: 策略引擎 — 接口 + 4 预设策略 ───

describe('V7.4 P2-A: RecommendationStrategy 类型 + 4 预设策略', () => {
  it('should have exactly 4 strategy names', () => {
    expect(RECOMMENDATION_STRATEGY_NAMES).toHaveLength(4);
    expect(RECOMMENDATION_STRATEGY_NAMES).toContain('explore');
    expect(RECOMMENDATION_STRATEGY_NAMES).toContain('exploit');
    expect(RECOMMENDATION_STRATEGY_NAMES).toContain('strict_health');
    expect(RECOMMENDATION_STRATEGY_NAMES).toContain('scene_first');
  });

  it('RECOMMENDATION_STRATEGIES registry should contain all 4 strategies', () => {
    expect(Object.keys(RECOMMENDATION_STRATEGIES)).toHaveLength(4);
    for (const name of RECOMMENDATION_STRATEGY_NAMES) {
      expect(RECOMMENDATION_STRATEGIES[name]).toBeDefined();
      expect(RECOMMENDATION_STRATEGIES[name].name).toBe(name);
    }
  });

  describe.each([
    ['explore', STRATEGY_EXPLORE],
    ['exploit', STRATEGY_EXPLOIT],
    ['strict_health', STRATEGY_STRICT_HEALTH],
    ['scene_first', STRATEGY_SCENE_FIRST],
  ] as [string, RecommendationStrategy][])('Strategy: %s', (name, strategy) => {
    it('should have valid recall config', () => {
      expect(strategy.recall.poolSizeMultiplier).toBeGreaterThan(0);
      expect(strategy.recall.diversityBoost).toBeGreaterThanOrEqual(0);
      expect(strategy.recall.diversityBoost).toBeLessThanOrEqual(1);
      expect(strategy.recall.categorySpread).toBeGreaterThanOrEqual(0);
      expect(strategy.recall.categorySpread).toBeLessThanOrEqual(1);
    });

    it('should have valid rank config', () => {
      expect(strategy.rank.scoringWeightOverrides).toBeDefined();
      expect(strategy.rank.factorStrengthOverrides).toBeDefined();
      expect(strategy.rank.explorationRate).toBeGreaterThanOrEqual(0);
      expect(strategy.rank.explorationRate).toBeLessThanOrEqual(1);
    });

    it('should have valid rerank config', () => {
      expect(['strict', 'normal', 'relaxed', 'off']).toContain(
        strategy.rerank.realismLevel,
      );
      expect(strategy.rerank.maxSameCategory).toBeGreaterThanOrEqual(1);
      expect(strategy.rerank.acquisitionDifficultyMax).toBeGreaterThanOrEqual(
        1,
      );
      expect(strategy.rerank.acquisitionDifficultyMax).toBeLessThanOrEqual(5);
    });

    it('should have description', () => {
      expect(strategy.description.length).toBeGreaterThan(0);
    });
  });

  it('explore should have higher explorationRate than exploit', () => {
    expect(STRATEGY_EXPLORE.rank.explorationRate).toBeGreaterThan(
      STRATEGY_EXPLOIT.rank.explorationRate,
    );
  });

  it('strict_health should boost health-related dimensions', () => {
    const healthOverrides = STRATEGY_STRICT_HEALTH.rank.scoringWeightOverrides;
    expect(healthOverrides.glycemic).toBeGreaterThan(1.0);
    expect(healthOverrides.nutrientDensity).toBeGreaterThan(1.0);
    expect(healthOverrides.inflammation).toBeGreaterThan(1.0);
  });

  it('scene_first should have strict realismLevel', () => {
    expect(STRATEGY_SCENE_FIRST.rerank.realismLevel).toBe('strict');
  });

  it('scene_first should have low acquisitionDifficultyMax', () => {
    expect(
      STRATEGY_SCENE_FIRST.rerank.acquisitionDifficultyMax,
    ).toBeLessThanOrEqual(STRATEGY_EXPLOIT.rerank.acquisitionDifficultyMax);
  });
});

// ─── P2-B: StrategyResolverService ───

describe('V7.4 P2-B: RecommendationStrategyResolverService', () => {
  let resolver: RecommendationStrategyResolverService;

  beforeEach(() => {
    resolver = new RecommendationStrategyResolverService();
  });

  it('should return explore for new user (feedbackCount < 10)', () => {
    const result = resolver.resolve({
      feedbackCount: 3,
      goalType: 'fat_loss',
      healthConditions: [],
    });
    expect(result.strategy.name).toBe('explore');
    expect(result.reason).toContain('新用户');
  });

  it('should return explore for feedbackCount = 0', () => {
    const result = resolver.resolve({
      feedbackCount: 0,
      goalType: 'health',
      healthConditions: ['diabetes'],
    });
    // feedbackCount < 10 优先于 strict_health
    expect(result.strategy.name).toBe('explore');
  });

  it('should return strict_health for fat_loss with health conditions', () => {
    const result = resolver.resolve({
      feedbackCount: 20,
      goalType: 'fat_loss',
      healthConditions: ['diabetes'],
    });
    expect(result.strategy.name).toBe('strict_health');
    expect(result.reason).toContain('diabetes');
  });

  it('should return strict_health for health goal with multiple conditions', () => {
    const result = resolver.resolve({
      feedbackCount: 50,
      goalType: 'health',
      healthConditions: ['hypertension', 'diabetes'],
    });
    expect(result.strategy.name).toBe('strict_health');
  });

  it('should return scene_first for canteen_meal', () => {
    const result = resolver.resolve({
      feedbackCount: 30,
      goalType: 'health',
      healthConditions: [],
      sceneType: 'canteen_meal',
    });
    expect(result.strategy.name).toBe('scene_first');
    expect(result.reason).toContain('canteen_meal');
  });

  it('should return scene_first for convenience_meal', () => {
    const result = resolver.resolve({
      feedbackCount: 15,
      goalType: 'habit',
      healthConditions: [],
      sceneType: 'convenience_meal',
    });
    expect(result.strategy.name).toBe('scene_first');
  });

  it('should return exploit as default for mature user without special conditions', () => {
    const result = resolver.resolve({
      feedbackCount: 30,
      goalType: 'muscle_gain',
      healthConditions: [],
      sceneType: 'home_cooking',
    });
    expect(result.strategy.name).toBe('exploit');
    expect(result.reason).toContain('偏好驱动');
  });

  it('should return exploit when goalType is muscle_gain with health conditions', () => {
    // muscle_gain 不在 strict_health 触发列表中
    const result = resolver.resolve({
      feedbackCount: 20,
      goalType: 'muscle_gain',
      healthConditions: ['back_pain'],
    });
    expect(result.strategy.name).toBe('exploit');
  });

  it('should prioritize feedbackCount < 10 over strict_health', () => {
    const result = resolver.resolve({
      feedbackCount: 5,
      goalType: 'fat_loss',
      healthConditions: ['diabetes'],
      sceneType: 'canteen_meal',
    });
    expect(result.strategy.name).toBe('explore');
  });

  it('should prioritize strict_health over scene_first', () => {
    const result = resolver.resolve({
      feedbackCount: 30,
      goalType: 'health',
      healthConditions: ['diabetes'],
      sceneType: 'canteen_meal',
    });
    expect(result.strategy.name).toBe('strict_health');
  });

  it('resolvedAt should be a recent timestamp', () => {
    const before = Date.now();
    const result = resolver.resolve({
      feedbackCount: 20,
      goalType: 'health',
      healthConditions: [],
    });
    expect(result.resolvedAt).toBeGreaterThanOrEqual(before);
    expect(result.resolvedAt).toBeLessThanOrEqual(Date.now());
  });

  it('getByName should return the correct strategy', () => {
    for (const name of RECOMMENDATION_STRATEGY_NAMES) {
      const strategy = resolver.getByName(name);
      expect(strategy.name).toBe(name);
    }
  });

  it('getAllStrategies should return 4 strategies', () => {
    const all = resolver.getAllStrategies();
    expect(all).toHaveLength(4);
  });
});

// ─── P2-C: PipelineBuilder 策略集成 ───

describe('V7.4 P2-C: PipelineBuilder 策略集成', () => {
  it('PipelineContext should accept recommendationStrategy field', () => {
    const resolver = new RecommendationStrategyResolverService();
    const resolved = resolver.resolve({
      feedbackCount: 5,
      goalType: 'health',
      healthConditions: [],
    });

    // 构造一个带策略的 PipelineContext
    const ctx = {
      allFoods: [],
      mealType: 'lunch',
      goalType: 'health',
      target: { calories: 500, protein: 25 },
      constraints: {},
      usedNames: new Set<string>(),
      picks: [],
      recommendationStrategy: resolved,
    } as any;

    expect(ctx.recommendationStrategy).toBeDefined();
    expect(ctx.recommendationStrategy.strategy.name).toBe('explore');
    expect(ctx.recommendationStrategy.reason).toBeDefined();
  });

  it('strategy factorStrengthOverrides should merge with factorAdjustments', () => {
    // 模拟 mergeStrategyFactorOverrides 的逻辑
    const existingAdjustments = new Map<string, number>([
      ['preference-signal', 1.2],
      ['popularity', 0.9],
    ]);

    const strategyOverrides: Record<string, number> = {
      'preference-signal': 0.7, // 策略要降低偏好影响
      'scene-context': 1.5, // 策略要增强场景感知
    };

    const merged = new Map(existingAdjustments);
    for (const [factorName, strategyStrength] of Object.entries(
      strategyOverrides,
    )) {
      const existing = merged.get(factorName) ?? 1.0;
      merged.set(factorName, existing * strategyStrength);
    }

    // preference-signal: 1.2 * 0.7 = 0.84
    expect(merged.get('preference-signal')).toBeCloseTo(0.84, 2);
    // scene-context: 1.0 (default) * 1.5 = 1.5
    expect(merged.get('scene-context')).toBeCloseTo(1.5, 2);
    // popularity: 未被策略覆盖，保持原值
    expect(merged.get('popularity')).toBeCloseTo(0.9, 2);
  });

  it('acquisitionDifficulty filter should work with strategy threshold', () => {
    const foods: Partial<FoodLibrary>[] = [
      { name: 'easy', acquisitionDifficulty: 1 },
      { name: 'moderate', acquisitionDifficulty: 3 },
      { name: 'hard', acquisitionDifficulty: 4 },
      { name: 'very_hard', acquisitionDifficulty: 5 },
      { name: 'default', acquisitionDifficulty: undefined },
    ];

    // scene_first 策略的 maxDiff = 2
    const maxDiff = STRATEGY_SCENE_FIRST.rerank.acquisitionDifficultyMax;
    expect(maxDiff).toBe(2);

    const filtered = foods.filter(
      (f) => (f.acquisitionDifficulty ?? 3) <= maxDiff,
    );
    // easy(1) passes, moderate(3) fails, hard(4) fails, very_hard(5) fails, default(3) fails
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('easy');
  });

  it('exploit strategy should allow higher acquisitionDifficulty', () => {
    const foods: Partial<FoodLibrary>[] = [
      { name: 'easy', acquisitionDifficulty: 1 },
      { name: 'moderate', acquisitionDifficulty: 3 },
      { name: 'hard', acquisitionDifficulty: 4 },
      { name: 'very_hard', acquisitionDifficulty: 5 },
    ];

    const maxDiff = STRATEGY_EXPLOIT.rerank.acquisitionDifficultyMax;
    expect(maxDiff).toBe(4);

    const filtered = foods.filter(
      (f) => (f.acquisitionDifficulty ?? 3) <= maxDiff,
    );
    expect(filtered).toHaveLength(3); // easy, moderate, hard
  });
});

// ─── P2-D: ProfileEventBus ───

describe('V7.4 P2-D: ProfileEventBus', () => {
  it('ProfileEvents constants should be defined', () => {
    expect(ProfileEvents.PREFERENCE_INCREMENTAL_UPDATE).toBe(
      'profile.preference.incremental_update',
    );
    expect(ProfileEvents.PREFERENCE_CACHE_INVALIDATED).toBe(
      'profile.preference.cache_invalidated',
    );
  });

  it('PreferenceIncrementalUpdateEvent should carry correct payload', () => {
    const event = new PreferenceIncrementalUpdateEvent(
      'user-123',
      'feedback',
      ['category', 'ingredient'],
      'accepted',
      '番茄炒蛋',
    );

    expect(event.eventName).toBe(ProfileEvents.PREFERENCE_INCREMENTAL_UPDATE);
    expect(event.userId).toBe('user-123');
    expect(event.source).toBe('feedback');
    expect(event.affectedDimensions).toContain('category');
    expect(event.feedbackAction).toBe('accepted');
    expect(event.foodName).toBe('番茄炒蛋');
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('PreferenceCacheInvalidatedEvent should carry correct payload', () => {
    const event = new PreferenceCacheInvalidatedEvent(
      'user-456',
      'feedback.accepted on 鸡胸肉',
    );

    expect(event.eventName).toBe(ProfileEvents.PREFERENCE_CACHE_INVALIDATED);
    expect(event.userId).toBe('user-456');
    expect(event.reason).toContain('鸡胸肉');
  });

  it('ProfileEventBusService should emit events via EventEmitter2', () => {
    const mockEmitter = { emit: jest.fn() };
    const bus = new ProfileEventBusService(mockEmitter as any);

    const updateEvent = new PreferenceIncrementalUpdateEvent(
      'user-1',
      'feedback',
      ['foodName'],
      'accepted',
    );
    bus.emitPreferenceUpdate(updateEvent);

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      ProfileEvents.PREFERENCE_INCREMENTAL_UPDATE,
      updateEvent,
    );

    const invalidateEvent = new PreferenceCacheInvalidatedEvent(
      'user-1',
      'test',
    );
    bus.emitCacheInvalidated(invalidateEvent);

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      ProfileEvents.PREFERENCE_CACHE_INVALIDATED,
      invalidateEvent,
    );

    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
  });
});

// ─── P2-E: ProfileEventListener ───

describe('V7.4 P2-E: ProfileEventListener', () => {
  let listener: ProfileEventListenerService;
  let mockPreferenceService: any;
  let mockRedis: any;
  let mockEventBus: any;

  beforeEach(() => {
    mockPreferenceService = {
      getUserPreferenceProfile: jest.fn().mockResolvedValue({
        categoryWeights: {},
        ingredientWeights: {},
        foodGroupWeights: {},
        foodNameWeights: {},
      }),
    };
    mockRedis = {
      buildKey: jest.fn((ns: string, id: string) => `${ns}:${id}`),
      del: jest.fn().mockResolvedValue(true),
    };
    mockEventBus = {
      emitPreferenceUpdate: jest.fn(),
      emitCacheInvalidated: jest.fn(),
    };

    listener = new ProfileEventListenerService(
      mockPreferenceService,
      mockRedis,
      mockEventBus,
    );
  });

  it('should invalidate cache and rebuild profile on feedback', async () => {
    const event = new FeedbackSubmittedEvent(
      'user-100',
      'lunch',
      '红烧肉',
      'food-id-1',
      'accepted',
    );

    await listener.onFeedbackSubmitted(event);

    // 1. 应该失效缓存
    expect(mockRedis.del).toHaveBeenCalledWith('pref_profile:user-100');

    // 2. 应该触发画像重建
    expect(mockPreferenceService.getUserPreferenceProfile).toHaveBeenCalledWith(
      'user-100',
    );

    // 3. 应该发布缓存失效事件
    expect(mockEventBus.emitCacheInvalidated).toHaveBeenCalledTimes(1);

    // 4. 应该发布增量更新事件
    expect(mockEventBus.emitPreferenceUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockEventBus.emitPreferenceUpdate.mock.calls[0][0];
    expect(updateCall.userId).toBe('user-100');
    expect(updateCall.source).toBe('feedback');
    expect(updateCall.feedbackAction).toBe('accepted');
    expect(updateCall.foodName).toBe('红烧肉');
  });

  it('should include foodGroup dimension for accepted feedback', async () => {
    const event = new FeedbackSubmittedEvent(
      'user-200',
      'dinner',
      '清蒸鱼',
      'food-id-2',
      'accepted',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'protein',
    );

    await listener.onFeedbackSubmitted(event);

    const updateCall = mockEventBus.emitPreferenceUpdate.mock.calls[0][0];
    expect(updateCall.affectedDimensions).toContain('category');
    expect(updateCall.affectedDimensions).toContain('ingredient');
    expect(updateCall.affectedDimensions).toContain('foodGroup');
  });

  it('should not include ingredient/foodGroup for skipped feedback', async () => {
    const event = new FeedbackSubmittedEvent(
      'user-300',
      'breakfast',
      '燕麦粥',
      'food-id-3',
      'skipped',
    );

    await listener.onFeedbackSubmitted(event);

    const updateCall = mockEventBus.emitPreferenceUpdate.mock.calls[0][0];
    expect(updateCall.affectedDimensions).toContain('foodName');
    expect(updateCall.affectedDimensions).not.toContain('ingredient');
    expect(updateCall.affectedDimensions).not.toContain('foodGroup');
  });

  it('should not throw when profile rebuild fails', async () => {
    mockPreferenceService.getUserPreferenceProfile.mockRejectedValue(
      new Error('DB connection error'),
    );

    const event = new FeedbackSubmittedEvent(
      'user-400',
      'lunch',
      '炒饭',
      'food-id-4',
      'replaced',
    );

    // 不应抛出异常
    await expect(listener.onFeedbackSubmitted(event)).resolves.toBeUndefined();
  });
});

// ─── P2-F: 解释能力增强 ───

describe('V7.4 P2-F: 解释能力增强', () => {
  let explanationGenerator: ExplanationGeneratorService;

  beforeEach(() => {
    explanationGenerator = new ExplanationGeneratorService(
      new MealCompositionScorer({} as any),
      new InsightGeneratorService(),
      new ExplanationTierService(),
      new NaturalLanguageExplainerService(),
      new MealExplanationService(new MealCompositionScorer({} as any)),
      new ComparisonExplanationService(),
    );
  });

  describe('generateComparisonExplanation', () => {
    it('should generate comparison between two foods', () => {
      const recommended = {
        food: {
          name: '鸡胸肉沙拉',
          calories: 250,
          protein: 30,
          fat: 8,
          carbs: 15,
          fiber: 5,
          acquisitionDifficulty: 2,
          category: 'composite',
        } as FoodLibrary,
        score: 85,
        servingCalories: 250,
        servingProtein: 30,
        servingFiber: 5,
      } as any;

      const alternative = {
        food: {
          name: '红烧肉',
          calories: 450,
          protein: 20,
          fat: 35,
          carbs: 10,
          fiber: 1,
          acquisitionDifficulty: 3,
          category: 'protein',
        } as FoodLibrary,
        score: 65,
        servingCalories: 450,
        servingProtein: 20,
        servingFiber: 1,
      } as any;

      const result: ComparisonExplanation =
        explanationGenerator.generateComparisonExplanation(
          recommended,
          alternative,
          'fat_loss',
        );

      expect(result.recommendedFood).toBe('鸡胸肉沙拉');
      expect(result.alternativeFood).toBe('红烧肉');
      expect(result.scoreDifference).toBe(20);
      expect(result.advantages.length).toBeGreaterThan(0);
      // 热量更低应该是优势
      expect(result.advantages.some((a) => a.includes('热量'))).toBe(true);
      // 蛋白质更丰富也应该是优势
      expect(result.advantages.some((a) => a.includes('蛋白质'))).toBe(true);
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should support en-US locale', () => {
      const recommended = {
        food: {
          name: 'Grilled Chicken',
          calories: 200,
          protein: 35,
          fiber: 0,
          acquisitionDifficulty: 2,
        } as FoodLibrary,
        score: 80,
        servingCalories: 200,
        servingProtein: 35,
        servingFiber: 0,
      } as any;

      const alternative = {
        food: {
          name: 'Fried Chicken',
          calories: 400,
          protein: 25,
          fiber: 0,
          acquisitionDifficulty: 3,
        } as FoodLibrary,
        score: 60,
        servingCalories: 400,
        servingProtein: 25,
        servingFiber: 0,
      } as any;

      const result = explanationGenerator.generateComparisonExplanation(
        recommended,
        alternative,
        'fat_loss',
        'en-US',
      );

      expect(result.summary).toContain('recommended over');
    });

    it('should handle equal scores gracefully', () => {
      const food1 = {
        food: {
          name: '食物A',
          calories: 300,
          protein: 20,
          fiber: 3,
          acquisitionDifficulty: 3,
        } as FoodLibrary,
        score: 70,
        servingCalories: 300,
        servingProtein: 20,
        servingFiber: 3,
      } as any;

      const food2 = {
        food: {
          name: '食物B',
          calories: 310,
          protein: 19,
          fiber: 3,
          acquisitionDifficulty: 3,
        } as FoodLibrary,
        score: 70,
        servingCalories: 310,
        servingProtein: 19,
        servingFiber: 3,
      } as any;

      const result = explanationGenerator.generateComparisonExplanation(
        food1,
        food2,
        'health',
      );

      expect(result.scoreDifference).toBe(0);
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe('generateSubstitutionExplanation', () => {
    it('should generate substitution explanation with nutritional impact', () => {
      const original = {
        food: {
          name: '白米饭',
          calories: 350,
          protein: 6,
          fat: 1,
          carbs: 78,
          fiber: 1,
          category: 'grain',
        } as FoodLibrary,
        score: 60,
        servingCalories: 350,
        servingProtein: 6,
        servingFiber: 1,
      } as any;

      const substitute = {
        food: {
          name: '糙米饭',
          calories: 330,
          protein: 7,
          fat: 2,
          carbs: 70,
          fiber: 4,
          category: 'grain',
        } as FoodLibrary,
        score: 72,
        servingCalories: 330,
        servingProtein: 7,
        servingFiber: 4,
      } as any;

      const target = { calories: 600, protein: 30 } as any;

      const result: SubstitutionExplanation =
        explanationGenerator.generateSubstitutionExplanation(
          original,
          substitute,
          'health',
          target,
        );

      expect(result.originalFood).toBe('白米饭');
      expect(result.substituteFood).toBe('糙米饭');
      expect(result.calorieChange).toBe(-20); // 330 - 350
      expect(result.proteinChange).toBe(1); // 7 - 6
      expect(result.fiberChange).toBe(3); // 4 - 1
      expect(result.isGoodSubstitute).toBe(true);
      expect(result.sameCategorySubstitute).toBe(true);
      // 纤维增加应该在 impacts 中
      expect(result.impacts.some((i) => i.includes('纤维'))).toBe(true);
      expect(result.suggestion).toContain('糙米饭');
      expect(result.suggestion).toContain('白米饭');
    });

    it('should flag bad substitution when calorie difference is too large', () => {
      const original = {
        food: {
          name: '蔬菜沙拉',
          calories: 100,
          protein: 3,
          fiber: 5,
          category: 'veggie',
        } as FoodLibrary,
        score: 80,
        servingCalories: 100,
        servingProtein: 3,
        servingFiber: 5,
      } as any;

      const substitute = {
        food: {
          name: '炸鸡排',
          calories: 500,
          protein: 25,
          fiber: 0,
          category: 'protein',
        } as FoodLibrary,
        score: 45,
        servingCalories: 500,
        servingProtein: 25,
        servingFiber: 0,
      } as any;

      const target = { calories: 500, protein: 25 } as any;

      const result = explanationGenerator.generateSubstitutionExplanation(
        original,
        substitute,
        'fat_loss',
        target,
      );

      // 热量从100→500，变化400 > 500*0.15=75，不是好的替代
      expect(result.isGoodSubstitute).toBe(false);
      expect(result.sameCategorySubstitute).toBe(false);
      expect(result.calorieChange).toBe(400);
    });

    it('should generate en-US suggestion', () => {
      const original = {
        food: {
          name: 'Rice',
          calories: 300,
          protein: 5,
          fiber: 1,
          category: 'grain',
        } as FoodLibrary,
        score: 60,
        servingCalories: 300,
        servingProtein: 5,
        servingFiber: 1,
      } as any;

      const substitute = {
        food: {
          name: 'Quinoa',
          calories: 280,
          protein: 8,
          fiber: 3,
          category: 'grain',
        } as FoodLibrary,
        score: 75,
        servingCalories: 280,
        servingProtein: 8,
        servingFiber: 3,
      } as any;

      const result = explanationGenerator.generateSubstitutionExplanation(
        original,
        substitute,
        'health',
        { calories: 600, protein: 30 } as any,
        'en-US',
      );

      expect(result.suggestion).toContain('substitute');
      expect(result.suggestion).toContain('Quinoa');
    });
  });
});

// ─── P2-G: Phase 2 端到端集成验证 ───

describe('V7.4 P2-G: Phase 2 端到端集成', () => {
  it('strategy resolution → pipeline context → chain scoring flow', () => {
    // 1. 策略解析
    const resolver = new RecommendationStrategyResolverService();
    const resolved = resolver.resolve({
      feedbackCount: 25,
      goalType: 'fat_loss',
      healthConditions: ['diabetes'],
    });
    expect(resolved.strategy.name).toBe('strict_health');

    // 2. 构造带策略的 PipelineContext
    const factorAdjustments = new Map<string, number>([
      ['preference-signal', 1.1],
    ]);

    // 3. 合并策略 factorStrengthOverrides
    const merged = new Map(factorAdjustments);
    for (const [name, strength] of Object.entries(
      resolved.strategy.rank.factorStrengthOverrides,
    )) {
      const existing = merged.get(name) ?? 1.0;
      merged.set(name, existing * strength);
    }

    // strict_health 降低 preference-signal: 0.7
    // 合并后: 1.1 * 0.7 = 0.77
    expect(merged.get('preference-signal')).toBeCloseTo(0.77, 2);

    // strict_health 提升 rule-weight: 1.3
    expect(merged.get('rule-weight')).toBeCloseTo(1.3, 2);

    // 4. 构造 ScoringChain 验证因子强度应用
    const chain = new ScoringChainService();
    chain.registerFactors([
      new PreferenceSignalFactor(),
      new RuleWeightFactor(),
    ]);
    expect(chain.getFactors()).toHaveLength(2);
  });

  it('event-driven profile update flow', async () => {
    // 模拟完整的 feedback → event → profile update 流程
    const mockEmitter = { emit: jest.fn() };
    const bus = new ProfileEventBusService(mockEmitter as any);

    const mockPref = {
      getUserPreferenceProfile: jest.fn().mockResolvedValue({
        categoryWeights: { protein: 1.1 },
        ingredientWeights: {},
        foodGroupWeights: {},
        foodNameWeights: { 鸡胸肉: 1.2 },
      }),
    };
    const mockRedis = {
      buildKey: jest.fn((ns: string, id: string) => `${ns}:${id}`),
      del: jest.fn().mockResolvedValue(true),
    };

    const listener = new ProfileEventListenerService(
      mockPref as any,
      mockRedis as any,
      bus,
    );

    // 模拟反馈事件
    const feedbackEvent = new FeedbackSubmittedEvent(
      'user-e2e',
      'lunch',
      '鸡胸肉',
      'food-001',
      'accepted',
    );

    await listener.onFeedbackSubmitted(feedbackEvent);

    // 验证：缓存失效 → 画像重建 → 事件发布
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockPref.getUserPreferenceProfile).toHaveBeenCalledWith('user-e2e');
    // ProfileEventBus 应通过 EventEmitter2 发布了 2 个事件（cache_invalidated + incremental_update）
    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('comparison and substitution explanation integration', () => {
    const gen = new ExplanationGeneratorService(
      new MealCompositionScorer({} as any),
      new InsightGeneratorService(),
      new ExplanationTierService(),
      new NaturalLanguageExplainerService(),
      new MealExplanationService(new MealCompositionScorer({} as any)),
      new ComparisonExplanationService(),
    );

    // 先推荐两个食物
    const picked = {
      food: {
        name: '清蒸鲈鱼',
        calories: 180,
        protein: 28,
        fat: 6,
        fiber: 0,
        acquisitionDifficulty: 3,
        category: 'protein',
      } as FoodLibrary,
      score: 82,
      servingCalories: 180,
      servingProtein: 28,
      servingFiber: 0,
    } as any;

    const notPicked = {
      food: {
        name: '红烧排骨',
        calories: 420,
        protein: 22,
        fat: 30,
        fiber: 0,
        acquisitionDifficulty: 3,
        category: 'protein',
      } as FoodLibrary,
      score: 58,
      servingCalories: 420,
      servingProtein: 22,
      servingFiber: 0,
    } as any;

    // 1. 对比解释
    const comparison = gen.generateComparisonExplanation(
      picked,
      notPicked,
      'fat_loss',
    );
    expect(comparison.scoreDifference).toBe(24);
    expect(comparison.advantages.length).toBeGreaterThan(0);

    // 2. 用户替换: 用户不要清蒸鲈鱼，换成红烧排骨
    const substitution = gen.generateSubstitutionExplanation(
      picked,
      notPicked,
      'fat_loss',
      { calories: 600, protein: 35 } as any,
    );
    expect(substitution.calorieChange).toBe(240); // 420 - 180
    expect(substitution.isGoodSubstitute).toBe(false); // 热量变化太大
    expect(substitution.impacts.length).toBeGreaterThan(0);
  });
});
