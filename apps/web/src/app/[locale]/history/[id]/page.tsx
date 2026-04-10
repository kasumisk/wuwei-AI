import type { Metadata } from 'next';
import { HistoryDetailPage } from '@/features/history/components/history-detail-page';

export const metadata: Metadata = {
  title: '分析详情 - 无畏健康 uWay Health',
  description: '查看食物分析详情',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function HistoryDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return <HistoryDetailPage analysisId={id} />;
}
