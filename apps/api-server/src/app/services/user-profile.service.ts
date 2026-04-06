import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile, ActivityLevel } from '../../entities/user-profile.entity';
import { SaveUserProfileDto } from '../dto/food.dto';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  /**
   * 获取用户档案
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.profileRepo.findOne({ where: { userId } });
  }

  /**
   * 创建或更新用户档案
   */
  async saveProfile(
    userId: string,
    dto: SaveUserProfileDto,
  ): Promise<UserProfile> {
    let profile = await this.profileRepo.findOne({ where: { userId } });

    if (profile) {
      Object.assign(profile, dto);
    } else {
      profile = this.profileRepo.create({ userId, ...dto });
    }

    // 如果未手动设置热量目标且有足够信息，自动计算
    if (
      !dto.dailyCalorieGoal &&
      profile.gender &&
      profile.birthYear &&
      profile.heightCm &&
      profile.weightKg
    ) {
      profile.dailyCalorieGoal = this.calculateDailyGoal(profile);
    }

    return this.profileRepo.save(profile);
  }

  /**
   * 获取每日热量目标
   */
  async getDailyCalorieGoal(userId: string): Promise<number> {
    const profile = await this.getProfile(userId);
    if (profile?.dailyCalorieGoal) return profile.dailyCalorieGoal;

    // 无档案时返回默认值
    return 2000;
  }

  /**
   * Harris-Benedict 公式计算每日热量目标
   * 减肥模式：BMR × 活动系数 × 0.8（20% 热量缺口）
   */
  calculateDailyGoal(profile: UserProfile): number {
    const age = new Date().getFullYear() - (profile.birthYear || 1990);
    const weight = Number(profile.weightKg) || 65;
    const height = Number(profile.heightCm) || 170;

    const bmr =
      profile.gender === 'male'
        ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
        : 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age;

    const activityMultiplier: Record<string, number> = {
      [ActivityLevel.SEDENTARY]: 1.2,
      [ActivityLevel.LIGHT]: 1.375,
      [ActivityLevel.MODERATE]: 1.55,
      [ActivityLevel.ACTIVE]: 1.725,
    };

    const multiplier =
      activityMultiplier[profile.activityLevel] || 1.375;

    // 减肥缺口 20%
    return Math.round(bmr * multiplier * 0.8);
  }
}
