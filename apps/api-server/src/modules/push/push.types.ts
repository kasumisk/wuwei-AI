import {
  PushDeliveryStatus,
  PushNotificationType,
  PushPlatform,
  PushProviderType,
  PushRegion,
} from '@prisma/client';

export {
  PushDeliveryStatus,
  PushNotificationType,
  PushPlatform,
  PushProviderType,
  PushRegion,
};

export type PushDeepLinkTarget =
  | 'home'
  | 'analysis_detail'
  | 'weekly_report'
  | 'premium';

export interface PushPayload {
  target: PushDeepLinkTarget;
  analysisId?: string;
  reportWeek?: string;
  source?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface PushDeviceContext {
  id: string;
  userId: string;
  token: string;
  platform: PushPlatform;
  pushRegion: PushRegion;
  providerType: PushProviderType;
  timezone: string;
  locale: string;
}

export interface PushMessage {
  userId: string;
  type: PushNotificationType;
  title: string;
  body: string;
  payload: PushPayload;
  scheduledFor?: Date;
}

export interface PushSendResult {
  token: string;
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  invalidToken?: boolean;
}

export interface PushProvider {
  readonly type: PushProviderType;
  isAvailable(): boolean;
  validateToken(token: string): Promise<boolean>;
  sendBatch(
    devices: PushDeviceContext[],
    message: PushMessage,
  ): Promise<PushSendResult[]>;
}

export interface PushSendOptions {
  userId: string;
  type: PushNotificationType;
  payload?: Partial<PushPayload>;
  locale?: string;
  scheduledFor?: Date;
  force?: boolean;
}
