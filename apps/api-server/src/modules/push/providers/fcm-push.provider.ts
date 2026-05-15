import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import {
  PushDeviceContext,
  PushMessage,
  PushProvider,
  PushProviderType,
  PushSendResult,
} from '../push.types';

const INVALID_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class FcmPushProvider implements PushProvider {
  readonly type = PushProviderType.FCM;
  private readonly logger = new Logger(FcmPushProvider.name);

  private get app(): admin.app.App | null {
    try {
      return admin.app('app-auth');
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.app !== null;
  }

  async validateToken(token: string): Promise<boolean> {
    return token.trim().length > 20;
  }

  async sendBatch(
    devices: PushDeviceContext[],
    message: PushMessage,
  ): Promise<PushSendResult[]> {
    const app = this.app;
    if (!app) {
      return devices.map((device) => ({
        token: device.token,
        success: false,
        errorCode: 'provider_unavailable',
        errorMessage: 'Firebase Admin app is not initialized',
      }));
    }

    if (devices.length === 0) return [];

    const tokens = devices.map((device) => device.token);
    const data = Object.fromEntries(
      Object.entries({
        type: message.type,
        ...message.payload,
      }).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );

    try {
      const response = await app.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: message.title,
          body: message.body,
        },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'eatcheck_retention',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
            },
          },
        },
      });

      return response.responses.map((item, index) => {
        const errorCode = item.error?.code;
        return {
          token: tokens[index],
          success: item.success,
          providerMessageId: item.messageId,
          errorCode,
          errorMessage: item.error?.message,
          invalidToken: errorCode ? INVALID_FCM_CODES.has(errorCode) : false,
        };
      });
    } catch (error) {
      this.logger.error(`FCM batch send failed: ${(error as Error).message}`);
      return devices.map((device) => ({
        token: device.token,
        success: false,
        errorCode: 'provider_exception',
        errorMessage: (error as Error).message,
      }));
    }
  }
}
