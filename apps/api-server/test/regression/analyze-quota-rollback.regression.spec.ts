import { Test } from '@nestjs/testing';
import { FoodTextAnalyzeController } from '../../src/modules/food/app/controllers/food-text-analyze.controller';
import { FoodImageAnalyzeController } from '../../src/modules/food/app/controllers/food-image-analyze.controller';
import { TextFoodAnalysisService } from '../../src/modules/food/app/services/text-food-analysis.service';
import { AnalyzeService } from '../../src/modules/food/app/services/analyze.service';
import { StorageService } from '../../src/storage/storage.service';
import { AnalysisSessionService } from '../../src/modules/food/app/services/analysis-session.service';
import { QuotaGateService } from '../../src/modules/subscription/app/services/quota-gate.service';
import { QuotaService } from '../../src/modules/subscription/app/services/quota.service';
import { ResultEntitlementService } from '../../src/modules/subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../src/modules/subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../src/modules/subscription/app/services/subscription.service';
import { I18nService } from '../../src/core/i18n';
import { AnalyzeResultHelperService } from '../../src/modules/food/app/services/analyze-result-helper.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

describe('analysis quota rollback regression', () => {
  it('rolls back text-analysis quota when analysis throws after quota is consumed', async () => {
    const quotaService = { rollback: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      controllers: [FoodTextAnalyzeController],
      providers: [
        {
          provide: TextFoodAnalysisService,
          useValue: { analyze: jest.fn().mockRejectedValue(new Error('llm failed')) },
        },
        {
          provide: QuotaGateService,
          useValue: {
            checkAccess: jest.fn().mockResolvedValue({
              allowed: true,
              quotaConsumed: true,
            }),
          },
        },
        { provide: QuotaService, useValue: quotaService },
        {
          provide: ResultEntitlementService,
          useValue: { trimResult: jest.fn() },
        },
        {
          provide: PaywallTriggerService,
          useValue: { handleAccessDecision: jest.fn(), recordResultTrimTrigger: jest.fn() },
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
        { provide: I18nService, useValue: { t: jest.fn().mockReturnValue('ok'), currentLocale: jest.fn().mockReturnValue('en-US') } },
        {
          provide: AnalyzeResultHelperService,
          useValue: {
            buildTextAnalysisCacheKey: jest.fn().mockReturnValue('cache-key'),
            getFromTextAnalysisCache: jest.fn().mockReturnValue(null),
            localizeAnalysisResult: jest.fn(),
            setToTextAnalysisCache: jest.fn(),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(FoodTextAnalyzeController);

    await expect(
      controller.analyzeText({ text: 'apple' } as any, { id: 'user-1' } as any),
    ).rejects.toThrow('llm failed');

    expect(quotaService.rollback).toHaveBeenCalledWith('user-1', 'ai_text_analysis');
  });

  it('rolls back image-analysis quota when upload fails after quota is consumed', async () => {
    const quotaService = { rollback: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      controllers: [FoodImageAnalyzeController],
      providers: [
        { provide: AnalyzeService, useValue: { submitAnalysis: jest.fn() } },
        {
          provide: StorageService,
          useValue: { upload: jest.fn().mockRejectedValue(new Error('upload failed')) },
        },
        { provide: TextFoodAnalysisService, useValue: {} },
        {
          provide: QuotaGateService,
          useValue: {
            checkAccess: jest.fn().mockResolvedValue({
              allowed: true,
              quotaConsumed: true,
            }),
          },
        },
        { provide: QuotaService, useValue: quotaService },
        { provide: ResultEntitlementService, useValue: {} },
        { provide: PaywallTriggerService, useValue: { handleAccessDecision: jest.fn() } },
        {
          provide: SubscriptionService,
          useValue: { getUserSummary: jest.fn().mockResolvedValue({ tier: 'free' }) },
        },
        { provide: PrismaService, useValue: {} },
        { provide: AnalysisSessionService, useValue: { createSession: jest.fn() } },
        { provide: I18nService, useValue: { t: jest.fn().mockReturnValue('ok') } },
        { provide: AnalyzeResultHelperService, useValue: {} },
      ],
    }).compile();

    const controller = moduleRef.get(FoodImageAnalyzeController);

    await expect(
      controller.analyzeImage(
        {
          buffer: Buffer.from('1'),
          originalname: 'a.jpg',
          mimetype: 'image/jpeg',
        } as any,
        {} as any,
        { id: 'user-1' } as any,
      ),
    ).rejects.toThrow('upload failed');

    expect(quotaService.rollback).toHaveBeenCalledWith('user-1', 'ai_image_analysis');
  });
});
