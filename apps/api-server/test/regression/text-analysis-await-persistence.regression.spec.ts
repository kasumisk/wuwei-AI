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

describe('FoodTextAnalyzeController persistence regression', () => {
  it('waits for text analysis persistence before returning analysisId', async () => {
    const textFoodAnalysisService = {
      analyze: jest.fn().mockResolvedValue({
        analysisId: 'analysis-1',
        foods: [],
        totals: { calories: 120, protein: 1, fat: 2, carbs: 20 },
        score: { nutritionScore: 80, healthScore: 80, confidenceScore: 90 },
        decision: { recommendation: 'recommend', shouldEat: true },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodTextAnalyzeController],
      providers: [
        { provide: TextFoodAnalysisService, useValue: textFoodAnalysisService },
        {
          provide: QuotaGateService,
          useValue: {
            checkAccess: jest.fn().mockResolvedValue({
              allowed: true,
              quotaConsumed: true,
            }),
          },
        },
        { provide: QuotaService, useValue: { rollback: jest.fn() } },
        {
          provide: ResultEntitlementService,
          useValue: { trimResult: jest.fn().mockImplementation((value) => value) },
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
            buildTextAnalysisCacheKey: jest.fn().mockReturnValue('cache-key'),
            getFromTextAnalysisCache: jest.fn().mockReturnValue(null),
            localizeAnalysisResult: jest.fn().mockResolvedValue(undefined),
            setToTextAnalysisCache: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: {} },
        { provide: AnalysisSessionService, useValue: {} },
      ],
    }).compile();

    const controller = moduleRef.get(FoodTextAnalyzeController);

    const response = await controller.analyzeText(
      { text: 'apple' } as any,
      { id: 'user-1' } as any,
    );

    expect(response.success).toBe(true);
    expect(textFoodAnalysisService.analyze).toHaveBeenCalledWith(
      'apple',
      undefined,
      'user-1',
      undefined,
      undefined,
      undefined,
      {
        awaitPersistence: true,
      },
    );
  });

  it('ignores stale cached analysis results whose analysis record is missing', async () => {
    const textFoodAnalysisService = {
      analyze: jest.fn().mockResolvedValue({
        analysisId: 'analysis-2',
        foods: [],
        totals: { calories: 120, protein: 1, fat: 2, carbs: 20 },
        score: { nutritionScore: 80, healthScore: 80, confidenceScore: 90 },
        decision: { recommendation: 'recommend', shouldEat: true },
      }),
    };

    const prisma = {
      foodAnalysisRecords: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const helper = {
      buildTextAnalysisCacheKey: jest.fn().mockReturnValue('cache-key'),
      getFromTextAnalysisCache: jest.fn().mockReturnValue({
        analysisId: 'stale-analysis-id',
        foods: [],
        totals: { calories: 100, protein: 1, fat: 1, carbs: 20 },
        score: { nutritionScore: 75, healthScore: 75, confidenceScore: 88 },
        decision: { recommendation: 'recommend', shouldEat: true },
      }),
      localizeAnalysisResult: jest.fn().mockResolvedValue(undefined),
      setToTextAnalysisCache: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodTextAnalyzeController],
      providers: [
        { provide: TextFoodAnalysisService, useValue: textFoodAnalysisService },
        {
          provide: QuotaGateService,
          useValue: {
            checkAccess: jest.fn().mockResolvedValue({
              allowed: true,
              quotaConsumed: true,
            }),
          },
        },
        { provide: QuotaService, useValue: { rollback: jest.fn() } },
        {
          provide: ResultEntitlementService,
          useValue: { trimResult: jest.fn().mockImplementation((value) => value) },
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
          useValue: helper,
        },
        { provide: PrismaService, useValue: prisma },
        { provide: AnalysisSessionService, useValue: {} },
      ],
    }).compile();

    const controller = moduleRef.get(FoodTextAnalyzeController);

    const response = await controller.analyzeText(
      { text: 'apple' } as any,
      { id: 'user-1' } as any,
    );

    expect(response.success).toBe(true);
    expect(prisma.foodAnalysisRecords.findUnique).toHaveBeenCalledWith({
      where: { id: 'stale-analysis-id' },
      select: { id: true },
    });
    expect(textFoodAnalysisService.analyze).toHaveBeenCalledTimes(1);
    expect(helper.localizeAnalysisResult).toHaveBeenCalledTimes(1);
    expect(helper.setToTextAnalysisCache).toHaveBeenCalledTimes(1);
  });
});
