import { RevenueCatSyncService } from '../../src/modules/subscription/app/services/revenuecat-sync.service';
import { SubscriptionTier } from '../../src/modules/subscription/subscription.types';

describe('RevenueCat refresh first purchase regression', () => {
  it('fetches RevenueCat snapshot for free users even without local RC subscription record', async () => {
    const service = new RevenueCatSyncService(
      { get: jest.fn().mockReturnValue('secret') } as any,
      {
        subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any,
      {
        getUserSummary: jest.fn().mockResolvedValue({
          tier: SubscriptionTier.FREE,
          subscriptionId: null,
        }),
        invalidateUserSummaryCache: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { register: jest.fn() } as any,
      {} as any,
    );

    const fetchSpy = jest
      .spyOn(service as any, 'fetchSubscriberSnapshot')
      .mockResolvedValue({ subscriber: {} });
    jest
      .spyOn(service as any, 'applySubscriberSnapshot')
      .mockResolvedValue({ cacheInvalidated: false });

    await service.triggerSyncForUser(
      '550e8400-e29b-41d4-a716-446655440000',
      'client_trigger',
    );

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('still skips sync for paid non-RC users without local RC subscription record', async () => {
    const service = new RevenueCatSyncService(
      { get: jest.fn().mockReturnValue('secret') } as any,
      {
        subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any,
      {
        getUserSummary: jest.fn().mockResolvedValue({
          tier: SubscriptionTier.PRO,
          subscriptionId: 'sub-manual-1',
        }),
        invalidateUserSummaryCache: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { register: jest.fn() } as any,
      {} as any,
    );

    const fetchSpy = jest.spyOn(service as any, 'fetchSubscriberSnapshot');

    const result = await service.triggerSyncForUser(
      '550e8400-e29b-41d4-a716-446655440000',
      'client_trigger',
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.snapshotFetched).toBe(false);
    expect(result.currentTier).toBe(SubscriptionTier.PRO);
  });

  it('prefers linked RevenueCat provider customer id when refreshing snapshot', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({
      providerCustomerId: '$RCAnonymousID:linked-user',
    });
    const service = new RevenueCatSyncService(
      {
        get: jest.fn((key: string) =>
          key == 'SUBSCRIPTION_STORE_ENV' ? 'production' : 'secret',
        ),
      } as any,
      {
        subscription: { findFirst: jest.fn().mockResolvedValue(null) },
        subscriptionProviderCustomer: {
          findFirst,
        },
      } as any,
      {
        getUserSummary: jest.fn().mockResolvedValue({
          tier: SubscriptionTier.FREE,
          subscriptionId: null,
        }),
        invalidateUserSummaryCache: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { register: jest.fn() } as any,
      {} as any,
    );

    const fetchSpy = jest
      .spyOn(service as any, 'fetchSubscriberSnapshot')
      .mockResolvedValue({ subscriber: {} });
    jest
      .spyOn(service as any, 'applySubscriberSnapshot')
      .mockResolvedValue({ cacheInvalidated: false });

    await service.triggerSyncForUser(
      '550e8400-e29b-41d4-a716-446655440000',
      'client_trigger',
    );

    expect(fetchSpy).toHaveBeenCalledWith('$RCAnonymousID:linked-user');
  });

  it('prefers provider customer id from the current store environment', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({
      providerCustomerId: 'prod-user',
    });
    const service = new RevenueCatSyncService(
      {
        get: jest.fn((key: string) =>
          key == 'SUBSCRIPTION_STORE_ENV' ? 'production' : 'secret',
        ),
      } as any,
      {
        subscription: { findFirst: jest.fn().mockResolvedValue(null) },
        subscriptionProviderCustomer: {
          findFirst,
        },
      } as any,
      {
        getUserSummary: jest.fn().mockResolvedValue({
          tier: SubscriptionTier.FREE,
          subscriptionId: null,
        }),
        invalidateUserSummaryCache: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { register: jest.fn() } as any,
      {} as any,
    );

    const fetchSpy = jest
      .spyOn(service as any, 'fetchSubscriberSnapshot')
      .mockResolvedValue({ subscriber: {} });
    jest
      .spyOn(service as any, 'applySubscriberSnapshot')
      .mockResolvedValue({ cacheInvalidated: false });

    await service.triggerSyncForUser(
      '550e8400-e29b-41d4-a716-446655440000',
      'client_trigger',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ environment: 'production' }),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith('prod-user');
  });

  it('prefers the most recently synced active provider customer across environments', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({
      providerCustomerId: 'sandbox-user',
      environment: 'sandbox',
    });
    const service = new RevenueCatSyncService(
      {
        get: jest.fn((key: string) =>
          key == 'SUBSCRIPTION_STORE_ENV' ? 'production' : 'secret',
        ),
      } as any,
      {
        subscription: { findFirst: jest.fn().mockResolvedValue(null) },
        subscriptionProviderCustomer: {
          findFirst,
        },
      } as any,
      {
        getUserSummary: jest.fn().mockResolvedValue({
          tier: SubscriptionTier.FREE,
          subscriptionId: null,
        }),
        invalidateUserSummaryCache: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { register: jest.fn() } as any,
      {} as any,
    );

    const fetchSpy = jest
      .spyOn(service as any, 'fetchSubscriberSnapshot')
      .mockResolvedValue({ subscriber: {} });
    jest
      .spyOn(service as any, 'applySubscriberSnapshot')
      .mockResolvedValue({ cacheInvalidated: false });

    await service.triggerSyncForUser(
      '550e8400-e29b-41d4-a716-446655440000',
      'client_trigger',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ environment: 'production' }),
        select: expect.objectContaining({
          providerCustomerId: true,
          environment: true,
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith('sandbox-user');
  });
});
