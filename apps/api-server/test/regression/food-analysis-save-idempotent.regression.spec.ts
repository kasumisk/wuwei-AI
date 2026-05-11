import { Test } from '@nestjs/testing';
import { FoodAnalysisSaveController } from '../../src/modules/food/app/controllers/food-analysis-save.controller';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { I18nService } from '../../src/core/i18n';
import { AnalyzeResultHelperService } from '../../src/modules/food/app/services/analyze-result-helper.service';
import { BehaviorService } from '../../src/modules/diet/app/services/behavior.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DailySummaryService } from '../../src/modules/diet/app/services/daily-summary.service';

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
      $transaction: jest.fn().mockImplementation(async (callback: any) => callback(tx)),
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

    const moduleRef = await Test.createTestingModule({
      controllers: [FoodAnalysisSaveController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: I18nService, useValue: i18n },
        { provide: AnalyzeResultHelperService, useValue: helper },
        { provide: BehaviorService, useValue: behaviorService },
        { provide: DailySummaryService, useValue: dailySummaryService },
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
  });
});
