import { Injectable } from '@nestjs/common';
import type { RuntimeRegion } from '../../../../core/region';

export type AppAuthMethod =
  | 'anonymous'
  | 'apple'
  | 'google'
  | 'email'
  | 'phone'
  | 'wechat';

export type AppAuthProviderName = 'firebase_auth' | 'phone_sms' | 'wechat';

export interface AppAuthProviderDescriptor {
  provider: AppAuthProviderName;
  methods: AppAuthMethod[];
  regions: RuntimeRegion[];
  enabled: boolean;
  primary: boolean;
}

@Injectable()
export class AppAuthProviderRegistry {
  private readonly providers: AppAuthProviderDescriptor[] = [
    {
      provider: 'firebase_auth',
      methods: ['apple', 'google', 'email', 'anonymous'],
      regions: ['GLOBAL'],
      enabled: true,
      primary: true,
    },
    {
      provider: 'phone_sms',
      methods: ['phone'],
      regions: ['CN'],
      enabled: true,
      primary: true,
    },
    {
      provider: 'wechat',
      methods: ['wechat'],
      regions: ['CN'],
      enabled: true,
      primary: true,
    },
  ];

  getProvidersForRegion(region: RuntimeRegion): AppAuthProviderDescriptor[] {
    return this.providers.filter(
      (provider) => provider.enabled && provider.regions.includes(region),
    );
  }

  getMethodsForRegion(region: RuntimeRegion): AppAuthMethod[] {
    return this.getProvidersForRegion(region).flatMap(
      (provider) => provider.methods,
    );
  }

  isMethodSupported(method: AppAuthMethod, region: RuntimeRegion): boolean {
    return this.getProvidersForRegion(region).some((provider) =>
      provider.methods.includes(method),
    );
  }

  assertMethodSupported(method: AppAuthMethod, region: RuntimeRegion): void {
    if (!this.isMethodSupported(method, region)) {
      throw new Error(
        `Auth method ${method} is not supported in region ${region}`,
      );
    }
  }
}
