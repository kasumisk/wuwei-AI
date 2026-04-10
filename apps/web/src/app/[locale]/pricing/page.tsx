import type { Metadata } from 'next';
import { PricingPage } from '@/features/subscription/components/pricing-page';

export const metadata: Metadata = {
  title: '选择方案 - 无畏健康 uWay Health',
  description: '选择最适合你的订阅计划，让 AI 营养管家为你服务',
};

export default function PricingRoute() {
  return <PricingPage />;
}
