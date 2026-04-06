'use client';

import { useAuth } from '@/lib/hooks/use-auth';
import { LocalizedLink } from '@/components/common/localized-link';
import Image from 'next/image';

/* ─── Mock Data (TODO: fetch from API) ─── */
const mockCalories = { consumed: 860, goal: 2100 };
const mockMacros = { protein: 84, proteinGoal: 140, carbs: 120, fats: 45 };
const mockStreak = { current: 12, total: 30, bars: [40, 60, 55, 85, 90, 10, 10] };
const mockMeals = [
  {
    id: '1',
    name: '绿色女神沙拉碗',
    mealType: '早餐',
    calories: 420,
    tag: '健康',
    tagColor: 'bg-secondary text-secondary-foreground',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDrESAAwyTCSEr0iwKisM9RpPRNieUdFQSXAP2kCr9_eT5jCKRdSvS5OfLDSmsOD7GNolBe7tgwFg0K7fMR_sJSB5rb1v27Jz19x7_nraWQt_pN4UqBgHeuMl3GtgSe_Yx-fVZs7zRhzNyJIvIenGjgwSVa2Q43ZmEu8Ok9Fs1hwH22jc_Zd1oeskdwf4s36tWdMO3t0IabKLD5kc3kLOP9n0skhQLc8JMwr2KrDsTF8uR7G207EAr4RbazO6okH-_d19f65TS1iPA',
  },
  {
    id: '2',
    name: '墨西哥辣味塔可 (2x)',
    mealType: '午餐',
    calories: 580,
    tag: '超标',
    tagColor: 'bg-tertiary-container text-on-tertiary-container',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCM0xEwzvBMSn8jl3oH4I2n7xqK0mdhf07Vip7TMHEoqprf2Qo4hUHKFfrDkzODDtmeo7c6ACoeOFYxVPSV1YNC4kYuGd2kQ9PHIZr71DEw2N6sTFngBCeTw5t1Q27bER3wdVeTya9vRmjI7GhS99v-WymrZx-DhKu_GpHdy7ennnwialvBPNnGXaVUEofeNCKH4bSEZph3caDAu82RFS2xJZiBu6RzmfQ1y4PRM7TPfgviMfIBI5iIr0QCaQLGp68TJeekf8Wnfkk',
  },
];

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

function IconTrophy({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  );
}

function IconFitness({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z" />
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

export function HomePage() {
  const { user, isLoggedIn } = useAuth();

  const remaining = mockCalories.goal - mockCalories.consumed;
  const caloriePercent = Math.round(
    (mockCalories.consumed / mockCalories.goal) * 100,
  );

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
        {/* AI Coaching Insight Hero */}
        <section className="mb-8">
          <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-primary to-primary-dim p-6 text-primary-foreground shadow-lg">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <IconSmartToy className="w-5 h-5 text-(--color-primary-container)" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-(--color-primary-container) font-sans">
                  AI 健康教练
                </span>
              </div>
              <p className="text-xl font-headline font-bold leading-tight mb-4">
                你本周的外卖点单比上周二健康了
                15%！今天午餐试试高蛋白选择吧。
              </p>
              <button className="bg-card text-primary font-bold px-5 py-2.5 rounded-full text-sm active:scale-95 transition-transform">
                查看个性化建议
              </button>
            </div>
            <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-(--color-primary-container) opacity-20 rounded-full blur-3xl" />
          </div>
        </section>

        {/* Primary CTA: Scan Takeout */}
        <section className="mb-8">
          <div className="bg-card rounded-2xl p-6 flex flex-col items-center text-center gap-4 shadow-sm border border-(--color-outline-variant)/10">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
              <IconScreenshot className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-headline font-bold">新的外卖订单？</h2>
              <p className="text-muted-foreground text-sm">
                扫描或上传你的外卖截图，即刻获取热量分析。
              </p>
            </div>
            <button className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20">
              <IconCamera className="w-5 h-5" />
              拍照或上传截图
            </button>
          </div>
        </section>

        {/* Bento Grid: Stats & Macros */}
        <section className="grid grid-cols-2 gap-4 mb-8">
          {/* Calorie Card */}
          <div className="col-span-2 bg-card rounded-2xl p-6 shadow-sm flex flex-col justify-between overflow-hidden relative">
            <div className="z-10">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                剩余卡路里
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-5xl font-headline font-extrabold text-primary tracking-tighter">
                  {remaining.toLocaleString()}
                </span>
                <span className="text-muted-foreground font-medium">
                  / {mockCalories.goal.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="mt-6 h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${caloriePercent}%` }}
              />
            </div>
          </div>

          {/* Protein Card */}
          <div className="bg-surface-container-high rounded-2xl p-5 flex flex-col gap-2">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                蛋白质
              </span>
              <IconFitness className="w-4 h-4 text-primary" />
            </div>
            <div className="mt-auto">
              <span className="text-2xl font-headline font-bold">
                {mockMacros.protein}g
              </span>
              <p className="text-xs text-muted-foreground">
                目标: {mockMacros.proteinGoal}g
              </p>
            </div>
          </div>

          {/* Carbs & Fats Card */}
          <div className="bg-muted rounded-2xl p-5 flex flex-col gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                碳水 / 脂肪
              </span>
              <div className="flex gap-4 mt-2">
                <div>
                  <span className="text-xl font-headline font-bold">
                    {mockMacros.carbs}g
                  </span>
                  <div className="h-1 w-8 bg-tertiary-container rounded-full mt-1" />
                </div>
                <div>
                  <span className="text-xl font-headline font-bold">
                    {mockMacros.fats}g
                  </span>
                  <div className="h-1 w-8 bg-secondary-dim rounded-full mt-1" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 30-Day Challenge Status */}
        <section className="mb-8">
          <div className="bg-surface-container-low rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-headline font-bold">瘦身打卡</h3>
                <p className="text-sm text-muted-foreground">
                  第 {mockStreak.current} 天 / 共 {mockStreak.total} 天
                </p>
              </div>
              <div className="bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-full flex items-center gap-1">
                <IconTrophy className="w-4 h-4" />
                <span className="text-[10px] font-bold">金牌水平</span>
              </div>
            </div>
            <div className="flex justify-between items-end gap-1 h-20">
              {mockStreak.bars.map((height, i) => (
                <div
                  key={i}
                  className={`w-full rounded-t-md ${height > 15 ? 'bg-primary' : 'bg-muted'}`}
                  style={{
                    height: `${height}%`,
                    opacity: height > 15 ? 0.4 + i * 0.12 : 1,
                  }}
                />
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground text-center italic">
              &ldquo;你本周的坚持度超过了 85% 的用户！&rdquo;
            </p>
          </div>
        </section>

        {/* Meal Log List */}
        <section className="mb-8">
          <h3 className="text-lg font-headline font-bold mb-4 px-1">今日记录</h3>
          <div className="space-y-4">
            {mockMeals.map((meal) => (
              <div
                key={meal.id}
                className="flex items-center gap-4 bg-card p-4 rounded-2xl shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="w-14 h-14 rounded-full object-cover"
                  src={meal.image}
                  alt={meal.name}
                />
                <div className="flex-1">
                  <h4 className="font-bold text-sm">{meal.name}</h4>
                  <p className="text-xs text-muted-foreground">
                    {meal.mealType} • {meal.calories} kcal
                  </p>
                </div>
                <span
                  className={`${meal.tagColor} px-2 py-1 rounded-md text-[10px] font-bold`}
                >
                  {meal.tag}
                </span>
              </div>
            ))}
          </div>

          {mockMeals.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">还没有今日记录</p>
              <p className="text-xs mt-1">上传外卖截图开始记录吧</p>
            </div>
          )}
        </section>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-6 pt-2 glass-morphism z-50 rounded-t-4xl shadow-[0_-4px_40px_rgba(11,54,29,0.06)]">
        {/* Dashboard (Active) */}
        <div className="flex flex-col items-center justify-center bg-(--color-surface-container-highest) dark:bg-primary text-foreground dark:text-primary-foreground rounded-full p-3 transition-all active:scale-90 duration-300">
          <IconGrid className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">
            首页
          </span>
        </div>
        {/* Analyzer */}
        <button className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300">
          <IconScreenshot className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">
            分析
          </span>
        </button>
        {/* AI Coach */}
        <button className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300">
          <IconSmartToy className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">
            AI教练
          </span>
        </button>
        {/* Challenge */}
        <button className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300">
          <IconTrophy className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">
            挑战
          </span>
        </button>
        {/* Profile */}
        <LocalizedLink
          href={isLoggedIn ? '/profile' : '/login'}
          className="flex flex-col items-center justify-center text-foreground/60 p-3 hover:text-primary transition-all active:scale-90 duration-300"
        >
          <IconPerson className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] mt-1">
            我的
          </span>
        </LocalizedLink>
      </nav>
    </div>
  );
}
