import type { Metadata } from 'next';
import { RecordsPage } from '@/features/records/components/records-page';

export const metadata: Metadata = {
  title: '记录历史 - 无畏健康 uWay Health',
  description: '查看你的饮食记录历史，支持按时间范围筛选',
};

export default function RecordsRoute() {
  return <RecordsPage />;
}
