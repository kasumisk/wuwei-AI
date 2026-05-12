import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FoodImageAnalyzeController } from '../../src/modules/food/app/controllers/food-image-analyze.controller';
import { AnalyzeService } from '../../src/modules/food/app/services/analyze.service';
import { StorageService } from '../../src/storage/storage.service';
import { TextFoodAnalysisService } from '../../src/modules/food/app/services/text-food-analysis.service';
import { AnalysisSessionService } from '../../src/modules/food/app/services/analysis-session.service';
import { QuotaGateService } from '../../src/modules/subscription/app/services/quota-gate.service';
import { QuotaService } from '../../src/modules/subscription/app/services/quota.service';
import { ResultEntitlementService } from '../../src/modules/subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../src/modules/subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../src/modules/subscription/app/services/subscription.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { I18nService } from '../../src/core/i18n';
import { AnalyzeResultHelperService } from '../../src/modules/food/app/services/analyze-result-helper.service';

describe('FoodImageAnalyzeController analysisId race regression', () => {
  it('returns null analysisId instead of requestId before persistence finishes', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FoodImageAnalyzeController],
      providers: [
        {
          provide: AnalyzeService,
          useValue: {
            getAnalysisStatus: jest.fn().mockResolvedValue({
              status: 'completed',
              stage: 'final',
              analysisId: undefined,
              data: {
                imageUrl: 'https://img',
                foods: [],
                totalCalories: 100,
                totalProtein: 1,
                totalFat: 2,
                totalCarbs: 3,
                nutritionScore: 70,
                decision: 'SAFE',
                advice: 'ok',
                riskLevel: 'low',
                insteadOptions: [],
              },
            }),
          },
        },
        { provide: StorageService, useValue: {} },
        { provide: TextFoodAnalysisService, useValue: {} },
        {
          provide: AnalysisSessionService,
          useValue: {
            getByRequestId: jest.fn().mockResolvedValue({
              id: 'session-1',
              userId: 'user-1',
            }),
          },
        },
        { provide: QuotaGateService, useValue: {} },
        { provide: QuotaService, useValue: {} },
        {
          provide: ResultEntitlementService,
          useValue: {
            trimResult: jest.fn().mockImplementation((value) => value),
          },
        },
        {
          provide: PaywallTriggerService,
          useValue: { recordResultTrimTrigger: jest.fn() },
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
        { provide: PrismaService, useValue: {} },
        {
          provide: I18nService,
          useValue: {
            currentLocale: jest.fn().mockReturnValue('en-US'),
            t: jest.fn().mockReturnValue('ok'),
          },
        },
        {
          provide: AnalyzeResultHelperService,
          useValue: {
            localizeLiteFoods: jest.fn(),
            localizeAnalysisResult: jest.fn(),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(FoodImageAnalyzeController);
    const response = await controller.getAnalysisResult('req-1', {
      id: 'user-1',
    } as any);

    expect(response.success).toBe(true);
    expect(response.data.requestId).toBe('req-1');
    expect(response.data.analysisId).toBeNull();
    expect(response.data.analysisSessionId).toBe('session-1');
  });

  it('rejects completed image analysis polling from another user', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FoodImageAnalyzeController],
      providers: [
        {
          provide: AnalyzeService,
          useValue: {
            getAnalysisStatus: jest.fn().mockResolvedValue({
              status: 'completed',
              stage: 'final',
              analysisId: 'analysis-1',
              data: {
                imageUrl: 'https://img',
                foods: [],
                totalCalories: 100,
                totalProtein: 1,
                totalFat: 2,
                totalCarbs: 3,
                nutritionScore: 70,
                decision: 'SAFE',
                advice: 'ok',
                riskLevel: 'low',
                insteadOptions: [],
              },
            }),
          },
        },
        { provide: StorageService, useValue: {} },
        { provide: TextFoodAnalysisService, useValue: {} },
        {
          provide: AnalysisSessionService,
          useValue: {
            getByRequestId: jest.fn().mockResolvedValue({
              id: 'session-1',
              userId: 'user-2',
            }),
          },
        },
        { provide: QuotaGateService, useValue: {} },
        { provide: QuotaService, useValue: {} },
        {
          provide: ResultEntitlementService,
          useValue: {
            trimResult: jest.fn().mockImplementation((value) => value),
          },
        },
        {
          provide: PaywallTriggerService,
          useValue: { recordResultTrimTrigger: jest.fn() },
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
        { provide: PrismaService, useValue: {} },
        {
          provide: I18nService,
          useValue: {
            currentLocale: jest.fn().mockReturnValue('en-US'),
            t: jest.fn().mockReturnValue('forbidden'),
          },
        },
        {
          provide: AnalyzeResultHelperService,
          useValue: {
            localizeLiteFoods: jest.fn(),
            localizeAnalysisResult: jest.fn(),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(FoodImageAnalyzeController);

    await expect(
      controller.getAnalysisResult('req-1', { id: 'user-1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 403 business code when polling failed image analysis quota error', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FoodImageAnalyzeController],
      providers: [
        {
          provide: AnalyzeService,
          useValue: {
            getAnalysisStatus: jest.fn().mockResolvedValue({
              status: 'failed',
              error:
                'Quota exceeded for user user-1 on feature food.image: 20/20',
            }),
          },
        },
        { provide: StorageService, useValue: {} },
        { provide: TextFoodAnalysisService, useValue: {} },
        { provide: AnalysisSessionService, useValue: {} },
        { provide: QuotaGateService, useValue: {} },
        { provide: QuotaService, useValue: {} },
        { provide: ResultEntitlementService, useValue: {} },
        { provide: PaywallTriggerService, useValue: {} },
        { provide: SubscriptionService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        {
          provide: I18nService,
          useValue: {
            currentLocale: jest.fn().mockReturnValue('en-US'),
            t: jest.fn().mockReturnValue('quota exceeded'),
          },
        },
        {
          provide: AnalyzeResultHelperService,
          useValue: {
            localizeLiteFoods: jest.fn(),
            localizeAnalysisResult: jest.fn(),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(FoodImageAnalyzeController);
    const response = await controller.getAnalysisResult('req-1', {
      id: 'user-1',
    } as any);

    expect(response.success).toBe(false);
    expect(response.code).toBe(403);
    expect(response.data).toEqual({
      requestId: 'req-1',
      status: 'failed',
      error: 'Quota exceeded for user user-1 on feature food.image: 20/20',
    });
  });
});
