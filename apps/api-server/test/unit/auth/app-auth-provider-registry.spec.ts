import {
  AppAuthProviderRegistry,
  type AppAuthMethod,
} from '../../../src/modules/auth/app/providers/app-auth-provider.registry';

describe('AppAuthProviderRegistry', () => {
  let registry: AppAuthProviderRegistry;

  beforeEach(() => {
    registry = new AppAuthProviderRegistry();
  });

  it('exposes global auth methods without China-only providers', () => {
    expect(registry.getMethodsForRegion('GLOBAL')).toEqual([
      'apple',
      'google',
      'email',
      'anonymous',
    ]);
    expect(registry.isMethodSupported('phone', 'GLOBAL')).toBe(false);
    expect(registry.isMethodSupported('wechat', 'GLOBAL')).toBe(false);
  });

  it('exposes China auth methods without Firebase assumptions', () => {
    expect(registry.getMethodsForRegion('CN')).toEqual(['phone', 'wechat']);
    expect(registry.isMethodSupported('phone', 'CN')).toBe(true);
    expect(registry.isMethodSupported('google', 'CN')).toBe(false);
    expect(registry.isMethodSupported('apple', 'CN')).toBe(false);
    expect(registry.isMethodSupported('anonymous', 'CN')).toBe(false);
  });

  it('uses one Firebase auth provider for global auth', () => {
    expect(registry.getProvidersForRegion('GLOBAL')).toEqual([
      expect.objectContaining({
        provider: 'firebase_auth',
        methods: ['apple', 'google', 'email', 'anonymous'],
        regions: ['GLOBAL'],
      }),
    ]);
  });

  it('adds WeChat and Phone SMS providers for China auth', () => {
    const providers = registry.getProvidersForRegion('CN');
    const byProvider = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );

    expect(byProvider.get('phone_sms')).toMatchObject({
      provider: 'phone_sms',
      methods: ['phone'],
      regions: ['CN'],
    });
    expect(byProvider.get('wechat')).toMatchObject({
      provider: 'wechat',
      methods: ['wechat'],
      regions: ['CN'],
    });
  });

  it('throws for unsupported methods in the requested region', () => {
    expect(() =>
      registry.assertMethodSupported('google' satisfies AppAuthMethod, 'CN'),
    ).toThrow('Auth method google is not supported in region CN');
  });
});
