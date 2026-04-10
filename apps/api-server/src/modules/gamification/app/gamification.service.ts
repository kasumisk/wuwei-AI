import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FoodService } from '../../diet/app/food.service';

export interface StreakStatus {
  current: number;
  longest: number;
  todayStatus: 'on_track' | 'at_risk' | 'exceeded';
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
  ) {}

  /**
   * 获取所有成就 + 用户已解锁
   */
  async getAchievements(userId: string): Promise<{
    all: any[];
    unlocked: any[];
  }> {
    const [all, unlocked] = await Promise.all([
      this.prisma.achievements.findMany(),
      this.prisma.user_achievements.findMany({ where: { user_id: userId } }),
    ]);
    return { all, unlocked };
  }

  /**
   * 检查并解锁成就
   */
  async checkAchievements(userId: string): Promise<any[]> {
    const profile = await this.prisma.user_behavior_profiles.findFirst({
      where: { user_id: userId },
    });
    if (!profile) return [];

    const all = await this.prisma.achievements.findMany();
    const unlocked = await this.prisma.user_achievements.findMany({
      where: { user_id: userId },
    });
    const unlockedIds = new Set(unlocked.map((u) => u.achievement_id));

    const newlyUnlocked: any[] = [];

    for (const achievement of all) {
      if (unlockedIds.has(achievement.id)) continue;

      let qualified = false;

      switch (achievement.category) {
        case 'streak':
          qualified = profile.streak_days >= achievement.threshold;
          break;
        case 'record':
          qualified = profile.total_records >= achievement.threshold;
          break;
        case 'milestone':
          if (achievement.code === 'healthy_rate_80') {
            qualified =
              profile.total_records >= 10 &&
              Number(profile.avg_compliance_rate) * 100 >=
                achievement.threshold;
          } else if (achievement.code === 'first_analyze') {
            qualified = profile.total_records >= 1;
          } else if (achievement.code === 'first_plan') {
            qualified = profile.total_records >= 1; // simplified check
          }
          break;
      }

      if (qualified) {
        const saved = await this.prisma.user_achievements.create({
          data: {
            user_id: userId,
            achievement_id: achievement.id,
          },
        });
        newlyUnlocked.push(saved);
        this.logger.log(`用户 ${userId} 解锁成就: ${achievement.name}`);
      }
    }

    return newlyUnlocked;
  }

  /**
   * 获取挑战列表
   */
  async getChallenges(userId: string): Promise<{
    available: any[];
    active: any[];
  }> {
    const [available, active] = await Promise.all([
      this.prisma.challenges.findMany({ where: { is_active: true } }),
      this.prisma.user_challenges.findMany({
        where: { user_id: userId, status: 'active' },
      }),
    ]);
    return { available, active };
  }

  /**
   * 参加挑战
   */
  async joinChallenge(userId: string, challengeId: string): Promise<any> {
    const challenge = await this.prisma.challenges.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('挑战不存在');

    // 检查是否已参加
    const existing = await this.prisma.user_challenges.findFirst({
      where: { user_id: userId, challenge_id: challengeId, status: 'active' },
    });
    if (existing) return existing;

    return this.prisma.user_challenges.create({
      data: {
        user_id: userId,
        challenge_id: challengeId,
        max_progress: challenge.duration_days,
        current_progress: 0,
        status: 'active',
      },
    });
  }

  /**
   * 获取连胜状态
   */
  async getStreakStatus(userId: string): Promise<StreakStatus> {
    const profile = await this.prisma.user_behavior_profiles.findFirst({
      where: { user_id: userId },
    });
    const summary = await this.foodService.getTodaySummary(userId);
    const goal = summary.calorieGoal || 2000;

    let todayStatus: StreakStatus['todayStatus'] = 'on_track';
    if (summary.totalCalories > goal) {
      todayStatus = 'exceeded';
    } else if (summary.totalCalories > goal * 0.9) {
      todayStatus = 'at_risk';
    }

    return {
      current: profile?.streak_days || 0,
      longest: profile?.longest_streak || 0,
      todayStatus,
    };
  }

  /**
   * 更新连胜（失败不归零规则）
   */
  async updateStreak(userId: string): Promise<void> {
    const summary = await this.foodService.getTodaySummary(userId);
    const goal = summary.calorieGoal || 2000;
    let profile = await this.prisma.user_behavior_profiles.findFirst({
      where: { user_id: userId },
    });

    if (!profile) {
      profile = await this.prisma.user_behavior_profiles.create({
        data: { user_id: userId },
      });
    }

    let streakDays = profile.streak_days;
    let longestStreak = profile.longest_streak;

    if (summary.totalCalories > 0 && summary.totalCalories <= goal) {
      streakDays += 1;
      if (streakDays > longestStreak) {
        longestStreak = streakDays;
      }
    } else if (summary.totalCalories > goal) {
      // 失败不归零：扣一半（最少1天）
      streakDays = Math.max(0, Math.floor(streakDays * 0.5));
    }

    await this.prisma.user_behavior_profiles.update({
      where: { id: profile.id },
      data: {
        streak_days: streakDays,
        longest_streak: longestStreak,
      },
    });

    // 自动检查成就
    await this.checkAchievements(userId).catch((err) =>
      this.logger.error(`检查成就失败: ${err.message}`),
    );
  }

  /**
   * 更新挑战进度
   */
  async updateChallengeProgress(userId: string): Promise<void> {
    const activeChallenges = await this.prisma.user_challenges.findMany({
      where: { user_id: userId, status: 'active' },
    });

    for (const uc of activeChallenges) {
      const newProgress = uc.current_progress + 1;
      const completed = newProgress >= uc.max_progress;

      await this.prisma.user_challenges.update({
        where: { id: uc.id },
        data: {
          current_progress: newProgress,
          status: completed ? 'completed' : 'active',
          completed_at: completed ? new Date() : undefined,
        },
      });

      if (completed) {
        this.logger.log(`用户 ${userId} 完成挑战 ${uc.challenge_id}`);
      }
    }
  }
}
