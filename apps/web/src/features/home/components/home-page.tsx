'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useHomeData } from '@/features/home/hooks/use-home-data';
import { LocalizedLink } from '@/components/common/localized-link';
import { ProactiveReminderCard } from './proactive-reminder';
import { TodayStatus } from './today-status';
import { MealRecordCard } from './meal-record-card';
import { GoalTransitionCard } from './goal-transition-card';
import { NutritionScoreCard } from './nutrition-score-card';
import { WeeklyTrendCard } from './weekly-trend-card';
import { QuickActionBar } from './quick-action-bar';
import { FrequentFoodSheet } from './frequent-food-sheet';
import { ProfileCollectionCard } from './profile-collection-card';
import { CompletionPrompt } from '@/features/profile/components/completion-prompt';
import { useUnreadCount } from '@/features/notification/hooks/use-notifications';
import { MEAL_LABELS } from '@/lib/constants/food';
import Image from 'next/image';
import type { FoodRecord, MealSuggestion, DailySummary } from '@/types/food';

/* ─── SVG Icon Components ─── */
function IconCamera({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M3 4V1h2v3h3v2H5v3H3V6H0V4h3zm3 6V7h3V4h7l1.83 2H21c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10h3zm7 9c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-3.2-5c0 1.77 1.43 3.2 3.2 3.2s3.2-1.43 3.2-3.2-1.43-3.2-3.2-3.2-3.2 1.43-3.2 3.2z" />
    </svg>
  );
}

function IconSearch({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function IconPerson({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function IconSettings({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

export function HomePage() {
  const { user, isLoggedIn } = useAuth();
  const router = useRouter();
  const {
    summary,
    records: meals,
    suggestion: mealSuggestion,
    reminder,
    profile,
    recentSummaries,
    nutritionScore,
    isLoading,
  } = useHomeData();
  const [dismissedReminder, setDismissedReminder] = useState(false);
  const [dismissedCompletion, setDismissedCompletion] = useState(false);
  const [dismissedGoalTransition, setDismissedGoalTransition] = useState(false);
  const [dismissedCollectionCard, setDismissedCollectionCard] = useState(false);
  const [frequentSheetOpen, setFrequentSheetOpen] = useState(false);
  const { data: unreadData } = useUnreadCount(isLoggedIn);
  const unreadCount = unreadData?.unreadCount ?? 0;

  // 安全网：登录且未完成引导时跳转分步引导
  if (isLoggedIn && profile && !profile.onboardingCompleted) {
    const startStep = profile.onboardingStep ?? 1;
    router.replace(`/onboarding?step=${startStep}`);
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased selection:bg-(--color-primary-container) selection:text-on-primary-container">
      {/* Top Navigation */}
      <nav className="fixed top-0 w-full z-50 glass-morphism">
        <div className="flex justify-between items-center px-6 py-4 w-full max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center overflow-hidden border-2 border-(--color-primary-container)">
              {user?.avatar ? (
                <Image
                  src={user.avatar}
                  alt="avatar"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                <IconPerson className="w-5 h-5 text-primary" />
              )}
            </div>
            <h1 className="text-xl font-extrabold text-foreground font-headline tracking-tight">
              无畏健康
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {/* 通知铃铛 */}
            <LocalizedLink
              href="/notifications"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:opacity-80 transition-opacity active:scale-95 duration-200 text-primary relative"
              aria-label={`通知${unreadCount > 0 ? `（${unreadCount > 99 ? '99+' : unreadCount}条未读）` : ''}`}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </LocalizedLink>
            {/* 设置/个人 */}
            <LocalizedLink
              href="/profile"
              className="w-10 h-10 flex items-center justify-center rounded-full hover:opacity-80 transition-opacity active:scale-95 duration-200 text-primary"
              aria-label="设置"
            >
              <IconSettings className="w-6 h-6" />
            </LocalizedLink>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-32 px-6 max-w-lg mx-auto">
        {/* Loading 骨架屏 */}
        {isLoading && (
          <div className="space-y-4 animate-pulse">
            {/* 今日状态骨架 */}
            <div className="bg-card rounded-2xl p-5 space-y-3">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-8 w-32 bg-muted rounded" />
              <div className="flex gap-3">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted rounded" />
              </div>
            </div>
            {/* 按钮区域骨架 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="h-24 bg-muted rounded-2xl" />
              <div className="h-24 bg-muted rounded-2xl" />
            </div>
            {/* 记录列表骨架 */}
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card rounded-xl p-4 space-y-2">
                  <div className="h-4 w-20 bg-muted rounded" />
                  <div className="h-3 w-full bg-muted rounded" />
                  <div className="h-3 w-2/3 bg-muted rounded" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 正常内容 */}
        {!isLoading && (
          <>
            {/* 今日状态 */}
            <TodayStatus summary={summary} profile={profile} />

            {/* 今日营养评分 */}
            <NutritionScoreCard scoreData={nutritionScore} />

            {/* 近7天趋势 */}
            <WeeklyTrendCard summaries={recentSummaries} />

            {/* 档案完善提醒 */}
            {!dismissedCompletion && (
              <CompletionPrompt onDismiss={() => setDismissedCompletion(true)} />
            )}

            {/* 画像收集引导（非侵入式） */}
            {!dismissedCollectionCard && (
              <ProfileCollectionCard onDismiss={() => setDismissedCollectionCard(true)} />
            )}

            {/* AI 目标迁移建议 */}
            {!dismissedGoalTransition && (
              <GoalTransitionCard onDismiss={() => setDismissedGoalTransition(true)} />
            )}

            {/* 快速记录入口：4入口操作栏 */}
            <QuickActionBar onFrequentClick={() => setFrequentSheetOpen(true)} />

            {/* 常吃食物底部Sheet */}
            <FrequentFoodSheet
              open={frequentSheetOpen}
              onClose={() => setFrequentSheetOpen(false)}
            />

            {/* V3: 主动提醒 */}
            {reminder && !dismissedReminder && (
              <section className="mb-6">
                <ProactiveReminderCard
                  reminder={reminder}
                  onDismiss={() => setDismissedReminder(true)}
                />
              </section>
            )}

            {/* 下一餐建议（精简版，详细计划跳转 /plan） */}
            {mealSuggestion && mealSuggestion.suggestion && (
              <NextMealHint suggestion={mealSuggestion} summary={summary} />
            )}

            {/* 今日记录 */}
            <MealList meals={meals} />
          </>
        )}
      </main>
    </div>
  );
}

/* ─── Sub-components ─── */

/** 精简版下一餐建议 — 只显示核心信息 + 跳转 /plan */
function NextMealHint({
  suggestion,
  summary,
}: {
  suggestion: MealSuggestion;
  summary: DailySummary;
}) {
  const label = MEAL_LABELS[suggestion.mealType] || '下一餐';

  return (
    <section className="mb-6">
      <div className="bg-card rounded-2xl p-4 border border-(--color-outline-variant)/10">
        <LocalizedLink href="/plan" className="block group">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <span className="text-primary">AI</span> {label}建议
            </h3>
            <span className="text-xs text-primary font-medium flex items-center gap-0.5 group-hover:gap-1 transition-all">
              查看完整计划
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          </div>
          <p className="text-sm text-foreground/80 line-clamp-2">{suggestion.suggestion.foods}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{suggestion.suggestion.calories} kcal</span>
            {suggestion.remainingCalories > 0 && (
              <span>剩余预算 {suggestion.remainingCalories} kcal</span>
            )}
          </div>
          {suggestion.suggestion.tip && (
            <p className="text-xs text-muted-foreground mt-1.5 italic">
              {suggestion.suggestion.tip}
            </p>
          )}
        </LocalizedLink>
        {/* 关联菜谱 */}
        <LocalizedLink
          href={`/recipes?q=${encodeURIComponent(suggestion.suggestion.foods.split('、')[0].split('，')[0].trim())}`}
          className="inline-flex items-center gap-1 mt-2 text-[11px] text-primary font-medium hover:opacity-80 transition-opacity"
        >
          🍳 查看相关菜谱
        </LocalizedLink>
      </div>
    </section>
  );
}

function MealList({ meals }: { meals: FoodRecord[] }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="text-lg font-headline font-bold">今日记录</h3>
        <LocalizedLink
          href="/history"
          className="text-xs text-primary font-medium flex items-center gap-0.5 hover:opacity-80"
        >
          全部历史
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </LocalizedLink>
      </div>
      <div className="space-y-3">
        {meals.map((meal) => (
          <MealRecordCard key={meal.id} meal={meal} />
        ))}
      </div>

      {meals.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">还没有今日记录</p>
          <p className="text-xs mt-1">拍照或输入文字描述开始记录吧</p>
        </div>
      )}
    </section>
  );
}
