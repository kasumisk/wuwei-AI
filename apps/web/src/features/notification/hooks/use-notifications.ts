'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@/lib/api/notification';
import type {
  NotificationListResponse,
  UnreadCountResponse,
  NotificationPreference,
} from '@/lib/api/notification';

/** 站内信列表 hook */
export function useNotifications(params?: { page?: number; limit?: number; enabled?: boolean }) {
  return useQuery<NotificationListResponse>({
    queryKey: ['notifications', params?.page, params?.limit],
    queryFn: () =>
      notificationService.getNotifications({
        page: params?.page,
        limit: params?.limit,
      }),
    enabled: params?.enabled !== false,
    staleTime: 30 * 1000,
  });
}

/** 未读数量 hook（轮询，用于全局红点） */
export function useUnreadCount(enabled: boolean = true) {
  return useQuery<UnreadCountResponse>({
    queryKey: ['notifications-unread'],
    queryFn: () => notificationService.getUnreadCount(),
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // 每分钟轮询一次
  });
}

/** 标记已读 mutations */
export function useNotificationActions() {
  const queryClient = useQueryClient();

  const markAsRead = useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  return {
    markAsRead: markAsRead.mutateAsync,
    isMarkingRead: markAsRead.isPending,
    markAllAsRead: markAllAsRead.mutateAsync,
    isMarkingAll: markAllAsRead.isPending,
  };
}

/** 通知偏好 hook */
export function useNotificationPreference(enabled: boolean = true) {
  return useQuery<NotificationPreference>({
    queryKey: ['notification-preference'],
    queryFn: () => notificationService.getPreference(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** 更新通知偏好 mutation */
export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      pushEnabled?: boolean;
      enabledTypes?: string[];
      quietStart?: string;
      quietEnd?: string;
    }) => notificationService.updatePreference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preference'] });
    },
  });
}
