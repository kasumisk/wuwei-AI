import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserProfile,
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
} from '../entities/user-profile.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { ProfileSnapshot } from '../entities/profile-snapshot.entity';
import { ProfileCacheService } from './profile-cache.service';
import {
  OnboardingStep1Dto,
  OnboardingStep2Dto,
  OnboardingStep3Dto,
  OnboardingStep4Dto,
  UpdateDeclaredProfileDto,
} from './dto/user-profile.dto';
import { SaveUserProfileDto } from 'src/modules/diet/app/food.dto';

/** 字段权重表 — 权重越高，对推荐质量影响越大 */
const FIELD_WEIGHTS: Record<string, number> = {
  gender: 8,
  birthYear: 8,
  heightCm: 10,
  weightKg: 10,
  goal: 9,
  activityLevel: 7,
  targetWeightKg: 5,
  mealsPerDay: 4,
  dietaryRestrictions: 6,
  allergens: 7,
  foodPreferences: 3,
  takeoutFrequency: 2,
  discipline: 5,
  weakTimeSlots: 3,
  bingeTriggers: 4,
  canCook: 3,
  exerciseProfile: 4,
  cookingSkillLevel: 2,
  healthConditions: 6,
  budgetLevel: 2,
  tasteIntensity: 2,
};

/** 关键字段 — 变更时创建快照 */
const CRITICAL_FIELDS = [
  'goal',
  'goalSpeed',
  'weightKg',
  'allergens',
  'dietaryRestrictions',
  'healthConditions',
];

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserInferredProfile)
    private readonly inferredRepo: Repository<UserInferredProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
    @InjectRepository(ProfileSnapshot)
    private readonly snapshotRepo: Repository<ProfileSnapshot>,
    private readonly profileCacheService: ProfileCacheService,
  ) {}

  /**
   * 获取用户档案
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.profileRepo.findOne({ where: { userId } });
  }

  /**
   * 创建或更新用户档案（兼容旧 API）
   */
  async saveProfile(
    userId: string,
    dto: SaveUserProfileDto,
  ): Promise<UserProfile> {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    const oldProfile = profile ? { ...profile } : null;

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

    // 更新完整度
    profile.dataCompleteness = this.calculateCompleteness(profile);

    const saved = await this.profileRepo.save(profile);

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    // 关键字段变更时创建快照
    if (oldProfile) {
      await this.createSnapshotIfNeeded(userId, oldProfile, saved);
    }

    // 同步更新推断数据
    await this.syncInferredProfile(saved);

    return saved;
  }

  // ==================== 分步引导流 ====================

  /**
   * 保存引导步骤数据
   */
  async saveOnboardingStep(
    userId: string,
    step: number,
    dto:
      | OnboardingStep1Dto
      | OnboardingStep2Dto
      | OnboardingStep3Dto
      | OnboardingStep4Dto,
  ): Promise<{
    profile: UserProfile;
    computed: { bmr?: number; tdee?: number; recommendedCalories?: number };
    nextStep: number | null;
    completeness: number;
  }> {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepo.create({ userId });
    }

    // 合并步骤数据
    Object.assign(profile, dto);
    profile.onboardingStep = step;

    // Step 2 完成后即可计算 BMR
    if (
      step >= 2 &&
      profile.gender &&
      profile.birthYear &&
      profile.heightCm &&
      profile.weightKg &&
      !profile.dailyCalorieGoal
    ) {
      profile.dailyCalorieGoal = this.calculateDailyGoal(profile);
    }

    // Step 4 完成 → 标记引导完成
    if (step >= 4) {
      profile.onboardingCompleted = true;
    }

    profile.dataCompleteness = this.calculateCompleteness(profile);
    const saved = await this.profileRepo.save(profile);

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    // 同步推断数据
    const computed = await this.syncInferredProfile(saved);

    return {
      profile: saved,
      computed: {
        bmr: computed?.estimatedBMR,
        tdee: computed?.estimatedTDEE,
        recommendedCalories: computed?.recommendedCalories,
      },
      nextStep: step < 4 ? step + 1 : null,
      completeness: Number(saved.dataCompleteness),
    };
  }

  /**
   * 跳过引导步骤
   */
  async skipOnboardingStep(
    userId: string,
    step: number,
  ): Promise<{ nextStep: number | null; completeness: number }> {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepo.create({ userId });
    }

    profile.onboardingStep = step;
    if (step >= 4) {
      profile.onboardingCompleted = true;
    }

    profile.dataCompleteness = this.calculateCompleteness(profile);
    await this.profileRepo.save(profile);

    return {
      nextStep: step < 4 ? step + 1 : null,
      completeness: Number(profile.dataCompleteness),
    };
  }

  // ==================== 完整画像 ====================

  /**
   * 获取聚合画像（声明 + 行为 + 推断）
   */
  async getFullProfile(userId: string): Promise<{
    declared: UserProfile | null;
    observed: UserBehaviorProfile | null;
    inferred: UserInferredProfile | null;
    meta: {
      completeness: number;
      onboardingStep: number;
      profileVersion: number;
    };
  }> {
    const [declared, observed, inferred] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
      this.inferredRepo.findOne({ where: { userId } }),
    ]);

    return {
      declared,
      observed,
      inferred,
      meta: {
        completeness: Number(declared?.dataCompleteness ?? 0),
        onboardingStep: declared?.onboardingStep ?? 0,
        profileVersion: declared?.profileVersion ?? 1,
      },
    };
  }

  /**
   * 更新声明数据（部分更新，已完成引导的用户使用）
   */
  async updateDeclaredProfile(
    userId: string,
    dto: UpdateDeclaredProfileDto,
  ): Promise<UserProfile> {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepo.create({ userId });
    }

    const oldProfile = { ...profile };
    Object.assign(profile, dto);

    // 重算热量（如果体重/身高/目标等变化且用户未手动设定）
    if (
      (dto.weightKg || dto.heightCm || dto.goal || dto.activityLevel) &&
      !dto.dailyCalorieGoal &&
      profile.gender &&
      profile.birthYear &&
      profile.heightCm &&
      profile.weightKg
    ) {
      profile.dailyCalorieGoal = this.calculateDailyGoal(profile);
    }

    profile.dataCompleteness = this.calculateCompleteness(profile);
    const saved = await this.profileRepo.save(profile);

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    await this.createSnapshotIfNeeded(userId, oldProfile, saved);
    await this.syncInferredProfile(saved);

    return saved;
  }

  /**
   * 获取补全建议
   */
  async getCompletionSuggestions(userId: string): Promise<{
    suggestions: Array<{
      field: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
      estimatedImpact: string;
    }>;
    currentCompleteness: number;
  }> {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      return { suggestions: [], currentCompleteness: 0 };
    }

    const suggestions: Array<{
      field: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
      estimatedImpact: string;
    }> = [];

    const fieldMeta: Record<
      string,
      { priority: 'high' | 'medium' | 'low'; reason: string; impact: string }
    > = {
      heightCm: {
        priority: 'high',
        reason: '计算基础代谢率的核心参数',
        impact: '推荐准确度提升 ~20%',
      },
      weightKg: {
        priority: 'high',
        reason: '计算基础代谢率的核心参数',
        impact: '推荐准确度提升 ~20%',
      },
      allergens: {
        priority: 'high',
        reason: '确保推荐食物安全，排除过敏原',
        impact: '安全性保障',
      },
      goal: {
        priority: 'high',
        reason: '决定营养分配策略',
        impact: '推荐准确度提升 ~15%',
      },
      dietaryRestrictions: {
        priority: 'medium',
        reason: '过滤不适合的食物',
        impact: '推荐准确度提升 ~10%',
      },
      healthConditions: {
        priority: 'medium',
        reason: '针对健康状况调整推荐',
        impact: '安全性 + 准确度提升',
      },
      discipline: {
        priority: 'medium',
        reason: '调整推荐约束松紧度',
        impact: '执行率提升 ~15%',
      },
      bingeTriggers: {
        priority: 'medium',
        reason: '暴食预防干预',
        impact: '坚持率提升 ~10%',
      },
      exerciseProfile: {
        priority: 'low',
        reason: '运动用户热量需求不同',
        impact: '热量计算更精确',
      },
      cookingSkillLevel: {
        priority: 'low',
        reason: '匹配烹饪难度',
        impact: '推荐可行性提升',
      },
    };

    for (const [field, meta] of Object.entries(fieldMeta)) {
      const value = (profile as any)[field];
      const isEmpty =
        value === null ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0);

      if (isEmpty) {
        suggestions.push({
          field,
          priority: meta.priority,
          reason: meta.reason,
          estimatedImpact: meta.impact,
        });
      }
    }

    // 按优先级排序
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    return {
      suggestions,
      currentCompleteness: Number(profile.dataCompleteness),
    };
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
    const bmr = this.calculateBMR(profile);
    const tdee = this.calculateTDEE(bmr, profile.activityLevel);
    return this.calculateRecommendedCalories(
      tdee,
      profile.goal,
      profile.goalSpeed,
    );
  }

  /**
   * 构建用户档案上下文字符串，供 AI 使用
   */
  buildUserContext(profile: UserProfile): string {
    const lines: string[] = [];
    if (profile.gender)
      lines.push(`性别: ${profile.gender === 'male' ? '男' : '女'}`);
    if (profile.birthYear)
      lines.push(`年龄: ${new Date().getFullYear() - profile.birthYear}岁`);
    if (profile.heightCm) lines.push(`身高: ${profile.heightCm}cm`);
    if (profile.weightKg) lines.push(`体重: ${profile.weightKg}kg`);
    if (profile.targetWeightKg)
      lines.push(`目标体重: ${profile.targetWeightKg}kg`);
    if (profile.bodyFatPercent)
      lines.push(`体脂率: ${profile.bodyFatPercent}%`);
    if (profile.goal) lines.push(`目标: ${profile.goal}`);
    if (profile.goalSpeed) lines.push(`目标节奏: ${profile.goalSpeed}`);
    if (profile.dailyCalorieGoal)
      lines.push(`每日热量目标: ${profile.dailyCalorieGoal}kcal`);
    if (profile.mealsPerDay) lines.push(`每日餐次: ${profile.mealsPerDay}`);
    if (profile.takeoutFrequency)
      lines.push(`外卖频率: ${profile.takeoutFrequency}`);
    if (profile.canCook !== undefined)
      lines.push(`会做饭: ${profile.canCook ? '是' : '否'}`);
    if (profile.foodPreferences?.length)
      lines.push(`饮食偏好: ${profile.foodPreferences.join(', ')}`);
    if (profile.dietaryRestrictions?.length)
      lines.push(`忌口: ${profile.dietaryRestrictions.join(', ')}`);
    if (profile.allergens?.length)
      lines.push(`⚠️过敏原: ${profile.allergens.join(', ')}`);
    if (profile.healthConditions?.length)
      lines.push(`健康状况: ${profile.healthConditions.join(', ')}`);
    if (profile.weakTimeSlots?.length)
      lines.push(`容易乱吃时段: ${profile.weakTimeSlots.join(', ')}`);
    if (profile.bingeTriggers?.length)
      lines.push(`暴食触发: ${profile.bingeTriggers.join(', ')}`);
    if (profile.discipline) lines.push(`自律程度: ${profile.discipline}`);
    return lines.join('\n');
  }

  // ==================== 内部方法 ====================

  /**
   * 计算数据完整度（加权）
   */
  calculateCompleteness(profile: UserProfile): number {
    const totalWeight = Object.values(FIELD_WEIGHTS).reduce((a, b) => a + b, 0);
    let filledWeight = 0;

    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const value = (profile as any)[field];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      )
        continue;
      filledWeight += weight;
    }

    return Math.round((filledWeight / totalWeight) * 100) / 100;
  }

  /**
   * 关键字段变更时创建快照
   */
  private async createSnapshotIfNeeded(
    userId: string,
    oldProfile: Partial<UserProfile>,
    newProfile: UserProfile,
  ): Promise<void> {
    const changed = CRITICAL_FIELDS.filter((f) => {
      const oldVal = (oldProfile as any)[f];
      const newVal = (newProfile as any)[f];
      return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });

    if (changed.length === 0) return;

    const triggerType = changed.includes('goal')
      ? 'goal_change'
      : changed.includes('weightKg')
        ? 'weight_update'
        : changed.includes('allergens') ||
            changed.includes('dietaryRestrictions')
          ? 'restriction_change'
          : 'field_update';

    await this.snapshotRepo.save({
      userId,
      snapshot: oldProfile,
      triggerType,
      changedFields: changed,
    });

    this.logger.log(
      `用户 ${userId} 关键字段变更快照已创建: [${changed.join(', ')}]`,
    );
  }

  /**
   * 同步更新推断数据（BMR/TDEE/macroTargets）
   */
  private async syncInferredProfile(
    profile: UserProfile,
  ): Promise<UserInferredProfile | null> {
    if (
      !profile.gender ||
      !profile.birthYear ||
      !profile.heightCm ||
      !profile.weightKg
    ) {
      return null;
    }

    let inferred = await this.inferredRepo.findOne({
      where: { userId: profile.userId },
    });
    if (!inferred) {
      inferred = this.inferredRepo.create({ userId: profile.userId });
    }

    const bmr = this.calculateBMR(profile);
    const tdee = this.calculateTDEE(bmr, profile.activityLevel);
    const recommendedCalories = this.calculateRecommendedCalories(
      tdee,
      profile.goal,
      profile.goalSpeed,
    );

    inferred.estimatedBMR = Math.round(bmr);
    inferred.estimatedTDEE = Math.round(tdee);
    inferred.recommendedCalories = recommendedCalories;
    inferred.macroTargets = this.calculateMacroTargets(
      recommendedCalories,
      profile.goal,
    );
    inferred.lastComputedAt = new Date();

    // 置信度
    inferred.confidenceScores = {
      ...inferred.confidenceScores,
      estimatedBMR: profile.bodyFatPercent ? 0.95 : 0.85,
      estimatedTDEE: 0.8,
      recommendedCalories: 0.8,
      macroTargets: 0.75,
    };

    return this.inferredRepo.save(inferred);
  }

  /**
   * 计算 BMR (Harris-Benedict)
   */
  private calculateBMR(profile: UserProfile): number {
    const age = new Date().getFullYear() - (profile.birthYear || 1990);
    const weight = Number(profile.weightKg) || 65;
    const height = Number(profile.heightCm) || 170;

    return profile.gender === 'male'
      ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
      : 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age;
  }

  /**
   * 计算 TDEE
   */
  private calculateTDEE(bmr: number, activityLevel: ActivityLevel): number {
    const multiplier: Record<string, number> = {
      [ActivityLevel.SEDENTARY]: 1.2,
      [ActivityLevel.LIGHT]: 1.375,
      [ActivityLevel.MODERATE]: 1.55,
      [ActivityLevel.ACTIVE]: 1.725,
    };
    return bmr * (multiplier[activityLevel] || 1.375);
  }

  /**
   * 计算推荐摄入热量
   */
  private calculateRecommendedCalories(
    tdee: number,
    goal: GoalType,
    goalSpeed: GoalSpeed,
  ): number {
    const goalMultiplier: Record<string, number> = {
      [GoalType.FAT_LOSS]: 0.8,
      [GoalType.MUSCLE_GAIN]: 1.1,
      [GoalType.HEALTH]: 1.0,
      [GoalType.HABIT]: 1.0,
    };
    const speedModifier: Record<string, number> = {
      [GoalSpeed.AGGRESSIVE]: -0.05,
      [GoalSpeed.STEADY]: 0,
      [GoalSpeed.RELAXED]: 0.05,
    };
    const goalMult = goalMultiplier[goal] ?? 1.0;
    const speedMod = speedModifier[goalSpeed] ?? 0;
    return Math.round(tdee * (goalMult + speedMod));
  }

  /**
   * 计算宏量营养素目标
   */
  private calculateMacroTargets(
    calories: number,
    goal: GoalType,
  ): { proteinG: number; carbG: number; fatG: number } {
    // 不同目标的宏量分配比例 (protein/carb/fat)
    const ratios: Record<string, [number, number, number]> = {
      [GoalType.FAT_LOSS]: [0.35, 0.4, 0.25],
      [GoalType.MUSCLE_GAIN]: [0.4, 0.4, 0.2],
      [GoalType.HEALTH]: [0.25, 0.5, 0.25],
      [GoalType.HABIT]: [0.25, 0.5, 0.25],
    };
    const [pRatio, cRatio, fRatio] = ratios[goal] || ratios[GoalType.HEALTH];
    return {
      proteinG: Math.round((calories * pRatio) / 4),
      carbG: Math.round((calories * cRatio) / 4),
      fatG: Math.round((calories * fRatio) / 9),
    };
  }
}
