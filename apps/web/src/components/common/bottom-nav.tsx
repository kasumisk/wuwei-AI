'use client';

import { useAuth } from '@/features/auth/hooks/use-auth';
import { useUnreadCount } from '@/features/notification/hooks/use-notifications';
import { LocalizedLink } from '@/components/common/localized-link';
import { useLocalizedRouter } from '@/lib/hooks/use-localized-router';

/* ─── Tab 配置 ─── */
interface NavTab {
  key: string;
  label: string;
  href: string;
  matchPattern: RegExp;
  icon: (props: { active: boolean }) => React.ReactNode;
}

function IconHome({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-6 h-6 ${active ? 'text-primary' : 'text-current'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  );
}

function IconCamera({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-6 h-6 ${active ? 'text-primary' : 'text-current'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M3 4V1h2v3h3v2H5v3H3V6H0V4h3zm3 6V7h3V4h7l1.83 2H21c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10h3zm7 9c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-3.2-5c0 1.77 1.43 3.2 3.2 3.2s3.2-1.43 3.2-3.2-1.43-3.2-3.2-3.2-3.2 1.43-3.2 3.2z" />
    </svg>
  );
}

function IconPlan({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-6 h-6 ${active ? 'text-primary' : 'text-current'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 6z" />
    </svg>
  );
}

function IconCoach({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-6 h-6 ${active ? 'text-primary' : 'text-current'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z" />
    </svg>
  );
}

function IconPerson({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-6 h-6 ${active ? 'text-primary' : 'text-current'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

const TABS: NavTab[] = [
  {
    key: 'home',
    label: '首页',
    href: '/home',
    matchPattern: /^\/home/,
    icon: IconHome,
  },
  {
    key: 'analyze',
    label: '分析',
    href: '/analyze',
    matchPattern: /^\/analyze/,
    icon: IconCamera,
  },
  {
    key: 'plan',
    label: '推荐',
    href: '/plan',
    matchPattern: /^\/plan/,
    icon: IconPlan,
  },
  {
    key: 'coach',
    label: 'AI教练',
    href: '/coach',
    matchPattern: /^\/coach/,
    icon: IconCoach,
  },
  {
    key: 'profile',
    label: '我的',
    href: '/profile',
    matchPattern: /^\/profile/,
    icon: IconPerson,
  },
];

export function BottomNav() {
  const { isLoggedIn } = useAuth();
  const { data: unreadData } = useUnreadCount(isLoggedIn);
  const unreadCount = unreadData?.unreadCount ?? 0;
  const { getCurrentPath } = useLocalizedRouter();

  // 去掉 locale 前缀用于匹配
  const normalizedPath = getCurrentPath();

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 bg-background/80 backdrop-blur-xl border-t border-border safe-bottom">
      <div className="flex justify-around items-center max-w-lg mx-auto px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {TABS.map((tab) => {
          const active = tab.matchPattern.test(normalizedPath);
          const href = tab.key === 'profile' && !isLoggedIn ? '/login' : tab.href;
          // 首页 tab 显示未读角标
          const showBadge = tab.key === 'home' && unreadCount > 0;

          return (
            <LocalizedLink
              key={tab.key}
              href={href}
              className={`relative flex flex-col items-center justify-center min-w-14 py-1 transition-all duration-200 active:scale-90
                ${active ? 'text-primary' : 'text-muted-foreground/75'}`}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 w-6 h-0.5 rounded-full bg-primary"
                />
              )}
              <div className="relative">
                <tab.icon active={active} />
                {showBadge && (
                  <span className="absolute -top-1 -right-1.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-0.5 ${active ? 'font-bold text-primary' : 'font-medium'}`}
              >
                {tab.label}
              </span>
            </LocalizedLink>
          );
        })}
      </div>
    </nav>
  );
}
