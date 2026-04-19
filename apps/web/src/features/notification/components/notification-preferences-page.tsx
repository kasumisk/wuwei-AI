'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  notificationService,
  type NotificationPreference,
  type NotificationType,
} from '@/lib/api/notification';
import { useToast } from '@/lib/hooks/use-toast';
import { CardSkeleton } from '@/components/common/page-skeleton';

/* ─── 通知类型配置 ─── */

const NOTIFICATION_TYPES: {
  type: NotificationType;
  label: string;
  description: string;
  icon: string;
}[] = [
  { type: 'meal_reminder', label: '用餐提醒', description: '到饭点提醒你记录饮食', icon: '🍽️' },
  { type: 'streak_risk', label: '打卡风险', description: '连续打卡即将中断时提醒', icon: '🔥' },
  { type: 'goal_progress', label: '目标进度', description: '目标达成进度更新', icon: '🎯' },
  { type: 'weekly_report', label: '周报推送', description: '每周饮食健康报告', icon: '📊' },
  { type: 'coach_nudge', label: 'AI 教练建议', description: 'AI 教练的个性化提醒', icon: '🤖' },
  { type: 'precomputed_ready', label: '推荐就绪', description: '个性化推荐计算完成', icon: '✨' },
  { type: 'system', label: '系统通知', description: '重要系统公告和更新', icon: '🔔' },
];

/* ─── 免打扰时段选项 ─── */

const QUIET_HOURS = [
  { label: '不开启', start: null, end: null },
  { label: '22:00 - 08:00', start: '22:00', end: '08:00' },
  { label: '23:00 - 07:00', start: '23:00', end: '07:00' },
  { label: '21:00 - 09:00', start: '21:00', end: '09:00' },
];

/* ─── 主组件 ─── */

export function NotificationPreferencesPage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 本地状态
  const [pushEnabled, setPushEnabled] = useState(true);
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set());
  const [quietHoursIndex, setQuietHoursIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) router.push('/login');
  }, [isLoggedIn, router]);

  // 获取当前偏好
  const { data: preference, isLoading } = useQuery({
    queryKey: ['notification-preference'],
    queryFn: () => notificationService.getPreference(),
    enabled: isLoggedIn,
  });

  // 初始化本地状态
  useEffect(() => {
    if (preference && !initialized) {
      setPushEnabled(preference.pushEnabled);
      setEnabledTypes(new Set(preference.enabledTypes));

      // 匹配免打扰时段
      const matchIdx = QUIET_HOURS.findIndex(
        (q) => q.start === preference.quietStart && q.end === preference.quietEnd
      );
      setQuietHoursIndex(matchIdx >= 0 ? matchIdx : 0);
      setInitialized(true);
    }
  }, [preference, initialized]);

  // 保存偏好
  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof notificationService.updatePreference>[0]) =>
      notificationService.updatePreference(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preference'] });
      toast({ title: '通知偏好已保存' });
    },
    onError: () => {
      toast({ title: '保存失败，请重试', variant: 'destructive' });
    },
  });

  // 切换总开关
  const handleTogglePush = useCallback(() => {
    const next = !pushEnabled;
    setPushEnabled(next);
    saveMutation.mutate({ pushEnabled: next });
  }, [pushEnabled, saveMutation]);

  // 切换单个类型
  const handleToggleType = useCallback(
    (type: string) => {
      setEnabledTypes((prev) => {
        const next = new Set(prev);
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        saveMutation.mutate({ enabledTypes: Array.from(next) });
        return next;
      });
    },
    [saveMutation]
  );

  // 切换免打扰时段
  const handleQuietHoursChange = useCallback(
    (index: number) => {
      setQuietHoursIndex(index);
      const selected = QUIET_HOURS[index];
      saveMutation.mutate({
        quietStart: selected.start ?? undefined,
        quietEnd: selected.end ?? undefined,
      });
    },
    [saveMutation]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-4 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button
              onClick={() => router.back()}
              className="mr-4 text-foreground/70 hover:text-foreground"
              aria-label="返回"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">通知设置</h1>
          </div>
          {saveMutation.isPending && (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent  animate-spin" />
          )}
        </div>
      </nav>

      <main className="px-4 py-4 max-w-lg mx-auto pb-32 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <CardSkeleton rows={1} />
            <CardSkeleton rows={4} />
            <CardSkeleton rows={2} />
          </div>
        ) : (
          <>
            {/* 推送总开关 */}
            <section className="bg-card  p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10  bg-primary/10 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold">推送通知</p>
                    <p className="text-xs text-muted-foreground">接收消息推送提醒</p>
                  </div>
                </div>
                <button
                  onClick={handleTogglePush}
                  className={`relative w-12 h-7  transition-colors duration-200 ${
                    pushEnabled ? 'bg-primary' : 'bg-muted'
                  }`}
                  role="switch"
                  aria-checked={pushEnabled}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6  bg-white shadow-sm transition-transform duration-200 ${
                      pushEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* 通知类型 */}
            <section className="space-y-2">
              <h2 className="text-xs font-bold text-muted-foreground px-1">通知类型</h2>
              <div className="bg-card  divide-y divide-border/30">
                {NOTIFICATION_TYPES.map(({ type, label, description, icon }) => {
                  const isEnabled = enabledTypes.has(type);
                  return (
                    <div key={type} className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-lg shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggleType(type)}
                        disabled={!pushEnabled}
                        className={`relative w-11 h-6  transition-colors duration-200 shrink-0 ml-3 disabled:opacity-40 ${
                          isEnabled ? 'bg-primary' : 'bg-muted'
                        }`}
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`${isEnabled ? '关闭' : '开启'}${label}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5  bg-white shadow-sm transition-transform duration-200 ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 免打扰时段 */}
            <section className="space-y-2">
              <h2 className="text-xs font-bold text-muted-foreground px-1">免打扰时段</h2>
              <div className="bg-card  p-4 space-y-2">
                <p className="text-xs text-muted-foreground">在此时段内不会收到推送通知</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {QUIET_HOURS.map((option, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuietHoursChange(i)}
                      disabled={!pushEnabled}
                      className={`px-3.5 py-2  text-sm font-medium transition-all disabled:opacity-40 ${
                        quietHoursIndex === i
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* 说明 */}
            <p className="text-[11px] text-muted-foreground text-center px-4 leading-relaxed">
              修改会自动保存。系统通知（如安全提醒）不受免打扰影响。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
