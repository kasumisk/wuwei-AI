import type { Metadata } from 'next';
import { HistoryPage } from '@/features/history/components/history-page';

export const metadata: Metadata = {
  title: '分析历史 - 无畏健康 uWay Health',
  description: '查看你的食物分析历史记录，追踪饮食变化趋势',
};

export default function HistoryRoute() {
  return <HistoryPage />;
}
