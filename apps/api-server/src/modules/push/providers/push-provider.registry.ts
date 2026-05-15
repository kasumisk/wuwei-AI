import { Injectable } from '@nestjs/common';
import { PushProvider, PushProviderType } from '../push.types';

@Injectable()
export class PushProviderRegistry {
  private readonly providers = new Map<PushProviderType, PushProvider>();

  register(provider: PushProvider): void {
    this.providers.set(provider.type, provider);
  }

  get(type: PushProviderType): PushProvider | null {
    return this.providers.get(type) ?? null;
  }

  list(): PushProvider[] {
    return Array.from(this.providers.values());
  }
}
