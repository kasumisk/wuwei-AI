/**
 * V7.7 P4: ProfileAggregatorService 单元测试
 *
 * 直接构造函数注入 mock，不使用 NestJS TestingModule。
 * 覆盖 aggregateForRecommendation / aggregateForScenario /
 * getShortTermProfile / getRecommendationPreferences 四个公开方法。
 */

import { ProfileAggregatorService } from '../../../src/modules/diet/app/recommendation/profile/profile-aggregator.service';

// ─── Mock factories ───

const mockRecentFoodNames = ['鸡蛋', '米饭', '西红柿'];

const mockFeedbackStats = {
  鸡蛋: { accepted: 5, rejected: 1 },
};

const mockPreferenceProfile = {
  categoryWeights: {},
  ingredientWeights: {},
  foodGroupWeights: {},
  foodNameWeights: {},
};

const mockEnrichedProfile = {
  regionCode: 'CN',
  inferred: { userSegment: 'health_seeker' },
  declared: null,
  observed: null,
  shortTerm: null,
  contextual: null,
  lifestyle: null,
  conflicts: [],
  profileFreshness: 1,
};

const mockEffectiveGoal = { goalType: 'fat_loss' };

const mockGoalProgress = {
  calorieCompliance: 0.9,
  proteinCompliance: 0.85,
  executionRate: 0.8,
  streakDays: 7,
};

const mockKitchenProfile = {
  hasOven: false,
  hasMicrowave: true,
  hasAirFryer: false,
  hasRiceCooker: true,
  hasSteamer: true,
  primaryStove: 'gas',
};

const mockSubstitutions: any[] = [];

const mockLearnedWeightOverrides = [1.0, 0.9, 1.1];

const mockRegionalBoostMap = { 粤菜: 1.2, 川菜: 0.8 };

const mockShortTermProfile = {
  recentMeals: [],
  recentNutrients: {},
  lastUpdated: Date.now(),
};

const mockRecommendationPreferences = {
  spicyLevel: 'medium',
  allergies: [],
};

// ─── Helper: create fresh mocks + service ───

function createService() {
  const profileResolver = {
    resolve: jest.fn().mockResolvedValue(mockEnrichedProfile),
    resolveWithDomainProfiles: jest.fn().mockResolvedValue(mockEnrichedProfile),
  };

  const preferenceProfileService = {
    getRecentFoodNames: jest.fn().mockResolvedValue(mockRecentFoodNames),
    getUserPreferenceProfile: jest
      .fn()
      .mockResolvedValue(mockPreferenceProfile),
    getRegionalBoostMap: jest.fn().mockResolvedValue(mockRegionalBoostMap),
    getCuisineRegionalBoostMap: jest
      .fn()
      .mockResolvedValue(mockRegionalBoostMap),
  };

  const feedbackService = {
    getUserFeedbackStats: jest.fn().mockResolvedValue(mockFeedbackStats),
  };

  const userProfileService = {
    getKitchenProfile: jest.fn().mockResolvedValue(mockKitchenProfile),
    getRecommendationPreferences: jest
      .fn()
      .mockResolvedValue(mockRecommendationPreferences),
  };

  const goalPhaseService = {
    getCurrentGoal: jest.fn().mockResolvedValue(mockEffectiveGoal),
  };

  const goalTrackerService = {
    getProgress: jest.fn().mockResolvedValue(mockGoalProgress),
  };

  const executionTrackerService = {
    getTopSubstitutions: jest.fn().mockResolvedValue(mockSubstitutions),
  };

  const learnedRankingService = {
    getLearnedWeights: jest.fn().mockResolvedValue(mockLearnedWeightOverrides),
  };

  const realtimeProfile = {
    getShortTermProfile: jest.fn().mockResolvedValue(mockShortTermProfile),
  };

  const service = new ProfileAggregatorService(
    profileResolver as any,
    preferenceProfileService as any,
    feedbackService as any,
    userProfileService as any,
    goalPhaseService as any,
    goalTrackerService as any,
    executionTrackerService as any,
    learnedRankingService as any,
    { learnWeights: jest.fn().mockResolvedValue(null), getLearnedWeights: jest.fn().mockResolvedValue(null) } as any, // weightLearnerService
    realtimeProfile as any,
  );

  return {
    service,
    profileResolver,
    preferenceProfileService,
    feedbackService,
    userProfileService,
    goalPhaseService,
    goalTrackerService,
    executionTrackerService,
    learnedRankingService,
    realtimeProfile,
  };
}

// ─── Tests ───

describe('ProfileAggregatorService', () => {
  const userId = 'user-001';
  const mealType = 'lunch';

  // ────────────────────────────────────────
  // aggregateForRecommendation
  // ────────────────────────────────────────
  describe('aggregateForRecommendation', () => {
    it('should aggregate all profile data successfully (happy path)', async () => {
      const {
        service,
        profileResolver,
        preferenceProfileService,
        feedbackService,
        userProfileService,
        goalPhaseService,
        goalTrackerService,
        executionTrackerService,
        learnedRankingService,
      } = createService();

      const result = await service.aggregateForRecommendation(userId, mealType);

      // Phase 1: 8 parallel calls
      expect(preferenceProfileService.getRecentFoodNames).toHaveBeenCalledTimes(
        1,
      );
      expect(feedbackService.getUserFeedbackStats).toHaveBeenCalledTimes(1);
      expect(
        preferenceProfileService.getUserPreferenceProfile,
      ).toHaveBeenCalledTimes(1);
      expect(profileResolver.resolveWithDomainProfiles).toHaveBeenCalledTimes(
        1,
      );
      expect(goalPhaseService.getCurrentGoal).toHaveBeenCalledTimes(1);
      expect(goalTrackerService.getProgress).toHaveBeenCalledTimes(1);
      expect(userProfileService.getKitchenProfile).toHaveBeenCalledTimes(1);
      expect(executionTrackerService.getTopSubstitutions).toHaveBeenCalledTimes(
        1,
      );

      // Phase 2: 2 sequential calls
      expect(learnedRankingService.getLearnedWeights).toHaveBeenCalledTimes(1);
      expect(
        preferenceProfileService.getRegionalBoostMap,
      ).toHaveBeenCalledTimes(1);

      // Verify returned shape
      expect(result).toEqual({
        recentFoodNames: mockRecentFoodNames,
        feedbackStats: mockFeedbackStats,
        preferenceProfile: mockPreferenceProfile,
        enrichedProfile: mockEnrichedProfile,
        effectiveGoal: mockEffectiveGoal,
        goalProgress: mockGoalProgress,
        kitchenProfile: mockKitchenProfile,
        substitutions: mockSubstitutions,
        learnedWeightOverrides: mockLearnedWeightOverrides,
        regionalBoostMap: mockRegionalBoostMap,
        cuisinePreferenceRegions: [],
      });
    });

    it('should handle learnedRankingService failure gracefully', async () => {
      const { service, learnedRankingService } = createService();

      learnedRankingService.getLearnedWeights.mockRejectedValue(
        new Error('Redis connection failed'),
      );

      const result = await service.aggregateForRecommendation(userId, mealType);

      // Should not throw
      expect(result.learnedWeightOverrides).toBeNull();
      // Other fields should still be populated
      expect(result.recentFoodNames).toEqual(mockRecentFoodNames);
      expect(result.regionalBoostMap).toEqual(mockRegionalBoostMap);
    });

    it('should pass correct userId and mealType to all services', async () => {
      const {
        service,
        profileResolver,
        preferenceProfileService,
        feedbackService,
        userProfileService,
        goalPhaseService,
        goalTrackerService,
        executionTrackerService,
        learnedRankingService,
      } = createService();

      await service.aggregateForRecommendation(userId, mealType);

      // Phase 1 calls with userId
      expect(preferenceProfileService.getRecentFoodNames).toHaveBeenCalledWith(
        userId,
        3,
      );
      expect(feedbackService.getUserFeedbackStats).toHaveBeenCalledWith(userId);
      expect(
        preferenceProfileService.getUserPreferenceProfile,
      ).toHaveBeenCalledWith(userId);
      expect(profileResolver.resolveWithDomainProfiles).toHaveBeenCalledWith(
        userId,
        mealType,
      );
      expect(goalPhaseService.getCurrentGoal).toHaveBeenCalledWith(userId);
      expect(goalTrackerService.getProgress).toHaveBeenCalledWith(userId);
      expect(userProfileService.getKitchenProfile).toHaveBeenCalledWith(userId);
      expect(executionTrackerService.getTopSubstitutions).toHaveBeenCalledWith(
        userId,
      );

      // Phase 2 calls
      expect(learnedRankingService.getLearnedWeights).toHaveBeenCalledWith(
        'health_seeker',
        userId,
      );
      expect(preferenceProfileService.getRegionalBoostMap).toHaveBeenCalledWith(
        'CN',
      );
    });

    it('should use enrichedProfile.regionCode for regionalBoostMap, fallback to CN', async () => {
      const { service, profileResolver, preferenceProfileService } =
        createService();

      // Case 1: regionCode present — use it directly
      profileResolver.resolveWithDomainProfiles.mockResolvedValue({
        ...mockEnrichedProfile,
        regionCode: 'GD',
      });

      await service.aggregateForRecommendation(userId, mealType);
      expect(preferenceProfileService.getRegionalBoostMap).toHaveBeenCalledWith(
        'GD',
      );

      // Case 2: regionCode falsy — fallback to default ('US' or locale-inferred)
      profileResolver.resolveWithDomainProfiles.mockResolvedValue({
        ...mockEnrichedProfile,
        regionCode: '',
      });

      await service.aggregateForRecommendation(userId, mealType);
      expect(preferenceProfileService.getRegionalBoostMap).toHaveBeenCalledWith(
        'US',
      );

      // Case 3: regionCode undefined — fallback to default ('US')
      profileResolver.resolveWithDomainProfiles.mockResolvedValue({
        ...mockEnrichedProfile,
        regionCode: undefined,
      });

      await service.aggregateForRecommendation(userId, mealType);
      expect(preferenceProfileService.getRegionalBoostMap).toHaveBeenCalledWith(
        'US',
      );
    });

    it('should use enrichedProfile.inferred.userSegment for learnedWeights', async () => {
      const { service, profileResolver, learnedRankingService } =
        createService();

      profileResolver.resolveWithDomainProfiles.mockResolvedValue({
        ...mockEnrichedProfile,
        inferred: { userSegment: 'muscle_builder' },
      });

      await service.aggregateForRecommendation(userId, mealType);

      expect(learnedRankingService.getLearnedWeights).toHaveBeenCalledWith(
        'muscle_builder',
        userId,
      );
    });
  });

  // ────────────────────────────────────────
  // aggregateForScenario
  // ────────────────────────────────────────
  describe('aggregateForScenario', () => {
    it('should return recentFoodNames and enrichedProfile', async () => {
      const { service } = createService();

      const result = await service.aggregateForScenario(userId, mealType);

      expect(result).toEqual({
        recentFoodNames: mockRecentFoodNames,
        enrichedProfile: mockEnrichedProfile,
      });
    });

    it('should call profileResolver.resolve (not resolveWithDomainProfiles)', async () => {
      const { service, profileResolver } = createService();

      await service.aggregateForScenario(userId, mealType);

      expect(profileResolver.resolve).toHaveBeenCalledWith(userId, mealType);
      expect(profileResolver.resolveWithDomainProfiles).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────
  // getShortTermProfile
  // ────────────────────────────────────────
  describe('getShortTermProfile', () => {
    it('should delegate to realtimeProfile.getShortTermProfile', async () => {
      const { service, realtimeProfile } = createService();

      const result = await service.getShortTermProfile(userId);

      expect(realtimeProfile.getShortTermProfile).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockShortTermProfile);
    });

    it('should return null when realtimeProfile returns null', async () => {
      const { service, realtimeProfile } = createService();

      realtimeProfile.getShortTermProfile.mockResolvedValue(null);

      const result = await service.getShortTermProfile(userId);

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────
  // getRecommendationPreferences
  // ────────────────────────────────────────
  describe('getRecommendationPreferences', () => {
    it('should delegate to userProfileService.getRecommendationPreferences', async () => {
      const { service, userProfileService } = createService();

      const result = await service.getRecommendationPreferences(userId);

      expect(
        userProfileService.getRecommendationPreferences,
      ).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockRecommendationPreferences);
    });
  });
});
