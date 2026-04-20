'use client';

import { LocalizedLink } from '@/components/common/localized-link';

/**
 * QuickActionBar — 首页4入口快速操作浮动按钮群
 *
 * 4 个入口直通分析页不同 Tab：
 * 1. 拍照分析 → /analyze?tab=image
 * 2. 文字描述 → /analyze?tab=text
 * 3. 常吃食物 → 打开底部Sheet (onFrequentClick)
 * 4. 食物库   → /analyze?tab=search
 */

interface QuickActionBarProps {
  onFrequentClick: () => void;
}

const actions = [
  {
    key: 'image',
    label: '拍照',
    href: '/analyze?tab=image',
    color: 'bg-primary text-primary-foreground',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M3 4V1h2v3h3v2H5v3H3V6H0V4h3zm3 6V7h3V4h7l1.83 2H21c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10h3zm7 9c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-3.2-5c0 1.77 1.43 3.2 3.2 3.2s3.2-1.43 3.2-3.2-1.43-3.2-3.2-3.2-3.2 1.43-3.2 3.2z" />
      </svg>
    ),
  },
  {
    key: 'text',
    label: '文字',
    href: '/analyze?tab=text',
    color: 'bg-blue-500 text-white',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
      </svg>
    ),
  },
  {
    key: 'frequent',
    label: '常吃',
    href: null, // handled by onClick
    color: 'bg-rose-500 text-white',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
  },
  {
    key: 'search',
    label: '食物库',
    href: '/analyze?tab=search',
    color: 'bg-amber-500 text-white',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
      </svg>
    ),
  },
] as const;

export function QuickActionBar({ onFrequentClick }: QuickActionBarProps) {
  return (
    <section className="mb-6">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1 mb-3">
        快速记录
      </h3>
      <div className="grid grid-cols-4 gap-3">
        {actions.map((action) =>
          action.href ? (
            <LocalizedLink
              key={action.key}
              href={action.href}
              className={`${action.color}  rounded-md p-3 flex flex-col items-center gap-2 active:scale-[0.95] transition-all shadow-sm`}
            >
              {action.icon}
              <span className="text-xs font-bold">{action.label}</span>
            </LocalizedLink>
          ) : (
            <button
              key={action.key}
              onClick={onFrequentClick}
              className={`${action.color}  rounded-md p-3 flex flex-col items-center gap-2 active:scale-[0.95] transition-all shadow-sm`}
            >
              {action.icon}
              <span className="text-xs font-bold">{action.label}</span>
            </button>
          )
        )}
      </div>
    </section>
  );
}
