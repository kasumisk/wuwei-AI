import { Injectable, Logger } from '@nestjs/common';
import {
  PushDeviceContext,
  PushMessage,
  PushProvider,
  PushProviderType,
  PushSendResult,
} from '../push.types';

@Injectable()
export class MockPushProvider implements PushProvider {
  readonly type = PushProviderType.MOCK;
  private readonly logger = new Logger(MockPushProvider.name);

  isAvailable(): boolean {
    return true;
  }

  async validateToken(token: string): Promise<boolean> {
    return token.trim().length > 0;
  }

  async sendBatch(
    devices: PushDeviceContext[],
    message: PushMessage,
  ): Promise<PushSendResult[]> {
    this.logger.debug(
      `Mock push: type=${message.type}, devices=${devices.length}, title=${message.title}`,
    );
    return devices.map((device) => ({
      token: device.token,
      success: true,
      providerMessageId: `mock-${Date.now()}-${device.id}`,
    }));
  }
}
