import {
  DEFAULT_LOCALE,
  DEFAULT_REGION_CODE,
  DEFAULT_TIMEZONE,
} from '../../common/config/regional-defaults';
import type {
  RegionCapabilityContext,
  RegionCapabilityProfile,
} from './region.types';

export const CN_COUNTRY_CODE = 'CN';
export const CN_LOCALE = 'zh-CN';
export const CN_TIMEZONE = 'Asia/Shanghai';

export function buildRequestContext(context: RegionCapabilityContext): {
  platform?: string;
  store?: string;
  appVersion?: string;
} {
  return {
    platform: context.platform?.trim() || undefined,
    store: context.store?.trim() || undefined,
    appVersion: context.appVersion?.trim() || undefined,
  };
}

export function buildDefaultGlobalProfile(
  context: RegionCapabilityContext = {},
  countryCode = DEFAULT_REGION_CODE,
): RegionCapabilityProfile {
  return {
    region: 'GLOBAL',
    countryCode,
    locale: context.locale?.trim() || DEFAULT_LOCALE,
    timezone: context.timezone?.trim() || DEFAULT_TIMEZONE,
    authMethods: ['apple', 'google', 'email', 'anonymous'],
    billingMethods: ['apple_iap', 'google_play', 'revenuecat'],
    aiFeatures: {
      foodImageAnalysis: true,
      coachChat: true,
      streaming: true,
    },
    aiProviders: ['openai', 'openrouter'],
    aiModelRouting: {
      foodTextAnalysis: {
        provider: 'deepseek',
        primaryModel: 'deepseek-chat',
      },
      foodImageAnalysis: {
        provider: 'openrouter',
        primaryModel: 'qwen/qwen3-vl-32b-instruct',
        fallbackModel: 'qwen/qwen-vl-plus',
      },
    },
    storageProvider: 'gcp',
    pushProviders: ['apns', 'fcm'],
    smsProvider: undefined,
    moderationProvider: undefined,
    compliance: {
      piplMode: false,
      dataResidencyRequired: false,
      contentModerationRequired: false,
      medicalDisclaimerRequired: true,
    },
    requestContext: buildRequestContext(context),
  };
}

export function buildDefaultChinaProfile(
  context: RegionCapabilityContext = {},
): RegionCapabilityProfile {
  return {
    region: 'CN',
    countryCode: CN_COUNTRY_CODE,
    locale: context.locale?.trim() || CN_LOCALE,
    timezone: context.timezone?.trim() || CN_TIMEZONE,
    authMethods: ['phone', 'wechat'],
    billingMethods: ['revenuecat'],
    aiFeatures: {
      foodImageAnalysis: true,
      coachChat: true,
      streaming: true,
    },
    aiProviders: ['qwen', 'deepseek'],
    aiModelRouting: {
      foodTextAnalysis: {
        provider: 'deepseek',
        primaryModel: 'deepseek-chat',
      },
      foodImageAnalysis: {
        provider: 'openrouter',
        primaryModel: 'qwen/qwen3-vl-32b-instruct',
        fallbackModel: 'qwen/qwen-vl-plus',
      },
    },
    storageProvider: 'oss',
    pushProviders: ['apns', 'jpush'],
    smsProvider: 'aliyun',
    moderationProvider: 'aliyun',
    compliance: {
      piplMode: true,
      dataResidencyRequired: true,
      contentModerationRequired: true,
      medicalDisclaimerRequired: true,
    },
    requestContext: buildRequestContext(context),
  };
}
