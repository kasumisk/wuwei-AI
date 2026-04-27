'use client';

import { LocalizedLink } from './localized-link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

/**
 * 统一空状态组件
 * 用于列表/页面无数据时的统一展示，保证体验一致性
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      {icon ? (
        <div className="w-16 h-16  bg-muted flex items-center justify-center">{icon}</div>
      ) : (
        <div className="w-16 h-16  bg-muted flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            width="28"
            height="28"
            className="text-muted-foreground"
          >
            <path d="M20 13H4c-.55 0-1-.45-1-1s.45-1 1-1h16c.55 0 1 .45 1 1s-.45 1-1 1zm0-4H4c-.55 0-1-.45-1-1s.45-1 1-1h16c.55 0 1 .45 1 1s-.45 1-1 1zm0 8H4c-.55 0-1-.45-1-1s.45-1 1-1h16c.55 0 1 .45 1 1s-.45 1-1 1z" />
          </svg>
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">{description}</p>
        )}
      </div>
      {actionLabel && actionHref && (
        <LocalizedLink
          href={actionHref}
          className="mt-1 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-bold  active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
          asButton
        >
          {actionLabel}
        </LocalizedLink>
      )}
      {actionLabel && onAction && !actionHref && (
        <button
          onClick={onAction}
          className="mt-1 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-bold  active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
