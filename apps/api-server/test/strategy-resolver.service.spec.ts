/**
 * V8.0 P3-04: StrategyResolver 合并逻辑单元测试
 *
 * 验证：
 * 1. 4 层合并优先级：GLOBAL → GOAL_TYPE → CONTEXT → USER
 * 2. 各层缺失时的降级处理
 * 3. deepMergeStrategy 规则（数组整体替换 / 对象递归合并 / 基础类型后者覆盖）
 * 4. mergeConfigOverride 叠加实验层配置
 * 5. V7.0 Context 策略匹配逻辑（timeOfDay / dayType / season / userLifecycle）
 * 6. 缓存行为（getOrSet 被调用）
 * 7. userId null 守卫（assignment.strategyId 为 null 时跳过）
 */

import { StrategyResolver } from '../src/modules/strategy/app/strategy-resolver.service';
import type { StrategyConfig, ResolvedStrategy } from '../src/modules/strategy/strategy.types';
import { StrategyScope } from '../src/modules/strategy/strategy.types';

// ─── Mock 工厂 ───

function makeStrategyEntity(id: string, config: StrategyConfig, extra?: any) {
  return { id, name: `strategy-${id}`, config, contextCondition: null, ...extra };
}

function makeResolvedStrategy(overrides?: Partial<ResolvedStrategy>): ResolvedStrategy {
  return {
    strategyId: 'default',
    strategyName: '系统默认策略',
    sources: [],
    config: {},
    resolvedAt: Date.now(),
    ...overrides,
  };
}

function createMockStrategyService(opts?: {
  globalStrategy?: any;
  goalStrategy?: any;
  contextStrategies?: any[];
  userAssignment?: any;
  userStrategy?: any;
}) {
  return {
    getGlobalStrategy: jest.fn().mockResolvedValue(opts?.globalStrategy ?? null),
    getActiveStrategy: jest.fn().mockResolvedValue(opts?.goalStrategy ?? null),
    getContextStrategies: jest.fn().mockResolvedValue(opts?.contextStrategies ?? []),
    getUserAssignment: jest.fn().mockResolvedValue(opts?.userAssignment ?? null),
    findById: jest.fn().mockResolvedValue(opts?.userStrategy ?? null),
  };
}

function createMockRedis() {
  return {
    getOrSet: jest.fn().mockImplementation(
      (_key: string, _ttl: number, factory: () => Promise<any>) => factory(),
    ),
  };
}

// ─── Test Suite ───

describe('StrategyResolver', () => {

  // ════════════════════════════════════════════════════════════
  // 1. 4 层合并优先级
  // ════════════════════════════════════════════════════════════

  describe('4 层合并优先级', () => {
    it('should return system-default when no strategies exist', async () => {
      const service = createMockStrategyService();
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(result.strategyId).toBe('system-default');
      expect(result.sources).toHaveLength(0);
    });

    it('should include global strategy in sources', async () => {
      const globalConfig: StrategyConfig = { rank: { mealModifiers: { lunch: {} } } };
      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('global-1', globalConfig),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(result.sources).toContain('global:global-1');
      expect(result.config.rank?.mealModifiers).toBeDefined();
    });

    it('should apply goal strategy on top of global', async () => {
      const globalConfig: StrategyConfig = { rank: { mealModifiers: { lunch: { protein: 1.1 } } } };
      const goalConfig: StrategyConfig = { rank: { mealModifiers: { dinner: { carbs: 0.9 } } } };

      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', globalConfig),
        goalStrategy: makeStrategyEntity('goal-1', goalConfig),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(result.sources).toContain('global:g1');
      expect(result.sources).toContain('goal:goal-1');
      // both meal modifier keys should be present after merge
      expect(result.config.rank?.mealModifiers?.lunch).toBeDefined();
      expect(result.config.rank?.mealModifiers?.dinner).toBeDefined();
    });

    it('should apply user strategy as highest priority', async () => {
      const globalConfig: StrategyConfig = { rank: { mealModifiers: { lunch: { protein: 1.0 } } } };
      const userConfig: StrategyConfig = { rank: { mealModifiers: { lunch: { protein: 1.5 } } } };

      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', globalConfig),
        userAssignment: { userId: 'user-1', strategyId: 'user-strat-1', assignmentType: 'MANUAL' },
        userStrategy: makeStrategyEntity('user-strat-1', userConfig),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(result.sources.some((s) => s.includes('MANUAL:user-strat-1'))).toBe(true);
      // user config overrides global: protein modifier should be 1.5
      expect(result.config.rank?.mealModifiers?.lunch?.protein).toBe(1.5);
    });

    it('should include strategy count in merged name when sources > 0', async () => {
      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', {}),
        goalStrategy: makeStrategyEntity('goal-1', {}),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(result.strategyName).toContain('合并策略');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. userId null 守卫（assignment.strategyId 为 null）
  // ════════════════════════════════════════════════════════════

  describe('assignment.strategyId null 守卫', () => {
    it('should skip user strategy when assignment.strategyId is null', async () => {
      const service = createMockStrategyService({
        userAssignment: { userId: 'user-1', strategyId: null, assignmentType: 'MANUAL' },
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      // findById should NOT be called when strategyId is null
      expect(service.findById).not.toHaveBeenCalled();
      expect(result.strategyId).toBe('system-default');
    });

    it('should skip user strategy when getUserAssignment returns null', async () => {
      const service = createMockStrategyService({ userAssignment: null });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(service.findById).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. mergeConfigOverride（A/B 实验层叠加）
  // ════════════════════════════════════════════════════════════

  describe('mergeConfigOverride', () => {
    it('should merge override config on top of resolved strategy', () => {
      const service = createMockStrategyService();
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const resolved = makeResolvedStrategy({
        strategyId: 's1',
        config: { exploration: { baseMin: 0.05, baseMax: 0.2 } },
        sources: ['global:g1'],
      });

      const override: StrategyConfig = { exploration: { baseMin: 0.1 } };
      const merged = resolver.mergeConfigOverride(resolved, override, 'experiment:exp-1/treatment');

      expect(merged.strategyId).toBe('s1+experiment:exp-1/treatment');
      expect(merged.sources).toContain('global:g1');
      expect(merged.sources).toContain('experiment:exp-1/treatment');
      // baseMin overridden, baseMax preserved
      expect(merged.config.exploration?.baseMin).toBe(0.1);
      expect(merged.config.exploration?.baseMax).toBe(0.2);
    });

    it('should not mutate the original resolved strategy', () => {
      const service = createMockStrategyService();
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const resolved = makeResolvedStrategy({
        config: { exploration: { baseMin: 0.05 } },
      });
      const originalSources = [...resolved.sources];
      const originalConfig = { ...resolved.config };

      resolver.mergeConfigOverride(resolved, { exploration: { baseMin: 0.2 } }, 'exp:1');

      expect(resolved.sources).toEqual(originalSources);
      expect(resolved.config.exploration?.baseMin).toBe(0.05);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. deepMergeStrategy 规则（通过 resolve 间接测试）
  // ════════════════════════════════════════════════════════════

  describe('deepMergeStrategy 规则', () => {
    it('should merge nested recall.sources by key (later wins)', async () => {
      const base: StrategyConfig = { recall: { sources: { rule: { enabled: true } } } };
      // Use 'as any' to allow extra fields (weight, semantic) for merge-logic testing
      const override: StrategyConfig = { recall: { sources: { rule: { enabled: false }, vector: { enabled: true, weight: 0.7 } } } };

      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', base),
        goalStrategy: makeStrategyEntity('goal-1', override),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      // override wins for rule.enabled
      expect(result.config.recall?.sources?.rule?.enabled).toBe(false);
      // vector was only in override
      expect(result.config.recall?.sources?.vector?.enabled).toBe(true);
    });

    it('should replace baseWeights array entirely (not per-element)', async () => {
      const base: StrategyConfig = { rank: { baseWeights: { fat_loss: [0.1, 0.2, 0.3] } as any } };
      const override: StrategyConfig = { rank: { baseWeights: { fat_loss: [0.4, 0.5] } as any } };

      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', base),
        goalStrategy: makeStrategyEntity('goal-1', override),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      // Array should be replaced entirely by the override
      expect((result.config.rank?.baseWeights as any)?.fat_loss).toEqual([0.4, 0.5]);
    });

    it('should handle empty config objects gracefully', async () => {
      const service = createMockStrategyService({
        globalStrategy: makeStrategyEntity('g1', {}),
        goalStrategy: makeStrategyEntity('goal-1', {}),
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss');

      // Should not throw, config should be valid object
      expect(result.config).toBeDefined();
      expect(typeof result.config).toBe('object');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. V7.0 Context 策略匹配
  // ════════════════════════════════════════════════════════════

  describe('V7.0 Context 策略匹配', () => {
    it('should match context strategy by timeOfDay', async () => {
      const contextConfig: StrategyConfig = { exploration: { baseMin: 0.25 } };
      const contextStrategy = makeStrategyEntity('ctx-morning', contextConfig, {
        contextCondition: { timeOfDay: ['morning'] },
      });

      const service = createMockStrategyService({
        contextStrategies: [contextStrategy],
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss', {
        timeOfDay: 'morning',
        dayType: 'weekday',
        season: 'summer',
        lifecycle: 'active',
      });

      expect(result.sources.some((s) => s.includes('context:ctx-morning'))).toBe(true);
      expect(result.config.exploration?.baseMin).toBe(0.25);
    });

    it('should NOT match context strategy when timeOfDay does not match', async () => {
      const contextStrategy = makeStrategyEntity('ctx-morning', {}, {
        contextCondition: { timeOfDay: ['morning'] },
      });

      const service = createMockStrategyService({
        contextStrategies: [contextStrategy],
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss', {
        timeOfDay: 'evening',
        dayType: 'weekday',
        season: 'summer',
        lifecycle: 'active',
      });

      expect(result.sources.some((s) => s.includes('context:'))).toBe(false);
    });

    it('should select the most specific matching context strategy', async () => {
      // strategy A matches only timeOfDay (score=1)
      // strategy B matches timeOfDay + dayType (score=2) → should win
      const stratA = makeStrategyEntity('ctx-a', { exploration: { baseMin: 0.1 } }, {
        contextCondition: { timeOfDay: ['morning'] },
      });
      const stratB = makeStrategyEntity('ctx-b', { exploration: { baseMin: 0.3 } }, {
        contextCondition: { timeOfDay: ['morning'], dayType: ['weekday'] },
      });

      const service = createMockStrategyService({
        contextStrategies: [stratA, stratB],
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss', {
        timeOfDay: 'morning',
        dayType: 'weekday',
        season: 'summer',
        lifecycle: 'active',
      });

      expect(result.sources.some((s) => s.includes('context:ctx-b'))).toBe(true);
      expect(result.config.exploration?.baseMin).toBe(0.3);
    });

    it('should skip context strategies with empty conditions', async () => {
      const emptyCondStrategy = makeStrategyEntity('ctx-empty', { exploration: { baseMin: 0.5 } }, {
        contextCondition: {}, // 空条件 → 不匹配
      });

      const service = createMockStrategyService({
        contextStrategies: [emptyCondStrategy],
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      const result = await resolver.resolve('user-1', 'fat_loss', {
        timeOfDay: 'morning',
        dayType: 'weekday',
        season: 'summer',
        lifecycle: 'active',
      });

      expect(result.sources.some((s) => s.includes('context:'))).toBe(false);
    });

    it('should skip context layer when contextInput is not provided', async () => {
      const contextStrategy = makeStrategyEntity('ctx-1', {}, {
        contextCondition: { timeOfDay: ['morning'] },
      });

      const service = createMockStrategyService({
        contextStrategies: [contextStrategy],
      });
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      // No contextInput → context strategies should not be evaluated
      const result = await resolver.resolve('user-1', 'fat_loss');

      expect(service.getContextStrategies).not.toHaveBeenCalled();
      expect(result.sources.some((s) => s.includes('context:'))).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. 缓存行为
  // ════════════════════════════════════════════════════════════

  describe('Redis 缓存', () => {
    it('should call redis.getOrSet with correct key pattern', async () => {
      const service = createMockStrategyService();
      const redis = createMockRedis();
      const resolver = new StrategyResolver(service as any, redis as any);

      await resolver.resolve('user-abc', 'muscle_gain');

      expect(redis.getOrSet).toHaveBeenCalledWith(
        expect.stringContaining('user-abc:muscle_gain'),
        expect.any(Number),
        expect.any(Function),
      );
    });
  });
});
