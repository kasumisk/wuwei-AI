import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type { PageResponse } from '@ai-platform/shared';

// ==================== 类型定义 ====================

export type SubscriptionStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'canceled'
  | 'grace_period'
  | 'paused';
export type SubscriptionTier = 'free' | 'pro' | 'premium';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
export type PaymentChannel =
  | 'apple_iap'
  | 'wechat_pay'
  | 'alipay'
  | 'manual'
  | 'stripe'
  | 'google_play';

export interface SubscriptionPlanDto {
  id: string;
  name: string;
  description?: string | null;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number;
  currency: string;
  entitlements: Record<string, unknown>;
  appleProductId?: string | null;
  wechatProductId?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDto {
  id: string;
  userId: string;
  user?: {
    id: string;
    nickname?: string;
    email?: string;
    avatar?: string;
  };
  plan?: SubscriptionPlanDto;
  planId: string;
  status: SubscriptionStatus;
  paymentChannel: PaymentChannel;
  startsAt: string;
  expiresAt: string;
  autoRenew: boolean;
  canceledAt?: string;
  cancelledAt?: string;
  platformSubscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecordDto {
  id: string;
  userId: string;
  subscriptionId?: string | null;
  orderNo: string;
  amountCents: number;
  currency: string;
  channel: PaymentChannel;
  status: string;
  platformTransactionId?: string | null;
  createdAt: string;
}

export interface GetSubscriptionsQuery {
  page?: number;
  pageSize?: number;
  status?: SubscriptionStatus | '';
  tier?: SubscriptionTier | '';
  paymentChannel?: PaymentChannel | '';
  keyword?: string;
}

export interface SubscriptionsListResponse {
  list: SubscriptionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GetPaymentRecordsQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  paymentChannel?: PaymentChannel | '';
  startDate?: string;
  endDate?: string;
}

export interface PaymentRecordsListResponse {
  list: PaymentRecordDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExtendSubscriptionDto {
  extendDays: number;
}

export interface ChangeSubscriptionPlanDto {
  newPlanId: string;
}

export interface SubscriptionOverview {
  totalSubscriptions: number;
  activeSubscriptions: number;
  byTier: Record<SubscriptionTier, number>;
  byChannel: Record<PaymentChannel, number>;
  mrr: number;
  currency: string;
}

export interface CreatePlanDto {
  name: string;
  description?: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number;
  currency?: string;
  entitlements: Record<string, unknown>;
  appleProductId?: string;
  wechatProductId?: string;
  sortOrder?: number;
}

export interface UpdatePlanDto {
  name?: string;
  description?: string;
  tier?: SubscriptionTier;
  billingCycle?: BillingCycle;
  priceCents?: number;
  currency?: string;
  entitlements?: Record<string, unknown>;
  appleProductId?: string;
  wechatProductId?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UsageQuotaItem {
  id: string;
  userId: string;
  feature: string;
  used: number;
  quotaLimit: number;
  cycle: 'daily' | 'weekly' | 'monthly';
  resetAt: string | null;
}

export interface UsageQuotasResponse {
  userId: string;
  list: UsageQuotaItem[];
}

export interface GetTriggerStatsParams {
  days?: number;
  feature?: string;
  triggerScene?: string;
}

export interface TriggerStatsByGroup {
  feature?: string;
  triggerScene?: string;
  currentTier?: string;
  totalTriggers: number;
  conversions: number;
  conversionRate: number;
}

export interface TriggerStatsResponse {
  days: number;
  totalTriggers: number;
  totalConversions: number;
  overallConversionRate: number;
  byFeature: TriggerStatsByGroup[];
  byScene: TriggerStatsByGroup[];
  byTier: TriggerStatsByGroup[];
}

// ==================== Query Keys ====================

const _all = ['subscriptions'] as const;

export const subscriptionQueryKeys = {
  all: _all,
  plans: [..._all, 'plans'] as const,
  planDetail: (id: string) => [..._all, 'plans', id] as const,
  list: (params?: GetSubscriptionsQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  payments: (params?: GetPaymentRecordsQuery) => [..._all, 'payments', params] as const,
  overview: [..._all, 'overview'] as const,
  userQuota: (userId: string) => [..._all, 'quota', userId] as const,
  usageQuotas: (userId: string, feature?: string) =>
    [..._all, 'usage-quotas', userId, feature] as const,
  triggerStats: (params?: GetTriggerStatsParams) => [..._all, 'trigger-stats', params] as const,
};

// ==================== API ====================

export const subscriptionApi = {
  // --- Plans ---
  getPlans: (): Promise<PageResponse<SubscriptionPlanDto>> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/plans`),

  getPlanById: (id: string): Promise<SubscriptionPlanDto> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/plans/${id}`),

  createPlan: (data: CreatePlanDto): Promise<SubscriptionPlanDto> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/plans`, data),

  updatePlan: (id: string, data: UpdatePlanDto): Promise<SubscriptionPlanDto> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/plans/${id}`, data),

  // --- Subscriptions ---
  getSubscriptions: (params?: GetSubscriptionsQuery): Promise<SubscriptionsListResponse> =>
    request.get(PATH.ADMIN.SUBSCRIPTIONS, params),

  getSubscriptionById: (id: string): Promise<SubscriptionDto> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}`),

  extendSubscription: (id: string, data: ExtendSubscriptionDto): Promise<SubscriptionDto> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/extend`, data),

  changeSubscriptionPlan: (id: string, data: ChangeSubscriptionPlanDto): Promise<SubscriptionDto> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/change-plan`, data),

  // --- Payment Records ---
  getPaymentRecords: (params?: GetPaymentRecordsQuery): Promise<PaymentRecordsListResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/payments`, params),

  // --- Overview ---
  getOverview: (): Promise<SubscriptionOverview> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/overview`),

  // --- User Quota (legacy per-user) ---
  getUserQuota: (userId: string): Promise<Record<string, unknown>> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/users/${userId}/quota`),

  // --- Usage Quotas (admin list) ---
  getUsageQuotas: (params: { userId: string; feature?: string }): Promise<UsageQuotasResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/usage-quotas`, params),

  resetUsageQuota: (id: string): Promise<UsageQuotaItem> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/usage-quotas/${id}/reset`, {}),

  // --- Trigger Stats ---
  getTriggerStats: (params?: GetTriggerStatsParams): Promise<TriggerStatsResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/trigger-stats`, params),
};

// ==================== React Query Hooks ====================

// Plans
export const useSubscriptionPlans = (
  options?: Omit<UseQueryOptions<PageResponse<SubscriptionPlanDto>>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.plans,
    queryFn: () => subscriptionApi.getPlans(),
    staleTime: 10 * 60 * 1000,
    ...options,
  });

export const useSubscriptionPlanById = (
  id: string | null,
  options?: Omit<UseQueryOptions<SubscriptionPlanDto>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: [...subscriptionQueryKeys.plans, id] as const,
    queryFn: () => subscriptionApi.getPlanById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useCreatePlan = (
  options?: UseMutationOptions<SubscriptionPlanDto, Error, CreatePlanDto>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => subscriptionApi.createPlan(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.plans }),
    ...options,
  });
};

export const useUpdatePlan = (
  options?: UseMutationOptions<SubscriptionPlanDto, Error, { id: string; data: UpdatePlanDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.updatePlan(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.plans }),
    ...options,
  });
};

// Subscriptions
export const useSubscriptions = (
  params?: GetSubscriptionsQuery,
  options?: Omit<UseQueryOptions<SubscriptionsListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.list(params),
    queryFn: () => subscriptionApi.getSubscriptions(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useSubscriptionDetail = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<SubscriptionDto>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.detail(id),
    queryFn: () => subscriptionApi.getSubscriptionById(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useExtendSubscription = (
  options?: UseMutationOptions<SubscriptionDto, Error, { id: string; data: ExtendSubscriptionDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.extendSubscription(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
    },
    ...options,
  });
};

export const useChangeSubscriptionPlan = (
  options?: UseMutationOptions<
    SubscriptionDto,
    Error,
    { id: string; data: ChangeSubscriptionPlanDto }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.changeSubscriptionPlan(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
    },
    ...options,
  });
};

// Payments
export const usePaymentRecords = (
  params?: GetPaymentRecordsQuery,
  options?: Omit<UseQueryOptions<PaymentRecordsListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.payments(params),
    queryFn: () => subscriptionApi.getPaymentRecords(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

// Overview
export const useSubscriptionOverview = (
  options?: Omit<UseQueryOptions<SubscriptionOverview>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.overview,
    queryFn: () => subscriptionApi.getOverview(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

// Usage Quotas
export const useUsageQuotas = (
  userId: string,
  feature?: string,
  options?: Omit<UseQueryOptions<UsageQuotasResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.usageQuotas(userId, feature),
    queryFn: () => subscriptionApi.getUsageQuotas({ userId, feature }),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useResetUsageQuota = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => subscriptionApi.resetUsageQuota(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
    },
  });
};

// Trigger Stats
export const useTriggerStats = (
  params?: GetTriggerStatsParams,
  options?: Omit<UseQueryOptions<TriggerStatsResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.triggerStats(params),
    queryFn: () => subscriptionApi.getTriggerStats(params),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export default subscriptionApi;
