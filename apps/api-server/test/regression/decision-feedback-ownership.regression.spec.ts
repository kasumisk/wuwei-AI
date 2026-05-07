import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BehaviorService } from '../../src/modules/diet/app/services/behavior.service';

describe('BehaviorService decision feedback ownership regression', () => {
  const createService = (prisma: any) =>
    new BehaviorService(prisma as any, {} as any, {} as any, undefined);

  it('rejects feedback updates for records owned by another user', async () => {
    const prisma = {
      aiDecisionLogs: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      foodRecords: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'other-user' }),
      },
    };
    const service = createService(prisma);

    await expect(
      service.logFeedback('current-user', 'record-1', true, 'helpful'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails clearly when record exists but no decision log exists', async () => {
    const prisma = {
      aiDecisionLogs: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      foodRecords: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'current-user' }),
      },
    };
    const service = createService(prisma);

    await expect(
      service.logFeedback('current-user', 'record-1', false, 'wrong'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists actualOutcome when updating owned decision feedback', async () => {
    const prisma = {
      aiDecisionLogs: {
        findFirst: jest.fn().mockResolvedValue({ id: 'log-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      foodRecords: {
        findUnique: jest.fn(),
      },
    };
    const service = createService(prisma);

    await service.logFeedback(
      'current-user',
      'record-1',
      true,
      'helpful',
      'blood_sugar_ok',
    );

    expect(prisma.aiDecisionLogs.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: {
        userFollowed: true,
        userFeedback: 'helpful',
        actualOutcome: 'blood_sugar_ok',
      },
    });
  });
});
