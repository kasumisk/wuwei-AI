import type { Metadata } from 'next';
import { PlanPage } from '@/features/plan/components/plan-page';

export const metadata: Metadata = {
  title: '饮食推荐 - 无畏健康 uWay Health',
  description: 'AI 为你量身定制的每日和每周饮食计划，支持智能替换和个性化调整',
};

export default function PlanRoute() {
  return <PlanPage />;
}
