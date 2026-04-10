'use client';

/**
 * 通知 API 服务
 * 对接后端 8 个通知端点
 */

import { clientGet, clientPost, clientPut, clientDelete } from './client-api';
import type { ApiResponse } from './http-client';

// ── 类型 ──

export type NotificationType =
  | 'meal_reminder'
  | 'streak_risk'
  | 'goal_progress'
  | 'weekly_report'
  | 'coach_nudge'
  | 'precomputed_ready'
  | 'system';

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  isPushed: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

export interface NotificationPreference {
  pushEnabled: boolean;
  enabledTypes: string[];
  quietStart: string | null;
  quietEnd: string | null;
}

export type DevicePlatform = 'ios' | 'android' | 'web';

// ── Unwrap ──

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ── Service ──

export const notificationService = {
  /** 获取站内信列表（分页） */
  getNotifications: async (params?: {
    page?: number;
    limit?: number;
  }): Promise<NotificationListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return unwrap(clientGet<NotificationListResponse>(`/app/notifications${qs ? `?${qs}` : ''}`));
  },

  /** 获取未读数量 */
  getUnreadCount: async (): Promise<UnreadCountResponse> => {
    return unwrap(clientGet<UnreadCountResponse>('/app/notifications/unread'));
  },

  /** 标记单条已读 */
  markAsRead: async (id: string): Promise<void> => {
    await clientPost<null>(`/app/notifications/${id}/read`, {});
  },

  /** 标记全部已读 */
  markAllAsRead: async (): Promise<{ markedCount: number }> => {
    return unwrap(clientPost<{ markedCount: number }>('/app/notifications/read-all', {}));
  },

  /** 注册设备推送令牌 */
  registerDevice: async (data: {
    token: string;
    deviceId: string;
    platform: DevicePlatform;
  }): Promise<{ id: string; deviceId: string; platform: DevicePlatform }> => {
    return unwrap(
      clientPost<{ id: string; deviceId: string; platform: DevicePlatform }>(
        '/app/notifications/device',
        data
      )
    );
  },

  /** 注销设备推送令牌 */
  deactivateDevice: async (deviceId: string): Promise<void> => {
    await clientDelete<null>('/app/notifications/device', {
      data: { deviceId },
    } as unknown as undefined);
  },

  /** 获取通知偏好 */
  getPreference: async (): Promise<NotificationPreference> => {
    return unwrap(clientGet<NotificationPreference>('/app/notifications/preference'));
  },

  /** 更新通知偏好 */
  updatePreference: async (data: {
    pushEnabled?: boolean;
    enabledTypes?: string[];
    quietStart?: string;
    quietEnd?: string;
  }): Promise<NotificationPreference> => {
    return unwrap(clientPut<NotificationPreference>('/app/notifications/preference', data));
  },
};
