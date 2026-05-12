import { Test } from '@nestjs/testing';

import { FoodTextAnalyzeController } from '../../src/modules/food/app/controllers/food-text-analyze.controller';
import { TextFoodAnalysisService } from '../../src/modules/food/app/services/text-food-analysis.service';
import { QuotaGateService } from '../../src/modules/subscription/app/services/quota-gate.service';
import { QuotaService } from '../../src/modules/subscription/app/services/quota.service';
import { ResultEntitlementService } from '../../src/modules/subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../src/modules/subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../src/modules/subscription/app/services/subscription.service';
import { I18nService } from '../../src/core/i18n';
import { AnalyzeResultHelperService } from '../../src/modules/food/app/services/analyze-result-helper.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { AnalysisSessionService } from '../../src/modules/food/app/services/analysis-session.service';

describe('FoodTextAnalyzeController refine regression', () => {
  it('reuses the same analysis record when refining text analysis', async () => {
    const fullResult = {
      analysisId: '11111111-1111-1111-1111-111111111111',
      foods: [
        {
          name: 'Chicken breast',
          quantity: '180g',
          calories: 297,
          protein: 55,
          fat: 6,
          carbs: 0,
          foodLibraryId: 'food-lib-1',
        },
      ],
      totals: {
        calories: 297,
        protein: 55,
        fat: 6,
        carbs: 0,
      },
      score: {
        nutritionScore: 82,
        healthScore: 82,
        confidenceScore: 90,
      },
      decision: {
        recommendation: 'recommend',
        shouldEat: true,
        reason: 'high protein',
        riskLevel: 'low',
      },
      alternatives: [],
      explanation: { summary: 'good choice', primaryReason: 'high protein' },
      summary: { headline: 'Chicken breast 297kcal' },
      evidencePack: null,
      shouldEatAction: null,
      structuredDecision: null,
      foodAnalysisPackage: null,
      contextualAnalysis: null,
      unifiedUserContext: null,
      coachActionPlan: null,
      analysisState: null,
      confidenceDiagnostics: null,
    };

    const prisma = {
      foodAnalysisRecords: {
        findUnique: jest.fn().mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          userId: 'user-1',
          status: 'completed',
          mealType: 'lunch',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const textFoodAnalysisService = {
      recomputeFromStructuredFoods: jest.fn().mockResolvedValue(fullResult),
    };

    const resultEntitlementService = {
      trimResult: jest.fn().mockImplementation((result) => result),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodTextAnalyzeController],
      providers: [
        { provide: TextFoodAnalysisService, useValue: textFoodAnalysisService },
        { provide: QuotaGateService, useValue: { checkAccess: jest.fn() } },
        { provide: QuotaService, useValue: { rollback: jest.fn() } },
        {
          provide: ResultEntitlementService,
          useValue: resultEntitlementService,
        },
        {
          provide: PaywallTriggerService,
          useValue: {
            handleAccessDecision: jest.fn(),
            recordResultTrimTrigger: jest.fn(),
          },
        },
        {
          provide: SubscriptionService,
          useValue: {
            getUserSummary: jest.fn().mockResolvedValue({
              tier: 'free',
              entitlements: {},
            }),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn().mockReturnValue('ok'),
            currentLocale: jest.fn().mockReturnValue('en-US'),
          },
        },
        {
          provide: AnalyzeResultHelperService,
          useValue: {
            localizeAnalysisResult: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: AnalysisSessionService,
          useValue: {
            buildDerivedText: jest
              .fn()
              .mockReturnValue('Chicken breast 180克。less oil'),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(FoodTextAnalyzeController);
    const response = await controller.refineTextAnalysis(
      '11111111-1111-1111-1111-111111111111',
      {
        foods: [
          {
            name: 'Chicken breast',
            estimatedWeightGrams: 180,
          },
        ],
        userNote: 'less oil',
        locale: 'en-US',
      } as any,
      { id: 'user-1' } as any,
    );

    expect(response.success).toBe(true);
    expect(response.data.analysisId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(
      textFoodAnalysisService.recomputeFromStructuredFoods,
    ).toHaveBeenCalledWith(
      [
        {
          name: 'Chicken breast',
          estimatedWeightGrams: 180,
        },
      ],
      'lunch',
      'user-1',
      'en-US',
      {
        analysisId: '11111111-1111-1111-1111-111111111111',
        persistRecord: false,
        emitCompletedEvent: false,
      },
    );
    expect(prisma.foodAnalysisRecords.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '11111111-1111-1111-1111-111111111111' },
      }),
    );
  });
});
