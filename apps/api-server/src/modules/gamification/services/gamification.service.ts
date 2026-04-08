import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from '../entities/achievement.entity';
import { UserAchievement } from '../entities/user-achievement.entity';
import { Challenge } from '../entities/challenge.entity';
import { UserChallenge, ChallengeStatus } from '../entities/user-challenge.entity';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    @InjectRepository(Achievement)
    private achievementRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
    @InjectRepository(UserChallenge)
    private userChallengeRepo: Repository<UserChallenge>,
  ) {}

  // ===== Achievements =====

  async getUserAchievements(userId: string) {
    return this.userAchievementRepo.find({
      where: { userId },
      relations: ['achievement'],
      order: { unlockedAt: 'DESC' },
    });
  }

  async checkAndUnlock(userId: string, code: string, currentValue: number) {
    const achievement = await this.achievementRepo.findOne({ where: { code, isActive: true } });
    if (!achievement) return null;

    if (currentValue < achievement.threshold) return null;

    const existing = await this.userAchievementRepo.findOne({
      where: { userId, achievementId: achievement.id },
    });
    if (existing) return null;

    const ua = this.userAchievementRepo.create({
      userId,
      achievementId: achievement.id,
      unlockedAt: new Date(),
    });
    await this.userAchievementRepo.save(ua);

    this.logger.log(`User ${userId} unlocked achievement: ${code}`);
    return { achievement, userAchievement: ua };
  }

  async checkStreakAchievements(userId: string, streakDays: number) {
    const streakCodes = [
      { code: 'streak_3', threshold: 3 },
      { code: 'streak_7', threshold: 7 },
      { code: 'streak_14', threshold: 14 },
      { code: 'streak_30', threshold: 30 },
      { code: 'streak_100', threshold: 100 },
    ];

    const results: any[] = [];
    for (const { code } of streakCodes) {
      const result = await this.checkAndUnlock(userId, code, streakDays);
      if (result) results.push(result);
    }
    return results;
  }

  // ===== Challenges =====

  async getActiveChallenges() {
    return this.challengeRepo.find({ where: { isActive: true } });
  }

  async getUserChallenges(userId: string) {
    return this.userChallengeRepo.find({
      where: { userId },
      relations: ['challenge'],
      order: { createdAt: 'DESC' },
    });
  }

  async joinChallenge(userId: string, challengeId: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id: challengeId, isActive: true } });
    if (!challenge) throw new NotFoundException('挑战不存在或已关闭');

    const existing = await this.userChallengeRepo.findOne({
      where: { userId, challengeId, status: ChallengeStatus.ACTIVE },
    });
    if (existing) throw new ConflictException('已参加该挑战');

    const uc = this.userChallengeRepo.create({
      userId,
      challengeId,
      maxProgress: challenge.durationDays,
      startedAt: new Date(),
    });
    return this.userChallengeRepo.save(uc);
  }

  async updateProgress(userId: string, userChallengeId: string, increment = 1) {
    const uc = await this.userChallengeRepo.findOne({
      where: { id: userChallengeId, userId, status: ChallengeStatus.ACTIVE },
    });
    if (!uc) throw new NotFoundException('挑战记录不存在');

    uc.currentProgress += increment;
    if (uc.currentProgress >= uc.maxProgress) {
      uc.status = ChallengeStatus.COMPLETED;
      uc.completedAt = new Date();
    }

    return this.userChallengeRepo.save(uc);
  }
}
