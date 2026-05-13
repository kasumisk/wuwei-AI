import { RegionStrategyAdminService } from '../../../src/core/region/region-strategy-admin.service';
import { RegionStrategyService } from '../../../src/core/region/region-strategy.service';

describe('RegionStrategyAdminService', () => {
  let admin: RegionStrategyAdminService;
  let strategy: RegionStrategyService;

  beforeEach(() => {
    admin = new RegionStrategyAdminService(undefined as any);
    strategy = new RegionStrategyService(admin);
  });

  it('lists default and effective profiles for both regions', () => {
    const configs = admin.list();

    expect(configs).toHaveLength(2);
    expect(configs.find((item) => item.region === 'GLOBAL')).toMatchObject({
      hasOverride: false,
      effectiveProfile: {
        region: 'GLOBAL',
        authMethods: ['apple', 'google', 'email', 'anonymous'],
      },
    });
    expect(configs.find((item) => item.region === 'CN')).toMatchObject({
      hasOverride: false,
      effectiveProfile: {
        region: 'CN',
        authMethods: ['phone', 'wechat'],
        billingMethods: ['revenuecat'],
      },
    });
  });

  it('updates an override and applies it in RegionStrategyService', async () => {
    await admin.update('CN', {
      aiProviders: ['qwen'],
      aiModelRouting: {
        foodImageAnalysis: {
          primaryModel: 'qwen/qwen-vl-plus',
        },
      },
      authMethods: ['phone'],
      compliance: {
        contentModerationRequired: false,
      },
    });

    const profile = strategy.resolveCapabilities({
      regionCode: 'CN',
      locale: 'zh-CN',
    });

    expect(profile.aiProviders).toEqual(['qwen']);
    expect(profile.aiModelRouting.foodImageAnalysis).toEqual({
      provider: 'openrouter',
      primaryModel: 'qwen/qwen-vl-plus',
      fallbackModel: 'qwen/qwen-vl-plus',
    });
    expect(profile.authMethods).toEqual(['phone']);
    expect(profile.compliance).toMatchObject({
      piplMode: true,
      contentModerationRequired: false,
      dataResidencyRequired: true,
    });
    expect(strategy.hasCapabilityOverride('CN', 'authMethods')).toBe(true);
    expect(strategy.hasCapabilityOverride('CN', 'billingMethods')).toBe(false);
  });

  it('resets an override back to defaults', async () => {
    await admin.update('CN', { storageProvider: 'cos' });
    expect(
      strategy.resolveCapabilities({ regionCode: 'CN' }).storageProvider,
    ).toBe('cos');

    await admin.reset('CN');

    expect(
      strategy.resolveCapabilities({ regionCode: 'CN' }).storageProvider,
    ).toBe('oss');
    expect(strategy.hasCapabilityOverride('CN', 'storageProvider')).toBe(false);
  });
});
