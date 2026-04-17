import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationEngineService } from './src/modules/decision/analyze/recommendation-engine.service';
import { DecisionCoachService } from './src/modules/decision/analyze/decision-coach.service';
import { I18nService } from './src/config/i18n.service';

describe('V3.2 Phase 2 - Recommendation & Coaching', () => {
  let recommendationEngine: RecommendationEngineService;
  let decisionCoach: DecisionCoachService;
  let module: TestingModule;

  const mockI18nService = {
    t: (key: string) => key,
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        RecommendationEngineService,
        DecisionCoachService,
        { provide: I18nService, useValue: mockI18nService },
      ],
    }).compile();

    recommendationEngine = module.get<RecommendationEngineService>(
      RecommendationEngineService,
    );
    decisionCoach = module.get<DecisionCoachService>(DecisionCoachService);
  });

  it('RecommendationEngineService should be defined', () => {
    expect(recommendationEngine).toBeDefined();
  });

  it('DecisionCoachService should be defined', () => {
    expect(decisionCoach).toBeDefined();
  });

  it('should handle empty recommendations gracefully', () => {
    const recommendations = recommendationEngine.generateRecommendations(
      {
        macroSlotStatus: {
          calories: 'ok',
          protein: 'ok',
          fat: 'ok',
          carbs: 'ok',
        },
        macroProgress: {
          consumed: { calories: 1800, protein: 100, fat: 60, carbs: 200 },
          remaining: { calories: 200, protein: 20, fat: 25, carbs: 50 },
        },
        identifiedIssues: [],
        recommendationContext: {
          remainingCalories: 200,
          targetMacros: { protein: 20, fat: 25, carbs: 50 },
          excludeFoods: [],
          preferredScenarios: [],
        },
      },
      [],
    );

    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should generate coaching explanation', () => {
    const explanation = decisionCoach.generateCoachingExplanation(
      {
        macroSlotStatus: {
          calories: 'ok',
          protein: 'ok',
          fat: 'ok',
          carbs: 'ok',
        },
        macroProgress: {
          consumed: { calories: 1800, protein: 100, fat: 60, carbs: 200 },
          remaining: { calories: 200, protein: 20, fat: 25, carbs: 50 },
        },
        identifiedIssues: [],
        recommendationContext: {
          remainingCalories: 200,
          targetMacros: { protein: 20, fat: 25, carbs: 50 },
          excludeFoods: [],
          preferredScenarios: [],
        },
      },
      'user123',
      'en',
    );

    expect(explanation).toBeDefined();
    expect(explanation).toHaveProperty('headline');
    expect(explanation).toHaveProperty('summary');
    expect(explanation).toHaveProperty('issues');
  });
});
