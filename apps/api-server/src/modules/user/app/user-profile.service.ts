import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActivityLevel,
  GoalType,
  GoalSpeed,
  Discipline,
  RecommendationPreferences,
  PopularityPreference,
  CookingEffort,
  BudgetSensitivity,
  KitchenProfile,
  DEFAULT_KITCHEN_PROFILE,
} from '../user.types';
import {
  user_profiles as UserProfile,
  user_inferred_profiles as UserInferredProfile,
  user_behavior_profiles as UserBehaviorProfile,
  profile_snapshots as ProfileSnapshot,
} from '@prisma/client';
import { ProfileCacheService } from './profile-cache.service';
import {
  OnboardingStep1Dto,
  OnboardingStep2Dto,
  OnboardingStep3Dto,
  OnboardingStep4Dto,
  UpdateDeclaredProfileDto,
  UpdateRecommendationPreferencesDto,
} from './dto/user-profile.dto';
import { SaveUserProfileDto } from '../../diet/app/dto/food.dto';
import {
  DomainEvents,
  ProfileUpdatedEvent,
} from '../../../core/events/domain-events';
import { PrismaService } from '../../../core/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
    private readonly profileCacheService: ProfileCacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 获取用户档案
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    }) as any;
  }

  /**
   * 获取用户时区（IANA 格式），无档案时返回默认值 Asia/Shanghai
   */
  async getTimezone(userId: string): Promise<string> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
      select: { timezone: true },
    });
    return profile?.timezone || 'Asia/Shanghai';
  }

  /**
   * 创建或更新用户档案（兼容旧 API）
   */
  async saveProfile(
    userId: string,
    dto: SaveUserProfileDto,
  ): Promise<UserProfile> {
    let profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    const oldProfile = profile ? { ...profile } : null;

    // Map DTO camelCase fields to snake_case DB fields
    const mappedData = this.mapDtoToDbFields(dto);

    if (profile) {
      // Merge mapped data
      profile = { ...profile, ...mappedData } as any;
    } else {
      profile = { user_id: userId, ...mappedData } as any;
    }

    // 如果未手动设置热量目标且有足够信息，自动计算
    if (
      !dto.dailyCalorieGoal &&
      profile!.gender &&
      profile!.birth_year &&
      profile!.height_cm &&
      profile!.weight_kg
    ) {
      (profile as any).daily_calorie_goal = this.calculateDailyGoal(
        profile as any,
      );
    }

    // 更新完整度
    (profile as any).data_completeness = this.calculateCompleteness(
      profile as any,
    );

    let saved: any;
    if (oldProfile) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(profile) as any,
      );
    } else {
      saved = await this.prisma.user_profiles.create({
        data: this.extractWritableFields(profile) as any,
      });
    }

    // V5 3.1: 体重变化时记录历史
    if (
      dto.weightKg &&
      (!oldProfile || Number(oldProfile.weight_kg) !== Number(dto.weightKg))
    ) {
      const source = oldProfile ? 'manual' : 'onboarding';
      await this.recordWeightHistory(
        userId,
        Number(dto.weightKg),
        dto.bodyFatPercent != null ? Number(dto.bodyFatPercent) : null,
        source,
      );
    }

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    // 关键字段变更时创建快照
    if (oldProfile) {
      await this.createSnapshotIfNeeded(userId, oldProfile, saved);
    }

    // 同步更新推断数据
    await this.syncInferredProfile(saved);

    // V6 Phase 1.2 + 2.17: 发布画像更新事件（含变更前后值）
    const dtoKeys = Object.keys(dto);
    const beforeVals: Record<string, unknown> = {};
    const afterVals: Record<string, unknown> = {};
    for (const k of dtoKeys) {
      const dbKey = this.camelToSnake(k);
      beforeVals[k] = oldProfile ? (oldProfile as any)[dbKey] : null;
      afterVals[k] = (saved as any)[dbKey];
    }
    this.eventEmitter.emit(
      DomainEvents.PROFILE_UPDATED,
      new ProfileUpdatedEvent(
        userId,
        'declared',
        'manual',
        dtoKeys,
        beforeVals,
        afterVals,
        oldProfile ? '用户手动更新档案' : '用户首次创建档案',
      ),
    );

    return saved as any;
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
    let profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });

    const mappedData = this.mapDtoToDbFields(dto);

    if (!profile) {
      profile = { user_id: userId, ...mappedData } as any;
    } else {
      profile = { ...profile, ...mappedData } as any;
    }

    // 合并步骤数据
    (profile as any).onboarding_step = step;

    // Step 2 完成后即可计算 BMR
    if (
      step >= 2 &&
      profile!.gender &&
      profile!.birth_year &&
      profile!.height_cm &&
      profile!.weight_kg &&
      !profile!.daily_calorie_goal
    ) {
      (profile as any).daily_calorie_goal = this.calculateDailyGoal(
        profile as any,
      );
    }

    // Step 4 完成 → 标记引导完成
    if (step >= 4) {
      (profile as any).onboarding_completed = true;
    }

    (profile as any).data_completeness = this.calculateCompleteness(
      profile as any,
    );

    let saved: any;
    const existing = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    if (existing) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(profile) as any,
      );
    } else {
      saved = await this.prisma.user_profiles.create({
        data: this.extractWritableFields(profile) as any,
      });
    }

    // V5 3.1: 引导步骤中填写体重时记录历史（Step 2 包含 weightKg）
    if ('weightKg' in dto && dto.weightKg) {
      await this.recordWeightHistory(
        userId,
        Number(dto.weightKg),
        'bodyFatPercent' in dto && dto.bodyFatPercent != null
          ? Number(dto.bodyFatPercent)
          : null,
        'onboarding',
      );
    }

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    // 同步推断数据
    const computed = await this.syncInferredProfile(saved);

    // V6.2 F3: Onboarding 完成时确保行为画像存在
    if (step >= 4) {
      await this.ensureBehaviorProfile(userId);
    }

    // V6 Phase 1.2 + 2.17: 引导步骤保存后发布画像更新事件
    const onboardingFields = Object.keys(dto);
    const onboardingAfter: Record<string, unknown> = {};
    for (const k of onboardingFields) {
      const dbKey = this.camelToSnake(k);
      onboardingAfter[k] = (saved as any)[dbKey];
    }
    this.eventEmitter.emit(
      DomainEvents.PROFILE_UPDATED,
      new ProfileUpdatedEvent(
        userId,
        'declared',
        'manual',
        onboardingFields,
        {}, // 引导流无前值
        onboardingAfter,
        `引导步骤 ${step} 完成`,
      ),
    );

    return {
      profile: saved as any,
      computed: {
        bmr: computed?.estimated_bmr ?? undefined,
        tdee: computed?.estimated_tdee ?? undefined,
        recommendedCalories: computed?.recommended_calories ?? undefined,
      },
      nextStep: step < 4 ? step + 1 : null,
      completeness: Number(saved.data_completeness),
    };
  }

  /**
   * 跳过引导步骤
   */
  async skipOnboardingStep(
    userId: string,
    step: number,
  ): Promise<{ nextStep: number | null; completeness: number }> {
    let profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });

    const updateData: any = {
      onboarding_step: step,
    };

    if (step >= 4) {
      updateData.onboarding_completed = true;
    }

    if (profile) {
      // Compute completeness with merged data
      const merged = { ...profile, ...updateData };
      updateData.data_completeness = this.calculateCompleteness(merged as any);
      profile = await this.updateProfileWithVersion(userId, updateData);
    } else {
      updateData.user_id = userId;
      updateData.data_completeness = this.calculateCompleteness(
        updateData as any,
      );
      profile = await this.prisma.user_profiles.create({
        data: updateData,
      });
    }

    // V6.2 F3: 跳过引导完成时也需同步推断画像、创建行为画像、发布事件
    if (step >= 4) {
      // 失效缓存
      this.profileCacheService.invalidate(userId);

      // 同步推断数据（基于已有的 profile 字段计算 BMR/TDEE）
      await this.syncInferredProfile(profile);

      // 确保行为画像存在
      await this.ensureBehaviorProfile(userId);

      // 发布画像更新事件，通知下游服务
      this.eventEmitter.emit(
        DomainEvents.PROFILE_UPDATED,
        new ProfileUpdatedEvent(
          userId,
          'declared',
          'manual',
          ['onboarding_completed'],
          {},
          { onboarding_completed: true },
          `引导步骤 ${step} 跳过完成`,
        ),
      );
    }

    return {
      nextStep: step < 4 ? step + 1 : null,
      completeness: Number(profile!.data_completeness),
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
      this.prisma.user_profiles.findUnique({ where: { user_id: userId } }),
      this.prisma.user_behavior_profiles.findUnique({
        where: { user_id: userId },
      }),
      this.prisma.user_inferred_profiles.findUnique({
        where: { user_id: userId },
      }),
    ]);

    return {
      declared: declared as any,
      observed: observed as any,
      inferred: inferred as any,
      meta: {
        completeness: Number(declared?.data_completeness ?? 0),
        onboardingStep: declared?.onboarding_step ?? 0,
        profileVersion: declared?.profile_version ?? 1,
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
    let profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });

    const mappedData = this.mapDtoToDbFields(dto);

    if (!profile) {
      profile = { user_id: userId } as any;
    }

    const oldProfile = { ...profile };
    const merged = { ...profile, ...mappedData };

    // 重算热量（如果体重/身高/目标等变化且用户未手动设定）
    if (
      (dto.weightKg || dto.heightCm || dto.goal || dto.activityLevel) &&
      !dto.dailyCalorieGoal &&
      merged.gender &&
      merged.birth_year &&
      merged.height_cm &&
      merged.weight_kg
    ) {
      (merged as any).daily_calorie_goal = this.calculateDailyGoal(
        merged as any,
      );
    }

    (merged as any).data_completeness = this.calculateCompleteness(
      merged as any,
    );

    let saved: any;
    const existing = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    if (existing) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(merged) as any,
      );
    } else {
      saved = await this.prisma.user_profiles.create({
        data: this.extractWritableFields(merged) as any,
      });
    }

    // V5 3.1: 体重变化时记录历史
    if (dto.weightKg && Number(oldProfile.weight_kg) !== Number(dto.weightKg)) {
      await this.recordWeightHistory(
        userId,
        Number(dto.weightKg),
        dto.bodyFatPercent != null
          ? Number(dto.bodyFatPercent)
          : saved.body_fat_percent != null
            ? Number(saved.body_fat_percent)
            : null,
        'manual',
      );
    }

    // 失效缓存
    this.profileCacheService.invalidate(userId);

    await this.createSnapshotIfNeeded(userId, oldProfile, saved);
    await this.syncInferredProfile(saved);

    // V6 Phase 1.2: 发布画像更新事件（含变更字段信息）
    const changedFields = Object.keys(dto).filter((k) => {
      const dbKey = this.camelToSnake(k);
      return (
        JSON.stringify((oldProfile as any)[dbKey]) !==
        JSON.stringify((saved as any)[dbKey])
      );
    });
    // V6 2.17: 构建变更前后值
    const declaredBefore: Record<string, unknown> = {};
    const declaredAfter: Record<string, unknown> = {};
    for (const k of changedFields) {
      const dbKey = this.camelToSnake(k);
      declaredBefore[k] = (oldProfile as any)[dbKey];
      declaredAfter[k] = (saved as any)[dbKey];
    }
    this.eventEmitter.emit(
      DomainEvents.PROFILE_UPDATED,
      new ProfileUpdatedEvent(
        userId,
        'declared',
        'manual',
        changedFields,
        declaredBefore,
        declaredAfter,
        '用户更新声明画像',
      ),
    );

    return saved as any;
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
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
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
      currentCompleteness: Number(profile.data_completeness),
    };
  }

  /**
   * 获取每日热量目标
   */
  async getDailyCalorieGoal(userId: string): Promise<number> {
    const profile = await this.getProfile(userId);
    if (profile?.daily_calorie_goal) return profile.daily_calorie_goal;

    // 无档案时返回默认值
    return 2000;
  }

  /**
   * Harris-Benedict 公式计算每日热量目标
   * 根据 goal 和 goalSpeed 动态调整热量缺口/盈余
   */
  /**
   * Harris-Benedict 公式计算每日热量目标
   * 根据 goal 和 goalSpeed 动态调整热量缺口/盈余
   */
  calculateDailyGoal(profile: any): number {
    const bmr = this.calculateBMR(profile);
    const tdee = this.calculateTDEE(
      bmr,
      profile.activity_level ?? profile.activityLevel,
      profile.exercise_profile ?? profile.exerciseProfile,
      Number(profile.weight_kg ?? profile.weightKg) || undefined,
    );
    return this.calculateRecommendedCalories(
      tdee,
      profile.goal,
      profile.goal_speed ?? profile.goalSpeed,
      profile.gender,
    );
  }

  /**
   * 构建用户档案上下文字符串，供 AI 使用
   */
  buildUserContext(profile: any): string {
    const lines: string[] = [];
    const g = (camel: string, snake: string) =>
      profile[snake] ?? profile[camel];
    if (g('gender', 'gender'))
      lines.push(`性别: ${g('gender', 'gender') === 'male' ? '男' : '女'}`);
    if (g('birthYear', 'birth_year'))
      lines.push(
        `年龄: ${new Date().getFullYear() - g('birthYear', 'birth_year')}岁`,
      );
    if (g('heightCm', 'height_cm'))
      lines.push(`身高: ${g('heightCm', 'height_cm')}cm`);
    if (g('weightKg', 'weight_kg'))
      lines.push(`体重: ${g('weightKg', 'weight_kg')}kg`);
    if (g('targetWeightKg', 'target_weight_kg'))
      lines.push(`目标体重: ${g('targetWeightKg', 'target_weight_kg')}kg`);
    if (g('bodyFatPercent', 'body_fat_percent'))
      lines.push(`体脂率: ${g('bodyFatPercent', 'body_fat_percent')}%`);
    if (g('goal', 'goal')) lines.push(`目标: ${g('goal', 'goal')}`);
    if (g('goalSpeed', 'goal_speed'))
      lines.push(`目标节奏: ${g('goalSpeed', 'goal_speed')}`);
    if (g('dailyCalorieGoal', 'daily_calorie_goal'))
      lines.push(
        `每日热量目标: ${g('dailyCalorieGoal', 'daily_calorie_goal')}kcal`,
      );
    if (g('mealsPerDay', 'meals_per_day'))
      lines.push(`每日餐次: ${g('mealsPerDay', 'meals_per_day')}`);
    if (g('takeoutFrequency', 'takeout_frequency'))
      lines.push(`外卖频率: ${g('takeoutFrequency', 'takeout_frequency')}`);
    const canCook = g('canCook', 'can_cook');
    if (canCook !== undefined) lines.push(`会做饭: ${canCook ? '是' : '否'}`);
    const foodPrefs = g('foodPreferences', 'food_preferences');
    if (foodPrefs?.length) lines.push(`饮食偏好: ${foodPrefs.join(', ')}`);
    const dietRestrictions = g('dietaryRestrictions', 'dietary_restrictions');
    if (dietRestrictions?.length)
      lines.push(`忌口: ${dietRestrictions.join(', ')}`);
    const allergens = g('allergens', 'allergens');
    if (allergens?.length) lines.push(`⚠️过敏原: ${allergens.join(', ')}`);
    const healthConds = g('healthConditions', 'health_conditions');
    if (healthConds?.length) lines.push(`健康状况: ${healthConds.join(', ')}`);
    const weakSlots = g('weakTimeSlots', 'weak_time_slots');
    if (weakSlots?.length) lines.push(`容易乱吃时段: ${weakSlots.join(', ')}`);
    const triggers = g('bingeTriggers', 'binge_triggers');
    if (triggers?.length) lines.push(`暴食触发: ${triggers.join(', ')}`);
    if (g('discipline', 'discipline'))
      lines.push(`自律程度: ${g('discipline', 'discipline')}`);
    return lines.join('\n');
  }

  // ==================== 内部方法 ====================

  /**
   * V5 Phase 3.1: 记录体重历史
   * 当体重发生变化时插入一条 weight_history 记录，支撑 goalProgress 趋势分析
   */
  private async recordWeightHistory(
    userId: string,
    weightKg: number,
    bodyFatPercent: number | null | undefined,
    source: 'manual' | 'device' | 'onboarding',
  ): Promise<void> {
    try {
      await this.prisma.weight_history.create({
        data: {
          user_id: userId,
          weight_kg: weightKg,
          body_fat_percent: bodyFatPercent ?? null,
          source,
        },
      });
      this.logger.debug(
        `用户 ${userId} 体重历史已记录: ${weightKg}kg (${source})`,
      );
    } catch (err) {
      // 体重记录失败不阻塞主流程
      this.logger.warn(
        `用户 ${userId} 体重历史记录失败: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 计算数据完整度（加权）
   */
  calculateCompleteness(profile: any): number {
    const totalWeight = Object.values(FIELD_WEIGHTS).reduce((a, b) => a + b, 0);
    let filledWeight = 0;

    // Map camelCase field names to snake_case for Prisma records
    const fieldMapping: Record<string, string> = {
      gender: 'gender',
      birthYear: 'birth_year',
      heightCm: 'height_cm',
      weightKg: 'weight_kg',
      goal: 'goal',
      activityLevel: 'activity_level',
      targetWeightKg: 'target_weight_kg',
      mealsPerDay: 'meals_per_day',
      dietaryRestrictions: 'dietary_restrictions',
      allergens: 'allergens',
      foodPreferences: 'food_preferences',
      takeoutFrequency: 'takeout_frequency',
      discipline: 'discipline',
      weakTimeSlots: 'weak_time_slots',
      bingeTriggers: 'binge_triggers',
      canCook: 'can_cook',
      exerciseProfile: 'exercise_profile',
      cookingSkillLevel: 'cooking_skill_level',
      healthConditions: 'health_conditions',
      budgetLevel: 'budget_level',
      tasteIntensity: 'taste_intensity',
    };

    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const snakeField = fieldMapping[field] || field;
      // Support both camelCase and snake_case
      const value = profile[snakeField] ?? profile[field];
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
    oldProfile: any,
    newProfile: any,
  ): Promise<void> {
    // Map camelCase critical fields to snake_case
    const criticalFieldMapping: Record<string, string> = {
      goal: 'goal',
      goalSpeed: 'goal_speed',
      weightKg: 'weight_kg',
      allergens: 'allergens',
      dietaryRestrictions: 'dietary_restrictions',
      healthConditions: 'health_conditions',
    };

    const changed = CRITICAL_FIELDS.filter((f) => {
      const dbField = criticalFieldMapping[f] || f;
      const oldVal = oldProfile[dbField];
      const newVal = newProfile[dbField];
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

    await this.prisma.profile_snapshots.create({
      data: {
        user_id: userId,
        snapshot: oldProfile as any,
        trigger_type: triggerType,
        changed_fields: changed,
      },
    });

    this.logger.log(
      `用户 ${userId} 关键字段变更快照已创建: [${changed.join(', ')}]`,
    );
  }

  /**
   * 同步更新推断数据（BMR/TDEE/macroTargets）
   */
  private async syncInferredProfile(profile: any): Promise<any | null> {
    const gender = profile.gender;
    const birthYear = profile.birth_year ?? profile.birthYear;
    const heightCm = profile.height_cm ?? profile.heightCm;
    const weightKg = profile.weight_kg ?? profile.weightKg;
    const userId = profile.user_id ?? profile.userId;

    if (!gender || !birthYear || !heightCm || !weightKg) {
      return null;
    }

    const inferred = await this.prisma.user_inferred_profiles.findUnique({
      where: { user_id: userId },
    });

    const bmr = this.calculateBMR(profile);
    const activityLevel = profile.activity_level ?? profile.activityLevel;
    const exerciseProfile = profile.exercise_profile ?? profile.exerciseProfile;
    const goal = profile.goal;
    const goalSpeed = profile.goal_speed ?? profile.goalSpeed;
    const bodyFatPercent = profile.body_fat_percent ?? profile.bodyFatPercent;

    const tdee = this.calculateTDEE(
      bmr,
      activityLevel,
      exerciseProfile,
      Number(weightKg) || undefined,
    );
    const recommendedCalories = this.calculateRecommendedCalories(
      tdee,
      goal,
      goalSpeed,
      gender,
    );

    const macroTargets = this.calculateMacroTargets(recommendedCalories, goal);

    // 置信度 — exerciseProfile 可用时 TDEE 精度更高
    const hasExerciseDetail =
      exerciseProfile?.type &&
      exerciseProfile.type !== 'none' &&
      exerciseProfile.frequencyPerWeek &&
      exerciseProfile.avgDurationMinutes;
    const confidenceScores = {
      ...((inferred?.confidence_scores as any) || {}),
      // V4: bodyFatPercent 现在直接影响 BMR 公式选择 (Katch-McArdle vs Harris-Benedict)
      estimatedBMR: bodyFatPercent ? 0.95 : 0.85,
      estimatedTDEE: hasExerciseDetail ? 0.9 : 0.8,
      recommendedCalories: hasExerciseDetail ? 0.88 : 0.8,
      macroTargets: 0.75,
    };

    const data = {
      estimated_bmr: Math.round(bmr),
      estimated_tdee: Math.round(tdee),
      recommended_calories: recommendedCalories,
      macro_targets: macroTargets as any,
      last_computed_at: new Date(),
      confidence_scores: confidenceScores as any,
    };

    if (inferred) {
      return this.prisma.user_inferred_profiles.update({
        where: { user_id: userId },
        data,
      });
    } else {
      return this.prisma.user_inferred_profiles.create({
        data: {
          user_id: userId,
          ...data,
        },
      });
    }
  }

  /**
   * V6.2 F3: 确保用户行为画像存在（Onboarding 完成时调用）
   * 使用 findUnique + create 模式避免重复创建
   */
  private async ensureBehaviorProfile(userId: string): Promise<void> {
    const existing = await this.prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!existing) {
      await this.prisma.user_behavior_profiles.create({
        data: { user_id: userId },
      });
      this.logger.log(
        `Created behavior profile for user ${userId} on onboarding completion`,
      );
    }
  }

  /**
   * 计算 BMR
   *
   * V4 Phase 3.3: 当 bodyFatPercent 可用时使用 Katch-McArdle 公式
   *   BMR = 370 + 21.6 × LeanBodyMass(kg)
   *   LeanBodyMass = weight × (1 - bodyFatPercent / 100)
   *
   * 回退: 无体脂数据时使用 Harris-Benedict 公式（原逻辑）
   */
  private calculateBMR(profile: any): number {
    const weight = Number(profile.weight_kg ?? profile.weightKg) || 65;
    const bodyFatPercent = profile.body_fat_percent ?? profile.bodyFatPercent;

    // Katch-McArdle: 当体脂率可用且在合理范围 (3%~60%)
    if (bodyFatPercent != null && bodyFatPercent >= 3 && bodyFatPercent <= 60) {
      const leanMass = weight * (1 - bodyFatPercent / 100);
      return 370 + 21.6 * leanMass;
    }

    // Harris-Benedict fallback
    const birthYear = profile.birth_year ?? profile.birthYear ?? 1990;
    const age = new Date().getFullYear() - birthYear;
    const height = Number(profile.height_cm ?? profile.heightCm) || 170;

    return profile.gender === 'male'
      ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
      : 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age;
  }

  /**
   * 计算 TDEE
   * 当 exerciseProfile 可用时，采用"基础活动乘数 + 运动消耗叠加"精细计算:
   *   TDEE = BMR × NEAT乘数 + 日均运动消耗(EAT)
   * 其中 EAT = (MET-1) × weightKg × durationHours × frequencyPerWeek / 7
   * MET 值参考 ACSM: cardio=6.0, strength=5.0, mixed=5.5
   *
   * 无 exerciseProfile 时回退到经典 activityLevel 粗粒度乘数
   */
  private calculateTDEE(
    bmr: number,
    activityLevel: ActivityLevel,
    exerciseProfile?: {
      type?: 'none' | 'cardio' | 'strength' | 'mixed';
      frequencyPerWeek?: number;
      avgDurationMinutes?: number;
    },
    weightKg?: number,
  ): number {
    // 如果有可用的运动详情，使用精细计算
    const hasExerciseData =
      exerciseProfile &&
      exerciseProfile.type &&
      exerciseProfile.type !== 'none' &&
      exerciseProfile.frequencyPerWeek &&
      exerciseProfile.frequencyPerWeek > 0 &&
      exerciseProfile.avgDurationMinutes &&
      exerciseProfile.avgDurationMinutes > 0;

    if (hasExerciseData && weightKg) {
      // NEAT 乘数（仅日常活动，不含运动）
      const neatMultiplier: Record<string, number> = {
        [ActivityLevel.SEDENTARY]: 1.2,
        [ActivityLevel.LIGHT]: 1.3,
        [ActivityLevel.MODERATE]: 1.4,
        [ActivityLevel.ACTIVE]: 1.5,
      };

      // 运动类型 MET 值（中等强度参考 ACSM）
      const metValues: Record<string, number> = {
        cardio: 6.0,
        strength: 5.0,
        mixed: 5.5,
      };

      const neat = neatMultiplier[activityLevel] || 1.3;
      const met = metValues[exerciseProfile.type!] || 5.5;
      const durationHours = exerciseProfile.avgDurationMinutes! / 60;
      const frequency = exerciseProfile.frequencyPerWeek!;

      // 每次运动消耗 = (MET - 1) × 体重 × 时长
      // 减 1 是因为 BMR 已经包含了静息代谢
      const perSessionCal = (met - 1) * weightKg * durationHours;
      // 折算日均
      const dailyExerciseCal = (perSessionCal * frequency) / 7;

      return bmr * neat + dailyExerciseCal;
    }

    // 回退：无运动详情时使用经典粗粒度乘数
    const classicMultiplier: Record<string, number> = {
      [ActivityLevel.SEDENTARY]: 1.2,
      [ActivityLevel.LIGHT]: 1.375,
      [ActivityLevel.MODERATE]: 1.55,
      [ActivityLevel.ACTIVE]: 1.725,
    };
    return bmr * (classicMultiplier[activityLevel] || 1.375);
  }

  /**
   * 计算推荐摄入热量
   * V5 Phase 1.7: 增加安全下限保护（女性 1200 kcal / 男性 1500 kcal）
   */
  private calculateRecommendedCalories(
    tdee: number,
    goal: GoalType,
    goalSpeed: GoalSpeed,
    gender?: string,
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
    const raw = Math.round(tdee * (goalMult + speedMod));

    // 安全下限：女性 1200 kcal，男性 1500 kcal，性别未知取 1200
    const minCalories = gender === 'male' ? 1500 : 1200;
    return Math.max(raw, minCalories);
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

  // ==================== Prisma 辅助方法 ====================

  /** camelCase → snake_case */
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /** Map DTO (camelCase) fields to DB (snake_case) fields */
  private mapDtoToDbFields(dto: Record<string, any>): Record<string, any> {
    const mapped: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      mapped[this.camelToSnake(key)] = value;
    }
    return mapped;
  }

  /** Extract writable fields for Prisma create/update (excludes id) */
  private extractWritableFields(profile: any): Record<string, any> {
    const data: Record<string, any> = {};
    const skipFields = ['id', 'created_at', 'updated_at', 'profile_version'];
    for (const [key, value] of Object.entries(profile)) {
      if (skipFields.includes(key)) continue;
      if (value === undefined) continue;
      data[key] = value;
    }
    return data;
  }

  /**
   * V6.2 3.7: 原子递增 profile_version 的 update 包装
   *
   * 使用 Prisma 的 `increment` 操作确保并发安全。
   * profile_version 被 extractWritableFields 排除，
   * 避免被覆盖为旧值。
   */
  private async updateProfileWithVersion(
    userId: string,
    data: Record<string, any>,
  ): Promise<any> {
    return this.prisma.user_profiles.update({
      where: { user_id: userId },
      data: {
        ...data,
        profile_version: { increment: 1 },
      },
    });
  }

  // ================================================================
  //  V6.5 Phase 3F: 用户推荐偏好设置
  // ================================================================

  /**
   * 保存/更新用户推荐偏好
   *
   * 存入 user_profiles.recommendation_preferences JSON 字段，
   * 供 StrategyResolver 在策略合并时作为 realism 覆盖层。
   */
  async updateRecommendationPreferences(
    userId: string,
    dto: UpdateRecommendationPreferencesDto,
  ): Promise<RecommendationPreferences> {
    const prefs: RecommendationPreferences = {};
    if (dto.popularityPreference)
      prefs.popularityPreference = dto.popularityPreference;
    if (dto.cookingEffort) prefs.cookingEffort = dto.cookingEffort;
    if (dto.budgetSensitivity) prefs.budgetSensitivity = dto.budgetSensitivity;
    // V7.2 P3-B: 复制现实性级别偏好
    if (dto.realismLevel) prefs.realismLevel = dto.realismLevel;

    await this.prisma.user_profiles.update({
      where: { user_id: userId },
      data: { recommendation_preferences: prefs as any },
    });

    this.logger.log(
      `用户推荐偏好已更新 userId=${userId}: ${JSON.stringify(prefs)}`,
    );

    // 清除画像缓存以便下次推荐使用最新偏好
    this.profileCacheService.invalidate(userId);

    return prefs;
  }

  /**
   * 获取用户推荐偏好（从 DB 读取，未设置则返回空对象）
   */
  async getRecommendationPreferences(
    userId: string,
  ): Promise<RecommendationPreferences> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
      select: { recommendation_preferences: true },
    });

    return (
      (profile?.recommendation_preferences as RecommendationPreferences) ?? {}
    );
  }

  /**
   * 将用户推荐偏好转换为 RealismConfig 覆盖
   *
   * 映射规则：
   * - popularityPreference: popular→threshold=40, balanced→不覆盖, adventurous→threshold=5
   * - cookingEffort: quick→weekday=30/weekend=60, moderate→weekday=60/weekend=120, elaborate→不启用
   * - budgetSensitivity: budget→启用预算过滤, moderate→不覆盖, unlimited→关闭预算过滤
   *
   * 返回部分 RealismConfig，由策略合并层 merge 到最终配置中。
   * 仅包含用户显式设置的维度，未设置的维度返回 undefined（不覆盖策略默认值）。
   */
  static toRealismOverride(
    prefs: RecommendationPreferences,
  ): Record<string, any> {
    const override: Record<string, any> = {};

    // 大众化偏好 → commonalityThreshold
    switch (prefs.popularityPreference) {
      case PopularityPreference.POPULAR:
        override.commonalityThreshold = 40;
        break;
      case PopularityPreference.ADVENTUROUS:
        override.commonalityThreshold = 5;
        override.executabilityWeightMultiplier = 0.7;
        break;
      // BALANCED → 不覆盖
    }

    // 烹饪投入 → cookTimeCap
    switch (prefs.cookingEffort) {
      case CookingEffort.QUICK:
        override.cookTimeCapEnabled = true;
        override.weekdayCookTimeCap = 30;
        override.weekendCookTimeCap = 60;
        break;
      case CookingEffort.MODERATE:
        override.cookTimeCapEnabled = true;
        override.weekdayCookTimeCap = 60;
        override.weekendCookTimeCap = 120;
        break;
      case CookingEffort.ELABORATE:
        override.cookTimeCapEnabled = false;
        break;
    }

    // 预算敏感度 → budgetFilter
    switch (prefs.budgetSensitivity) {
      case BudgetSensitivity.BUDGET:
        override.budgetFilterEnabled = true;
        break;
      case BudgetSensitivity.UNLIMITED:
        override.budgetFilterEnabled = false;
        break;
      // MODERATE → 不覆盖
    }

    // V7.2 P3-B: realismLevel 预设 → 作为全局覆盖
    // 优先级高于上面的单维度覆盖：如果用户同时设置了 realismLevel 和 cookingEffort，
    // realismLevel 的 cookTimeCap 会覆盖 cookingEffort 的设置
    if (prefs.realismLevel && prefs.realismLevel !== 'normal') {
      switch (prefs.realismLevel) {
        case 'strict':
          // 强制收紧：大众化≥40, 预算+烹饪时间都启用, 上限收紧
          override.commonalityThreshold = Math.max(
            override.commonalityThreshold ?? 0,
            40,
          );
          override.budgetFilterEnabled = true;
          override.cookTimeCapEnabled = true;
          override.weekdayCookTimeCap = Math.min(
            override.weekdayCookTimeCap ?? 45,
            30,
          );
          override.weekendCookTimeCap = Math.min(
            override.weekendCookTimeCap ?? 120,
            60,
          );
          override.canteenMode = true;
          break;
        case 'relaxed':
          // 放宽：大众化阈值降低, 关闭预算和时间过滤
          override.commonalityThreshold = Math.min(
            override.commonalityThreshold ?? 20,
            10,
          );
          override.budgetFilterEnabled = false;
          override.cookTimeCapEnabled = false;
          break;
        case 'off':
          // 关闭所有现实性过滤
          override.enabled = false;
          break;
      }
    }

    return override;
  }

  /**
   * V7.1 P3-B: 获取用户厨房设备画像
   *
   * 从 user_profiles.kitchen_profile (JSON) 读取。
   * 无数据时返回 null（调用方应使用 DEFAULT_KITCHEN_PROFILE 兜底）。
   */
  async getKitchenProfile(userId: string): Promise<KitchenProfile | null> {
    try {
      const profile = await this.prisma.user_profiles.findUnique({
        where: { user_id: userId },
        select: { kitchen_profile: true },
      });

      if (!profile?.kitchen_profile) return null;

      const raw = profile.kitchen_profile as Record<string, unknown>;
      // 验证必要字段存在，兜底填充默认值
      return {
        hasOven:
          typeof raw.hasOven === 'boolean'
            ? raw.hasOven
            : DEFAULT_KITCHEN_PROFILE.hasOven,
        hasMicrowave:
          typeof raw.hasMicrowave === 'boolean'
            ? raw.hasMicrowave
            : DEFAULT_KITCHEN_PROFILE.hasMicrowave,
        hasAirFryer:
          typeof raw.hasAirFryer === 'boolean'
            ? raw.hasAirFryer
            : DEFAULT_KITCHEN_PROFILE.hasAirFryer,
        hasSteamer:
          typeof raw.hasSteamer === 'boolean'
            ? raw.hasSteamer
            : DEFAULT_KITCHEN_PROFILE.hasSteamer,
        hasRiceCooker:
          typeof raw.hasRiceCooker === 'boolean'
            ? raw.hasRiceCooker
            : DEFAULT_KITCHEN_PROFILE.hasRiceCooker,
        primaryStove:
          typeof raw.primaryStove === 'string'
            ? (raw.primaryStove as KitchenProfile['primaryStove'])
            : DEFAULT_KITCHEN_PROFILE.primaryStove,
      };
    } catch {
      return null;
    }
  }
}
