export type RuntimeRegion = 'GLOBAL' | 'CN';

export type AuthMethod =
  | 'anonymous'
  | 'apple'
  | 'email'
  | 'google'
  | 'phone'
  | 'wechat';

export type BillingMethod =
  | 'alipay'
  | 'apple_iap'
  | 'google_play'
  | 'revenuecat'
  | 'wechat_pay';

export interface RegionCapabilityContext {
  regionCode?: string | null;
  locale?: string | null;
  timezone?: string | null;
  platform?: string | null;
  store?: string | null;
  appVersion?: string | null;
}

export interface RegionComplianceFlags {
  piplMode: boolean;
  dataResidencyRequired: boolean;
  contentModerationRequired: boolean;
  medicalDisclaimerRequired: boolean;
}

export interface RegionAiModelRoute {
  provider?: string;
  primaryModel: string;
  fallbackModel?: string;
}

export interface RegionAiModelRouting {
  foodTextAnalysis: RegionAiModelRoute;
  foodImageAnalysis: RegionAiModelRoute;
}

export interface RegionCapabilityProfile {
  region: RuntimeRegion;
  countryCode: string;
  locale: string;
  timezone: string;
  authMethods: AuthMethod[];
  billingMethods: BillingMethod[];
  aiFeatures: {
    foodImageAnalysis: boolean;
    coachChat: boolean;
    streaming: boolean;
  };
  aiProviders: string[];
  aiModelRouting: RegionAiModelRouting;
  storageProvider: string;
  pushProviders: string[];
  smsProvider?: string;
  moderationProvider?: string;
  compliance: RegionComplianceFlags;
  requestContext: {
    platform?: string;
    store?: string;
    appVersion?: string;
  };
}

export type RegionCapabilityOverride = Partial<
  Omit<
    RegionCapabilityProfile,
    'region' | 'requestContext' | 'aiFeatures' | 'aiModelRouting' | 'compliance'
  >
> & {
  aiFeatures?: Partial<RegionCapabilityProfile['aiFeatures']>;
  aiModelRouting?: Partial<{
    [K in keyof RegionAiModelRouting]: Partial<RegionAiModelRouting[K]>;
  }>;
  compliance?: Partial<RegionCapabilityProfile['compliance']>;
};
