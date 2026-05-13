import { BillingProviderRegistry } from '../../../src/modules/subscription/app/providers/billing-provider.registry';

describe('BillingProviderRegistry', () => {
  let registry: BillingProviderRegistry;

  beforeEach(() => {
    registry = new BillingProviderRegistry();
  });

  it('exposes global billing methods backed by RevenueCat', () => {
    expect(registry.getMethodsForRegion('GLOBAL')).toEqual([
      'apple_iap',
      'google_play',
      'revenuecat',
    ]);

    const providers = registry.getProvidersForRegion('GLOBAL');
    expect(providers).toEqual([
      expect.objectContaining({
        provider: 'revenuecat',
        methods: ['apple_iap', 'google_play', 'revenuecat'],
        stores: ['app_store', 'play_store'],
      }),
    ]);
  });

  it('uses RevenueCat as the China billing provider too', () => {
    expect(registry.getMethodsForRegion('CN')).toEqual(['revenuecat']);
    expect(registry.isMethodSupported('revenuecat', 'CN')).toBe(true);
    expect(registry.isMethodSupported('apple_iap', 'CN')).toBe(false);
    expect(registry.isMethodSupported('wechat_pay', 'CN')).toBe(false);

    expect(registry.getProvidersForRegion('CN')).toEqual([
      expect.objectContaining({
        provider: 'revenuecat',
        methods: ['revenuecat'],
        regions: ['CN'],
      }),
    ]);
  });

  it('throws for unsupported billing methods in the requested region', () => {
    expect(() =>
      registry.assertMethodSupported('wechat_pay', 'GLOBAL'),
    ).toThrow('Billing method wechat_pay is not supported in region GLOBAL');
  });
});
