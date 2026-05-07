import { SubscriptionService } from '../../src/modules/subscription/app/services/subscription.service';
import {
  SubscriptionStatus,
  SubscriptionTier,
} from '../../src/modules/subscription/subscription.types';

describe('SubscriptionService terminal status summary regression', () => {
  it('preserves refunded status in summary while keeping free access', async () => {
    const prisma = {
      subscription: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'sub-refunded-1',
            status: SubscriptionStatus.REFUNDED,
            expiresAt: new Date('2026-05-01T00:00:00.000Z'),
            subscriptionPlan: { name: 'EatCheck Pro Monthly' },
          }),
      },
      subscriptionPlan: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Free',
          entitlements: { ai_image_analysis: 1 },
        }),
      },
      userEntitlement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const service = new SubscriptionService(
      prisma,
      {
        createNamespace: jest.fn().mockReturnValue({
          getOrSet: jest.fn((_key: string, factory: () => Promise<unknown>) =>
            factory(),
          ),
          invalidate: jest.fn(),
        }),
      } as any,
      { emit: jest.fn() } as any,
      {
        resolve: jest.fn().mockImplementation((_tier, entitlements) => entitlements ?? {}),
      } as any,
      { t: jest.fn((key: string) => key) } as any,
      {} as any,
      {} as any,
      { shouldRunInProc: jest.fn().mockReturnValue(false) } as any,
      { register: jest.fn() } as any,
    );
    service.onModuleInit();

    const summary = await service.getUserSummary(
      '550e8400-e29b-41d4-a716-446655440000',
    );

    expect(summary.tier).toBe(SubscriptionTier.FREE);
    expect(summary.status).toBe(SubscriptionStatus.REFUNDED);
    expect(summary.subscriptionId).toBe('sub-refunded-1');
    expect(summary.planName).toBe('EatCheck Pro Monthly');
    expect(summary.autoRenew).toBe(false);
    expect(summary.entitlementSource).toBe('plan');
    expect(summary.entitlements).toEqual({ ai_image_analysis: 1 });
  });
});
