import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FoodService } from '../../diet/app/services/food.service';

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
      this.prisma.userAchievements.findMany({ where: { userId: userId } }),
    ]);
    return { all, unlocked };
  }

  /**
   * 检查并解锁成就
   */
  async checkAchievements(userId: string): Promise<any[]> {
    const profile = await this.prisma.userBehaviorProfiles.findFirst({
      where: { userId: userId },
    });
    if (!profile) return [];

    const all = await this.prisma.achievements.findMany();
    const unlocked = await this.prisma.userAchievements.findMany({
      where: { userId: userId },
    });
    const unlockedIds = new Set(unlocked.map((u) => u.achievementId));

    const newlyUnlocked: any[] = [];

    for (const achievement of all) {
      if (unlockedIds.has(achievement.id)) continue;

      let qualified = false;

      switch (achievement.category) {
        case 'streak':
          qualified = profile.streakDays >= achievement.threshold;
          break;
        case 'record':
          qualified = profile.totalRecords >= achievement.threshold;
          break;
        case 'milestone':
          if (achievement.code === 'healthy_rate_80') {
            qualified =
              profile.totalRecords >= 10 &&
              Number(profile.avgComplianceRate) * 100 >=
                achievement.threshold;
          } else if (achievement.code === 'first_analyze') {
            qualified = profile.totalRecords >= 1;
          } else if (achievement.code === 'first_plan') {
            qualified = profile.totalRecords >= 1; // simplified check
          }
          break;
      }

      if (qualified) {
        const saved = await this.prisma.userAchievements.create({
          data: {
            userId: userId,
            achievementId: achievement.id,
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
      this.prisma.challenges.findMany({ where: { isActive: true } }),
      this.prisma.userChallenges.findMany({
        where: { userId: userId, status: 'active' },
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
    const existing = await this.prisma.userChallenges.findFirst({
      where: { userId: userId, challengeId: challengeId, status: 'active' },
    });
    if (existing) return existing;

    return this.prisma.userChallenges.create({
      data: {
        userId: userId,
        challengeId: challengeId,
        maxProgress: challenge.durationDays,
        currentProgress: 0,
        status: 'active',
      },
    });
  }

  /**
   * 获取连胜状态
   */
  async getStreakStatus(userId: string): Promise<StreakStatus> {
    const profile = await this.prisma.userBehaviorProfiles.findFirst({
      where: { userId: userId },
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
      current: profile?.streakDays || 0,
      longest: profile?.longestStreak || 0,
      todayStatus,
    };
  }

  /**
   * 更新连胜（失败不归零规则）
   */
  async updateStreak(userId: string): Promise<void> {
    const summary = await this.foodService.getTodaySummary(userId);
    const goal = summary.calorieGoal || 2000;
    let profile = await this.prisma.userBehaviorProfiles.findFirst({
      where: { userId: userId },
    });

    if (!profile) {
      profile = await this.prisma.userBehaviorProfiles.create({
        data: { userId: userId },
      });
    }

    let streakDays = profile.streakDays;
    let longestStreak = profile.longestStreak;

    if (summary.totalCalories > 0 && summary.totalCalories <= goal) {
      streakDays += 1;
      if (streakDays > longestStreak) {
        longestStreak = streakDays;
      }
    } else if (summary.totalCalories > goal) {
      // 失败不归零：扣一半（最少1天）
      streakDays = Math.max(0, Math.floor(streakDays * 0.5));
    }

    await this.prisma.userBehaviorProfiles.update({
      where: { id: profile.id },
      data: {
        streakDays: streakDays,
        longestStreak: longestStreak,
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
    const activeChallenges = await this.prisma.userChallenges.findMany({
      where: { userId: userId, status: 'active' },
    });

    for (const uc of activeChallenges) {
      const newProgress = uc.currentProgress + 1;
      const completed = newProgress >= uc.maxProgress;

      await this.prisma.userChallenges.update({
        where: { id: uc.id },
        data: {
          currentProgress: newProgress,
          status: completed ? 'completed' : 'active',
          completedAt: completed ? new Date() : undefined,
        },
      });

      if (completed) {
        this.logger.log(`用户 ${userId} 完成挑战 ${uc.challengeId}`);
      }
    }
  }
}
