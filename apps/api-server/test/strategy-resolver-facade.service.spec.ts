/**
 * StrategyResolverFacade 单元测试 — V7.7 P4
 *
 * 测试 resolveStrategyForUser() 三层策略合并链路：
 *   base strategy → A/B experiment overlay → user preferences overlay
 *
 * 使用直接构造函数注入 mock，与项目现有单测风格一致。
 */

import { StrategyResolverFacade } from '../src/modules/diet/app/recommendation/strategy-resolver-facade.service';
import { UserProfileService } from '../src/modules/user/app/user-profile.service';

describe('StrategyResolverFacade', () => {
  let facade: StrategyResolverFacade;
  let mockStrategyResolver: any;
  let mockAbTestingService: any;
  let mockProfileAggregator: any;

  const baseStrategy = {
    strategyId: 'strategy-1',
    strategyName: 'Default',
    sources: ['global'],
    config: { rank: { method: 'weighted_sum' } },
    resolvedAt: Date.now(),
  };

  const experimentResult = {
    experimentId: 'exp-1',
    groupName: 'treatment',
    config: { exploration: { epsilon: 0.2 } },
  };

  const recPrefs = {
    popularityPreference: 'mainstream',
    cookingEffort: 'low',
    budgetSensitivity: null,
    realismLevel: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    mockStrategyResolver = {
      resolve: jest.fn().mockResolvedValue(baseStrategy),
      mergeConfigOverride: jest
        .fn()
        .mockImplementation((resolved, configOverride, source) => ({
          ...resolved,
          config: { ...resolved.config, ...configOverride },
          sources: [...resolved.sources, source],
        })),
    };

    mockAbTestingService = {
      resolveExperimentStrategy: jest.fn().mockResolvedValue(null),
    };

    mockProfileAggregator = {
      getRecommendationPreferences: jest.fn().mockResolvedValue({
        popularityPreference: null,
        cookingEffort: null,
        budgetSensitivity: null,
        realismLevel: null,
      }),
    };

    facade = new StrategyResolverFacade(
      mockStrategyResolver,
      mockAbTestingService,
      mockProfileAggregator,
    ) as any;
  });

  // ═══════════════════════════════════════════════════════════
  // Happy path
  // ═══════════════════════════════════════════════════════════

  describe('Happy path', () => {
    it('应该解析包含三层合并的完整策略 (base + experiment + user preferences)', async () => {
      mockAbTestingService.resolveExperimentStrategy.mockResolvedValue(
        experimentResult,
      );
      mockProfileAggregator.getRecommendationPreferences.mockResolvedValue(
        recPrefs,
      );
      jest
        .spyOn(UserProfileService, 'toRealismOverride')
        .mockReturnValue({ popularityWeight: 1.2 });

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      // base resolve called
      expect(mockStrategyResolver.resolve).toHaveBeenCalledWith(
        'user-1',
        'weight_loss',
      );

      // experiment merge
      expect(mockStrategyResolver.mergeConfigOverride).toHaveBeenCalledWith(
        baseStrategy,
        experimentResult.config,
        'experiment:exp-1/treatment',
      );

      // user preferences merge
      expect(UserProfileService.toRealismOverride).toHaveBeenCalledWith(
        recPrefs,
      );
      expect(mockStrategyResolver.mergeConfigOverride).toHaveBeenCalledTimes(2);
      expect(mockStrategyResolver.mergeConfigOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: expect.arrayContaining(['experiment:exp-1/treatment']),
        }),
        { realism: { popularityWeight: 1.2 } },
        'user_recommendation_preferences',
      );

      // final result includes all sources
      expect(result).not.toBeNull();
      expect(result!.sources).toContain('experiment:exp-1/treatment');
      expect(result!.sources).toContain('user_recommendation_preferences');
    });

    it('应该在无实验和无用户偏好时返回基础策略', async () => {
      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(mockStrategyResolver.resolve).toHaveBeenCalledWith(
        'user-1',
        'weight_loss',
      );
      expect(mockStrategyResolver.mergeConfigOverride).not.toHaveBeenCalled();
      expect(result).toEqual(baseStrategy);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Experiment layer
  // ═══════════════════════════════════════════════════════════

  describe('Experiment layer', () => {
    it('应该在 abTestingService 返回结果时合并实验策略', async () => {
      mockAbTestingService.resolveExperimentStrategy.mockResolvedValue(
        experimentResult,
      );

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(
        mockAbTestingService.resolveExperimentStrategy,
      ).toHaveBeenCalledWith('user-1', 'weight_loss');
      expect(mockStrategyResolver.mergeConfigOverride).toHaveBeenCalledWith(
        baseStrategy,
        experimentResult.config,
        'experiment:exp-1/treatment',
      );
      expect(result!.sources).toContain('experiment:exp-1/treatment');
      expect(result!.config).toHaveProperty('exploration');
    });

    it('应该在 abTestingService 返回 null 时跳过实验合并', async () => {
      mockAbTestingService.resolveExperimentStrategy.mockResolvedValue(null);

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(mockAbTestingService.resolveExperimentStrategy).toHaveBeenCalled();
      expect(mockStrategyResolver.mergeConfigOverride).not.toHaveBeenCalled();
      expect(result).toEqual(baseStrategy);
    });

    it('应该在 abTestingService 抛出异常时优雅降级 (warn, 继续使用基础策略)', async () => {
      mockAbTestingService.resolveExperimentStrategy.mockRejectedValue(
        new Error('AB service down'),
      );

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      // Should not throw, should return base strategy
      expect(result).toEqual(baseStrategy);
      expect(mockStrategyResolver.mergeConfigOverride).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // User preferences layer
  // ═══════════════════════════════════════════════════════════

  describe('User preferences layer', () => {
    it('应该在用户有推荐偏好时合并 realism 覆盖', async () => {
      mockProfileAggregator.getRecommendationPreferences.mockResolvedValue(
        recPrefs,
      );
      jest
        .spyOn(UserProfileService, 'toRealismOverride')
        .mockReturnValue({ popularityWeight: 1.2 });

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(
        mockProfileAggregator.getRecommendationPreferences,
      ).toHaveBeenCalledWith('user-1');
      expect(UserProfileService.toRealismOverride).toHaveBeenCalledWith(
        recPrefs,
      );
      expect(mockStrategyResolver.mergeConfigOverride).toHaveBeenCalledWith(
        baseStrategy,
        { realism: { popularityWeight: 1.2 } },
        'user_recommendation_preferences',
      );
      expect(result!.sources).toContain('user_recommendation_preferences');
    });

    it('应该在 toRealismOverride 返回空对象时跳过 realism 合并', async () => {
      mockProfileAggregator.getRecommendationPreferences.mockResolvedValue(
        recPrefs,
      );
      jest.spyOn(UserProfileService, 'toRealismOverride').mockReturnValue({});

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(UserProfileService.toRealismOverride).toHaveBeenCalledWith(
        recPrefs,
      );
      expect(mockStrategyResolver.mergeConfigOverride).not.toHaveBeenCalled();
      expect(result).toEqual(baseStrategy);
    });

    it('应该在偏好加载失败时优雅降级 (warn, 继续使用当前策略)', async () => {
      mockProfileAggregator.getRecommendationPreferences.mockRejectedValue(
        new Error('Profile service timeout'),
      );

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      // Should not throw, should return base strategy
      expect(result).toEqual(baseStrategy);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Error handling
  // ═══════════════════════════════════════════════════════════

  describe('Error handling', () => {
    it('应该在 strategyResolver.resolve 抛出异常时返回 null', async () => {
      mockStrategyResolver.resolve.mockRejectedValue(
        new Error('Strategy store unavailable'),
      );

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(result).toBeNull();
    });

    it('应该在整体流程失败时返回 null', async () => {
      mockStrategyResolver.resolve.mockRejectedValue(
        new Error('Unexpected failure'),
      );
      mockAbTestingService.resolveExperimentStrategy.mockRejectedValue(
        new Error('AB down'),
      );
      mockProfileAggregator.getRecommendationPreferences.mockRejectedValue(
        new Error('Profile down'),
      );

      const result = await facade.resolveStrategyForUser(
        'user-1',
        'weight_loss',
      );

      expect(result).toBeNull();
    });
  });
});
