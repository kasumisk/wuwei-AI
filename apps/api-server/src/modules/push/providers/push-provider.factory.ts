import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PushPlatform,
  PushProvider,
  PushProviderType,
  PushRegion,
} from '../push.types';
import { FcmPushProvider } from './fcm-push.provider';
import { HuaweiPushProvider, JPushProvider } from './china-push.provider';
import { MockPushProvider } from './mock-push.provider';
import { PushProviderRegistry } from './push-provider.registry';

export interface ResolvedPushProvider {
  requestedType: PushProviderType;
  actualType: PushProviderType;
  provider: PushProvider;
  fallbackApplied: boolean;
}

@Injectable()
export class PushProviderFactory implements OnModuleInit {
  constructor(
    private readonly registry: PushProviderRegistry,
    private readonly fcm: FcmPushProvider,
    private readonly jpush: JPushProvider,
    private readonly huawei: HuaweiPushProvider,
    private readonly mock: MockPushProvider,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    [this.fcm, this.jpush, this.huawei, this.mock].forEach((provider) =>
      this.registry.register(provider),
    );
  }

  resolve(type: PushProviderType): ResolvedPushProvider {
    const provider = this.registry.get(type);
    if (provider?.isAvailable()) {
      return {
        requestedType: type,
        actualType: type,
        provider,
        fallbackApplied: false,
      };
    }

    const fallbackType = this.getFallbackProviderType(type);
    const fallback = this.registry.get(fallbackType) ?? this.mock;
    const actualProvider = fallback.isAvailable() ? fallback : this.mock;
    return {
      requestedType: type,
      actualType: actualProvider.type,
      provider: actualProvider,
      fallbackApplied: actualProvider.type !== type,
    };
  }

  resolveType(params: {
    region: PushRegion;
    platform: PushPlatform;
    requested?: PushProviderType;
    deviceBrand?: string | null;
  }): PushProviderType {
    if (params.requested) return params.requested;

    const forced = this.config.get<string>('PUSH_PROVIDER')?.toUpperCase();
    if (forced && forced in PushProviderType) {
      return forced as PushProviderType;
    }

    if (params.region === PushRegion.CHINA_MAINLAND) {
      const brand = (params.deviceBrand ?? '').toLowerCase();
      if (brand.includes('huawei') || brand.includes('honor')) {
        return PushProviderType.HUAWEI;
      }
      return PushProviderType.JPUSH;
    }

    if (this.config.get<string>('NODE_ENV') === 'test') {
      return PushProviderType.MOCK;
    }

    return PushProviderType.FCM;
  }

  getFallbackProviderType(type: PushProviderType): PushProviderType {
    if (type === PushProviderType.MOCK) return PushProviderType.MOCK;
    const configured = this.config
      .get<string>(`PUSH_${type}_FALLBACK`)
      ?.toUpperCase();
    if (configured && configured in PushProviderType) {
      return configured as PushProviderType;
    }
    return PushProviderType.MOCK;
  }

  getProviderHealth() {
    return this.registry.list().map((provider) => ({
      type: provider.type,
      isAvailable: provider.isAvailable(),
      fallbackType: this.getFallbackProviderType(provider.type),
    }));
  }
}
