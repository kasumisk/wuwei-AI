'use client';

import type { Achievement, UserAchievement } from '@/types/food';

interface AchievementBadgeProps {
  achievement: Achievement;
  unlocked?: UserAchievement;
}

export function AchievementBadge({ achievement, unlocked }: AchievementBadgeProps) {
  const isUnlocked = !!unlocked;

  return (
    <div
      className={`flex flex-col items-center gap-1 p-3  transition-all ${
        isUnlocked ? 'bg-card shadow-sm' : 'bg-muted/30 opacity-50'
      }`}
    >
      <span className="text-2xl">{achievement.icon || '🏅'}</span>
      <span
        className={`text-xs font-bold text-center ${isUnlocked ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {achievement.name}
      </span>
      {isUnlocked && <span className="text-[10px] text-primary font-medium">已解锁</span>}
    </div>
  );
}
