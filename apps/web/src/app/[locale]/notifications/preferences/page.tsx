import type { Metadata } from 'next';
import { NotificationPreferencesPage } from '@/features/notification/components/notification-preferences-page';

export const metadata: Metadata = {
  title: '通知设置 - 无畏健康 uWay Health',
  description: '管理通知推送偏好和免打扰设置',
};

export default function NotificationPreferencesRoute() {
  return <NotificationPreferencesPage />;
}
