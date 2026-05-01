import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
} from '../../../user.types';
import { UserProfiles as UserProfile } from '@prisma/client';
import {
  updateInferred,
  updateBehavior,
  getInferred,
  getBehavior,
  InferredData,
  BehaviorData,
} from '../../../user-profile-merge.helper';
import { ProfileCacheService } from './profile-cache.service';
import { getRegionMacroBias } from '../../../../../common/config/regional-defaults';
import {
  OnboardingStep1Dto,
  OnboardingStep2Dto,
  OnboardingStep3Dto,
  OnboardingStep4Dto,
  UpdateDeclaredProfileDto,
  UpdateRecommendationPreferencesDto,
} from '../../dto/user-profile.dto';
import { SaveUserProfileDto } from '../../../../diet/app/dto/food.dto';
import {
  DomainEvents,
  ProfileUpdatedEvent,
  UserRegionChangedEvent,
} from '../../../../../core/events/domain-events';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../../core/i18n';
import { ProfileChangeLogService } from './profile-change-log.service';
import { RequestContextService } from '../../../../../core/context/request-context.service';

const DELETE_ACCOUNT_CONFIRMATION_TEXT = 'DELETE';

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
    private readonly i18n: I18nService,
    private readonly profileChangeLogService: ProfileChangeLogService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * 获取用户档案
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    }) as any;
  }

  /**
   * 获取用户时区（IANA 格式），无档案时返回默认值 Asia/Shanghai
   */
  async getTimezone(userId: string): Promise<string> {
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
      select: { timezone: true },
    });
    return profile?.timezone || 'Asia/Shanghai';
  }

  async deleteAccount(userId: string, confirmationText: string): Promise<void> {
    if (confirmationText.trim() != DELETE_ACCOUNT_CONFIRMATION_TEXT) {
      throw new BadRequestException('Invalid delete confirmation text');
    }

    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
      select: {
        id: true,
        authType: true,
        email: true,
        phone: true,
        nickname: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        this.i18n.t('user.userNotFound', { id: userId }),
      );
    }

    await this.profileChangeLogService.createLog({
      userId,
      changeType: 'account',
      source: 'manual',
      changedFields: ['account'],
      beforeValues: {
        status: 'active',
        authType: user.authType,
        email: user.email,
        phone: user.phone,
        nickname: user.nickname,
        createdAt: user.createdAt.toISOString(),
      } as any,
      afterValues: {
        status: 'deleted',
      } as any,
      triggerEvent: 'app.user.delete_account',
      reason: '用户主动删除账号',
      metadata: {
        requestId: this.requestContext.requestId,
        locale: this.requestContext.locale,
        confirmationText,
      } as any,
    });

    await this.prisma.appUsers.delete({ where: { id: userId } });
    this.profileCacheService.invalidate(userId);
  }

  /**
   * 创建或更新用户档案（兼容旧 API）
   */
  async saveProfile(
    userId: string,
    dto: SaveUserProfileDto,
  ): Promise<UserProfile> {
    let profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    const oldProfile = profile ? { ...profile } : null;

    if (profile) {
      profile = { ...profile, ...dto } as any;
    } else {
      profile = { userId: userId, ...dto } as any;
    }

    // 强制重算热量：忽略客户端传入值，始终由服务端根据体征计算
    if (
      profile!.gender &&
      profile!.birthYear &&
      profile!.heightCm &&
      profile!.weightKg
    ) {
      (profile as any).dailyCalorieGoal = this.calculateDailyGoal(
        profile as any,
      );
    }

    // 更新完整度
    (profile as any).dataCompleteness = this.calculateCompleteness(
      profile as any,
    );

    let saved: any;
    if (oldProfile) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(profile) as any,
      );
    } else {
      saved = await this.prisma.userProfiles.create({
        data: this.extractWritableFields(profile) as any,
      });
    }

    // V5 3.1: 体重变化时记录历史
    if (
      dto.weightKg &&
      (!oldProfile || Number(oldProfile.weightKg) !== Number(dto.weightKg))
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
      beforeVals[k] = oldProfile ? (oldProfile as any)[k] : null;
      afterVals[k] = saved[k];
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
    let profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });

    if (!profile) {
      profile = { userId: userId, ...dto } as any;
    } else {
      profile = { ...profile, ...dto } as any;
    }

    // 合并步骤数据
    (profile as any).onboardingStep = step;

    // Step 2 完成后即可计算 BMR
    if (
      step >= 2 &&
      profile!.gender &&
      profile!.birthYear &&
      profile!.heightCm &&
      profile!.weightKg &&
      !profile!.dailyCalorieGoal
    ) {
      (profile as any).dailyCalorieGoal = this.calculateDailyGoal(
        profile as any,
      );
    }

    // Step 4 完成 → 标记引导完成
    if (step >= 4) {
      (profile as any).onboardingCompleted = true;
    }

    (profile as any).dataCompleteness = this.calculateCompleteness(
      profile as any,
    );

    let saved: any;
    const existing = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    if (existing) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(profile) as any,
      );
    } else {
      saved = await this.prisma.userProfiles.create({
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
      onboardingAfter[k] = saved[k];
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
      profile: saved,
      computed: {
        bmr: computed?.estimatedBmr ?? undefined,
        tdee: computed?.estimatedTdee ?? undefined,
        recommendedCalories: computed?.recommendedCalories ?? undefined,
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
    let profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });

    const updateData: any = {
      onboardingStep: step,
    };

    if (step >= 4) {
      updateData.onboardingCompleted = true;
    }

    if (profile) {
      // Compute completeness with merged data
      const merged = { ...profile, ...updateData };
      updateData.dataCompleteness = this.calculateCompleteness(merged);
      profile = await this.updateProfileWithVersion(userId, updateData);
    } else {
      updateData.userId = userId;
      updateData.dataCompleteness = this.calculateCompleteness(updateData);
      profile = await this.prisma.userProfiles.create({
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
          ['onboardingCompleted'],
          {},
          { onboardingCompleted: true },
          `引导步骤 ${step} 跳过完成`,
        ),
      );
    }

    return {
      nextStep: step < 4 ? step + 1 : null,
      completeness: Number(profile!.dataCompleteness),
    };
  }

  // ==================== 完整画像 ====================

  /**
   * 获取聚合画像（声明 + 行为 + 推断）
   */
  async getFullProfile(userId: string): Promise<{
    declared: UserProfile | null;
    observed: BehaviorData | null;
    inferred: InferredData | null;
    meta: {
      completeness: number;
      onboardingStep: number;
      profileVersion: number;
    };
  }> {
    const declared = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });

    const observed = declared ? getBehavior(declared) : null;
    const inferred = declared ? getInferred(declared) : null;

    return {
      declared: declared as any,
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
    let profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });

    if (!profile) {
      profile = { userId: userId } as any;
    }

    const oldProfile = { ...profile };
    const merged = { ...profile, ...dto };

    // 强制重算热量：忽略客户端传入的 dailyCalorieGoal，始终由服务端根据体征计算
    // 体征完整（gender/birthYear/heightCm/weightKg）时必算
    if (
      merged.gender &&
      merged.birthYear &&
      merged.heightCm &&
      merged.weightKg
    ) {
      (merged as any).dailyCalorieGoal = this.calculateDailyGoal(merged as any);
    }

    (merged as any).dataCompleteness = this.calculateCompleteness(
      merged as any,
    );

    let saved: any;
    const existing = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    if (existing) {
      saved = await this.updateProfileWithVersion(
        userId,
        this.extractWritableFields(merged) as any,
      );
    } else {
      saved = await this.prisma.userProfiles.create({
        data: this.extractWritableFields(merged) as any,
      });
    }

    // V5 3.1: 体重变化时记录历史
    if (dto.weightKg && Number(oldProfile.weightKg) !== Number(dto.weightKg)) {
      await this.recordWeightHistory(
        userId,
        Number(dto.weightKg),
        dto.bodyFatPercent != null
          ? Number(dto.bodyFatPercent)
          : saved.bodyFatPercent != null
            ? Number(saved.bodyFatPercent)
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
      return (
        JSON.stringify((oldProfile as any)[k]) !== JSON.stringify(saved[k])
      );
    });
    // V6 2.17: 构建变更前后值
    const declaredBefore: Record<string, unknown> = {};
    const declaredAfter: Record<string, unknown> = {};
    for (const k of changedFields) {
      declaredBefore[k] = (oldProfile as any)[k];
      declaredAfter[k] = saved[k];
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

    // 区域+时区优化（深度分析 P0-2）：regionCode 变更触发独立事件，
    // 下游清画像缓存 + regional boost map 残留
    const oldRegion = (oldProfile as any).regionCode ?? null;
    const newRegion = (saved as any).regionCode ?? null;
    if (newRegion && oldRegion !== newRegion) {
      this.eventEmitter.emit(
        DomainEvents.USER_REGION_CHANGED,
        new UserRegionChangedEvent(
          userId,
          oldRegion,
          newRegion,
          'profile_update',
        ),
      );
    }

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
      /** V5.2: 影响级别 — safety=影响食物安全检测, accuracy=影响推荐准确度, optional=锦上添花 */
      impactLevel: 'safety' | 'accuracy' | 'optional';
    }>;
    currentCompleteness: number;
  }> {
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    if (!profile) {
      return { suggestions: [], currentCompleteness: 0 };
    }

    const suggestions: Array<{
      field: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
      estimatedImpact: string;
      impactLevel: 'safety' | 'accuracy' | 'optional';
    }> = [];

    const t = (key: string) => this.i18n.t(`user.${key}`);
    const fieldMeta: Record<
      string,
      {
        priority: 'high' | 'medium' | 'low';
        reason: string;
        impact: string;
        impactLevel: 'safety' | 'accuracy' | 'optional';
      }
    > = {
      heightCm: {
        priority: 'high',
        reason: t('field.reason.heightForBmr'),
        impact: t('field.impact.bmrAccuracy'),
        impactLevel: 'accuracy',
      },
      weightKg: {
        priority: 'high',
        reason: t('field.reason.weightForBmr'),
        impact: t('field.impact.bmrAccuracy'),
        impactLevel: 'accuracy',
      },
      allergens: {
        priority: 'high',
        reason: t('field.reason.allergiesSafety'),
        impact: t('field.impact.safety'),
        impactLevel: 'safety',
      },
      goal: {
        priority: 'high',
        reason: t('field.reason.goalNutritionStrategy'),
        impact: t('field.impact.goalAccuracy'),
        impactLevel: 'accuracy',
      },
      dietaryRestrictions: {
        priority: 'medium',
        reason: t('field.reason.dietaryFiltering'),
        impact: t('field.impact.dietaryAccuracy'),
        impactLevel: 'safety',
      },
      healthConditions: {
        priority: 'medium',
        reason: t('field.reason.healthConditions'),
        impact: t('field.impact.healthSafetyAccuracy'),
        impactLevel: 'safety',
      },
      discipline: {
        priority: 'medium',
        reason: t('field.reason.constraintTightness'),
        impact: t('field.impact.complianceBoost'),
        impactLevel: 'optional',
      },
      bingeTriggers: {
        priority: 'medium',
        reason: t('field.reason.bingePrevention'),
        impact: t('field.impact.persistenceBoost'),
        impactLevel: 'optional',
      },
      exerciseProfile: {
        priority: 'low',
        reason: t('field.reason.activityCalories'),
        impact: t('field.impact.calorieAccuracy'),
        impactLevel: 'optional',
      },
      cookingSkillLevel: {
        priority: 'low',
        reason: t('field.reason.cookingDifficultyMatch'),
        impact: t('field.impact.feasibility'),
        impactLevel: 'optional',
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
          impactLevel: meta.impactLevel,
        });
      }
    }

    // 按优先级排序（safety 字段优先）
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const impactOrder = { safety: 0, accuracy: 1, optional: 2 };
    suggestions.sort(
      (a, b) =>
        impactOrder[a.impactLevel] - impactOrder[b.impactLevel] ||
        priorityOrder[a.priority] - priorityOrder[b.priority],
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
  /**
   * Harris-Benedict 公式计算每日热量目标
   * 根据 goal 和 goalSpeed 动态调整热量缺口/盈余
   */
  calculateDailyGoal(profile: any): number {
    const bmr = this.calculateBMR(profile);
    const tdee = this.calculateTDEE(
      bmr,
      profile.activityLevel,
      profile.exerciseProfile,
      Number(profile.weightKg) || undefined,
    );
    return this.calculateRecommendedCalories(
      tdee,
      profile.goal,
      profile.goalSpeed,
      profile.gender,
    );
  }

  /**
   * 构建用户档案上下文字符串，供 AI 使用
   */
  buildUserContext(profile: any): string {
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
      await this.prisma.weightHistory.create({
        data: {
          userId: userId,
          weightKg: weightKg,
          bodyFatPercent: bodyFatPercent ?? null,
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

    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const value = profile[field];
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
    const changed = CRITICAL_FIELDS.filter((f) => {
      const oldVal = oldProfile[f];
      const newVal = newProfile[f];
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

    await this.prisma.profileSnapshots.create({
      data: {
        userId: userId,
        snapshot: oldProfile,
        triggerType: triggerType,
        changedFields: changed,
      },
    });

    this.logger.log(
      `用户 ${userId} 关键字段变更快照已创建: [${changed.join(', ')}]`,
    );
  }

  /**
   * 同步更新推断数据（BMR/TDEE/macroTargets）
   */
  private async syncInferredProfile(
    profile: any,
  ): Promise<InferredData | null> {
    const gender = profile.gender;
    const birthYear = profile.birthYear;
    const heightCm = profile.heightCm;
    const weightKg = profile.weightKg;
    const userId = profile.userId;

    if (!gender || !birthYear || !heightCm || !weightKg) {
      return null;
    }

    const existingProfile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    const inferred = existingProfile ? getInferred(existingProfile) : null;

    const bmr = this.calculateBMR(profile);
    const activityLevel = profile.activityLevel;
    const exerciseProfile = profile.exerciseProfile;
    const goal = profile.goal;
    const goalSpeed = profile.goalSpeed;
    const bodyFatPercent = profile.bodyFatPercent;

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

    const macroTargets = this.calculateMacroTargets(
      recommendedCalories,
      goal,
      profile.regionCode ?? null,
    );

    // 置信度 — exerciseProfile 可用时 TDEE 精度更高
    const hasExerciseDetail =
      exerciseProfile?.type &&
      exerciseProfile.type !== 'none' &&
      exerciseProfile.frequencyPerWeek &&
      exerciseProfile.avgDurationMinutes;
    const confidenceScores = {
      ...((inferred?.confidenceScores as any) || {}),
      // V4: bodyFatPercent 现在直接影响 BMR 公式选择 (Katch-McArdle vs Harris-Benedict)
      estimatedBMR: bodyFatPercent ? 0.95 : 0.85,
      estimatedTDEE: hasExerciseDetail ? 0.9 : 0.8,
      recommendedCalories: hasExerciseDetail ? 0.88 : 0.8,
      macroTargets: 0.75,
    };

    const data: Partial<InferredData> = {
      estimatedBmr: Math.round(bmr),
      estimatedTdee: Math.round(tdee),
      recommendedCalories: recommendedCalories,
      macroTargets: macroTargets as any,
      lastComputedAt: new Date(),
      confidenceScores: confidenceScores,
    };

    await updateInferred(this.prisma, userId, data);
    return { ...inferred, ...data } as InferredData;
  }

  /**
   * V6.2 F3: 确保用户行为画像存在（Onboarding 完成时调用）
   * 使用 findUnique + create 模式避免重复创建
   */
  private async ensureBehaviorProfile(userId: string): Promise<void> {
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    const existing = profile ? getBehavior(profile) : null;
    if (!existing) {
      await updateBehavior(this.prisma, userId, {});
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
    const weight = Number(profile.weightKg) || 65;
    const bodyFatPercent = profile.bodyFatPercent;

    // Katch-McArdle: 当体脂率可用且在合理范围 (3%~60%)
    if (bodyFatPercent != null && bodyFatPercent >= 3 && bodyFatPercent <= 60) {
      const leanMass = weight * (1 - bodyFatPercent / 100);
      return 370 + 21.6 * leanMass;
    }

    // Harris-Benedict fallback
    const birthYear = profile.birthYear ?? 1990;
    const age = new Date().getFullYear() - birthYear;
    const height = Number(profile.heightCm) || 170;

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
    regionCode?: string | null,
  ): { proteinG: number; carbG: number; fatG: number } {
    // 不同目标的宏量分配比例 (protein/carb/fat)
    const ratios: Record<string, [number, number, number]> = {
      [GoalType.FAT_LOSS]: [0.35, 0.4, 0.25],
      [GoalType.MUSCLE_GAIN]: [0.4, 0.4, 0.2],
      [GoalType.HEALTH]: [0.25, 0.5, 0.25],
      [GoalType.HABIT]: [0.25, 0.5, 0.25],
    };
    const [pRatio0, cRatio0, fRatio0] =
      ratios[goal] || ratios[GoalType.HEALTH];

    // P3-2.4: 区域 macro 偏置（pp = 百分点）
    // 偏置后做归一化：保证 p+c+f = 1（避免热量漂移）
    const bias = getRegionMacroBias(regionCode);
    let pRatio = pRatio0 + (bias.proteinPct ?? 0) / 100;
    let cRatio = cRatio0 + (bias.carbsPct ?? 0) / 100;
    let fRatio = fRatio0 + (bias.fatPct ?? 0) / 100;
    // 防越界（任一比例不得 < 0.1 / > 0.7，超出则回退到 default）
    if (
      pRatio < 0.1 || pRatio > 0.7 ||
      cRatio < 0.1 || cRatio > 0.7 ||
      fRatio < 0.1 || fRatio > 0.7
    ) {
      pRatio = pRatio0;
      cRatio = cRatio0;
      fRatio = fRatio0;
    }
    // 归一化（防 bias 之和不为 0 的浮点误差）
    const sum = pRatio + cRatio + fRatio;
    if (sum > 0) {
      pRatio /= sum;
      cRatio /= sum;
      fRatio /= sum;
    }

    return {
      proteinG: Math.round((calories * pRatio) / 4),
      carbG: Math.round((calories * cRatio) / 4),
      fatG: Math.round((calories * fRatio) / 9),
    };
  }

  // ==================== Prisma 辅助方法 ====================

  /** Extract writable fields for Prisma create/update (excludes id) */
  private extractWritableFields(profile: any): Record<string, any> {
    const data: Record<string, any> = {};
    const skipFields = ['id', 'createdAt', 'updatedAt', 'profileVersion'];
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
    return this.prisma.userProfiles.update({
      where: { userId: userId },
      data: {
        ...data,
        profileVersion: { increment: 1 },
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
    // FIX: read existing prefs first so a single-field update doesn't wipe all other saved fields
    const existing = await this.getRecommendationPreferences(userId);

    // Build patch — use !== undefined so falsy valid values (e.g. 'off', 'low') are not silently skipped
    const patch: Partial<RecommendationPreferences> = {};
    if (dto.popularityPreference !== undefined)
      patch.popularityPreference = dto.popularityPreference;
    if (dto.cookingEffort !== undefined)
      patch.cookingEffort = dto.cookingEffort;
    if (dto.budgetSensitivity !== undefined)
      patch.budgetSensitivity = dto.budgetSensitivity;
    if (dto.realismLevel !== undefined) patch.realismLevel = dto.realismLevel;
    if (dto.diversityTolerance !== undefined)
      patch.diversityTolerance = dto.diversityTolerance as any;
    if (dto.mealPattern !== undefined)
      patch.mealPattern = dto.mealPattern as any;
    if (dto.flavorOpenness !== undefined)
      patch.flavorOpenness = dto.flavorOpenness as any;

    // Merge with existing
    const merged: RecommendationPreferences = { ...existing, ...patch };

    await this.prisma.userProfiles.upsert({
      where: { userId: userId },
      update: { recommendationPreferences: merged as any },
      create: {
        userId: userId,
        recommendationPreferences: merged as any,
      },
    });

    this.logger.log(
      `用户推荐偏好已更新 userId=${userId}: ${JSON.stringify(merged)}`,
    );

    // 清除画像缓存以便下次推荐使用最新偏好
    this.profileCacheService.invalidate(userId);

    return merged;
  }

  /**
   * 获取用户推荐偏好（从 DB 读取，未设置则返回空对象）
   */
  async getRecommendationPreferences(
    userId: string,
  ): Promise<RecommendationPreferences> {
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
      select: { recommendationPreferences: true },
    });

    return (
      (profile?.recommendationPreferences as RecommendationPreferences) ?? {}
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
      const profile = await this.prisma.userProfiles.findUnique({
        where: { userId: userId },
        select: { kitchenProfile: true },
      });

      if (!profile?.kitchenProfile) return null;

      const raw = profile.kitchenProfile as Record<string, unknown>;
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
