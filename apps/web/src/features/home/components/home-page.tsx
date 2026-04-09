'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useHomeData } from '@/features/home/hooks/use-home-data';
import { LocalizedLink } from '@/components/common/localized-link';
import { ProactiveReminderCard } from './proactive-reminder';
import { TodayStatus } from './today-status';
import { CompletionPrompt } from '@/features/profile/components/completion-prompt';
import Image from 'next/image';
import type { FoodRecord } from '@/types/food';

/* ─── SVG Icon Components ─── */
function IconSmartToy({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z" />
    </svg>
  );
}

function IconScreenshot({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M11 2v4H2v14h20V6h-9V2h-2zm0 6V6h2v2h7v12H4V8h7zm-4 2h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z" />
    </svg>
  );
}

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

function IconGrid({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z" />
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

const MEAL_LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export function HomePage() {
  const { user, isLoggedIn } = useAuth();
  const router = useRouter();
  const {
    summary,
    records: meals,
    suggestion: mealSuggestion,
    dailyPlan,
    reminder,
    profile,
  } = useHomeData();
  const [activeScenario, setActiveScenario] = useState(0);
  const [dismissedReminder, setDismissedReminder] = useState(false);
  const [dismissedCompletion, setDismissedCompletion] = useState(false);

  // 安全网：登录且未完成引导时跳转分步引导
  // useHomeData 中已 fetch profile, 这里只做跳转检查
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
          <button className="w-10 h-10 flex items-center justify-center rounded-full hover:opacity-80 transition-opacity active:scale-95 duration-200 text-primary">
            <IconSettings className="w-6 h-6" />
          </button>
        </div>
      </nav>

      <main className="pt-24 pb-32 px-6 max-w-lg mx-auto">
        {/* 今日状态 */}
        <TodayStatus summary={summary} profile={profile} />

        {/* 档案完善提醒 */}
        {!dismissedCompletion && (
          <CompletionPrompt onDismiss={() => setDismissedCompletion(true)} />
        )}

        {/* 核心入口：双按钮 */}
        <section className="grid grid-cols-2 gap-4 mb-6">
          <LocalizedLink
            href="/analyze"
            className="bg-primary text-primary-foreground rounded-2xl p-5 flex flex-col items-center gap-3 active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
          >
            <IconCamera className="w-8 h-8" />
            <span className="font-bold text-sm">📷 拍照识别</span>
          </LocalizedLink>
          <LocalizedLink
            href="/foods"
            className="bg-card border border-(--color-outline-variant)/20 rounded-2xl p-5 flex flex-col items-center gap-3 active:scale-[0.97] transition-all shadow-sm"
          >
            <IconSearch className="w-8 h-8 text-primary" />
            <span className="font-bold text-sm">✍️ 手动搜索</span>
          </LocalizedLink>
        </section>

        {/* V3: 主动提醒 */}
        {reminder && !dismissedReminder && (
          <section className="mb-6">
            <ProactiveReminderCard
              reminder={reminder}
              onDismiss={() => setDismissedReminder(true)}
            />
          </section>
        )}

        {/* V2: 每日计划 */}
        {dailyPlan && (
          <section className="mb-6">
            <div className="bg-surface-container-low rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📅</span>
                <h3 className="font-bold text-sm">今日饮食计划</h3>
              </div>
              {dailyPlan.strategy && (
                <p className="text-xs text-muted-foreground mb-3">💡 {dailyPlan.strategy}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: '早餐', plan: dailyPlan.morningPlan, emoji: '🌅' },
                  { label: '午餐', plan: dailyPlan.lunchPlan, emoji: '☀️' },
                  { label: '晚餐', plan: dailyPlan.dinnerPlan, emoji: '🌙' },
                  { label: '加餐', plan: dailyPlan.snackPlan, emoji: '🍪' },
                ].map(
                  ({ label, plan, emoji }) =>
                    plan && (
                      <div key={label} className="bg-card rounded-xl p-3">
                        <span className="text-xs font-bold text-muted-foreground">
                          {emoji} {label}
                        </span>
                        <p className="text-xs mt-1 line-clamp-2">{plan.foods}</p>
                        <span className="text-[10px] text-primary font-bold">
                          {plan.calories} kcal
                        </span>
                        {plan.tip && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                            💡 {plan.tip}
                          </p>
                        )}
                      </div>
                    )
                )}
              </div>
            </div>
          </section>
        )}

        {/* 今日建议 */}
        {mealSuggestion && mealSuggestion.suggestion && (
          <section className="mb-6">
            <div className="bg-surface-container-low rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🍽️</span>
                <h3 className="font-bold text-sm">
                  {MEAL_LABELS[mealSuggestion.mealType] || '下一餐'}推荐
                </h3>
              </div>
              {mealSuggestion.scenarios && mealSuggestion.scenarios.length > 0 ? (
                <>
                  <div className="flex gap-2 mb-3">
                    {mealSuggestion.scenarios.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveScenario(i)}
                        className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all ${
                          activeScenario === i
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {s.scenario}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const s = mealSuggestion.scenarios![activeScenario];
                    return s ? (
                      <>
                        <p className="text-base font-medium">{s.foods}</p>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-sm text-primary font-bold">
                            ≈ {s.calories} kcal
                          </span>
                          <span className="text-xs text-muted-foreground">💡 {s.tip}</span>
                        </div>
                      </>
                    ) : null;
                  })()}
                </>
              ) : (
                <>
                  <p className="text-base font-medium">{mealSuggestion.suggestion.foods}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-primary font-bold">
                      ≈ {mealSuggestion.suggestion.calories} kcal
                    </span>
                    <span className="text-xs text-muted-foreground">
                      💡 {mealSuggestion.suggestion.tip}
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* 今日记录 */}
        <MealList meals={meals} />
      </main>

      {/* Bottom Navigation */}
      <BottomNav isLoggedIn={isLoggedIn} />
    </div>
  );
}

/* ─── Sub-components ─── */

function MealList({ meals }: { meals: FoodRecord[] }) {
  return (
    <section className="mb-8">
      <h3 className="text-lg font-headline font-bold mb-4 px-1">📋 今日记录</h3>
      <div className="space-y-3">
        {meals.map((meal) => {
          const mealLabel = MEAL_LABELS[meal.mealType] || meal.mealType;
          const foodNames = meal.foods.map((f) => f.name).join('、');
          const decisionBadge =
            meal.decision && meal.decision !== 'SAFE' ? (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  meal.decision === 'OK'
                    ? 'bg-yellow-100 text-yellow-800'
                    : meal.decision === 'LIMIT'
                      ? 'bg-orange-100 text-orange-800'
                      : meal.decision === 'AVOID'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-green-100 text-green-800'
                }`}
              >
                {meal.decision === 'OK'
                  ? '注意'
                  : meal.decision === 'LIMIT'
                    ? '少吃'
                    : meal.decision === 'AVOID'
                      ? '不建议'
                      : '健康'}
              </span>
            ) : meal.isHealthy !== undefined ? (
              <span
                className={`${meal.isHealthy ? 'bg-secondary text-secondary-foreground' : 'bg-tertiary-container text-on-tertiary-container'} px-2 py-0.5 rounded-md text-[10px] font-bold`}
              >
                {meal.isHealthy ? '健康' : '注意'}
              </span>
            ) : null;

          return (
            <div
              key={meal.id}
              className="flex items-center gap-4 bg-card p-4 rounded-2xl shadow-sm"
            >
              {meal.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="w-14 h-14 rounded-full object-cover"
                  src={meal.imageUrl}
                  alt={foodNames}
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                  <IconCamera className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm truncate">{foodNames || '饮食记录'}</h4>
                <p className="text-xs text-muted-foreground">
                  {mealLabel} • {meal.totalCalories} kcal
                </p>
              </div>
              {decisionBadge}
            </div>
          );
        })}
      </div>

      {meals.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">还没有今日记录</p>
          <p className="text-xs mt-1">拍照或搜索食物开始记录吧</p>
        </div>
      )}
    </section>
  );
}

function BottomNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-2 glass-morphism z-50 rounded-t-4xl shadow-[0_-4px_40px_rgba(11,54,29,0.06)]">
      <div className="flex flex-col items-center justify-center bg-(--color-surface-container-highest) dark:bg-primary text-foreground dark:text-primary-foreground rounded-full p-3 transition-all active:scale-90 duration-300">
        <IconGrid className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">首页</span>
      </div>
      <LocalizedLink
        href="/analyze"
        className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300"
      >
        <IconScreenshot className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">分析</span>
      </LocalizedLink>
      <LocalizedLink
        href="/coach"
        className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300"
      >
        <IconSmartToy className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">AI教练</span>
      </LocalizedLink>
      <LocalizedLink
        href={isLoggedIn ? '/profile' : '/login'}
        className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300"
      >
        <IconPerson className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">我的</span>
      </LocalizedLink>
    </nav>
  );
}
