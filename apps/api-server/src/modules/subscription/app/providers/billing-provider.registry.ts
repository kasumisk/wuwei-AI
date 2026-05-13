import { Injectable } from '@nestjs/common';
import type { RuntimeRegion } from '../../../../core/region';

export type AppBillingMethod =
  | 'alipay'
  | 'apple_iap'
  | 'google_play'
  | 'revenuecat'
  | 'wechat_pay';

export type AppBillingProviderName = 'alipay' | 'revenuecat' | 'wechat_pay';

export interface BillingProviderDescriptor {
  provider: AppBillingProviderName;
  methods: AppBillingMethod[];
  regions: RuntimeRegion[];
  enabled: boolean;
  stores?: Array<'app_store' | 'play_store' | 'wechat' | 'alipay'>;
  primary: boolean;
}

@Injectable()
export class BillingProviderRegistry {
  private readonly providers: BillingProviderDescriptor[] = [
    {
      provider: 'revenuecat',
      methods: ['apple_iap', 'google_play', 'revenuecat'],
      regions: ['GLOBAL'],
      enabled: true,
      stores: ['app_store', 'play_store'],
      primary: true,
    },
    {
      provider: 'revenuecat',
      methods: ['revenuecat'],
      regions: ['CN'],
      enabled: true,
      primary: true,
    },
  ];

  getProvidersForRegion(region: RuntimeRegion): BillingProviderDescriptor[] {
    return this.providers.filter(
      (provider) => provider.enabled && provider.regions.includes(region),
    );
  }

  getMethodsForRegion(region: RuntimeRegion): AppBillingMethod[] {
    return this.getProvidersForRegion(region).flatMap(
      (provider) => provider.methods,
    );
  }

  isMethodSupported(method: AppBillingMethod, region: RuntimeRegion): boolean {
    return this.getProvidersForRegion(region).some((provider) =>
      provider.methods.includes(method),
    );
  }

  assertMethodSupported(method: AppBillingMethod, region: RuntimeRegion): void {
    if (!this.isMethodSupported(method, region)) {
      throw new Error(
        `Billing method ${method} is not supported in region ${region}`,
      );
    }
  }
}
