import { AppCapabilitiesController } from '../../../src/modules/capabilities/app/app-capabilities.controller';
import { RegionStrategyAdminService } from '../../../src/core/region/region-strategy-admin.service';
import { RegionStrategyService } from '../../../src/core/region/region-strategy.service';
import { AppAuthProviderRegistry } from '../../../src/modules/auth/app/providers/app-auth-provider.registry';
import { BillingProviderRegistry } from '../../../src/modules/subscription/app/providers/billing-provider.registry';

describe('AppCapabilitiesController', () => {
  it('returns a public capabilities payload using request context', () => {
    const regionStrategy = new RegionStrategyService(
      new RegionStrategyAdminService(undefined as any),
    );
    const controller = new AppCapabilitiesController(
      regionStrategy,
      new AppAuthProviderRegistry(),
      new BillingProviderRegistry(),
    );

    const response = controller.getCapabilities({
      regionCode: 'CN',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      platform: 'android',
      store: 'official',
      appVersion: '1.0.0',
    });

    expect(response.success).toBe(true);
    expect(response.code).toBe(200);
    expect(response.data.region).toBe('CN');
    expect(response.data.authMethods).toEqual(['phone', 'wechat']);
    expect(response.data.billingMethods).toEqual(['revenuecat']);
    expect(response.data.requestContext).toEqual({
      platform: 'android',
      store: 'official',
      appVersion: '1.0.0',
    });
  });

  it('uses admin overrides before registry defaults when configured', async () => {
    const admin = new RegionStrategyAdminService(undefined as any);
    await admin.update('CN', {
      authMethods: ['wechat'],
      billingMethods: ['revenuecat'],
    });
    const controller = new AppCapabilitiesController(
      new RegionStrategyService(admin),
      new AppAuthProviderRegistry(),
      new BillingProviderRegistry(),
    );

    const response = controller.getCapabilities({ regionCode: 'CN' });

    expect(response.data.authMethods).toEqual(['wechat']);
    expect(response.data.billingMethods).toEqual(['revenuecat']);
  });
});
