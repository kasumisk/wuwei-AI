import request from '@/utils/request';
import { PATH } from './path';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

export type RuntimeRegion = 'GLOBAL' | 'CN';
export type AuthMethod = 'anonymous' | 'apple' | 'email' | 'google' | 'phone' | 'wechat';
export type BillingMethod = 'alipay' | 'apple_iap' | 'google_play' | 'revenuecat' | 'wechat_pay';

export interface RegionComplianceFlags {
  piplMode: boolean;
  dataResidencyRequired: boolean;
  contentModerationRequired: boolean;
  medicalDisclaimerRequired: boolean;
}

export interface RegionAiFeatures {
  foodImageAnalysis: boolean;
  coachChat: boolean;
  streaming: boolean;
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
  aiFeatures: RegionAiFeatures;
  aiProviders: string[];
  aiModelRouting: RegionAiModelRouting;
  storageProvider: string;
  pushProviders: string[];
  smsProvider?: string;
  moderationProvider?: string;
  compliance: RegionComplianceFlags;
}

export type RegionCapabilityOverride = Partial<
  Omit<RegionCapabilityProfile, 'region' | 'aiFeatures' | 'aiModelRouting' | 'compliance'>
> & {
  aiFeatures?: Partial<RegionAiFeatures>;
  aiModelRouting?: Partial<{
    [K in keyof RegionAiModelRouting]: Partial<RegionAiModelRouting[K]>;
  }>;
  compliance?: Partial<RegionComplianceFlags>;
};

export interface RegionStrategyConfigView {
  region: RuntimeRegion;
  hasOverride: boolean;
  override: RegionCapabilityOverride | null;
  defaultProfile: RegionCapabilityProfile;
  effectiveProfile: RegionCapabilityProfile;
}

export type UpdateRegionStrategyDto = RegionCapabilityOverride;

const _all = ['region-strategy'] as const;

export const regionStrategyQueryKeys = {
  all: _all,
  list: [..._all, 'list'] as const,
  detail: (region: RuntimeRegion) => [..._all, 'detail', region] as const,
};

export const regionStrategyApi = {
  list: (): Promise<RegionStrategyConfigView[]> => request.get(PATH.ADMIN.REGION_STRATEGY),
  get: (region: RuntimeRegion): Promise<RegionStrategyConfigView> =>
    request.get(`${PATH.ADMIN.REGION_STRATEGY}/${region}`),
  update: (
    region: RuntimeRegion,
    data: UpdateRegionStrategyDto
  ): Promise<RegionStrategyConfigView> =>
    request.put(`${PATH.ADMIN.REGION_STRATEGY}/${region}`, data),
  reset: (region: RuntimeRegion): Promise<RegionStrategyConfigView> =>
    request.delete(`${PATH.ADMIN.REGION_STRATEGY}/${region}`),
};

export const useRegionStrategies = (
  options?: Omit<UseQueryOptions<RegionStrategyConfigView[]>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: regionStrategyQueryKeys.list,
    queryFn: () => regionStrategyApi.list(),
    staleTime: 15 * 1000,
    ...options,
  });

export const useUpdateRegionStrategy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ region, data }: { region: RuntimeRegion; data: UpdateRegionStrategyDto }) =>
      regionStrategyApi.update(region, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: regionStrategyQueryKeys.list });
      queryClient.invalidateQueries({ queryKey: regionStrategyQueryKeys.detail(variables.region) });
    },
  });
};

export const useResetRegionStrategy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (region: RuntimeRegion) => regionStrategyApi.reset(region),
    onSuccess: (_, region) => {
      queryClient.invalidateQueries({ queryKey: regionStrategyQueryKeys.list });
      queryClient.invalidateQueries({ queryKey: regionStrategyQueryKeys.detail(region) });
    },
  });
};
