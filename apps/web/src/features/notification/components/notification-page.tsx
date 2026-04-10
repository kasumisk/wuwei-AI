'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useNotifications,
  useNotificationActions,
} from '@/features/notification/hooks/use-notifications';
import type { NotificationItem, NotificationType } from '@/lib/api/notification';

// ── 类型配色 ──
const TYPE_CONFIG: Record<NotificationType, { icon: string; label: string; color: string }> = {
  meal_reminder: { icon: '🍽️', label: '用餐提醒', color: 'bg-green-100 text-green-700' },
  streak_risk: { icon: '🔥', label: '打卡风险', color: 'bg-orange-100 text-orange-700' },
  goal_progress: { icon: '🎯', label: '目标进度', color: 'bg-blue-100 text-blue-700' },
  weekly_report: { icon: '📊', label: '周报', color: 'bg-purple-100 text-purple-700' },
  coach_nudge: { icon: '🤖', label: 'AI 教练', color: 'bg-indigo-100 text-indigo-700' },
  precomputed_ready: { icon: '✨', label: '推荐就绪', color: 'bg-amber-100 text-amber-700' },
  system: { icon: '🔔', label: '系统', color: 'bg-gray-100 text-gray-700' },
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function NotificationPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isFetching } = useNotifications({ page, limit });
  const { markAsRead, markAllAsRead, isMarkingAll } = useNotificationActions();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const hasUnread = items.some((n) => !n.isRead);

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
    } catch {
      // Silent fail
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-6 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button
              onClick={() => router.back()}
              className="mr-4 text-foreground/70 hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">消息通知</h1>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && <span className="text-xs text-muted-foreground">共 {total} 条</span>}
            {hasUnread && (
              <button
                onClick={handleMarkAllRead}
                disabled={isMarkingAll}
                className="text-xs text-primary font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                {isMarkingAll ? '处理中...' : '全部已读'}
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="px-6 py-4 max-w-lg mx-auto pb-32">
        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <svg
                className="w-7 h-7 text-muted-foreground"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">暂无通知</p>
              <p className="text-xs text-muted-foreground mt-1">系统消息和提醒会在这里出现</p>
            </div>
          </div>
        )}

        {/* List */}
        {!isLoading && items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onMarkRead={markAsRead} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="px-4 py-2 bg-muted rounded-full text-sm font-medium disabled:opacity-30 active:scale-[0.97] transition-all"
            >
              上一页
            </button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="px-4 py-2 bg-muted rounded-full text-sm font-medium disabled:opacity-30 active:scale-[0.97] transition-all"
            >
              下一页
            </button>
          </div>
        )}

        {isFetching && !isLoading && (
          <div className="flex justify-center mt-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </main>
    </div>
  );
}

/** 单条通知 */
function NotificationRow({
  item,
  onMarkRead,
}: {
  item: NotificationItem;
  onMarkRead: (id: string) => Promise<void>;
}) {
  const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.system;

  const handleClick = async () => {
    if (!item.isRead) {
      try {
        await onMarkRead(item.id);
      } catch {
        // Silent
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`rounded-xl p-4 transition-all cursor-pointer active:scale-[0.99] ${
        item.isRead ? 'bg-card opacity-70' : 'bg-card border-l-4 border-l-primary'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 类型图标 */}
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm ${config.color}`}
        >
          {config.icon}
        </div>

        <div className="flex-1 min-w-0">
          {/* 标题 + 时间 */}
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm font-medium line-clamp-1 ${!item.isRead ? 'font-bold' : ''}`}>
              {item.title}
            </h4>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatTime(item.createdAt)}
            </span>
          </div>

          {/* 内容 */}
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.body}</p>

          {/* 类型标签 */}
          <span
            className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.color}`}
          >
            {config.label}
          </span>
        </div>

        {/* 未读点 */}
        {!item.isRead && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
      </div>
    </div>
  );
}
