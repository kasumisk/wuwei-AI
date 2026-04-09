'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalizedRouter } from '@/lib/hooks/use-localized-router';

/**
 * 旧版健康档案页面 — 已废弃
 * 功能已迁移至:
 * - /onboarding (新用户引导)
 * - /profile/edit (已有用户编辑档案)
 *
 * 此页面仅做客户端兜底重定向（主要 redirect 在 next.config.ts 中配置）
 */
export default function HealthProfilePage() {
  const searchParams = useSearchParams();
  const { replace } = useLocalizedRouter();

  useEffect(() => {
    const isOnboarding = searchParams.get('from') === 'onboarding';
    if (isOnboarding) {
      replace('/onboarding');
    } else {
      replace('/profile/edit');
    }
  }, [searchParams, replace]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">跳转中...</div>
    </div>
  );
}
