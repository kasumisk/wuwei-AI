import { FoodService } from '../../src/modules/diet/app/services/food.service';

describe('FoodService daily summary sync regression', () => {
  it('waits for daily summary update before resolving createRecord', async () => {
    let summaryUpdated = false;
    const service = new FoodService(
      {
        createRecord: jest.fn().mockResolvedValue({
          id: 'record-1',
          recordedAt: new Date('2026-05-08T10:00:00.000Z'),
        }),
      } as any,
      {
        updateDailySummary: jest.fn().mockImplementation(async () => {
          summaryUpdated = true;
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.createRecord('user-1', {
      foods: [],
      totalCalories: 100,
      mealType: 'lunch',
      source: 'manual',
    } as any);

    expect(summaryUpdated).toBe(true);
  });
});
