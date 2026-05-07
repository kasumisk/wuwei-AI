import { FoodRecordService } from '../../src/modules/diet/app/services/food-record.service';

describe('FoodRecordService timezone date query regression', () => {
  it('interprets explicit date using user local timezone boundaries', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      foodRecords: {
        findMany,
        count,
      },
    };
    const service = new FoodRecordService(prisma as any, { t: jest.fn() } as any);

    await service.queryRecords(
      'user-1',
      { date: '2026-05-07', page: 1, limit: 20 },
      'Asia/Shanghai',
    );

    const where = findMany.mock.calls[0][0].where;
    expect(where.recordedAt.gte.toISOString()).toBe('2026-05-06T16:00:00.000Z');
    expect(where.recordedAt.lte.toISOString()).toBe('2026-05-07T16:00:00.000Z');
  });
});
