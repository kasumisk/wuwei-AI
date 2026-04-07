'use client';

import { useState, useEffect } from 'react';
import { useFood } from '@/lib/hooks/use-food';
import { AchievementBadge } from '@/components/achievement-badge';
import type { Achievement, UserAchievement, ChallengeItem, UserChallengeItem, StreakStatus } from '@/lib/api/food';

export default function ChallengePage() {
  const { getAchievements, getChallenges, joinChallenge, getStreak } = useFood();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [unlocked, setUnlocked] = useState<UserAchievement[]>([]);
  const [challenges, setChallenges] = useState<ChallengeItem[]>([]);
  const [activeChallenges, setActiveChallenges] = useState<UserChallengeItem[]>([]);
  const [streak, setStreak] = useState<StreakStatus>({ current: 0, longest: 0, todayStatus: 'on_track' });
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    getAchievements().then(({ all, unlocked: u }) => { setAchievements(all); setUnlocked(u); }).catch(() => {});
    getChallenges().then(({ available, active }) => { setChallenges(available); setActiveChallenges(active); }).catch(() => {});
    getStreak().then(setStreak).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoin = async (challengeId: string) => {
    setJoining(challengeId);
    try {
      const uc = await joinChallenge(challengeId);
      setActiveChallenges((prev) => [...prev, uc]);
    } catch {
      // ignore
    } finally {
      setJoining(null);
    }
  };

  const activeIds = new Set(activeChallenges.map((c) => c.challengeId));
  const unlockedMap = new Map(unlocked.map((u) => [u.achievementId, u]));

  const STREAK_STATUS_LABELS: Record<string, { label: string; color: string }> = {
    on_track: { label: '进度正常', color: 'text-green-600' },
    at_risk: { label: '接近超标', color: 'text-orange-600' },
    exceeded: { label: '已超标', color: 'text-red-600' },
  };

  const statusInfo = STREAK_STATUS_LABELS[streak.todayStatus] || STREAK_STATUS_LABELS.on_track;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="sticky top-0 z-40 glass-morphism px-6 py-4">
        <h1 className="text-xl font-extrabold font-headline">🏆 挑战与成就</h1>
      </header>

      <main className="px-6 max-w-lg mx-auto mt-4 space-y-6">
        {/* 连胜状态 */}
        <section className="bg-card rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">🔥 连胜</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-headline font-extrabold text-primary">{streak.current}</span>
                <span className="text-muted-foreground text-sm">天</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">最长记录 {streak.longest} 天</p>
              <p className={`text-xs font-bold mt-1 ${statusInfo.color}`}>{statusInfo.label}</p>
            </div>
          </div>
        </section>

        {/* 成就 */}
        <section>
          <h2 className="text-lg font-headline font-bold mb-3 px-1">🏅 成就</h2>
          <div className="grid grid-cols-4 gap-3">
            {achievements.map((a) => (
              <AchievementBadge key={a.id} achievement={a} unlocked={unlockedMap.get(a.id)} />
            ))}
          </div>
          {achievements.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
          )}
        </section>

        {/* 挑战 */}
        <section>
          <h2 className="text-lg font-headline font-bold mb-3 px-1">⚡ 挑战</h2>
          <div className="space-y-3">
            {challenges.map((c) => {
              const isActive = activeIds.has(c.id);
              const activeRecord = activeChallenges.find((ac) => ac.challengeId === c.id);

              return (
                <div key={c.id} className="bg-card rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm">{c.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{c.durationDays} 天挑战</p>
                    </div>
                    {isActive ? (
                      <div className="text-right flex-shrink-0 ml-3">
                        <span className="text-xs font-bold text-primary">
                          {activeRecord?.currentProgress || 0}/{activeRecord?.maxProgress || c.durationDays}
                        </span>
                        <p className="text-[10px] text-muted-foreground">
                          {activeRecord?.status === 'completed' ? '已完成 🎉' : '进行中'}
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleJoin(c.id)}
                        disabled={joining === c.id}
                        className="flex-shrink-0 ml-3 bg-primary text-primary-foreground px-4 py-1.5 rounded-full text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                      >
                        {joining === c.id ? '...' : '参加'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {challenges.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
          )}
        </section>
      </main>
    </div>
  );
}
