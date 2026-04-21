'use client';

import { useQuery } from '@tanstack/react-query';
import { subscriptionService } from '@/lib/api/subscription';
import { useAuth } from '@/features/auth/hooks/use-auth';

export interface QuotaItem {
  feature: string;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  resetAt: string | null;
}

/**
 * 获取当前用户的配额使用状态
 * 轮询间隔 5 分钟，staleTime 2 分钟
 */
export function useQuotaStatus() {
  const { isLoggedIn } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['quota-status'],
    queryFn: () => subscriptionService.getQuotaStatus(),
    enabled: isLoggedIn,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const quotas = data?.quotas ?? [];
  const tier = data?.tier ?? 'free';

  /** 按 feature name 查找（大小写不敏感，兼容后端返回的小写蛇形命名） */
  function getQuota(feature: string): QuotaItem | undefined {
    const target = feature.toLowerCase();
    return quotas.find((q) => (q.feature || '').toLowerCase() === target);
  }

  /** 文字分析配额 */
  const textAnalysis = getQuota('ai_text_analysis');
  /** 图片分析配额 */
  const imageAnalysis = getQuota('ai_image_analysis');
  /** AI 教练配额 */
  const coach = getQuota('ai_coach');

  return {
    tier,
    quotas,
    textAnalysis,
    imageAnalysis,
    coach,
    isLoading,
    refetch,
    getQuota,
  };
}
