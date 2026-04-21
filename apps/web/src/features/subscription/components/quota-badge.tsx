'use client';

import { useQuotaStatus, type QuotaItem } from '../hooks/use-quota-status';
import { LocalizedLink } from '@/components/common/localized-link';

/**
 * Compact inline badge showing remaining quota for a single feature.
 * Renders nothing while loading or if quota data is unavailable.
 */
function SingleQuota({ item, label }: { item: QuotaItem | undefined; label: string }) {
  if (!item) return null;

  if (item.unlimited) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {label}：无限制
      </span>
    );
  }

  const pct = item.limit > 0 ? item.remaining / item.limit : 0;
  const color =
    pct <= 0
      ? 'text-destructive font-bold'
      : pct <= 0.2
        ? 'text-amber-600 font-bold'
        : 'text-muted-foreground';

  return (
    <span className={`text-[11px] ${color}`}>
      {label}：剩余 {item.remaining}/{item.limit} 次
    </span>
  );
}

/**
 * Shows quota status for the current input mode on the analyze page.
 * `mode` should be 'image' | 'text' — other modes don't consume AI quota.
 */
export function AnalyzeQuotaBadge({ mode }: { mode: 'image' | 'text' }) {
  const { tier, textAnalysis, imageAnalysis, isLoading } = useQuotaStatus();

  if (isLoading) return null;

  const item = mode === 'image' ? imageAnalysis : textAnalysis;
  const label = mode === 'image' ? '图片分析' : '文字分析';

  // No quota info available — don't render
  if (!item) return null;

  const exhausted = !item.unlimited && item.remaining <= 0;

  return (
    <div className="bg-linear-to-r from-primary/5 to-primary/10 border border-primary/15 px-4 py-3 space-y-1">
      <div className="flex items-center justify-between">
        <SingleQuota item={item} label={label} />
        {tier === 'free' && (
          <LocalizedLink
            href="/pricing"
            className="text-xs text-primary font-bold shrink-0 px-3 py-1 bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            升级解锁更多
          </LocalizedLink>
        )}
      </div>
      {exhausted && (
        <p className="text-[11px] text-destructive">
          今日次数已用完，明天重置或升级套餐立即增加额度
        </p>
      )}
    </div>
  );
}

/**
 * Compact quota summary for the home page — shows all AI quotas in a row.
 */
export function HomeQuotaSummary() {
  const { tier, textAnalysis, imageAnalysis, coach, isLoading } = useQuotaStatus();

  if (isLoading) return null;

  // If all quotas are missing, don't render
  if (!textAnalysis && !imageAnalysis && !coach) return null;

  return (
    <div className="bg-card rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold">今日配额</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase">
          {tier}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <SingleQuota item={textAnalysis} label="文字" />
        <SingleQuota item={imageAnalysis} label="图片" />
        <SingleQuota item={coach} label="教练" />
      </div>
    </div>
  );
}
