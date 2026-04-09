import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from '../entities/achievement.entity';
import { UserAchievement } from '../entities/user-achievement.entity';
import { Challenge } from '../entities/challenge.entity';
import { UserChallenge } from '../entities/user-challenge.entity';
import { UserBehaviorProfile } from '../../user/entities/user-behavior-profile.entity';
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
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(UserChallenge)
    private readonly userChallengeRepo: Repository<UserChallenge>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
    private readonly foodService: FoodService,
  ) {}

  /**
   * 获取所有成就 + 用户已解锁
   */
  async getAchievements(userId: string): Promise<{
    all: Achievement[];
    unlocked: UserAchievement[];
  }> {
    const [all, unlocked] = await Promise.all([
      this.achievementRepo.find(),
      this.userAchievementRepo.find({ where: { userId } }),
    ]);
    return { all, unlocked };
  }

  /**
   * 检查并解锁成就
   */
  async checkAchievements(userId: string): Promise<UserAchievement[]> {
    const profile = await this.behaviorRepo.findOne({ where: { userId } });
    if (!profile) return [];

    const all = await this.achievementRepo.find();
    const unlocked = await this.userAchievementRepo.find({ where: { userId } });
    const unlockedIds = new Set(unlocked.map((u) => u.achievementId));

    const newlyUnlocked: UserAchievement[] = [];

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
              Number(profile.avgComplianceRate) * 100 >= achievement.threshold;
          } else if (achievement.code === 'first_analyze') {
            qualified = profile.totalRecords >= 1;
          } else if (achievement.code === 'first_plan') {
            qualified = profile.totalRecords >= 1; // simplified check
          }
          break;
      }

      if (qualified) {
        const ua = this.userAchievementRepo.create({
          userId,
          achievementId: achievement.id,
        });
        const saved = await this.userAchievementRepo.save(ua);
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
    available: Challenge[];
    active: UserChallenge[];
  }> {
    const [available, active] = await Promise.all([
      this.challengeRepo.find({ where: { isActive: true } }),
      this.userChallengeRepo.find({ where: { userId, status: 'active' } }),
    ]);
    return { available, active };
  }

  /**
   * 参加挑战
   */
  async joinChallenge(
    userId: string,
    challengeId: string,
  ): Promise<UserChallenge> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('挑战不存在');

    // 检查是否已参加
    const existing = await this.userChallengeRepo.findOne({
      where: { userId, challengeId, status: 'active' },
    });
    if (existing) return existing;

    const userChallenge = this.userChallengeRepo.create({
      userId,
      challengeId,
      maxProgress: challenge.durationDays,
      currentProgress: 0,
      status: 'active',
    });

    return this.userChallengeRepo.save(userChallenge);
  }

  /**
   * 获取连胜状态
   */
  async getStreakStatus(userId: string): Promise<StreakStatus> {
    const profile = await this.behaviorRepo.findOne({ where: { userId } });
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
    let profile = await this.behaviorRepo.findOne({ where: { userId } });

    if (!profile) {
      profile = this.behaviorRepo.create({ userId });
    }

    if (summary.totalCalories > 0 && summary.totalCalories <= goal) {
      profile.streakDays += 1;
      if (profile.streakDays > profile.longestStreak) {
        profile.longestStreak = profile.streakDays;
      }
    } else if (summary.totalCalories > goal) {
      // 失败不归零：扣一半（最少1天）
      profile.streakDays = Math.max(0, Math.floor(profile.streakDays * 0.5));
    }

    await this.behaviorRepo.save(profile);

    // 自动检查成就
    await this.checkAchievements(userId).catch((err) =>
      this.logger.error(`检查成就失败: ${err.message}`),
    );
  }

  /**
   * 更新挑战进度
   */
  async updateChallengeProgress(userId: string): Promise<void> {
    const activeChallenges = await this.userChallengeRepo.find({
      where: { userId, status: 'active' },
    });

    for (const uc of activeChallenges) {
      uc.currentProgress += 1;
      if (uc.currentProgress >= uc.maxProgress) {
        uc.status = 'completed';
        uc.completedAt = new Date();
        this.logger.log(`用户 ${userId} 完成挑战 ${uc.challengeId}`);
      }
      await this.userChallengeRepo.save(uc);
    }
  }
}
