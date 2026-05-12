import { Test } from '@nestjs/testing';
import { FoodAnalysisSaveController } from '../../src/modules/food/app/controllers/food-analysis-save.controller';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { I18nService } from '../../src/core/i18n';
import { AnalyzeResultHelperService } from '../../src/modules/food/app/services/analyze-result-helper.service';
import { BehaviorService } from '../../src/modules/diet/app/services/behavior.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DailySummaryService } from '../../src/modules/diet/app/services/daily-summary.service';
import { DailyStatusService } from '../../src/modules/diet/app/services/daily-status.service';
import { UserProfileService } from '../../src/modules/user/app/services/profile/user-profile.service';
import { MealType } from '../../src/modules/diet/diet.types';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('FoodAnalysisSaveController regression', () => {
  it('returns existing record instead of creating duplicate for same analysisId', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      foodRecords: {
        findFirst: jest.fn().mockResolvedValue({ id: 'record-existing' }),
      },
      foodAnalysisRecords: {
        findUnique: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    };
    const i18n = { t: jest.fn().mockReturnValue('saved') };
    const helper = {
      reconstructAnalysisResult: jest.fn(),
      mapRecommendationToDecision: jest.fn(),
      mapRiskLevel: jest.fn(),
    };
    const behaviorService = { logDecision: jest.fn() };
    const eventEmitter = { emit: jest.fn() };
    const dailySummaryService = { updateDailySummary: jest.fn() };
    const dailyStatusService = { invalidateUserDate: jest.fn() };
    const userProfileService = { getTimezone: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodAnalysisSaveController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: I18nService, useValue: i18n },
        { provide: AnalyzeResultHelperService, useValue: helper },
        { provide: BehaviorService, useValue: behaviorService },
        { provide: DailySummaryService, useValue: dailySummaryService },
        { provide: DailyStatusService, useValue: dailyStatusService },
        { provide: UserProfileService, useValue: userProfileService },
      ],
    }).compile();

    const controller = moduleRef.get(FoodAnalysisSaveController);
    const result = await controller.saveAnalysisToRecord(
      { analysisId: '9f6ea96d-6558-42a2-b8ea-6f0dc4432c02' },
      { id: 'user-1' } as any,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      recordId: 'record-existing',
      analysisId: '9f6ea96d-6558-42a2-b8ea-6f0dc4432c02',
    });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.foodAnalysisRecords.findUnique).not.toHaveBeenCalled();
    expect(behaviorService.logDecision).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(dailySummaryService.updateDailySummary).not.toHaveBeenCalled();
    expect(dailyStatusService.invalidateUserDate).not.toHaveBeenCalled();
  });

  it('awaits summary update and daily-status invalidation before returning success', async () => {
    let releaseSummary: (() => void) | undefined;
    let releaseInvalidate: (() => void) | undefined;

    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      foodRecords: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'record-created',
          recordedAt: new Date('2026-05-12T14:30:00.000Z'),
          totalCalories: 320,
        }),
      },
      foodAnalysisRecords: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'analysis-1',
          userId: 'user-1',
          status: 'completed',
          mealType: 'snack',
          inputType: 'text',
          imageUrl: null,
        }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    };
    const i18n = { t: jest.fn().mockReturnValue('saved') };
    const helper = {
      reconstructAnalysisResult: jest.fn().mockReturnValue({
        foods: [
          {
            name: 'banana',
            calories: 320,
            quantity: '1 serving',
            category: 'fruit',
            protein: 3,
            fat: 1,
            carbs: 45,
          },
        ],
        totals: {
          calories: 320,
          protein: 3,
          fat: 1,
          carbs: 45,
        },
        explanation: {
          summary: 'summary',
          primaryReason: 'reason',
        },
        decision: {
          shouldEat: true,
          recommendation: 'recommended',
          riskLevel: 'low',
          reason: 'fine',
        },
        score: {
          nutritionScore: 88,
        },
        summary: {
          headline: 'headline',
        },
        alternatives: [],
      }),
      mapRecommendationToDecision: jest.fn().mockReturnValue('SAFE'),
      mapRiskLevel: jest.fn().mockReturnValue('LOW'),
    };
    const behaviorService = { logDecision: jest.fn().mockResolvedValue(undefined) };
    const eventEmitter = { emit: jest.fn() };
    const dailySummaryService = {
      updateDailySummary: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseSummary = resolve;
          }),
      ),
    };
    const dailyStatusService = {
      invalidateUserDate: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseInvalidate = resolve;
          }),
      ),
    };
    const userProfileService = {
      getTimezone: jest.fn().mockResolvedValue('America/New_York'),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodAnalysisSaveController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: I18nService, useValue: i18n },
        { provide: AnalyzeResultHelperService, useValue: helper },
        { provide: BehaviorService, useValue: behaviorService },
        { provide: DailySummaryService, useValue: dailySummaryService },
        { provide: DailyStatusService, useValue: dailyStatusService },
        { provide: UserProfileService, useValue: userProfileService },
      ],
    }).compile();

    const controller = moduleRef.get(FoodAnalysisSaveController);
    const pending = controller.saveAnalysisToRecord(
      { analysisId: 'analysis-1', mealType: MealType.SNACK },
      { id: 'user-1' } as any,
    );

    await flushAsyncWork();
    await flushAsyncWork();

    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await flushAsyncWork();
    expect(settled).toBe(false);
    expect(behaviorService.logDecision).toHaveBeenCalledTimes(1);
    expect(dailySummaryService.updateDailySummary).toHaveBeenCalledTimes(1);

    releaseSummary?.();
    await flushAsyncWork();
    await flushAsyncWork();

    expect(dailyStatusService.invalidateUserDate).toHaveBeenCalledWith(
      'user-1',
      '2026-05-12',
    );
    expect(settled).toBe(false);

    releaseInvalidate?.();
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      recordId: 'record-created',
      analysisId: 'analysis-1',
    });
  });
});
