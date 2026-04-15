'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useProfile } from '@/features/profile/hooks/use-profile';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { LocalizedLink } from '@/components/common/localized-link';
import { ProfileCompletionBar } from '@/features/profile/components/profile-completion-bar';
import { FeedbackStatsCard } from '@/features/profile/components/feedback-stats-card';
import { GOAL_LABELS_EMOJI } from '@/lib/constants/food';
import type { BehaviorProfile } from '@/types/user';

const activityLabelMap: Record<string, string> = {
  sedentary: '久坐不动',
  light: '轻度活动',
  moderate: '中度活动',
  active: '高强度',
};

function ChevronRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width="20"
      height="20"
      className="text-muted-foreground"
    >
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoggedIn, isAnonymous, logout } = useAuth();
  const { profile, behaviorProfile } = useProfile();
  const { tier, isFree, isPro, isPremium } = useSubscription();

  if (!isLoggedIn) {
    router.push('/login');
  }

  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/login');
  }, [logout, router]);

  const displayName = isAnonymous
    ? '体验用户'
    : user?.nickname || user?.phone || user?.email || 'uWay 用户';
  const initials = isAnonymous ? '?' : displayName.charAt(0).toUpperCase();

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
            {isAnonymous ? (
              <p className="text-sm text-primary-foreground/70">登录后可保留所有数据</p>
            ) : (
              <>
                {user?.phone && (
                  <p className="text-sm text-primary-foreground/70">
                    {user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
                  </p>
                )}
                {user?.email && !user?.phone && (
                  <p className="text-sm text-primary-foreground/70">{user.email}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 py-5 max-w-lg mx-auto pb-24 space-y-4">
        {/* 订阅状态卡片 */}
        <LocalizedLink
          href="/pricing"
          className="block bg-card rounded-2xl p-4 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isPremium ? 'bg-amber-100' : isPro ? 'bg-primary/10' : 'bg-muted'
                }`}
              >
                <span className="text-lg">{isPremium ? '👑' : isPro ? '⭐' : '🆓'}</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold">
                    {isPremium ? 'Premium 会员' : isPro ? 'Pro 会员' : '免费版'}
                  </p>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isPremium
                        ? 'bg-amber-100 text-amber-700'
                        : isPro
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {tier.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isFree ? '升级解锁更多 AI 功能' : '感谢你的支持！'}
                </p>
              </div>
            </div>
            {isFree && <span className="text-xs text-primary font-bold shrink-0">升级</span>}
            {!isFree && <ChevronRight />}
          </div>
        </LocalizedLink>

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
              <p className="text-base font-extrabold text-primary leading-5">
                {profile.goal ? GOAL_LABELS_EMOJI[profile.goal] : '--'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">目标</p>
            </div>
            <div className="text-center border-l border-border/40">
              <p className="text-base font-extrabold text-primary leading-5">
                {profile.activityLevel ? activityLabelMap[profile.activityLevel] : '--'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">活动</p>
            </div>
          </div>
        )}

        {/* 画像完成度进度条 */}
        <ProfileCompletionBar />

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
              <p className="text-xl font-extrabold text-primary">
                {Math.round(Number(behaviorProfile.avgComplianceRate) * 100)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">健康率</p>
            </div>
          </div>
        )}

        {/* AI 行为洞察 */}
        <BehaviorInsightCard behaviorProfile={behaviorProfile} />

        {/* 反馈统计 */}
        <FeedbackStatsCard />

        {/* 菜单列表 */}
        <div className="bg-card rounded-2xl overflow-hidden divide-y divide-border/40">
          <LocalizedLink
            href="/profile/edit"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">📋</span>
              <div>
                <p className="text-sm font-bold">健康档案</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {profile?.onboardingCompleted
                    ? '身高 / 体重 / 目标 / 饮食习惯'
                    : '未完善，点击填写'}
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

          <LocalizedLink
            href="/profile/preferences"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">⚙️</span>
              <div>
                <p className="text-sm font-bold">偏好设置</p>
                <p className="text-xs text-muted-foreground mt-0.5">推荐偏好 / 厨房装备 / 生活方式</p>
              </div>
            </div>
            <ChevronRight />
          </LocalizedLink>

          <LocalizedLink
            href="/challenge"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🏆</span>
              <div>
                <p className="text-sm font-bold">挑战任务</p>
                <p className="text-xs text-muted-foreground mt-0.5">完成挑战赢取成就徽章</p>
              </div>
            </div>
            <ChevronRight />
          </LocalizedLink>

          <LocalizedLink
            href="/recipes"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🍳</span>
              <div>
                <p className="text-sm font-bold">菜谱库</p>
                <p className="text-xs text-muted-foreground mt-0.5">浏览和搜索健康菜谱</p>
              </div>
            </div>
            <ChevronRight />
          </LocalizedLink>

          <LocalizedLink
            href="/chat"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">💬</span>
              <div>
                <p className="text-sm font-bold">AI 对话</p>
                <p className="text-xs text-muted-foreground mt-0.5">自由问答，深度探索饮食知识</p>
              </div>
            </div>
            <ChevronRight />
          </LocalizedLink>

          <LocalizedLink
            href="/notifications"
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🔔</span>
              <div>
                <p className="text-sm font-bold">消息通知</p>
                <p className="text-xs text-muted-foreground mt-0.5">用餐提醒、周报、系统消息</p>
              </div>
            </div>
            <ChevronRight />
          </LocalizedLink>
        </div>

        {/* 法律信息 */}
        <div className="bg-card rounded-2xl overflow-hidden divide-y divide-border/40">
          <LocalizedLink
            href="/terms"
            className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
          >
            <span className="text-xs text-muted-foreground">服务条款</span>
            <ChevronRight />
          </LocalizedLink>
          <LocalizedLink
            href="/privacy"
            className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
          >
            <span className="text-xs text-muted-foreground">隐私政策</span>
            <ChevronRight />
          </LocalizedLink>
        </div>

        {/* 匿名用户升级 / 正式用户退出 */}
        {isAnonymous ? (
          <LocalizedLink
            href="/login"
            className="block w-full bg-primary text-primary-foreground font-bold py-4 rounded-2xl text-center active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
          >
            登录 / 注册，保留所有数据
          </LocalizedLink>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full bg-muted text-destructive font-bold py-4 rounded-2xl active:scale-[0.98] transition-all"
          >
            退出登录
          </button>
        )}
      </main>
    </div>
  );
}

/* ─── AI 行为洞察卡片 ─── */

const COACH_STYLE_LABELS: Record<string, string> = {
  strict: '严格型教练',
  supportive: '鼓励型教练',
  analytical: '分析型教练',
  balanced: '平衡型教练',
};

function formatHour(h: number): string {
  if (h < 12) return `上午${h}点`;
  if (h === 12) return '中午12点';
  return `下午${h - 12}点`;
}

function BehaviorInsightCard({
  behaviorProfile,
}: {
  behaviorProfile: BehaviorProfile | undefined;
}) {
  if (!behaviorProfile) return null;

  const { foodPreferences, bingeRiskHours, failureTriggers, coachStyle } = behaviorProfile;

  // 至少有一项洞察数据才展示
  const hasPreferences =
    (foodPreferences?.loves && foodPreferences.loves.length > 0) ||
    (foodPreferences?.avoids && foodPreferences.avoids.length > 0) ||
    (foodPreferences?.frequentFoods && foodPreferences.frequentFoods.length > 0);
  const hasRiskHours = bingeRiskHours && bingeRiskHours.length > 0;
  const hasTriggers = failureTriggers && failureTriggers.length > 0;
  const hasCoachStyle = !!coachStyle;

  if (!hasPreferences && !hasRiskHours && !hasTriggers && !hasCoachStyle) return null;

  return (
    <div className="bg-card rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🧠</span>
        <h3 className="text-sm font-bold">AI 对你的了解</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">基于行为数据分析</span>
      </div>

      {/* 食物偏好 */}
      {hasPreferences && (
        <div className="space-y-2">
          {foodPreferences.loves && foodPreferences.loves.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">你偏爱的食物</p>
              <div className="flex flex-wrap gap-1.5">
                {foodPreferences.loves.map((food) => (
                  <span
                    key={food}
                    className="px-2 py-0.5 rounded-lg bg-green-50 text-green-700 text-[11px] font-medium border border-green-200"
                  >
                    {food}
                  </span>
                ))}
              </div>
            </div>
          )}
          {foodPreferences.avoids && foodPreferences.avoids.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">你回避的食物</p>
              <div className="flex flex-wrap gap-1.5">
                {foodPreferences.avoids.map((food) => (
                  <span
                    key={food}
                    className="px-2 py-0.5 rounded-lg bg-red-50 text-red-600 text-[11px] font-medium border border-red-200"
                  >
                    {food}
                  </span>
                ))}
              </div>
            </div>
          )}
          {foodPreferences.frequentFoods && foodPreferences.frequentFoods.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">你的常吃清单</p>
              <div className="flex flex-wrap gap-1.5">
                {foodPreferences.frequentFoods.map((food) => (
                  <span
                    key={food}
                    className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 text-[11px] font-medium border border-blue-200"
                  >
                    {food}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 高风险时段 */}
      {hasRiskHours && (
        <div>
          <p className="text-[11px] font-bold text-muted-foreground mb-1">暴食高风险时段</p>
          <div className="flex flex-wrap gap-1.5">
            {bingeRiskHours.map((h) => (
              <span
                key={h}
                className="px-2 py-0.5 rounded-lg bg-orange-50 text-orange-600 text-[11px] font-medium border border-orange-200"
              >
                {formatHour(h)}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            这些时段 AI 会加强提醒，帮你度过难关
          </p>
        </div>
      )}

      {/* 失控触发因素 */}
      {hasTriggers && (
        <div>
          <p className="text-[11px] font-bold text-muted-foreground mb-1">容易失控的情况</p>
          <div className="flex flex-wrap gap-1.5">
            {failureTriggers.map((trigger) => (
              <span
                key={trigger}
                className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 text-[11px] font-medium border border-amber-200"
              >
                {trigger}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI 教练风格 */}
      {hasCoachStyle && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/30">
          <span className="text-sm">🤖</span>
          <p className="text-xs text-muted-foreground">
            AI 当前以{' '}
            <span className="font-bold text-foreground">
              {COACH_STYLE_LABELS[coachStyle] || coachStyle}
            </span>{' '}
            与你互动
          </p>
        </div>
      )}
    </div>
  );
}
