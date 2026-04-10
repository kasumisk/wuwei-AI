import type { Metadata } from 'next';
import { NotificationPage } from '@/features/notification/components/notification-page';

export const metadata: Metadata = {
  title: '消息通知 - 无畏健康 uWay Health',
  description: '查看系统消息、用餐提醒和健康报告',
};

export default function NotificationsRoute() {
  return <NotificationPage />;
}
