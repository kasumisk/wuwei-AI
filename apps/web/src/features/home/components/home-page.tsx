'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useHomeData } from '@/features/home/hooks/use-home-data';
import { useDismissStore } from '@/store';
import { LocalizedLink } from '@/components/common/localized-link';
import { useUnreadCount } from '@/features/notification/hooks/use-notifications';
import Image from 'next/image';

/* ── new Phase-2 components ── */
import { HeroBudgetCard } from './hero-budget-card';
import { NutritionScoreCompact } from './nutrition-score-compact';
import { WeeklyTrendMini } from './weekly-trend-mini';
import { SmartPromptSlot } from './smart-prompt-slot';
import { NextMealCard } from './next-meal-card';
import { TodayMealList } from './today-meal-list';
import { QuickActionBar } from './quick-action-bar';
import { FrequentFoodPicker } from './frequent-food-picker';
import { useState } from 'react';

/* ─── SVG Icons ─── */
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

  const dismissedReminder = useDismissStore((s) => s.dismissedReminder);
  const setDismissedReminder = useDismissStore((s) => s.setDismissedReminder);
  const dismissedCompletion = useDismissStore((s) => s.dismissedCompletion);
  const setDismissedCompletion = useDismissStore((s) => s.setDismissedCompletion);
  const dismissedGoalTransition = useDismissStore((s) => s.dismissedGoalTransition);
  const setDismissedGoalTransition = useDismissStore((s) => s.setDismissedGoalTransition);
  const dismissedCollectionCard = useDismissStore((s) => s.dismissedCollectionCard);
  const setDismissedCollectionCard = useDismissStore((s) => s.setDismissedCollectionCard);

  const [frequentOpen, setFrequentOpen] = useState(false);
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
        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-4 animate-pulse">
            <div className="bg-card rounded-2xl p-5 space-y-3">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-10 w-36 bg-muted rounded" />
              <div className="h-2 w-full bg-muted rounded-full" />
              <div className="space-y-2 pt-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-3 bg-muted rounded" />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="h-24 bg-muted rounded-2xl" />
              <div className="h-24 bg-muted rounded-2xl" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card rounded-xl p-4 h-16 bg-muted" />
              ))}
            </div>
          </div>
        )}

        {/* Main content */}
        {!isLoading && (
          <>
            {/* 1. Hero: calorie budget + macro progress */}
            <HeroBudgetCard summary={summary} profile={profile} scoreData={nutritionScore} />

            {/* 2. Compact nutrition score */}
            <NutritionScoreCompact scoreData={nutritionScore} />

            {/* 3. Mini weekly trend */}
            <WeeklyTrendMini summaries={recentSummaries} />

            {/* 4. Single smart prompt (reminder > completion > goalTransition > collection) */}
            <SmartPromptSlot
              reminder={reminder}
              showReminder={!dismissedReminder}
              onDismissReminder={() => setDismissedReminder(true)}
              showCompletion={!dismissedCompletion}
              onDismissCompletion={() => setDismissedCompletion(true)}
              showGoalTransition={!dismissedGoalTransition}
              onDismissGoalTransition={() => setDismissedGoalTransition(true)}
              showCollectionCard={!dismissedCollectionCard}
              onDismissCollectionCard={() => setDismissedCollectionCard(true)}
            />

            {/* 5. Quick record bar */}
            <QuickActionBar onFrequentClick={() => setFrequentOpen(true)} />

            {/* 6. Frequent food picker sheet */}
            <FrequentFoodPicker open={frequentOpen} onClose={() => setFrequentOpen(false)} />

            {/* 7. Next meal card (compact, no tab) */}
            {mealSuggestion?.suggestion && (
              <NextMealCard
                suggestion={mealSuggestion}
                summary={summary}
                profile={profile ?? null}
              />
            )}

            {/* 8. Today meal list */}
            <TodayMealList meals={meals} defaultVisible={3} />
          </>
        )}
      </main>
    </div>
  );
}
