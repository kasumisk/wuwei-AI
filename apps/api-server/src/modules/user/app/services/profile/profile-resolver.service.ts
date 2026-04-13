/**
 * V6.2 Phase 2.10 — ProfileResolverService（统一画像聚合）
 *
 * 核心职责：
 * 1. 聚合五层画像（声明/行为/推断/短期/上下文）为统一的 EnrichedProfileContext
 * 2. 推荐引擎只需调用 resolve() 一次，即可获取全部画像信息
 * 3. 并行加载各层画像，最小化延迟
 *
 * 数据来源：
 * - declared / observed / inferred → ProfileCacheService（带 L1/L2 缓存 + Singleflight）
 * - shortTerm → RealtimeProfileService（Redis 7天滑窗）
 * - contextual → ContextualProfileService（纯计算，无 I/O）
 *
 * 设计决策：
 * - contextual 需要 timezone + mealType 参数，由调用方传入
 * - 如果不传 mealType，则跳过上下文画像计算（contextual = null）
 * - 基础约束字段（dietaryRestrictions, allergens 等）从 declared 层自动提取
 *   填充到 EnrichedProfileContext 的 UserProfileConstraints 基础字段中
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  user_profiles as UserProfile,
  user_behavior_profiles as UserBehaviorProfile,
  user_inferred_profiles as UserInferredProfile,
} from '@prisma/client';
import { ProfileCacheService } from './profile-cache.service';
import { RealtimeProfileService } from './realtime-profile.service';
import {
  ContextualProfileService,
  ContextualProfile,
} from './contextual-profile.service';
import {
  EnrichedProfileContext,
  ProfileConflict,
} from '../../../../diet/app/recommendation/types/recommendation.types';
import {
  ProfileFactory,
  DomainProfiles,
} from '../../../domain/profile-factory';

/**
 * V7.0 Phase 2-F: 带领域画像的聚合结果
 *
 * 在 EnrichedProfileContext 基础上，附加强类型领域画像。
 * Phase 3 的 RecommendationEngine 将消费此类型。
 */
export interface EnrichedProfileWithDomain extends EnrichedProfileContext {
  domainProfiles: DomainProfiles;
}

@Injectable()
export class ProfileResolverService {
  private readonly logger = new Logger(ProfileResolverService.name);

  constructor(
    private readonly profileCache: ProfileCacheService,
    private readonly realtimeProfile: RealtimeProfileService,
    private readonly contextualProfile: ContextualProfileService,
  ) {}

  /**
   * 聚合所有画像层为统一上下文
   *
   * @param userId 用户 ID
   * @param mealType 当前餐次类型（可选，用于上下文场景检测）
   * @returns EnrichedProfileContext — 包含五层画像 + 基础约束字段
   */
  async resolve(
    userId: string,
    mealType?: string,
  ): Promise<EnrichedProfileContext> {
    // 并行加载 DB 画像（3层缓存）+ 短期画像（Redis）
    const [fullProfile, shortTerm] = await Promise.all([
      this.profileCache.getFullProfile(userId),
      this.realtimeProfile.getShortTermProfile(userId),
    ]);

    const { declared, observed, inferred } = fullProfile;

    // 上下文画像：需要 timezone + mealType，纯计算无 I/O
    let contextual: ContextualProfile | null = null;
    if (mealType) {
      const timezone = declared?.timezone || 'Asia/Shanghai';
      // V6.3 P2-9: 读取 exerciseSchedule 用于 post_exercise 场景检测
      const exerciseSchedule =
        (declared?.exercise_schedule as Record<
          string,
          { startHour: number; durationHours: number }
        >) || null;
      try {
        contextual = this.contextualProfile.detectScene(
          timezone,
          mealType,
          shortTerm,
          undefined, // now — 使用当前时间
          exerciseSchedule,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to detect scene for user ${userId}: ${err.message}`,
        );
      }
    }

    // 组装 EnrichedProfileContext
    return this.buildContext(
      declared,
      observed,
      inferred,
      shortTerm,
      contextual,
    );
  }

  /**
   * V7.0 Phase 2-F: 聚合所有画像层 + 生成强类型领域模型
   *
   * 在 resolve() 基础上，通过 ProfileFactory 将 EnrichedProfileContext
   * 转换为 NutritionProfile + PreferencesProfile 领域实体。
   *
   * Phase 3 的 RecommendationEngine.recommendMeal() 将使用此方法替代 resolve()，
   * 在 PipelineContext 中传递 domainProfiles。
   *
   * @param userId 用户 ID
   * @param mealType 当前餐次类型（可选）
   * @returns EnrichedProfileWithDomain — 包含五层画像 + 基础约束 + 领域画像
   */
  async resolveWithDomainProfiles(
    userId: string,
    mealType?: string,
  ): Promise<EnrichedProfileWithDomain> {
    const context = await this.resolve(userId, mealType);

    // ProfileFactory 是纯静态类，无 I/O，直接同步调用
    const domainProfiles = ProfileFactory.fromEnrichedContext(context);

    this.logger.debug(
      `Domain profiles built for user ${userId}: ` +
        `nutrition(bmr=${domainProfiles.nutrition.bmr}, tdee=${domainProfiles.nutrition.tdee}, confidence=${domainProfiles.nutrition.confidence.toFixed(2)}), ` +
        `preferences(cuisine=${Object.keys(domainProfiles.preferences.cuisineWeights).length} entries, philosophy=${domainProfiles.preferences.dietaryPhilosophy})`,
    );

    return {
      ...context,
      domainProfiles,
    };
  }

  /**
   * 从各层画像构建 EnrichedProfileContext
   * 基础约束字段从 declared 层自动提取
   */
  private buildContext(
    declared: UserProfile | null,
    observed: UserBehaviorProfile | null,
    inferred: UserInferredProfile | null,
    shortTerm: import('./realtime-profile.service').ShortTermProfile | null,
    contextual: ContextualProfile | null,
  ): EnrichedProfileContext {
    const context: EnrichedProfileContext = {
      // ── 基础约束字段（向后兼容 UserProfileConstraints） ──
      dietaryRestrictions: (declared?.dietary_restrictions as string[]) || [],
      weakTimeSlots: (declared?.weak_time_slots as string[]) || [],
      discipline: declared?.discipline || 'medium',
      allergens: (declared?.allergens as string[]) || [],
      healthConditions: (declared?.health_conditions as string[]) || [],
      regionCode: declared?.region_code || 'CN',
      timezone: declared?.timezone || 'Asia/Shanghai',

      // ── 声明画像 ──
      declared: declared
        ? {
            gender: declared.gender ?? undefined,
            birthYear: declared.birth_year ?? undefined,
            heightCm: declared.height_cm
              ? Number(declared.height_cm)
              : undefined,
            weightKg: declared.weight_kg
              ? Number(declared.weight_kg)
              : undefined,
            targetWeightKg: declared.target_weight_kg
              ? Number(declared.target_weight_kg)
              : undefined,
            activityLevel: declared.activity_level ?? undefined,
            goal: declared.goal ?? undefined,
            goalSpeed: declared.goal_speed ?? undefined,
            dailyCalorieGoal: declared.daily_calorie_goal ?? undefined,
            mealsPerDay: declared.meals_per_day ?? undefined,
            takeoutFrequency: declared.takeout_frequency ?? undefined,
            canCook: declared.can_cook ?? undefined,
            cookingSkillLevel: declared.cooking_skill_level ?? undefined,
            budgetLevel: declared.budget_level ?? undefined,
            familySize: declared.family_size ?? undefined,
            cuisinePreferences:
              (declared.cuisine_preferences as string[]) ?? undefined,
            foodPreferences:
              (declared.food_preferences as string[]) ?? undefined,
            dietaryRestrictions:
              (declared.dietary_restrictions as string[]) ?? undefined,
            allergens: (declared.allergens as string[]) ?? undefined,
            healthConditions:
              (declared.health_conditions as string[]) ?? undefined,
            weakTimeSlots: (declared.weak_time_slots as string[]) ?? undefined,
            bingeTriggers: (declared.binge_triggers as string[]) ?? undefined,
            discipline: declared.discipline ?? undefined,
            regionCode: declared.region_code ?? undefined,
            timezone: declared.timezone ?? undefined,
            exerciseSchedule:
              (declared.exercise_schedule as Record<
                string,
                { startHour: number; durationHours: number }
              >) ?? undefined,
            // V6.6 Phase 2-C: 生活方式画像字段
            sleepQuality: declared.sleep_quality ?? undefined,
            stressLevel: declared.stress_level ?? undefined,
            hydrationGoal: declared.hydration_goal
              ? Number(declared.hydration_goal)
              : undefined,
            supplementsUsed:
              (declared.supplements_used as string[]) ?? undefined,
            mealTimingPreference: declared.meal_timing_preference ?? undefined,
            // V7.8: exerciseIntensity 从 exercise_profile.intensity 读取（原 exercise_intensity 字段已删除）
            exerciseIntensity:
              (declared.exercise_profile as any)?.intensity ?? undefined,
            alcoholFrequency: declared.alcohol_frequency ?? undefined,
            // V6.8 Phase 3-C: age 从 birth_year 动态计算
            age: declared.birth_year
              ? new Date().getFullYear() - declared.birth_year
              : undefined,
          }
        : null,

      // ── 推断画像 ──
      inferred: inferred
        ? {
            estimatedBmr: inferred.estimated_bmr ?? undefined,
            estimatedTdee: inferred.estimated_tdee ?? undefined,
            recommendedCalories: inferred.recommended_calories ?? undefined,
            macroTargets: (inferred.macro_targets as any) ?? undefined,
            userSegment: inferred.user_segment ?? undefined,
            churnRisk: inferred.churn_risk
              ? Number(inferred.churn_risk)
              : undefined,
            optimalMealCount: inferred.optimal_meal_count ?? undefined,
            nutritionGaps: (inferred.nutrition_gaps as string[]) ?? undefined,
            preferenceWeights:
              (inferred.preference_weights as Record<string, number>) ??
              undefined,
          }
        : null,

      // ── 行为画像 ──
      observed: observed
        ? {
            avgComplianceRate: observed.avg_compliance_rate
              ? Number(observed.avg_compliance_rate)
              : undefined,
            totalRecords: observed.total_records ?? undefined,
            streakDays: observed.streak_days ?? undefined,
            mealTimingPatterns:
              (observed.meal_timing_patterns as Record<string, any>) ??
              undefined,
            portionTendency: observed.portion_tendency ?? undefined,
            // V6.3 P1-3: 暴食风险时段
            bingeRiskHours:
              (observed.binge_risk_hours as number[]) ?? undefined,
          }
        : null,

      // ── 短期画像 ──
      shortTerm,

      // ── 上下文画像 ──
      contextual,

      // ── V6.5: 生活方式画像（从 declared 提取评分相关字段） ──
      lifestyle: declared
        ? {
            tasteIntensity:
              (declared.taste_intensity as Record<string, number>) || null,
            cuisinePreferences:
              (declared.cuisine_preferences as string[]) || [],
            budgetLevel:
              (declared.budget_level as 'low' | 'medium' | 'high') || null,
            cookingSkillLevel: declared.cooking_skill_level ?? null,
            familySize: declared.family_size ?? 1,
            mealPrepWilling: declared.meal_prep_willing ?? false,
            // V6.6 Phase 2-C: 新增生活方式字段
            sleepQuality: declared.sleep_quality ?? null,
            stressLevel: declared.stress_level ?? null,
            hydrationGoal: declared.hydration_goal
              ? Number(declared.hydration_goal)
              : null,
            supplementsUsed: (declared.supplements_used as string[]) ?? null,
            mealTimingPreference: declared.meal_timing_preference ?? null,
            // V7.8: exerciseIntensity 从 exercise_profile.intensity 读取（原 exercise_intensity 字段已删除）
            exerciseIntensity:
              ((declared.exercise_profile as any)?.intensity as
                | 'none'
                | 'light'
                | 'moderate'
                | 'high'
                | null) ?? null,
            alcoholFrequency:
              (declared.alcohol_frequency as
                | 'never'
                | 'occasional'
                | 'frequent'
                | null) ?? null,
            // V6.8 Phase 3-C: age 从 birth_year 动态计算
            age: declared.birth_year
              ? new Date().getFullYear() - declared.birth_year
              : null,
          }
        : null,

      // ── V6.8 Phase 1-D: 冲突解决层 ──
      conflicts: [],
      profileFreshness: 0,
    };

    // V6.8 Phase 1-D: 冲突检测与调和
    this.resolveConflicts(context, declared, observed);

    // V6.8 Phase 3-C: 画像新鲜度衰减 — 当画像过于陈旧时降低 declared 层权重
    if (context.declared && context.profileFreshness < 0.3) {
      context.declared.confidence =
        (context.declared.confidence ?? 1.0) * context.profileFreshness;
      this.logger.debug(
        `Profile freshness ${context.profileFreshness.toFixed(2)} < 0.3, declared confidence decayed to ${context.declared.confidence.toFixed(2)}`,
      );
    }

    return context;
  }

  // ════════════════════════════════════════════════════════════════
  // V6.8 Phase 1-D: 冲突解决层
  // ════════════════════════════════════════════════════════════════

  /**
   * 冲突检测与调和
   *
   * 在 5 层画像合并完成后，检测声明层与行为层之间的矛盾：
   * 1. 新鲜度衰减 — 声明画像超过半年逐渐失效
   * 2. 目标 vs 实际摄入 — 减脂目标但实际热量超标
   * 3. 活动水平 vs 实际步频 — 声明高活动量但行为画像显示低合规
   * 4. 烹饪技能 vs 实际选择 — 声明会做饭但实际高外卖频率
   *
   * 冲突数据附加到 context.conflicts[]，供 trace/解释使用。
   */
  private resolveConflicts(
    context: EnrichedProfileContext,
    declared: UserProfile | null,
    observed: UserBehaviorProfile | null,
  ): void {
    const conflicts: ProfileConflict[] = [];

    // ── 1. 新鲜度计算 ──
    // declared.updated_at 距今天数 → 半年（180天）线性衰减到 0
    const daysSinceUpdate = declared?.updated_at
      ? (Date.now() - new Date(declared.updated_at).getTime()) / 86400000
      : 365;
    context.profileFreshness = Math.max(0, 1 - daysSinceUpdate / 180);

    // ── 2. 目标 vs 行为冲突 ──
    // 用户声明减脂，但短期画像显示实际摄入远超目标
    if (context.declared?.goal === 'fat_loss') {
      const targetCal =
        context.declared.dailyCalorieGoal ??
        context.inferred?.recommendedCalories ??
        2000;
      // 从短期画像的 dailyIntakes 计算近期平均摄入
      const intakes = context.shortTerm?.dailyIntakes;
      let recentAvgCal: number | null = null;
      if (intakes && intakes.length > 0) {
        const totalCal = intakes.reduce((sum, d) => sum + d.calories, 0);
        recentAvgCal = totalCal / intakes.length;
      }
      if (recentAvgCal !== null && recentAvgCal > targetCal * 1.2) {
        conflicts.push({
          field: 'goal_compliance',
          declaredValue: 'fat_loss',
          observedValue: `avg ${Math.round(recentAvgCal)} kcal (target ${targetCal})`,
          resolution: context.profileFreshness > 0.5 ? 'use_declared' : 'blend',
          confidence: Math.min(1, (observed?.total_records ?? 0) / 30),
          reason: 'declared_goal_conflicts_with_observed_intake',
        });
      }
    }

    // ── 3. 活动水平 vs 实际合规 ──
    // 用户声明 active/very_active，但实际合规率很低（<40%），
    // 说明可能高估了自己的活动水平
    if (
      context.declared?.activityLevel &&
      ['active', 'very_active'].includes(context.declared.activityLevel) &&
      context.observed?.avgComplianceRate !== undefined &&
      context.observed.avgComplianceRate < 0.4
    ) {
      conflicts.push({
        field: 'activity_level',
        declaredValue: context.declared.activityLevel,
        observedValue: `compliance ${Math.round((context.observed.avgComplianceRate ?? 0) * 100)}%`,
        resolution: context.profileFreshness > 0.7 ? 'use_declared' : 'blend',
        confidence: Math.min(1, (observed?.total_records ?? 0) / 20),
        reason: 'high_declared_activity_but_low_compliance',
      });
    }

    // ── 4. 烹饪技能 vs 实际选择模式 ──
    // 用户声明会做饭（canCook=true），但外卖频率为 often/always
    if (
      context.declared?.canCook === true &&
      context.declared?.takeoutFrequency &&
      ['often', 'always'].includes(context.declared.takeoutFrequency)
    ) {
      conflicts.push({
        field: 'cooking_pattern',
        declaredValue: `canCook=true, skill=${context.declared.cookingSkillLevel ?? 'unknown'}`,
        observedValue: `takeoutFrequency=${context.declared.takeoutFrequency}`,
        resolution: 'blend',
        confidence: 0.6, // 基于声明数据，置信度中等
        reason: 'declared_cook_but_high_takeout_frequency',
      });
    }

    context.conflicts = conflicts;

    if (conflicts.length > 0) {
      this.logger.debug(
        `Detected ${conflicts.length} profile conflict(s): ${conflicts.map((c) => c.field).join(', ')}`,
      );
    }
  }
}
