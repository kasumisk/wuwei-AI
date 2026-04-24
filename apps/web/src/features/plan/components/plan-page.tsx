'use client';

import { useQuery } from '@tanstack/react-query';
import { usePlanData } from '@/features/plan/hooks/use-plan-data';
import { DailyPlanCard } from '@/features/home/components/daily-plan-card';
import { WeeklyPlanCard } from './weekly-plan-card';
import { WhyNotCard } from './why-not-card';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { foodRecordService } from '@/lib/api/food-record';
import { profileService } from '@/lib/api/profile';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { LocalizedLink } from '@/components/common/localized-link';
import { useToast } from '@/lib/hooks/use-toast';
import { BottomNav } from '@/components/common/bottom-nav';
import { NextMealCard } from '@/features/home/components/next-meal-card';

export function PlanPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const { isFree, isPaid } = useSubscription();
  const {
    dailyPlan,
    weeklyPlan,
    suggestion,
    isLoading,
    dailyLoading,
    weeklyLoading,
    regeneratePlan,
    isRegenerating,
    explainWhyNot,
    isExplaining,
    explainResult,
  } = usePlanData();

  // 只取 MealRecommendationCard 需要的 summary 和 profile（不拉取全部首页数据）
  const { data: summary } = useQuery({
    queryKey: ['summary', 'today'],
    queryFn: () => foodRecordService.getTodaySummary(),
    staleTime: 60 * 1000,
  });
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.getProfile(),
    staleTime: 5 * 60 * 1000,
  });

  const summaryFallback = summary ?? {
    totalCalories: 0,
    calorieGoal: 2000,
    mealCount: 0,
    remaining: 2000,
  };

  // 未登录
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 pb-24">
        <div className="text-center space-y-4">
          <span className="text-5xl">🍽️</span>
          <h2 className="text-xl font-bold">个性化饮食推荐</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            登录后，AI 会根据你的目标和偏好，每天生成专属饮食计划
          </p>
          <LocalizedLink
            href="/login"
            className="inline-block px-8 py-3  bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/20"
          >
            登录开始
          </LocalizedLink>
        </div>
      </div>
    );
  }

  // 加载中
  if (isLoading && !dailyPlan && !weeklyPlan) {
    return (
      <div className="min-h-screen bg-background pt-6 pb-24 px-4 max-w-lg mx-auto">
        <h2 className="text-xl font-extrabold font-headline mb-6">饮食推荐</h2>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface-container-low rounded-md p-5 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/3 mb-3" />
              <div className="h-3 bg-muted rounded w-full mb-2" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const handleRegenerate = async () => {
    try {
      await regeneratePlan(undefined);
      toast({ title: '计划已重新生成' });
    } catch {
      toast({ title: '重新生成失败，请稍后再试', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-background pt-6 pb-24 px-4 max-w-lg mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-extrabold font-headline">饮食推荐</h2>
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="px-3 py-1.5  text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 active:scale-[0.97] transition-all disabled:opacity-50"
        >
          {isRegenerating ? '生成中...' : '🔄 重新生成'}
        </button>
      </div>

      {/* 下一餐推荐 */}
      {suggestion && suggestion.suggestion && (
        <NextMealCard
          suggestion={suggestion}
          summary={summaryFallback}
          profile={profile ?? null}
        />
      )}

      {/* 今日计划 */}
      {dailyPlan && <DailyPlanCard dailyPlan={dailyPlan} />}

      {/* 今日计划加载中 */}
      {dailyLoading && !dailyPlan && (
        <div className="bg-surface-container-low rounded-md p-5 mb-6 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-3" />
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card rounded-md p-3 h-20" />
            ))}
          </div>
        </div>
      )}

      {/* 周计划（付费用户显示，免费用户显示升级提示） */}
      {weeklyPlan && <WeeklyPlanCard weeklyPlan={weeklyPlan} />}

      {/* 免费用户：周计划锁定提示（显示真实数据 + 模糊遮罩） */}
      {isFree && (
        <div className="bg-card rounded-md p-5 mb-6 relative overflow-hidden">
          {/* 真实数据占位（有数据用真实的，没有用骨架） */}
          <div className="blur-sm pointer-events-none opacity-50 space-y-3">
            <h3 className="text-base font-bold">本周计划</h3>
            {weeklyPlan ? (
              <>
                <div className="flex gap-1">
                  {weeklyPlan.plans.slice(0, 7).map((day, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-muted  h-14 flex flex-col items-center justify-center text-[10px] text-muted-foreground gap-0.5"
                    >
                      <span>
                        {
                          ['一', '二', '三', '四', '五', '六', '日'][
                            new Date(day.date).getDay() === 0 ? 6 : new Date(day.date).getDay() - 1
                          ]
                        }
                      </span>
                      <span className="font-bold text-foreground/70">{day.totalCalories}</span>
                    </div>
                  ))}
                </div>
                {weeklyPlan.weeklyNutrition && (
                  <div className="h-10 bg-muted  flex items-center px-3 gap-4">
                    <span className="text-xs text-muted-foreground">
                      周均 {Math.round(weeklyPlan.weeklyNutrition.avgCalories)} kcal
                    </span>
                    <span className="text-xs text-muted-foreground">
                      蛋白 {Math.round(weeklyPlan.weeklyNutrition.avgProtein)}g
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex gap-1">
                  {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
                    <div
                      key={d}
                      className="flex-1 bg-muted  h-14 flex items-center justify-center text-xs text-muted-foreground"
                    >
                      周{d}
                    </div>
                  ))}
                </div>
                <div className="h-16 bg-muted " />
              </>
            )}
          </div>
          {/* 锁定覆盖 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 backdrop-blur-[2px]">
            <div className="w-12 h-12  bg-primary/10 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-sm font-bold mb-1">周计划为 Premium 专属</p>
            <p className="text-xs text-muted-foreground mb-3">升级后可查看完整一周饮食规划</p>
            <LocalizedLink
              href="/pricing"
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold  active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
            >
              查看方案
            </LocalizedLink>
          </div>
        </div>
      )}

      {/* 周计划加载中 */}
      {weeklyLoading && !weeklyPlan && (
        <div className="bg-surface-container-low rounded-md p-5 mb-6 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/4 mb-4" />
          <div className="flex gap-1 mb-4">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="w-11 h-16 bg-muted " />
            ))}
          </div>
        </div>
      )}

      {/* "为什么不推荐" */}
      <WhyNotCard onExplain={explainWhyNot} isExplaining={isExplaining} result={explainResult} />
      <BottomNav />
    </div>
  );
}
