'use client';

import { useQuery } from '@tanstack/react-query';
import { foodPlanService } from '@/lib/api/food-plan';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { FeedbackDimensionStats } from '@/types/food';

/**
 * 反馈统计卡片
 * 调用 GET /api/app/food/feedback-stats
 * 展示用户对推荐的整体反馈维度分布
 */

const DIMENSION_LABELS: {
  key: keyof Omit<FeedbackDimensionStats, 'ratedCount'>;
  label: string;
  icon: string;
}[] = [
  { key: 'avgTaste', label: '口味', icon: '😋' },
  { key: 'avgPortion', label: '份量', icon: '🍽️' },
  { key: 'avgPrice', label: '价格', icon: '💰' },
  { key: 'avgTiming', label: '时机', icon: '⏰' },
];

function RatingBar({ value, label, icon }: { value: number | null; label: string; icon: string }) {
  const displayVal = value !== null ? value.toFixed(1) : '--';
  const widthPct = value !== null ? Math.round((value / 5) * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-5 text-center shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-8 shrink-0">{label}</span>
      <div className="flex-1 bg-muted  h-2 overflow-hidden">
        <div
          className={`h-full  transition-all ${
            value !== null && value >= 4
              ? 'bg-green-500'
              : value !== null && value >= 3
                ? 'bg-primary'
                : value !== null && value >= 2
                  ? 'bg-amber-500'
                  : 'bg-red-400'
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="text-xs font-bold text-foreground w-8 text-right shrink-0">
        {displayVal}
      </span>
    </div>
  );
}

export function FeedbackStatsCard() {
  const { isLoggedIn } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['feedback-stats'],
    queryFn: () => foodPlanService.getFeedbackStats(30),
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-card  p-4 animate-pulse space-y-3">
        <div className="h-4 w-24 bg-muted rounded" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3 w-full bg-muted rounded" />
        ))}
      </div>
    );
  }

  if (!data || data.global.ratedCount === 0) {
    return (
      <div className="bg-card  p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">📈</span>
          <h3 className="text-sm font-bold">反馈统计</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          暂无反馈数据。对推荐的食物进行评分后，统计数据将在这里展示。
        </p>
      </div>
    );
  }

  const { global, days } = data;

  // Top 3 foods by rated count
  const topFoods = Object.entries(data.perFood)
    .sort(([, a], [, b]) => b.ratedCount - a.ratedCount)
    .slice(0, 3);

  return (
    <div className="bg-card  p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📈</span>
          <h3 className="text-sm font-bold">反馈统计</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          近{days}天 · {global.ratedCount}次反馈
        </span>
      </div>

      {/* 全局维度评分 */}
      <div className="space-y-2">
        {DIMENSION_LABELS.map(({ key, label, icon }) => (
          <RatingBar key={key} value={global[key]} label={label} icon={icon} />
        ))}
      </div>

      {/* 高频食物 Top 3 */}
      {topFoods.length > 0 && (
        <div className="pt-2 border-t border-border/30 space-y-1.5">
          <p className="text-[11px] font-bold text-muted-foreground">评价最多的食物</p>
          {topFoods.map(([foodName, stats]) => (
            <div key={foodName} className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate flex-1">{foodName}</span>
              <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                <span>{stats.ratedCount}次</span>
                {stats.avgTaste !== null && (
                  <span className="font-medium text-foreground">{stats.avgTaste.toFixed(1)}分</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
