import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserProfile,
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
} from '../../entities/user-profile.entity';
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
   * 根据 goal 和 goalSpeed 动态调整热量缺口/盈余
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

    const tdee = bmr * (activityMultiplier[profile.activityLevel] || 1.375);

    // 目标系数：减脂 -20%，增肌 +10%，健康/习惯 维持
    const goalMultiplier: Record<string, number> = {
      [GoalType.FAT_LOSS]: 0.8,
      [GoalType.MUSCLE_GAIN]: 1.1,
      [GoalType.HEALTH]: 1.0,
      [GoalType.HABIT]: 1.0,
    };

    // 速度修正：激进进一步降低 5%，佛系放宽 5%
    const speedModifier: Record<string, number> = {
      [GoalSpeed.AGGRESSIVE]: -0.05,
      [GoalSpeed.STEADY]: 0,
      [GoalSpeed.RELAXED]: 0.05,
    };

    const goalMult = goalMultiplier[profile.goal] ?? 0.8;
    const speedMod = speedModifier[profile.goalSpeed] ?? 0;

    return Math.round(tdee * (goalMult + speedMod));
  }

  /**
   * 构建用户档案上下文字符串，供 AI 使用
   */
  buildUserContext(profile: UserProfile): string {
    const lines: string[] = [];
    if (profile.gender) lines.push(`性别: ${profile.gender === 'male' ? '男' : '女'}`);
    if (profile.birthYear) lines.push(`年龄: ${new Date().getFullYear() - profile.birthYear}岁`);
    if (profile.heightCm) lines.push(`身高: ${profile.heightCm}cm`);
    if (profile.weightKg) lines.push(`体重: ${profile.weightKg}kg`);
    if (profile.targetWeightKg) lines.push(`目标体重: ${profile.targetWeightKg}kg`);
    if (profile.bodyFatPercent) lines.push(`体脂率: ${profile.bodyFatPercent}%`);
    if (profile.goal) lines.push(`目标: ${profile.goal}`);
    if (profile.goalSpeed) lines.push(`目标节奏: ${profile.goalSpeed}`);
    if (profile.dailyCalorieGoal) lines.push(`每日热量目标: ${profile.dailyCalorieGoal}kcal`);
    if (profile.mealsPerDay) lines.push(`每日餐次: ${profile.mealsPerDay}`);
    if (profile.takeoutFrequency) lines.push(`外卖频率: ${profile.takeoutFrequency}`);
    if (profile.canCook !== undefined) lines.push(`会做饭: ${profile.canCook ? '是' : '否'}`);
    if (profile.foodPreferences?.length) lines.push(`饮食偏好: ${profile.foodPreferences.join(', ')}`);
    if (profile.dietaryRestrictions?.length) lines.push(`忌口: ${profile.dietaryRestrictions.join(', ')}`);
    if (profile.weakTimeSlots?.length) lines.push(`容易乱吃时段: ${profile.weakTimeSlots.join(', ')}`);
    if (profile.bingeTriggers?.length) lines.push(`暴食触发: ${profile.bingeTriggers.join(', ')}`);
    if (profile.discipline) lines.push(`自律程度: ${profile.discipline}`);
    return lines.join('\n');
  }
}
