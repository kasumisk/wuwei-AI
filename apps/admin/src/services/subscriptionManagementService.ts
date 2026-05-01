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
  | 'trial'
  | 'active'
  | 'billing_retry'
  | 'expired'
  | 'cancelled'
  | 'canceled'
  | 'grace_period'
  | 'paused'
  | 'refunded'
  | 'revoked'
  | 'transferred'
  | 'unknown';
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
  storeProducts?: SubscriptionStoreProductDto[];
  planEntitlements?: SubscriptionPlanEntitlementDto[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionStoreProductDto {
  id: string;
  planId: string;
  provider: string;
  store?: string | null;
  productId: string;
  environment: string;
  offeringId?: string | null;
  packageId?: string | null;
  billingCycle: string;
  isActive: boolean;
}

export interface SubscriptionStoreProductInputDto {
  provider: string;
  store: string;
  productId: string;
  offeringId?: string;
  packageId?: string;
  environment?: string;
  isActive?: boolean;
}

export interface SubscriptionPlanEntitlementDto {
  id: string;
  planId: string;
  entitlementCode: string;
  value: unknown;
  isActive: boolean;
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
  lastSyncedAt?: string | null;
  lastSyncSource?: string | null;
  lastSyncStatus?: 'ok' | 'failed' | 'unknown';
  lastWebhookStatus?: string | null;
  lastWebhookError?: string | null;
  latestStoreProductId?: string | null;
  latestMappedOfferingId?: string | null;
  latestMappedPackageId?: string | null;
  latestTransactionAt?: string | null;
  latestTransactionType?: string | null;
  latestWebhookAt?: string | null;
  latestWebhookEventType?: string | null;
  hasRefundRecord?: boolean;
  hasManualEntitlement?: boolean;
  hasRevenueCatSignal?: boolean;
  paymentRecords?: PaymentRecordDto[];
  usageQuotas?: UsageQuotaItem[];
  userEntitlements?: UserEntitlementDto[];
  providerCustomers?: SubscriptionProviderCustomerDto[];
  createdAt: string;
  updatedAt: string;
}

export interface UserEntitlementDto {
  id: string;
  userId: string;
  entitlementCode: string;
  sourceType: string;
  sourceKey: string;
  subscriptionId?: string | null;
  provider?: string | null;
  providerCustomerId?: string | null;
  status: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo?: string | null;
  updatedAt: string;
}

export interface SubscriptionProviderCustomerDto {
  id: string;
  userId: string;
  provider: string;
  providerCustomerId: string;
  originalProviderCustomerId?: string | null;
  aliases: string[];
  environment: string;
  status: string;
  lastSyncedAt?: string | null;
}

export interface PaymentRecordDto {
  id: string;
  userId: string;
  user?: {
    id: string;
    nickname?: string;
    email?: string;
    avatar?: string;
  } | null;
  subscription?: {
    id: string;
    status?: string;
    expiresAt?: string;
    plan?: {
      id: string;
      name: string;
      tier?: string;
      billingCycle?: string;
    } | null;
  } | null;
  subscriptionId?: string | null;
  orderNo: string;
  amountCents: number;
  currency: string;
  channel: PaymentChannel;
  status: string;
  transactionId?: string | null;
  platformTransactionId?: string | null;
  refundAmountCents?: number;
  paidAt?: string | null;
  refundedAt?: string | null;
  createdAt: string;
}

export interface GetSubscriptionsQuery {
  page?: number;
  pageSize?: number;
  status?: SubscriptionStatus | '';
  tier?: SubscriptionTier | '';
  paymentChannel?: PaymentChannel | '';
  keyword?: string;
  platformSubscriptionId?: string;
  productId?: string;
  hasRefundRecord?: boolean;
  hasManualEntitlement?: boolean;
  hasRevenueCatSignal?: boolean;
  webhookProcessingStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
  status?: string;
  startDate?: string;
  endDate?: string;
  orderNo?: string;
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

export interface SubscriptionResyncDto {
  reason?: string;
}

export interface AdminSubscriptionActionDto {
  reason?: string;
}

export interface GrantManualEntitlementDto {
  entitlementCode: string;
  value: unknown;
  effectiveTo?: string;
  reason?: string;
}

export interface RevokeManualEntitlementDto {
  userEntitlementId: string;
  reason?: string;
}

export interface SubscriptionTimelineQuery {
  limit?: number;
}

export interface SubscriptionAuditLogDto {
  id: string;
  subscriptionId?: string | null;
  userId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  runtimeEnv: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  reason?: string | null;
  createdAt: string;
}

export interface SubscriptionTransactionDto {
  id: string;
  subscriptionId?: string | null;
  relatedSubscriptionId?: string | null;
  userId?: string | null;
  provider: string;
  providerEventId?: string | null;
  transactionType: string;
  store?: string | null;
  environment?: string | null;
  runtimeEnv: string;
  storeProductId?: string | null;
  mappedOfferingId?: string | null;
  mappedPackageId?: string | null;
  transactionId?: string | null;
  originalTransactionId?: string | null;
  purchaseToken?: string | null;
  purchasedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  status: string;
  rawSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface BillingWebhookEventDto {
  id: string;
  subscriptionId?: string | null;
  provider: string;
  providerEventId: string;
  eventType?: string | null;
  appUserId?: string | null;
  originalAppUserId?: string | null;
  aliases: string[];
  store?: string | null;
  environment?: string | null;
  runtimeEnv: string;
  productId?: string | null;
  mappedOfferingId?: string | null;
  mappedPackageId?: string | null;
  entitlementIds: string[];
  transactionId?: string | null;
  originalTransactionId?: string | null;
  eventTimestamp?: string | null;
  receivedAt: string;
  processingStatus: string;
  retryCount: number;
  lastError?: string | null;
  processedAt?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface SubscriptionTimelineResponse {
  subscriptionId: string;
  userId: string;
  audits: SubscriptionAuditLogDto[];
  transactions: SubscriptionTransactionDto[];
  webhookEvents: BillingWebhookEventDto[];
}

export interface SubscriptionOverview {
  totalSubscriptions: number;
  activeSubscriptions: number;
  byTier: Record<SubscriptionTier, number>;
  byChannel: Record<PaymentChannel, number>;
  mrr: number;
  currency: string;
}

export interface SubscriptionAnomalySummary {
  failedWebhookCount: number;
  orphanTransactionCount: number;
  unmappedProductCount: number;
  activeWithoutRevenueCatSignalCount: number;
}

export interface UnmappedProductAnomaly {
  source: 'webhook' | 'transaction';
  productId?: string | null;
  relatedSubscriptionId?: string | null;
  mappedOfferingId?: string | null;
  mappedPackageId?: string | null;
  userId?: string | null;
  eventType?: string | null;
  happenedAt: string;
}

export interface ActiveWithoutRevenueCatSignalItem {
  id: string;
  userId: string;
  user?: {
    id: string;
    nickname?: string;
    email?: string;
  } | null;
  status: string;
  paymentChannel: PaymentChannel;
  platformSubscriptionId?: string | null;
  expiresAt: string;
  updatedAt: string;
  plan?: SubscriptionPlanDto;
}

export interface SubscriptionAnomaliesResponse {
  summary: SubscriptionAnomalySummary;
  failedWebhooks: BillingWebhookEventDto[];
  orphanTransactions: SubscriptionTransactionDto[];
  unmappedProducts: UnmappedProductAnomaly[];
  activeWithoutRevenueCatSignals: ActiveWithoutRevenueCatSignalItem[];
}

export interface RebuildEntitlementsResponse {
  mode: 'queued' | 'sync';
  jobId?: string;
  queuedAt: string;
  action: 'rebuild_entitlements';
  result?: {
    subscriptions: number;
  };
}

export interface SubscriptionMaintenanceDispatchResponse {
  mode: 'queued' | 'sync';
  jobId?: string;
  queuedAt: string;
  action: 'resync_subscription' | 'rebuild_entitlements';
  result?: unknown;
}

export interface SubscriptionMaintenanceJobItem {
  id: string;
  name: string;
  status: string;
  data: Record<string, unknown>;
  result: unknown;
  failedReason: string | null;
  summary: string;
  attemptsMade: number;
  processedOn: number | null;
  finishedOn: number | null;
  timestamp: number;
}

export interface SubscriptionMaintenanceJobsResponse {
  counts: Record<string, number>;
  list: SubscriptionMaintenanceJobItem[];
}

export interface SubscriptionMaintenanceDlqItem {
  id: string;
  queueName: string;
  jobId: string;
  jobData: Record<string, unknown>;
  errorMessage: string;
  attemptsMade: number;
  status: string;
  failedAt: string;
  retriedAt: string | null;
  createdAt: string;
}

export interface SubscriptionMaintenanceDlqResponse {
  list: SubscriptionMaintenanceDlqItem[];
  total: number;
}

export interface CreatePlanDto {
  name: string;
  description?: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number;
  currency?: string;
  entitlements: Record<string, unknown>;
  storeProducts?: SubscriptionStoreProductInputDto[];
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
  storeProducts?: SubscriptionStoreProductInputDto[];
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
  timeline: (id: string, params?: SubscriptionTimelineQuery) =>
    [..._all, 'timeline', id, params] as const,
  payments: (params?: GetPaymentRecordsQuery) => [..._all, 'payments', params] as const,
  overview: [..._all, 'overview'] as const,
  anomalies: (params?: { limit?: number }) => [..._all, 'anomalies', params] as const,
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

  getSubscriptionTimeline: (
    id: string,
    params?: SubscriptionTimelineQuery
  ): Promise<SubscriptionTimelineResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/timeline`, params),

  getSubscriptionAnomalies: (params?: { limit?: number }): Promise<SubscriptionAnomaliesResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/anomalies`, params),

  getSubscriptionMaintenanceJobs: (
    params?: { limit?: number }
  ): Promise<SubscriptionMaintenanceJobsResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/maintenance/jobs`, params),

  getSubscriptionMaintenanceJob: (
    jobId: string
  ): Promise<SubscriptionMaintenanceJobItem> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/maintenance/jobs/${jobId}`),

  getSubscriptionMaintenanceDlq: (params?: {
    limit?: number;
    status?: string;
  }): Promise<SubscriptionMaintenanceDlqResponse> =>
    request.get(`${PATH.ADMIN.SUBSCRIPTIONS}/maintenance/dlq`, params),

  replaySubscriptionMaintenanceDlq: (
    dlqId: string
  ): Promise<{ mode: 'queued'; jobId?: string }> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/maintenance/dlq/${dlqId}/replay`, {}),

  discardSubscriptionMaintenanceDlq: (
    dlqId: string
  ): Promise<{ id: string; status: 'discarded' }> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/maintenance/dlq/${dlqId}/discard`, {}),

  rebuildEntitlements: (): Promise<RebuildEntitlementsResponse> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/operations/rebuild-entitlements`, {}),

  extendSubscription: (id: string, data: ExtendSubscriptionDto): Promise<SubscriptionDto> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/extend`, data),

  changeSubscriptionPlan: (id: string, data: ChangeSubscriptionPlanDto): Promise<SubscriptionDto> =>
    request.put(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/change-plan`, data),

  resyncSubscription: (
    id: string,
    data: SubscriptionResyncDto
  ): Promise<SubscriptionMaintenanceDispatchResponse> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/resync`, data),

  refundSubscription: (id: string, data: AdminSubscriptionActionDto): Promise<SubscriptionDto> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/refund`, data),

  revokeSubscription: (id: string, data: AdminSubscriptionActionDto): Promise<SubscriptionDto> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/revoke`, data),

  grantManualEntitlement: (
    id: string,
    data: GrantManualEntitlementDto
  ): Promise<UserEntitlementDto> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/manual-entitlements`, data),

  revokeManualEntitlement: (
    id: string,
    data: RevokeManualEntitlementDto
  ): Promise<UserEntitlementDto> =>
    request.post(`${PATH.ADMIN.SUBSCRIPTIONS}/${id}/manual-entitlements/revoke`, data),

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

export const useSubscriptionTimeline = (
  id: string,
  params?: SubscriptionTimelineQuery,
  enabled = true,
  options?: Omit<UseQueryOptions<SubscriptionTimelineResponse>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.timeline(id, params),
    queryFn: () => subscriptionApi.getSubscriptionTimeline(id, params),
    enabled: enabled && !!id,
    staleTime: 60 * 1000,
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

export const useResyncSubscription = (
  options?: UseMutationOptions<SubscriptionMaintenanceDispatchResponse, Error, { id: string; data: SubscriptionResyncDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.resyncSubscription(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.timeline(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
    },
    ...options,
  });
};

export const useRefundSubscription = (
  options?: UseMutationOptions<SubscriptionDto, Error, { id: string; data: AdminSubscriptionActionDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.refundSubscription(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.timeline(id) });
    },
    ...options,
  });
};

export const useRevokeSubscription = (
  options?: UseMutationOptions<SubscriptionDto, Error, { id: string; data: AdminSubscriptionActionDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.revokeSubscription(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.timeline(id) });
    },
    ...options,
  });
};

export const useGrantManualEntitlement = (
  options?: UseMutationOptions<UserEntitlementDto, Error, { id: string; data: GrantManualEntitlementDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.grantManualEntitlement(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.timeline(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
    },
    ...options,
  });
};

export const useRevokeManualEntitlement = (
  options?: UseMutationOptions<UserEntitlementDto, Error, { id: string; data: RevokeManualEntitlementDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => subscriptionApi.revokeManualEntitlement(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.timeline(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.all });
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

export const useSubscriptionAnomalies = (
  params?: { limit?: number },
  options?: Omit<UseQueryOptions<SubscriptionAnomaliesResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: subscriptionQueryKeys.anomalies(params),
    queryFn: () => subscriptionApi.getSubscriptionAnomalies(params),
    staleTime: 60 * 1000,
    ...options,
  });

export const useSubscriptionMaintenanceJobs = (
  params?: { limit?: number },
  options?: Omit<
    UseQueryOptions<SubscriptionMaintenanceJobsResponse>,
    'queryKey' | 'queryFn'
  >
) =>
  useQuery({
    queryKey: [...subscriptionQueryKeys.all, 'maintenance-jobs', params] as const,
    queryFn: () => subscriptionApi.getSubscriptionMaintenanceJobs(params),
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,
    ...options,
  });

export const useSubscriptionMaintenanceDlq = (
  params?: { limit?: number; status?: string },
  options?: Omit<
    UseQueryOptions<SubscriptionMaintenanceDlqResponse>,
    'queryKey' | 'queryFn'
  >
) =>
  useQuery({
    queryKey: [...subscriptionQueryKeys.all, 'maintenance-dlq', params] as const,
    queryFn: () => subscriptionApi.getSubscriptionMaintenanceDlq(params),
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,
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
