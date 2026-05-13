import { RegionStrategyService } from '../../../src/core/region/region-strategy.service';

describe('RegionStrategyService', () => {
  let service: RegionStrategyService;

  beforeEach(() => {
    service = new RegionStrategyService();
  });

  it('returns the global capability profile by default', () => {
    const profile = service.resolveCapabilities({});

    expect(profile.region).toBe('GLOBAL');
    expect(profile.countryCode).toBe('US');
    expect(profile.locale).toBe('en-US');
    expect(profile.timezone).toBe('America/New_York');
    expect(profile.authMethods).toEqual([
      'apple',
      'google',
      'email',
      'anonymous',
    ]);
    expect(profile.billingMethods).toEqual([
      'apple_iap',
      'google_play',
      'revenuecat',
    ]);
    expect(profile.aiModelRouting.foodTextAnalysis).toEqual({
      provider: 'deepseek',
      primaryModel: 'deepseek-chat',
    });
    expect(profile.aiModelRouting.foodImageAnalysis).toEqual({
      provider: 'openrouter',
      primaryModel: 'qwen/qwen3-vl-32b-instruct',
      fallbackModel: 'qwen/qwen-vl-plus',
    });
    expect(profile.compliance.dataResidencyRequired).toBe(false);
    expect(profile.compliance.contentModerationRequired).toBe(false);
  });

  it('returns the China capability profile when regionCode is CN', () => {
    const profile = service.resolveCapabilities({
      regionCode: 'CN',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
    });

    expect(profile.region).toBe('CN');
    expect(profile.countryCode).toBe('CN');
    expect(profile.locale).toBe('zh-CN');
    expect(profile.timezone).toBe('Asia/Shanghai');
    expect(profile.authMethods).toEqual(['phone', 'wechat']);
    expect(profile.billingMethods).toEqual(['revenuecat']);
    expect(profile.aiModelRouting.foodTextAnalysis.primaryModel).toBe(
      'deepseek-chat',
    );
    expect(profile.aiModelRouting.foodImageAnalysis.primaryModel).toBe(
      'qwen/qwen3-vl-32b-instruct',
    );
    expect(profile.aiModelRouting.foodImageAnalysis.fallbackModel).toBe(
      'qwen/qwen-vl-plus',
    );
    expect(profile.compliance.piplMode).toBe(true);
    expect(profile.compliance.dataResidencyRequired).toBe(true);
    expect(profile.compliance.contentModerationRequired).toBe(true);
  });

  it('infers China from zh-CN locale when regionCode is absent', () => {
    const profile = service.resolveCapabilities({ locale: 'zh-CN' });

    expect(profile.region).toBe('CN');
    expect(profile.countryCode).toBe('CN');
  });

  it('keeps GLOBAL for non-China locale even when timezone is missing', () => {
    const profile = service.resolveCapabilities({ locale: 'ja-JP' });

    expect(profile.region).toBe('GLOBAL');
    expect(profile.countryCode).toBe('JP');
    expect(profile.timezone).toBe('America/New_York');
  });

  it('forces CN strategy when REGION_STRATEGY_FORCE_REGION=CN', () => {
    service = new RegionStrategyService(undefined, {
      get: jest.fn((key: string) =>
        key === 'REGION_STRATEGY_FORCE_REGION' ? 'CN' : undefined,
      ),
    } as any);

    const profile = service.resolveCapabilities({ locale: 'en-US' });

    expect(profile.region).toBe('CN');
    expect(profile.countryCode).toBe('CN');
    expect(profile.authMethods).toEqual(['phone', 'wechat']);
  });

  it('forces GLOBAL strategy when REGION_STRATEGY_FORCE_REGION=GLOBAL', () => {
    service = new RegionStrategyService(undefined, {
      get: jest.fn((key: string) =>
        key === 'REGION_STRATEGY_FORCE_REGION' ? 'GLOBAL' : undefined,
      ),
    } as any);

    const profile = service.resolveCapabilities({ locale: 'zh-CN' });

    expect(profile.region).toBe('GLOBAL');
    expect(profile.countryCode).toBe('CN');
    expect(profile.authMethods).toEqual([
      'apple',
      'google',
      'email',
      'anonymous',
    ]);
  });
});
