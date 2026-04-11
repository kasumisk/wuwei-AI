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
import { EnrichedProfileContext } from '../../diet/app/recommendation/recommendation.types';

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
    return {
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
            sleepQuality: (declared as any).sleep_quality ?? undefined,
            stressLevel: (declared as any).stress_level ?? undefined,
            hydrationGoal: (declared as any).hydration_goal
              ? Number((declared as any).hydration_goal)
              : undefined,
            supplementsUsed:
              ((declared as any).supplements_used as string[]) ?? undefined,
            mealTimingPreference:
              (declared as any).meal_timing_preference ?? undefined,
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
            sleepQuality: (declared as any).sleep_quality ?? null,
            stressLevel: (declared as any).stress_level ?? null,
            hydrationGoal: (declared as any).hydration_goal
              ? Number((declared as any).hydration_goal)
              : null,
            supplementsUsed:
              ((declared as any).supplements_used as string[]) ?? null,
            mealTimingPreference:
              (declared as any).meal_timing_preference ?? null,
          }
        : null,
    };
  }
}
