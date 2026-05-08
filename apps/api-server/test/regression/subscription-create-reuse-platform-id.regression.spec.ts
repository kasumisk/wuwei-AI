import { SubscriptionService } from '../../src/modules/subscription/app/services/subscription.service';
import {
  PaymentChannel,
  SubscriptionStatus,
  SubscriptionTier,
} from '../../src/modules/subscription/subscription.types';

describe('SubscriptionService createSubscription platform id reuse regression', () => {
  it('reuses existing subscription row when the same platform subscription id already exists', async () => {
    const existing = {
      id: 'sub-existing-1',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      planId: 'plan-old',
      paymentChannel: PaymentChannel.APPLE_IAP,
      platformSubscriptionId: '2000001166514890',
      startsAt: new Date('2026-05-08T12:39:54.000Z'),
      expiresAt: new Date('2026-05-08T12:39:54.000Z'),
      status: SubscriptionStatus.EXPIRED,
      autoRenew: false,
      cancelledAt: new Date('2026-05-08T12:40:00.000Z'),
      gracePeriodEndsAt: null,
    };
    const updated = {
      ...existing,
      planId: 'plan-new',
      expiresAt: new Date('2026-06-08T12:39:54.000Z'),
      status: SubscriptionStatus.ACTIVE,
      autoRenew: true,
      cancelledAt: null,
    };

    const prisma = {
      subscriptionPlan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'plan-new',
          tier: SubscriptionTier.PRO,
          name: 'EatCheck Pro Monthly',
          entitlements: { ai_image_analysis: 99 },
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
        updateMany: jest.fn(),
        create: jest.fn(),
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
        listCountableFeatures: jest.fn().mockReturnValue([]),
      } as any,
      { t: jest.fn((key: string) => key) } as any,
      {
        syncUserEntitlementsFromSubscription: jest.fn(),
      } as any,
      {} as any,
      { shouldRunInProc: jest.fn().mockReturnValue(false) } as any,
      { register: jest.fn() } as any,
    );
    service.onModuleInit();

    const result = await service.createSubscription({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      planId: 'plan-new',
      paymentChannel: PaymentChannel.APPLE_IAP,
      platformSubscriptionId: '2000001166514890',
      expiresAt: new Date('2026-06-08T12:39:54.000Z'),
    });

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          platformSubscriptionId: '2000001166514890',
        }),
      }),
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-existing-1' },
      }),
    );
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(result.id).toBe('sub-existing-1');
  });
});
