import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import request from '@/utils/request';
import { PATH } from './path';

export interface PushOverview {
  activeDevices: number;
  inactiveDevices: number;
  failedLogs: number;
  sentLogs: number;
  byProvider: Array<{
    providerType: string;
    pushRegion: string;
    isActive: boolean;
    _count: { _all: number };
  }>;
}

export interface PushDeviceItem {
  id: string;
  userId: string;
  token: string;
  deviceId: string;
  platform: string;
  pushRegion: string;
  providerType: string;
  timezone: string;
  locale: string;
  appVersion?: string | null;
  deviceBrand?: string | null;
  romType?: string | null;
  isActive: boolean;
  lastSeenAt: string;
  updatedAt: string;
}

export interface PushLogItem {
  id: string;
  userId: string;
  deviceTokenId?: string | null;
  notificationType: string;
  providerType: string;
  pushRegion: string;
  status: string;
  title: string;
  body: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

export interface PushProviderHealthItem {
  type: string;
  isAvailable: boolean;
  fallbackType: string;
  activeDevices: number;
  inactiveDevices: number;
  sentLogs: number;
  failedLogs: number;
}

export interface PushUserDetail {
  user: {
    id: string;
    email?: string | null;
    nickname?: string | null;
    avatar?: string | null;
    status: string;
    createdAt: string;
    lastLoginAt?: string | null;
  };
  preference: {
    userId: string;
    pushEnabled: boolean;
    dailyCheckInEnabled: boolean;
    noAnalysisTodayEnabled: boolean;
    weeklyReportEnabled: boolean;
    analysisFollowUpEnabled: boolean;
    premiumUpgradeHintEnabled: boolean;
    timezone: string;
    locale: string;
    quietStart: string;
    quietEnd: string;
    dailyReminderTime: string;
    noAnalysisReminderTime: string;
    weeklyReportDay: number;
    weeklyReportTime: string;
    updatedAt: string;
  };
  devices: PushDeviceItem[];
  logs: PushLogItem[];
  summary: {
    activeDeviceCount: number;
    inactiveDeviceCount: number;
    sentLogCount: number;
    failedLogCount: number;
  };
}

const _all = ['push-management'] as const;

export const pushManagementQueryKeys = {
  all: _all,
  overview: [..._all, 'overview'] as const,
  devices: (params?: Record<string, unknown>) => [..._all, 'devices', params] as const,
  logs: (params?: Record<string, unknown>) => [..._all, 'logs', params] as const,
  providerHealth: [..._all, 'provider-health'] as const,
  userDetail: (userId?: string) => [..._all, 'user-detail', userId] as const,
};

export const pushManagementApi = {
  getOverview: (): Promise<PushOverview> => request.get(PATH.ADMIN.PUSH_OVERVIEW),
  getDevices: (
    params?: Record<string, unknown>
  ): Promise<{ list: PushDeviceItem[]; total: number }> =>
    request.get(PATH.ADMIN.PUSH_DEVICES, params),
  getLogs: (params?: Record<string, unknown>): Promise<{ list: PushLogItem[]; total: number }> =>
    request.get(PATH.ADMIN.PUSH_LOGS, params),
  getUserDetail: (userId: string): Promise<PushUserDetail> =>
    request.get(PATH.ADMIN.PUSH_USER_DETAIL(userId)),
  getProviderHealth: (): Promise<PushProviderHealthItem[]> =>
    request.get(PATH.ADMIN.PUSH_PROVIDER_HEALTH),
  disableDevice: (id: string): Promise<{ id: string; disabled: boolean }> =>
    request.delete(`${PATH.ADMIN.PUSH_DEVICES}/${id}`),
  triggerCron: (data: {
    cronName: 'push.daily-check-in' | 'push.no-analysis-today' | 'push.weekly-report-ready';
  }): Promise<{ cronName: string; triggeredAt: string }> =>
    request.post(PATH.ADMIN.PUSH_CRON_TRIGGER, data),
  retryLog: (id: string): Promise<{ retried: boolean; mode: string; sent: number; failed: number }> =>
    request.post(PATH.ADMIN.PUSH_LOG_RETRY(id), {}),
  cleanupInvalidTokens: (data?: { limit?: number }): Promise<{
    scannedLogs: number;
    matchedDeviceIds: number;
    cleanedCount: number;
  }> => request.post(PATH.ADMIN.PUSH_CLEANUP_INVALID_TOKENS, data ?? {}),
  sendTest: (data: {
    userId: string;
    type?: string;
    payload?: Record<string, string | number | boolean | null>;
  }): Promise<{ sent: number; failed: number }> => request.post(PATH.ADMIN.PUSH_TEST, data),
};

export const usePushOverview = (
  options?: Omit<UseQueryOptions<PushOverview>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: pushManagementQueryKeys.overview,
    queryFn: () => pushManagementApi.getOverview(),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  });

export const usePushDevices = (
  params?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<{ list: PushDeviceItem[]; total: number }>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: pushManagementQueryKeys.devices(params),
    queryFn: () => pushManagementApi.getDevices(params),
    staleTime: 15 * 1000,
    ...options,
  });

export const usePushLogs = (
  params?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<{ list: PushLogItem[]; total: number }>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: pushManagementQueryKeys.logs(params),
    queryFn: () => pushManagementApi.getLogs(params),
    staleTime: 15 * 1000,
    ...options,
  });

export const usePushUserDetail = (
  userId?: string,
  options?: Omit<UseQueryOptions<PushUserDetail>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: pushManagementQueryKeys.userDetail(userId),
    queryFn: () => pushManagementApi.getUserDetail(userId as string),
    enabled: Boolean(userId),
    staleTime: 15 * 1000,
    ...options,
  });

export const usePushProviderHealth = (
  options?: Omit<UseQueryOptions<PushProviderHealthItem[]>, 'queryKey' | 'queryFn'>,
) =>
  useQuery({
    queryKey: pushManagementQueryKeys.providerHealth,
    queryFn: () => pushManagementApi.getProviderHealth(),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  });

export const useDisablePushDevice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pushManagementApi.disableDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.all });
    },
  });
};

export const useSendPushTest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      userId: string;
      type?: string;
      payload?: Record<string, string | number | boolean | null>;
    }) => pushManagementApi.sendTest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.logs() });
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.overview });
    },
  });
};

export const useTriggerPushCron = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      cronName: 'push.daily-check-in' | 'push.no-analysis-today' | 'push.weekly-report-ready';
    }) => pushManagementApi.triggerCron(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.all });
    },
  });
};

export const useRetryPushLog = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pushManagementApi.retryLog(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.all });
    },
  });
};

export const useCleanupInvalidPushTokens = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: { limit?: number }) => pushManagementApi.cleanupInvalidTokens(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushManagementQueryKeys.all });
    },
  });
};

export default pushManagementApi;
