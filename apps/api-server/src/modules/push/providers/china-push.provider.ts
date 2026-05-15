import { Injectable } from '@nestjs/common';
import {
  PushDeviceContext,
  PushMessage,
  PushProvider,
  PushProviderType,
  PushSendResult,
} from '../push.types';

abstract class NotConfiguredPushProvider implements PushProvider {
  abstract readonly type: PushProviderType;

  isAvailable(): boolean {
    return false;
  }

  async validateToken(token: string): Promise<boolean> {
    return token.trim().length > 0;
  }

  async sendBatch(
    devices: PushDeviceContext[],
    _message: PushMessage,
  ): Promise<PushSendResult[]> {
    return devices.map((device) => ({
      token: device.token,
      success: false,
      errorCode: 'provider_not_configured',
      errorMessage: `${this.type} provider is not configured`,
    }));
  }
}

@Injectable()
export class JPushProvider extends NotConfiguredPushProvider {
  readonly type = PushProviderType.JPUSH;
}

@Injectable()
export class HuaweiPushProvider extends NotConfiguredPushProvider {
  readonly type = PushProviderType.HUAWEI;
}
