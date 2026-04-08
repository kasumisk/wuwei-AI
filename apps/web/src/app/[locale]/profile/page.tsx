'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { useFood } from '@/lib/hooks/use-food';
import type { UserProfile, BehaviorProfile } from '@/lib/api/food';
import { LocalizedLink } from '@/components/common/localized-link';

const goalLabelMap: Record<string, string> = {
  fat_loss: '🔥 减脂',
  muscle_gain: '💪 增肌',
  health: '🧘 保持健康',
  habit: '🌱 改善习惯',
};

const activityLabelMap: Record<string, string> = {
  sedentary: '久坐不动',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高强度',
};

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-muted-foreground">
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoggedIn, logout } = useAuth();
  const { getProfile, getBehaviorProfile } = useFood();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [behaviorProfile, setBehaviorProfile] = useState<BehaviorProfile | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }
    getProfile().then(setProfile).catch(() => {});
    getBehaviorProfile().then(setBehaviorProfile).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/login');
  }, [logout, router]);

  const displayName = user?.nickname || user?.phone || user?.email || 'uWay 用户';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 用户头部 */}
      <div className="bg-primary px-6 pt-14 pb-8">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-foreground/20 border-2 border-primary-foreground/30 flex items-center justify-center shrink-0">
            <span className="text-2xl font-extrabold text-primary-foreground">{initials}</span>
          </div>
          <div>
            <p className="text-lg font-extrabold text-primary-foreground">{displayName}</p>
            {user?.phone && (
              <p className="text-sm text-primary-foreground/70">
                {user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
              </p>
            )}
            {user?.email && !user?.phone && (
              <p className="text-sm text-primary-foreground/70">{user.email}</p>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 py-5 max-w-lg mx-auto pb-24 space-y-4">

        {/* 健康概览 */}
        {profile && (
          <div className="bg-card rounded-2xl p-4 grid grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-lg font-extrabold text-primary">{profile.heightCm || '--'}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">身高 cm</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-lg font-extrabold text-primary">{profile.weightKg || '--'}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">体重 kg</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-base font-extrabold text-primary leading-5">{profile.goal ? goalLabelMap[profile.goal] : '--'}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">目标</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-base font-extrabold text-primary leading-5">{profile.activityLevel ? activityLabelMap[profile.activityLevel] : '--'}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">活动</p>
            </div>
          </div>
        )}

        {/* 饮食数据 */}
        {behaviorProfile && (
          <div className="bg-card rounded-2xl p-4 grid grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-xl font-extrabold text-primary">{behaviorProfile.streakDays}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">连续天数</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-xl font-extrabold text-primary">{behaviorProfile.longestStreak}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">最长记录</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-xl font-extrabold text-primary">{behaviorProfile.totalRecords}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">总记录数</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-xl font-extrabold text-primary">{Math.round(Number(behaviorProfile.avgComplianceRate) * 100)}%</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">健康率</p>
            </div>
          </div>
        )}

        {/* 菜单列表 */}
        <div className="bg-card rounded-2xl overflow-hidden divide-y divide-border/40">
          <LocalizedLink
            href="/health-profile"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">📋</span>
              <div>
                <p className="text-sm font-bold">健康档案</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {profile?.onboardingCompleted ? '身高 / 体重 / 目标 / 饮食习惯' : '未完善，点击填写'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!profile?.onboardingCompleted && (
                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  未完善
                </span>
              )}
              <ChevronRight />
            </div>
          </LocalizedLink>
        </div>

        {/* 退出登录 */}
        <button
          onClick={handleLogout}
          className="w-full bg-muted text-destructive font-bold py-4 rounded-2xl active:scale-[0.98] transition-all"
        >
          退出登录
        </button>
      </main>
    </div>
  );
}
