import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../entities/user-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { UpdateProfileDto, OnboardingStepDto } from '../dto/user-profile.dto';
import { ACTIVITY_FACTORS, DEFICIT_MULTIPLIERS, COMPLETENESS_WEIGHTS, ONBOARDING_STEPS } from '../../../shared/constants/profile.constants';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    @InjectRepository(UserProfile)
    private profileRepo: Repository<UserProfile>,
    @InjectRepository(UserBehaviorProfile)
    private behaviorRepo: Repository<UserBehaviorProfile>,
  ) {}

  async getOrCreate(userId: string): Promise<UserProfile> {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepo.create({ userId });
      profile = await this.profileRepo.save(profile);
      this.logger.log(`Profile created for user: ${userId}`);
    }
    return profile;
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    let profile = await this.getOrCreate(userId);
    Object.assign(profile, dto);

    // Auto-calculate calorie goal if not manually set
    if (!dto.dailyCalorieGoal && profile.weightKg && profile.heightCm && profile.birthYear) {
      profile.dailyCalorieGoal = this.calculateCalorieGoal(profile);
    }

    return this.profileRepo.save(profile);
  }

  async onboardingStep(userId: string, dto: OnboardingStepDto): Promise<UserProfile> {
    const profile = await this.getOrCreate(userId);
    const stepFields = ONBOARDING_STEPS[dto.step];
    if (stepFields) {
      const allFields = [...stepFields.required, ...stepFields.optional];
      for (const field of allFields) {
        if (dto.data[field] !== undefined) {
          (profile as any)[field] = dto.data[field];
        }
      }
    }

    if (dto.step === 4) {
      profile.onboardingCompleted = true;
      if (profile.weightKg && profile.heightCm && profile.birthYear) {
        profile.dailyCalorieGoal = this.calculateCalorieGoal(profile);
      }
    }

    return this.profileRepo.save(profile);
  }

  async getBehavior(userId: string): Promise<UserBehaviorProfile> {
    let behavior = await this.behaviorRepo.findOne({ where: { userId } });
    if (!behavior) {
      behavior = this.behaviorRepo.create({ userId });
      behavior = await this.behaviorRepo.save(behavior);
    }
    return behavior;
  }

  async updateBehavior(userId: string, data: Partial<UserBehaviorProfile>): Promise<UserBehaviorProfile> {
    const behavior = await this.getBehavior(userId);
    Object.assign(behavior, data);
    return this.behaviorRepo.save(behavior);
  }

  async incrementRecords(userId: string, isHealthy: boolean): Promise<void> {
    const behavior = await this.getBehavior(userId);
    behavior.totalRecords += 1;
    if (isHealthy) {
      behavior.healthyRecords += 1;
      behavior.streakDays += 1;
      if (behavior.streakDays > behavior.longestStreak) {
        behavior.longestStreak = behavior.streakDays;
      }
    } else {
      behavior.streakDays = 0;
    }
    behavior.avgComplianceRate = behavior.totalRecords > 0
      ? behavior.healthyRecords / behavior.totalRecords
      : 0;
    await this.behaviorRepo.save(behavior);
  }

  getProfileCompleteness(profile: UserProfile): number {
    let score = 0;
    const weights = COMPLETENESS_WEIGHTS;
    if (profile.gender) score += weights.gender;
    if (profile.birthYear) score += weights.birthYear;
    if (profile.heightCm) score += weights.heightCm;
    if (profile.weightKg) score += weights.weightKg;
    if (profile.goal) score += weights.goal;
    if (profile.activityLevel) score += weights.activityLevel;
    if (profile.foodPreferences?.length) score += weights.foodPreferences;
    if (profile.dietaryRestrictions?.length) score += weights.dietaryRestrictions;
    return Math.min(score, 1);
  }

  private calculateCalorieGoal(profile: UserProfile): number {
    const age = new Date().getFullYear() - (profile.birthYear || 1990);
    const weight = Number(profile.weightKg) || 70;
    const height = Number(profile.heightCm) || 170;

    // Mifflin-St Jeor equation
    let bmr: number;
    if (profile.gender === 'male') {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    const activityFactor = ACTIVITY_FACTORS[profile.activityLevel] || 1.375;
    let tdee = bmr * activityFactor;

    const deficitMultiplier = DEFICIT_MULTIPLIERS[profile.goal]?.[profile.goalSpeed] ?? 1;
    const target = Math.round(tdee * deficitMultiplier);

    return Math.max(1200, Math.min(target, 5000));
  }
}
