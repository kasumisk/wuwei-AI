'use client';

import { Skeleton } from '@/components/ui/skeleton';

interface PageSkeletonProps {
  /** 页面标题区域 (默认 true) */
  showHeader?: boolean;
  /** 卡片行数 (默认 3) */
  cardCount?: number;
  /** 显示圆形头像占位 (默认 false) */
  showAvatar?: boolean;
}

/**
 * 统一页面骨架屏
 * 在页面级数据加载时使用，保证 CLS (Cumulative Layout Shift) 最小化
 */
export function PageSkeleton({
  showHeader = true,
  cardCount = 3,
  showAvatar = false,
}: PageSkeletonProps) {
  return (
    <div className="space-y-5 animate-pulse">
      {showHeader && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      )}

      {showAvatar && (
        <div className="flex items-center gap-3">
          <Skeleton className="w-12 h-12 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      )}

      {Array.from({ length: cardCount }).map((_, i) => (
        <div key={i} className="bg-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          {i === 0 && <Skeleton className="h-8 w-full rounded-xl" />}
        </div>
      ))}
    </div>
  );
}

/**
 * 内联卡片骨架屏
 * 用于单个卡片的加载占位
 */
export function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="bg-card rounded-2xl p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === rows - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
