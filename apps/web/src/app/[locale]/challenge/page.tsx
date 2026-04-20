'use client';

import { useState } from 'react';
import { AchievementBadge } from '@/features/challenge/components/achievement-badge';
import { useChallenges } from '@/features/challenge/hooks/use-challenges';
import { useToast } from '@/lib/hooks/use-toast';
import type { Achievement, UserAchievement } from '@/types/food';

export default function ChallengePage() {
  const {
    achievements,
    unlockedAchievements,
    challenges,
    activeChallenges,
    streak,
    joinChallenge,
    isJoining,
    isLoading,
  } = useChallenges();
  const { toast } = useToast();
  const [selectedAchievement, setSelectedAchievement] = useState<{
    achievement: Achievement;
    unlocked?: UserAchievement;
  } | null>(null);

  const handleJoin = async (challengeId: string) => {
    try {
      await joinChallenge(challengeId);
      toast({ title: '成功加入挑战！' });
    } catch {
      toast({ title: '加入失败，请稍后再试', variant: 'destructive' });
    }
  };

  const activeIds = new Set(activeChallenges.map((c) => c.challengeId));
  const unlockedMap = new Map(unlockedAchievements.map((u) => [u.achievementId, u]));

  const STREAK_STATUS_LABELS: Record<string, { label: string; color: string }> = {
    on_track: { label: '进度正常', color: 'text-green-600' },
    at_risk: { label: '接近超标', color: 'text-orange-600' },
    exceeded: { label: '已超标', color: 'text-red-600' },
  };

  const statusInfo = STREAK_STATUS_LABELS[streak.todayStatus] || STREAK_STATUS_LABELS.on_track;

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <header className="sticky top-0 z-40 glass-morphism px-4 py-4">
        <h1 className="text-xl font-extrabold font-headline">🏆 挑战与成就</h1>
      </header>

      <main className="px-4 max-w-lg mx-auto mt-4 space-y-6">
        {/* 连胜状态 */}
        <section className="bg-card rounded-md p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                🔥 连胜
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-headline font-extrabold text-primary">
                  {streak.current}
                </span>
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
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-lg font-headline font-bold">🏅 成就</h2>
            {achievements.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {unlockedAchievements.length}/{achievements.length} 已解锁
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="grid grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1 p-3  bg-muted/30 animate-pulse"
                >
                  <div className="w-8 h-8  bg-muted" />
                  <div className="w-10 h-3 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : achievements.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              暂无成就，坚持记录即可解锁
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {achievements.map((a) => (
                <button
                  key={a.id}
                  onClick={() =>
                    setSelectedAchievement({ achievement: a, unlocked: unlockedMap.get(a.id) })
                  }
                  className="text-left"
                >
                  <AchievementBadge achievement={a} unlocked={unlockedMap.get(a.id)} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 成就详情弹层 */}
        {selectedAchievement && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setSelectedAchievement(null)}
          >
            <div
              className="bg-card rounded-md p-5 w-full max-w-sm shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center gap-2">
                <span className="text-4xl">{selectedAchievement.achievement.icon || '🏅'}</span>
                <h3 className="text-lg font-bold">{selectedAchievement.achievement.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedAchievement.achievement.description}
                </p>

                <div className="w-full mt-3 space-y-2 text-left">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">类别</span>
                    <span className="font-medium">{selectedAchievement.achievement.category}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">解锁条件</span>
                    <span className="font-medium">
                      达成 {selectedAchievement.achievement.threshold} 次
                    </span>
                  </div>
                  {selectedAchievement.achievement.rewardType && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">奖励</span>
                      <span className="font-medium text-accent">
                        {selectedAchievement.achievement.rewardType === 'points'
                          ? `${selectedAchievement.achievement.rewardValue} 积分`
                          : `${selectedAchievement.achievement.rewardValue} ${selectedAchievement.achievement.rewardType}`}
                      </span>
                    </div>
                  )}
                  {selectedAchievement.unlocked && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">解锁时间</span>
                      <span className="font-medium text-primary">
                        {new Date(selectedAchievement.unlocked.unlockedAt).toLocaleDateString(
                          'zh-CN'
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {!selectedAchievement.unlocked && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    继续努力，即可解锁此成就
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedAchievement(null)}
                className="w-full mt-4 py-2  bg-muted text-sm font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* 挑战 */}
        <section>
          <h2 className="text-lg font-headline font-bold mb-3 px-1">⚡ 挑战</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-card rounded-md p-4 shadow-sm animate-pulse">
                  <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                  <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted rounded w-1/4" />
                </div>
              ))}
            </div>
          ) : challenges.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">暂无可用挑战</p>
          ) : (
            <div className="space-y-3">
              {challenges.map((c) => {
                const isActive = activeIds.has(c.id);
                const activeRecord = activeChallenges.find((ac) => ac.challengeId === c.id);
                const progress = activeRecord
                  ? (activeRecord.currentProgress / (activeRecord.maxProgress || c.durationDays)) *
                    100
                  : 0;
                const isCompleted = activeRecord?.status === 'completed';

                return (
                  <div key={c.id} className="bg-card rounded-md p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-sm">{c.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {c.durationDays} 天挑战
                        </p>
                      </div>
                      {isActive ? (
                        <div className="text-right flex-shrink-0 ml-3">
                          <span className="text-xs font-bold text-primary">
                            {activeRecord?.currentProgress || 0}/
                            {activeRecord?.maxProgress || c.durationDays}
                          </span>
                          <p className="text-[10px] text-muted-foreground">
                            {isCompleted ? '已完成 🎉' : '进行中'}
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleJoin(c.id)}
                          disabled={isJoining}
                          className="flex-shrink-0 ml-3 bg-primary text-primary-foreground px-4 py-1.5  text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                        >
                          {isJoining ? '...' : '参加'}
                        </button>
                      )}
                    </div>
                    {/* 进度条 */}
                    {isActive && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-muted  overflow-hidden">
                          <div
                            className={`h-full  transition-all duration-500 ${
                              isCompleted ? 'bg-green-500' : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min(progress, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
