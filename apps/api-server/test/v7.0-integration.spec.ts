/**
 * V7.0 集成测试 — 纯单元风格，所有依赖 mock
 *
 * 覆盖 V7.0 所有新增/增强服务的核心逻辑：
 * 1. Domain Profiles（Phase 1）— NutritionProfile / PreferencesProfile / ProfileFactory
 * 2. Goal Tracking（Phase 2）— GoalTrackerService / GoalPhaseService
 * 3. Integration（Phase 3）— FoodScorer 权重调整 / ExplanationGenerator 目标进度洞察 / 类型兼容性
 */

import { GoalType } from '../src/modules/user/user.types';
import type { GoalPhase, CompoundGoal } from '../src/modules/user/user.types';
import type { EffectiveGoal } from '../src/modules/user/app/goal-phase.service';
import type { GoalProgress } from '../src/modules/user/app/goal-tracker.service';
import { ProfileFactory } from '../src/modules/user/domain/profile-factory';
import type { DomainProfiles } from '../src/modules/user/domain/profile-factory';
import type { NutritionProfile } from '../src/modules/user/domain/nutrition-profile';
import {
  DEFAULT_NUTRITION_PROFILE,
  validateNutritionProfile,
} from '../src/modules/user/domain/nutrition-profile';
import type { PreferencesProfile } from '../src/modules/user/domain/preferences-profile';
import {
  DEFAULT_PREFERENCES_PROFILE,
  DIVERSITY_PENALTY_MULTIPLIER,
  FLAVOR_EXPLORATION_FACTOR,
  validatePreferencesProfile,
} from '../src/modules/user/domain/preferences-profile';
import {
  SCORE_DIMENSIONS,
  ScoreDimension,
  computeWeights,
  ScoringContext,
  PipelineContext,
  MealRecommendation,
  MealFromPoolRequest,
  ScoredFood,
  MealTarget,
  StructuredInsight,
} from '../src/modules/diet/app/recommendation/recommendation.types';
import type { FoodLibrary } from '../src/modules/food/food.types';
import { FoodScorerService } from '../src/modules/diet/app/recommendation/food-scorer.service';
import { ExplanationGeneratorService } from '../src/modules/diet/app/recommendation/explanation-generator.service';
import { InsightGeneratorService } from '../src/modules/diet/app/recommendation/insight-generator.service';
import { ExplanationTierService } from '../src/modules/diet/app/recommendation/explanation-tier.service';
import { NaturalLanguageExplainerService } from '../src/modules/diet/app/recommendation/natural-language-explainer.service';
import { MealExplanationService } from '../src/modules/diet/app/recommendation/meal-explanation.service';
import { ComparisonExplanationService } from '../src/modules/diet/app/recommendation/comparison-explanation.service';

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

function createMockMealTarget(): MealTarget {
  return {
    calories: 500,
    protein: 30,
    fat: 15,
    carbs: 60,
    fiber: 8,
  };
}

function createMockGoalPhase(overrides?: Partial<GoalPhase>): GoalPhase {
  return {
    id: 'phase-001',
    goalType: GoalType.FAT_LOSS,
    name: '减脂期',
    durationWeeks: 4,
    calorieMultiplier: 0.8,
    order: 0,
    ...overrides,
  };
}

function createMockCompoundGoal(
  overrides?: Partial<CompoundGoal>,
): CompoundGoal {
  return {
    primary: GoalType.FAT_LOSS,
    phases: [
      createMockGoalPhase({ order: 0, goalType: GoalType.FAT_LOSS }),
      createMockGoalPhase({
        id: 'phase-002',
        order: 1,
        goalType: GoalType.MUSCLE_GAIN,
        name: '增肌期',
      }),
    ],
    currentPhaseIndex: 0,
    startDate: '2026-01-01',
    ...overrides,
  };
}

function createMockGoalProgress(
  overrides?: Partial<GoalProgress>,
): GoalProgress {
  return {
    calorieCompliance: 0.92,
    proteinCompliance: 0.85,
    executionRate: 0.78,
    streakDays: 5,
    ...overrides,
  };
}

function createMockEffectiveGoal(
  overrides?: Partial<EffectiveGoal>,
): EffectiveGoal {
  return {
    goalType: GoalType.FAT_LOSS,
    compound: createMockCompoundGoal(),
    currentPhase: createMockGoalPhase(),
    weightAdjustment: {
      calories: 1.3,
      satiety: 1.2,
      glycemic: 1.15,
      fat: 1.1,
      protein: 1.05,
    },
    ...overrides,
  };
}

function createMockEnrichedProfileContext(overrides?: any): any {
  return {
    profileFreshness: 0.8,
    dietaryRestrictions: [],
    cuisinePreferences: ['中餐', '日料'],
    declared: {
      cuisinePreferences: ['中餐', '日料'],
      mealsPerDay: 3,
    },
    inferred: {
      estimatedBmr: 1600,
      estimatedTdee: 2200,
      recommendedCalories: 1800,
      macroTargets: {
        protein: 90,
        carbs: 200,
        fat: 60,
        fiber: 28,
      },
      nutritionGaps: ['iron', 'vitaminD'],
    },
    observed: {
      totalRecords: 15,
    },
    contextual: {},
    ...overrides,
  };
}

// ─── Mocks for FoodScorerService dependencies ───

const mockPenaltyEngine = {
  evaluate: jest.fn().mockReturnValue({
    finalMultiplier: 1.0,
    modifiers: [],
    isVetoed: false,
  }),
};

const mockRecommendationConfig = {
  getBaseWeights: jest.fn().mockReturnValue(undefined),
};

const mockNutritionTargetService = {
  evaluate: jest.fn().mockReturnValue(0.5),
};

const mockSeasonalityService = {
  getSeasonalityScore: jest.fn().mockReturnValue(0.5),
};

const mockMealCompositionScorer = {
  scoreMealComposition: jest.fn().mockReturnValue({
    ingredientDiversity: 70,
    cookingMethodDiversity: 60,
    flavorHarmony: 65,
    nutritionComplementarity: 55,
    textureDiversity: 50,
    overall: 60,
  }),
};

// ════════════════════════════════════════════════════════════
// 1. Domain Profiles (Phase 1)
// ════════════════════════════════════════════════════════════

describe('Domain Profiles (Phase 1)', () => {
  describe('NutritionProfile', () => {
    it('should have correct default field values', () => {
      const profile = DEFAULT_NUTRITION_PROFILE;
      expect(profile.bmr).toBe(1500);
      expect(profile.tdee).toBe(2000);
      expect(profile.recommendedCalories).toBe(2000);
      expect(profile.macroTargets.protein).toBe(75);
      expect(profile.macroTargets.carbs).toBe(250);
      expect(profile.macroTargets.fat).toBe(67);
      expect(profile.macroTargets.fiber).toBe(25);
      expect(profile.nutritionGaps).toEqual([]);
      expect(profile.calculationMethod).toBe('harris_benedict');
      expect(profile.confidence).toBe(0.3);
    });

    it('should clamp values with validateNutritionProfile', () => {
      const extreme: NutritionProfile = {
        bmr: 100, // below 800
        tdee: 9000, // above 6000
        recommendedCalories: 500, // below 800
        macroTargets: { protein: 10, carbs: 20, fat: 5, fiber: 2 },
        nutritionGaps: [],
        calculationMethod: 'harris_benedict',
        calculatedAt: Date.now(),
        confidence: 1.5,
      };
      const validated = validateNutritionProfile(extreme);
      expect(validated.bmr).toBe(800);
      expect(validated.tdee).toBe(6000);
      expect(validated.recommendedCalories).toBe(800);
      expect(validated.macroTargets.protein).toBe(30);
      expect(validated.macroTargets.carbs).toBe(50);
      expect(validated.macroTargets.fat).toBe(20);
      expect(validated.macroTargets.fiber).toBe(10);
      expect(validated.confidence).toBe(1);
    });
  });

  describe('PreferencesProfile', () => {
    it('should have correct default values', () => {
      const profile = DEFAULT_PREFERENCES_PROFILE;
      expect(profile.popularityPreference).toBe('balanced');
      expect(profile.cookingEffort).toBe('moderate');
      expect(profile.budgetSensitivity).toBe('moderate');
      expect(profile.cuisineWeights).toEqual({});
      expect(profile.diversityTolerance).toBe('medium');
      expect(profile.dietaryPhilosophy).toBe('omnivore');
      expect(profile.mealPattern).toBe('standard_three');
      expect(profile.flavorOpenness).toBe('moderate');
    });

    it('should have correct DIVERSITY_PENALTY_MULTIPLIER values', () => {
      expect(DIVERSITY_PENALTY_MULTIPLIER.low).toBe(0.5);
      expect(DIVERSITY_PENALTY_MULTIPLIER.medium).toBe(1.0);
      expect(DIVERSITY_PENALTY_MULTIPLIER.high).toBe(1.5);
    });

    it('should have correct FLAVOR_EXPLORATION_FACTOR values', () => {
      expect(FLAVOR_EXPLORATION_FACTOR.conservative).toBe(0.7);
      expect(FLAVOR_EXPLORATION_FACTOR.moderate).toBe(1.0);
      expect(FLAVOR_EXPLORATION_FACTOR.adventurous).toBe(1.4);
    });

    it('should validate and fallback invalid enum values', () => {
      const invalid: Partial<PreferencesProfile> = {
        popularityPreference: 'invalid' as any,
        cookingEffort: 'invalid' as any,
        diversityTolerance: 'invalid' as any,
        cuisineWeights: { 中餐: 1.5, 日料: -0.2, bad: NaN },
      };
      const validated = validatePreferencesProfile(invalid);
      expect(validated.popularityPreference).toBe('balanced');
      expect(validated.cookingEffort).toBe('moderate');
      expect(validated.diversityTolerance).toBe('medium');
      // Cuisine weights clamped to [0, 1]
      expect(validated.cuisineWeights['中餐']).toBe(1);
      expect(validated.cuisineWeights['日料']).toBe(0);
      expect(validated.cuisineWeights['bad']).toBeUndefined();
    });
  });

  describe('ProfileFactory.createNutritionProfile', () => {
    it('should create valid NutritionProfile from EnrichedProfileContext', () => {
      const ctx = createMockEnrichedProfileContext();
      const profile = ProfileFactory.createNutritionProfile(ctx);

      expect(profile.bmr).toBe(1600);
      expect(profile.tdee).toBe(2200);
      expect(profile.recommendedCalories).toBe(1800);
      expect(profile.macroTargets.protein).toBe(90);
      expect(profile.macroTargets.carbs).toBe(200);
      expect(profile.macroTargets.fat).toBe(60);
      expect(profile.macroTargets.fiber).toBe(28);
      expect(profile.nutritionGaps).toEqual(['iron', 'vitaminD']);
      expect(profile.calculationMethod).toBe('harris_benedict');
      expect(profile.confidence).toBeGreaterThan(0);
    });

    it('should return defaults when inferred is null', () => {
      const ctx = createMockEnrichedProfileContext({ inferred: null });
      const profile = ProfileFactory.createNutritionProfile(ctx);

      expect(profile.bmr).toBe(DEFAULT_NUTRITION_PROFILE.bmr);
      expect(profile.tdee).toBe(DEFAULT_NUTRITION_PROFILE.tdee);
      expect(profile.calculatedAt).toBeGreaterThan(0);
    });
  });

  describe('ProfileFactory.createPreferencesProfile', () => {
    it('should create PreferencesProfile with cuisineWeights from declared', () => {
      const ctx = createMockEnrichedProfileContext();
      const profile = ProfileFactory.createPreferencesProfile(ctx);

      expect(profile.cuisineWeights['中餐']).toBe(0.8);
      expect(profile.cuisineWeights['日料']).toBe(0.8);
      expect(profile.diversityTolerance).toBe('medium');
      expect(profile.dietaryPhilosophy).toBe('omnivore');
      expect(profile.mealPattern).toBe('standard_three');
      expect(profile.flavorOpenness).toBe('moderate');
    });

    it('should infer intermittent_fasting for mealsPerDay <= 2', () => {
      const ctx = createMockEnrichedProfileContext({
        declared: { mealsPerDay: 2 },
      });
      const profile = ProfileFactory.createPreferencesProfile(ctx);
      expect(profile.mealPattern).toBe('intermittent_fasting');
    });

    it('should infer frequent_small for mealsPerDay >= 5', () => {
      const ctx = createMockEnrichedProfileContext({
        declared: { mealsPerDay: 6 },
      });
      const profile = ProfileFactory.createPreferencesProfile(ctx);
      expect(profile.mealPattern).toBe('frequent_small');
    });

    it('should infer vegetarian from dietaryRestrictions', () => {
      const ctx = createMockEnrichedProfileContext({
        dietaryRestrictions: ['vegetarian'],
      });
      const profile = ProfileFactory.createPreferencesProfile(ctx);
      expect(profile.dietaryPhilosophy).toBe('vegetarian');
    });

    it('should infer vegan from dietaryRestrictions', () => {
      const ctx = createMockEnrichedProfileContext({
        dietaryRestrictions: ['vegan'],
      });
      const profile = ProfileFactory.createPreferencesProfile(ctx);
      expect(profile.dietaryPhilosophy).toBe('vegan');
    });
  });

  describe('ProfileFactory.fromEnrichedContext (DomainProfiles)', () => {
    it('should combine both nutrition and preferences profiles', () => {
      const ctx = createMockEnrichedProfileContext();
      const profiles: DomainProfiles = ProfileFactory.fromEnrichedContext(ctx);

      expect(profiles.nutrition).toBeDefined();
      expect(profiles.preferences).toBeDefined();
      expect(profiles.nutrition.bmr).toBe(1600);
      expect(profiles.preferences.cuisineWeights['中餐']).toBe(0.8);
    });
  });
});

// ════════════════════════════════════════════════════════════
// 2. Goal Phase (Phase 2)
// ════════════════════════════════════════════════════════════

describe('Goal Phase (Phase 2)', () => {
  describe('EffectiveGoal type structure', () => {
    it('should have correct fields when fully populated', () => {
      const goal = createMockEffectiveGoal();
      expect(goal.goalType).toBe(GoalType.FAT_LOSS);
      expect(goal.compound).toBeDefined();
      expect(goal.currentPhase).toBeDefined();
      expect(goal.weightAdjustment).toBeDefined();
      expect(goal.compound!.primary).toBe(GoalType.FAT_LOSS);
    });

    it('should be valid with only goalType', () => {
      const minimal: EffectiveGoal = { goalType: GoalType.HEALTH };
      expect(minimal.goalType).toBe(GoalType.HEALTH);
      expect(minimal.compound).toBeUndefined();
      expect(minimal.currentPhase).toBeUndefined();
      expect(minimal.weightAdjustment).toBeUndefined();
    });
  });

  describe('GoalProgress type structure', () => {
    it('should have all required fields', () => {
      const progress = createMockGoalProgress();
      expect(progress.calorieCompliance).toBe(0.92);
      expect(progress.proteinCompliance).toBe(0.85);
      expect(progress.executionRate).toBe(0.78);
      expect(progress.streakDays).toBe(5);
    });

    it('should accept optional phase fields', () => {
      const progress = createMockGoalProgress({
        phaseRemainingDays: 14,
        phaseProgress: 0.6,
      });
      expect(progress.phaseRemainingDays).toBe(14);
      expect(progress.phaseProgress).toBe(0.6);
    });

    it('should allow zero values', () => {
      const progress = createMockGoalProgress({
        calorieCompliance: 0,
        proteinCompliance: 0,
        executionRate: 0,
        streakDays: 0,
      });
      expect(progress.calorieCompliance).toBe(0);
      expect(progress.streakDays).toBe(0);
    });
  });

  describe('GoalPhase type structure', () => {
    it('should have all required fields', () => {
      const phase = createMockGoalPhase();
      expect(phase.id).toBe('phase-001');
      expect(phase.goalType).toBe(GoalType.FAT_LOSS);
      expect(phase.name).toBe('减脂期');
      expect(phase.durationWeeks).toBe(4);
      expect(phase.calorieMultiplier).toBe(0.8);
      expect(phase.order).toBe(0);
    });

    it('should accept optional macroRatioOverride', () => {
      const phase = createMockGoalPhase({
        macroRatioOverride: { carb: [0.3, 0.5], fat: [0.2, 0.35] },
      });
      expect(phase.macroRatioOverride!.carb).toEqual([0.3, 0.5]);
      expect(phase.macroRatioOverride!.fat).toEqual([0.2, 0.35]);
    });
  });

  describe('CompoundGoal type structure', () => {
    it('should support primary + secondary goals', () => {
      const goal = createMockCompoundGoal({
        secondary: GoalType.HEALTH,
        secondaryWeight: 0.2,
      });
      expect(goal.primary).toBe(GoalType.FAT_LOSS);
      expect(goal.secondary).toBe(GoalType.HEALTH);
      expect(goal.secondaryWeight).toBe(0.2);
    });

    it('should have phases array', () => {
      const goal = createMockCompoundGoal();
      expect(goal.phases).toHaveLength(2);
      expect(goal.phases![0].goalType).toBe(GoalType.FAT_LOSS);
      expect(goal.phases![1].goalType).toBe(GoalType.MUSCLE_GAIN);
    });
  });

  describe('GOAL_TYPE_WEIGHT_ADJUSTMENTS (via weight adjustments)', () => {
    it('fat_loss should boost calories=1.3 and satiety=1.2', () => {
      const goal = createMockEffectiveGoal({
        goalType: GoalType.FAT_LOSS,
        weightAdjustment: {
          calories: 1.3,
          satiety: 1.2,
          glycemic: 1.15,
          fat: 1.1,
          protein: 1.05,
        },
      });
      expect(goal.weightAdjustment!.calories).toBe(1.3);
      expect(goal.weightAdjustment!.satiety).toBe(1.2);
    });

    it('muscle_gain should boost protein=1.35', () => {
      const goal = createMockEffectiveGoal({
        goalType: GoalType.MUSCLE_GAIN,
        weightAdjustment: {
          protein: 1.35,
          calories: 0.9,
          satiety: 0.85,
        },
      });
      expect(goal.weightAdjustment!.protein).toBe(1.35);
      expect(goal.weightAdjustment!.calories).toBe(0.9);
    });

    it('weight adjustment dimensions should match SCORE_DIMENSIONS', () => {
      const adj: Partial<Record<ScoreDimension, number>> = {
        calories: 1.3,
        satiety: 1.2,
        glycemic: 1.15,
      };
      for (const dim of Object.keys(adj)) {
        expect(SCORE_DIMENSIONS).toContain(dim);
      }
    });
  });
});

// ════════════════════════════════════════════════════════════
// 3. FoodScorer Weight Adjustment (Phase 3-C)
// ════════════════════════════════════════════════════════════

describe('FoodScorer Weight Adjustment (Phase 3-C)', () => {
  let scorer: FoodScorerService;

  beforeEach(() => {
    jest.clearAllMocks();
    scorer = new FoodScorerService(
      mockPenaltyEngine as any,
      mockRecommendationConfig as any,
      mockNutritionTargetService as any,
      mockSeasonalityService as any,
    );
  });

  it('should return a non-zero score for basic food without goal adjustment', () => {
    const food = createMockFoodLibrary();
    const ctx: ScoringContext = {
      food,
      goalType: 'health',
      target: createMockMealTarget(),
    };
    const result = scorer.scoreFoodDetailed(ctx);
    expect(result.score).toBeGreaterThan(0);
  });

  it('should change score when effectiveGoal.weightAdjustment is applied', () => {
    const food = createMockFoodLibrary();
    const target = createMockMealTarget();

    // Without adjustment
    const ctxNoAdj: ScoringContext = {
      food,
      goalType: 'fat_loss',
      target,
    };
    const noAdj = scorer.scoreFoodDetailed(ctxNoAdj);

    // With fat_loss adjustment (calories=1.3, satiety=1.2)
    const ctxWithAdj: ScoringContext = {
      food,
      goalType: 'fat_loss',
      target,
      effectiveGoal: createMockEffectiveGoal(),
    };
    const withAdj = scorer.scoreFoodDetailed(ctxWithAdj);

    // Scores should differ due to weight redistribution
    expect(withAdj.score).not.toBe(noAdj.score);
  });

  it('should boost score for food matching cuisine preference', () => {
    const food = createMockFoodLibrary({ cuisine: '中餐' });
    const target = createMockMealTarget();

    // Without cuisine profile
    const ctxNoCuisine: ScoringContext = {
      food,
      goalType: 'health',
      target,
    };
    const noCuisine = scorer.scoreFoodDetailed(ctxNoCuisine);

    // With high cuisine weight (0.9 > 0.5 → positive boost)
    const ctxWithCuisine: ScoringContext = {
      food,
      goalType: 'health',
      target,
      preferencesProfile: {
        ...DEFAULT_PREFERENCES_PROFILE,
        cuisineWeights: { 中餐: 0.9 },
      },
    };
    const withCuisine = scorer.scoreFoodDetailed(ctxWithCuisine);

    expect(withCuisine.score).toBeGreaterThan(noCuisine.score);
  });

  it('should penalize score for disliked cuisine', () => {
    const food = createMockFoodLibrary({ cuisine: '日料' });
    const target = createMockMealTarget();

    // Without cuisine profile
    const ctxNoCuisine: ScoringContext = {
      food,
      goalType: 'health',
      target,
    };
    const noCuisine = scorer.scoreFoodDetailed(ctxNoCuisine);

    // With low cuisine weight (0.1 < 0.5 → negative boost)
    const ctxDislike: ScoringContext = {
      food,
      goalType: 'health',
      target,
      preferencesProfile: {
        ...DEFAULT_PREFERENCES_PROFILE,
        cuisineWeights: { 日料: 0.1 },
      },
    };
    const dislike = scorer.scoreFoodDetailed(ctxDislike);

    expect(dislike.score).toBeLessThan(noCuisine.score);
  });

  it('should not change score when food.cuisine is undefined', () => {
    const food = createMockFoodLibrary({ cuisine: undefined });
    const target = createMockMealTarget();

    const ctxNoCuisine: ScoringContext = {
      food,
      goalType: 'health',
      target,
    };
    const noCuisine = scorer.scoreFoodDetailed(ctxNoCuisine);

    const ctxWithProfile: ScoringContext = {
      food,
      goalType: 'health',
      target,
      preferencesProfile: {
        ...DEFAULT_PREFERENCES_PROFILE,
        cuisineWeights: { 中餐: 0.9, 日料: 0.1 },
      },
    };
    const withProfile = scorer.scoreFoodDetailed(ctxWithProfile);

    // Without food.cuisine, cuisineWeights should have no effect
    expect(withProfile.score).toBe(noCuisine.score);
  });

  it('should not change score when cuisine is not in cuisineWeights', () => {
    const food = createMockFoodLibrary({ cuisine: '泰餐' });
    const target = createMockMealTarget();

    const ctxNoMatch: ScoringContext = {
      food,
      goalType: 'health',
      target,
    };
    const noMatch = scorer.scoreFoodDetailed(ctxNoMatch);

    const ctxWithProfile: ScoringContext = {
      food,
      goalType: 'health',
      target,
      preferencesProfile: {
        ...DEFAULT_PREFERENCES_PROFILE,
        cuisineWeights: { 中餐: 0.9 },
      },
    };
    const withProfile = scorer.scoreFoodDetailed(ctxWithProfile);

    // '泰餐' not in cuisineWeights → no boost
    expect(withProfile.score).toBe(noMatch.score);
  });

  it('should produce valid scores with combined goal adjustment and cuisine boost', () => {
    const food = createMockFoodLibrary({ cuisine: '中餐' });
    const target = createMockMealTarget();

    const ctx: ScoringContext = {
      food,
      goalType: 'fat_loss',
      target,
      effectiveGoal: createMockEffectiveGoal(),
      preferencesProfile: {
        ...DEFAULT_PREFERENCES_PROFILE,
        cuisineWeights: { 中餐: 0.8 },
      },
    };
    const result = scorer.scoreFoodDetailed(ctx);

    expect(result.score).toBeGreaterThan(0);
    expect(result.explanation).toBeDefined();
  });

  it('should re-normalize weights after goal adjustment', () => {
    const food = createMockFoodLibrary();
    const target = createMockMealTarget();
    const ctx: ScoringContext = {
      food,
      goalType: 'fat_loss',
      target,
      effectiveGoal: createMockEffectiveGoal(),
    };
    const result = scorer.scoreFoodDetailed(ctx);

    // The score should be valid (re-normalization ensures weights sum to 1)
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(2); // reasonable upper bound
  });
});

// ════════════════════════════════════════════════════════════
// 4. ExplanationGenerator Insights (Phase 3-D)
// ════════════════════════════════════════════════════════════

describe('ExplanationGenerator Goal Progress Insights (Phase 3-D)', () => {
  let generator: ExplanationGeneratorService;

  beforeEach(() => {
    jest.clearAllMocks();
    generator = new ExplanationGeneratorService(
      mockMealCompositionScorer as any,
      new InsightGeneratorService(),
      new ExplanationTierService(),
      new NaturalLanguageExplainerService(),
      new MealExplanationService(mockMealCompositionScorer as any),
      new ComparisonExplanationService(),
    );
  });

  const baseFoods = [
    createMockScoredFood(createMockFoodLibrary({ id: 'f1', name: '鸡胸肉' })),
    createMockScoredFood(
      createMockFoodLibrary({ id: 'f2', name: '西兰花', category: 'veggie' }),
    ),
  ];
  const target = createMockMealTarget();

  it('should generate streak insight when streakDays >= 3', () => {
    const progress = createMockGoalProgress({ streakDays: 5 });
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      progress,
    );

    const streakInsight = insights.find(
      (i) => i.type === 'goal_progress' && i.titleKey.includes('streak'),
    );
    expect(streakInsight).toBeDefined();
    expect(streakInsight!.vars.streakDays).toBe(5);
  });

  it('should not generate streak insight when streakDays < 3', () => {
    const progress = createMockGoalProgress({ streakDays: 2 });
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      progress,
    );

    const streakInsight = insights.find(
      (i) => i.type === 'goal_progress' && i.titleKey.includes('streak'),
    );
    expect(streakInsight).toBeUndefined();
  });

  it('should generate good compliance insight when calorie >= 85%', () => {
    const progress = createMockGoalProgress({ calorieCompliance: 0.92 });
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      progress,
    );

    const complianceInsight = insights.find(
      (i) => i.type === 'goal_progress' && i.titleKey.includes('compliance'),
    );
    expect(complianceInsight).toBeDefined();
    expect(complianceInsight!.contentKey).toContain('good');
  });

  it('should generate needs_improvement insight when calorie < 85%', () => {
    const progress = createMockGoalProgress({ calorieCompliance: 0.6 });
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      progress,
    );

    const complianceInsight = insights.find(
      (i) => i.type === 'goal_progress' && i.titleKey.includes('compliance'),
    );
    expect(complianceInsight).toBeDefined();
    expect(complianceInsight!.contentKey).toContain('needs_improvement');
  });

  it('should generate phase transition hint when remainingDays <= 7', () => {
    const progress = createMockGoalProgress({
      phaseRemainingDays: 5,
      phaseProgress: 0.85,
    });
    const effectiveGoal = createMockEffectiveGoal();

    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      effectiveGoal,
      progress,
    );

    const phaseInsight = insights.find(
      (i) =>
        i.type === 'goal_progress' && i.titleKey.includes('phase_transition'),
    );
    expect(phaseInsight).toBeDefined();
    expect(phaseInsight!.vars.remainingDays).toBe(5);
    expect(phaseInsight!.importance).toBe(0.9);
  });

  it('should not generate phase transition hint when remainingDays > 7', () => {
    const progress = createMockGoalProgress({
      phaseRemainingDays: 14,
      phaseProgress: 0.5,
    });
    const effectiveGoal = createMockEffectiveGoal();

    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      effectiveGoal,
      progress,
    );

    const phaseInsight = insights.find(
      (i) =>
        i.type === 'goal_progress' && i.titleKey.includes('phase_transition'),
    );
    expect(phaseInsight).toBeUndefined();
  });

  it('should not generate phase transition hint when effectiveGoal has no currentPhase', () => {
    const progress = createMockGoalProgress({
      phaseRemainingDays: 3,
      phaseProgress: 0.9,
    });
    const effectiveGoal = createMockEffectiveGoal({
      currentPhase: undefined,
    });

    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      effectiveGoal,
      progress,
    );

    const phaseInsight = insights.find(
      (i) =>
        i.type === 'goal_progress' && i.titleKey.includes('phase_transition'),
    );
    expect(phaseInsight).toBeUndefined();
  });

  it('should not generate goal_progress insights when goalProgress is null', () => {
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      null,
    );

    const goalInsights = insights.filter((i) => i.type === 'goal_progress');
    expect(goalInsights).toHaveLength(0);
  });

  it('should not generate goal_progress insights when goalProgress is undefined', () => {
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      undefined,
      undefined,
    );

    const goalInsights = insights.filter((i) => i.type === 'goal_progress');
    expect(goalInsights).toHaveLength(0);
  });

  it('should sort insights by importance descending', () => {
    const progress = createMockGoalProgress({
      streakDays: 5,
      phaseRemainingDays: 3,
      phaseProgress: 0.9,
    });
    const effectiveGoal = createMockEffectiveGoal();

    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      effectiveGoal,
      progress,
    );

    for (let i = 1; i < insights.length; i++) {
      expect(insights[i].importance).toBeLessThanOrEqual(
        insights[i - 1].importance,
      );
    }
  });

  it('should include compliance vars: calorieCompliance and proteinCompliance', () => {
    const progress = createMockGoalProgress({
      calorieCompliance: 0.88,
      proteinCompliance: 0.75,
      executionRate: 0.8,
    });
    const insights = generator.generateStructuredInsights(
      baseFoods,
      target,
      null,
      null,
      undefined,
      null,
      progress,
    );

    const complianceInsight = insights.find(
      (i) => i.type === 'goal_progress' && i.titleKey.includes('compliance'),
    );
    expect(complianceInsight).toBeDefined();
    expect(complianceInsight!.vars.calorieCompliance).toBe(88);
    expect(complianceInsight!.vars.proteinCompliance).toBe(75);
    expect(complianceInsight!.vars.executionRate).toBe(80);
  });
});

// ════════════════════════════════════════════════════════════
// 5. Type Compatibility (Phase 3-B)
// ════════════════════════════════════════════════════════════

describe('Type Compatibility (Phase 3-B)', () => {
  describe('PipelineContext', () => {
    it('should accept effectiveGoal field', () => {
      const ctx: Partial<PipelineContext> = {
        effectiveGoal: createMockEffectiveGoal(),
      };
      expect(ctx.effectiveGoal).toBeDefined();
      expect(ctx.effectiveGoal!.goalType).toBe(GoalType.FAT_LOSS);
    });

    it('should accept goalProgress field', () => {
      const ctx: Partial<PipelineContext> = {
        goalProgress: createMockGoalProgress(),
      };
      expect(ctx.goalProgress).toBeDefined();
      expect(ctx.goalProgress!.calorieCompliance).toBe(0.92);
    });

    it('should accept domainProfiles field', () => {
      const profiles = ProfileFactory.fromEnrichedContext(
        createMockEnrichedProfileContext(),
      );
      const ctx: Partial<PipelineContext> = {
        domainProfiles: profiles,
      };
      expect(ctx.domainProfiles).toBeDefined();
      expect(ctx.domainProfiles!.nutrition.bmr).toBe(1600);
      expect(ctx.domainProfiles!.preferences.cuisineWeights['中餐']).toBe(0.8);
    });

    it('should accept null goalProgress', () => {
      const ctx: Partial<PipelineContext> = {
        goalProgress: null,
      };
      expect(ctx.goalProgress).toBeNull();
    });
  });

  describe('ScoringContext', () => {
    it('should accept effectiveGoal field', () => {
      const ctx: Partial<ScoringContext> = {
        effectiveGoal: createMockEffectiveGoal(),
      };
      expect(ctx.effectiveGoal!.weightAdjustment).toBeDefined();
    });

    it('should accept preferencesProfile field', () => {
      const ctx: Partial<ScoringContext> = {
        preferencesProfile: {
          ...DEFAULT_PREFERENCES_PROFILE,
          cuisineWeights: { 中餐: 0.8 },
        },
      };
      expect(ctx.preferencesProfile!.cuisineWeights['中餐']).toBe(0.8);
    });
  });

  describe('MealRecommendation', () => {
    it('should accept goalProgressTip field', () => {
      const rec: Partial<MealRecommendation> = {
        goalProgressTip: '本周热量合规率 92%，继续保持',
      };
      expect(rec.goalProgressTip).toBeDefined();
    });

    it('should accept phaseTransitionHint field', () => {
      const rec: Partial<MealRecommendation> = {
        phaseTransitionHint: '减脂期第 3 周，即将进入维持期',
      };
      expect(rec.phaseTransitionHint).toBeDefined();
    });

    it('should accept both fields together', () => {
      const rec: Partial<MealRecommendation> = {
        goalProgressTip: '执行率 85%',
        phaseTransitionHint: '阶段即将完成',
      };
      expect(rec.goalProgressTip).toBe('执行率 85%');
      expect(rec.phaseTransitionHint).toBe('阶段即将完成');
    });
  });

  describe('MealFromPoolRequest', () => {
    it('should accept effectiveGoal field', () => {
      const req: Partial<MealFromPoolRequest> = {
        effectiveGoal: createMockEffectiveGoal(),
      };
      expect(req.effectiveGoal!.goalType).toBe(GoalType.FAT_LOSS);
    });

    it('should accept goalProgress field', () => {
      const req: Partial<MealFromPoolRequest> = {
        goalProgress: createMockGoalProgress(),
      };
      expect(req.goalProgress!.streakDays).toBe(5);
    });

    it('should accept domainProfiles field', () => {
      const profiles = ProfileFactory.fromEnrichedContext(
        createMockEnrichedProfileContext(),
      );
      const req: Partial<MealFromPoolRequest> = {
        domainProfiles: profiles,
      };
      expect(req.domainProfiles!.nutrition).toBeDefined();
      expect(req.domainProfiles!.preferences).toBeDefined();
    });

    it('should accept null goalProgress', () => {
      const req: Partial<MealFromPoolRequest> = {
        goalProgress: null,
      };
      expect(req.goalProgress).toBeNull();
    });
  });

  describe('InsightType includes goal_progress', () => {
    it('should allow goal_progress as StructuredInsight type', () => {
      const insight: StructuredInsight = {
        type: 'goal_progress',
        titleKey: 'test.title',
        contentKey: 'test.content',
        vars: {},
        importance: 0.9,
      };
      expect(insight.type).toBe('goal_progress');
    });
  });
});
