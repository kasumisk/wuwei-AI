/**
 * V1.9 Phase 1.5 — 统一用户上下文构建服务
 *
 * 合并 TextFoodAnalysisService.buildUnifiedUserContext() 和
 * ImageFoodAnalysisService.buildUnifiedUserContext() 的重复逻辑。
 *
 * 职责:
 * - build(): 构建结构化用户上下文（含目标/今日摄入/目标值/画像信息）
 * - formatAsPromptString(): 将结构化上下文格式化为 prompt 字符串（供图片链路使用）
 */
import { Injectable, Logger } from '@nestjs/common';
import { FoodService } from '../../diet/app/services/food.service';
import { NutritionScoreService } from '../../diet/app/services/nutrition-score.service';
import { UserProfileService } from '../../user/app/services/profile/user-profile.service';
import { GoalTrackerService } from '../../user/app/services/goal/goal-tracker.service';
import { GoalPhaseService } from '../../user/app/services/goal/goal-phase.service';
import { RealtimeProfileService } from '../../user/app/services/profile/realtime-profile.service';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import {
  UnifiedUserContext,
  MacroSlotStatus,
} from '../types/analysis-result.types';
import { cl } from '../i18n/decision-labels';
import { translateEnum } from '../../../common/i18n/enum-i18n';

// ==================== 输出类型 ====================

// ==================== 目标上下文（图片链路格式化用） ====================

function getGoalContext(
  goalType: string,
  locale?: Locale,
): { label: string; focus: string } {
  const key = ['fat_loss', 'muscle_gain', 'health', 'habit'].includes(goalType)
    ? goalType
    : 'health';
  return {
    label: cl(`ctx.goal.${key}`, locale),
    focus: cl(`ctx.focus.${key}`, locale),
  };
}

// ==================== 服务 ====================

/**
 * V3.4 P1.1: 根据健康条件生成专用 AI 指令块
 *
 * 目的：让 Vision AI / LLM 在分析时优先关注对该用户最重要的营养维度
 */
function buildHealthConditionGuidance(
  conditions: string[],
  locale?: Locale,
): string {
  if (!conditions || conditions.length === 0) return '';

  const lines: string[] = [cl('ctx.health.header', locale)];

  if (conditions.includes('diabetes')) {
    lines.push(cl('ctx.health.diabetes', locale));
  }
  if (conditions.includes('hypertension')) {
    lines.push(cl('ctx.health.hypertension', locale));
  }
  if (
    conditions.includes('heart_disease') ||
    conditions.includes('cardiovascular')
  ) {
    lines.push(cl('ctx.health.heart', locale));
  }
  if (conditions.includes('gout')) {
    lines.push(cl('ctx.health.gout', locale));
  }
  if (conditions.includes('kidney_disease')) {
    lines.push(cl('ctx.health.kidney', locale));
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

@Injectable()
export class UserContextBuilderService {
  private readonly logger = new Logger(UserContextBuilderService.name);

  constructor(
    private readonly foodService: FoodService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly goalTrackerService: GoalTrackerService,
    private readonly goalPhaseService: GoalPhaseService,
    private readonly realtimeProfileService: RealtimeProfileService,
    private readonly behaviorService: BehaviorService,
  ) {}

  /**
   * 构建结构化用户上下文
   */
  async build(userId?: string, locale?: Locale): Promise<UnifiedUserContext> {
    const localHour = getUserLocalHour(DEFAULT_TIMEZONE);
    const defaults: UnifiedUserContext = {
      goalType: 'health',
      goalLabel: cl('goal.label.health', locale),
      todayCalories: 0,
      todayProtein: 0,
      todayFat: 0,
      todayCarbs: 0,
      goalCalories: 2000,
      goalProtein: 65,
      goalFat: 65,
      goalCarbs: 275,
      remainingCalories: 2000,
      remainingProtein: 65,
      remainingFat: 65,
      remainingCarbs: 275,
      mealCount: 0,
      profile: null,
      localHour,
      allergens: [],
      dietaryRestrictions: [],
      healthConditions: [],
      budgetStatus: 'under_target',
      nutritionPriority: ['protein_gap'],
      contextSignals: ['fresh_day'],
    };

    if (!userId) return defaults;

    try {
      const [
        summary,
        profile,
        goalProgress,
        effectiveGoal,
        shortTermProfile,
        behaviorProfile,
      ] = await Promise.all([
        this.foodService.getTodaySummary(userId),
        this.userProfileService.getProfile(userId),
        this.goalTrackerService.getProgress(userId).catch(() => null),
        this.goalPhaseService.getCurrentGoal(userId).catch(() => null),
        this.realtimeProfileService
          .getShortTermProfile(userId)
          .catch(() => null),
        this.behaviorService.getProfile(userId).catch(() => null),
      ]);

      // V4.2: 信号完整度追踪
      const signalNames = [
        'todaySummary',
        'profile',
        'goalProgress',
        'effectiveGoal',
        'shortTermProfile',
        'behaviorProfile',
      ];
      const signalValues = [
        summary,
        profile,
        goalProgress,
        effectiveGoal,
        shortTermProfile,
        behaviorProfile,
      ];
      const availableSignals: string[] = [];
      const missingSignals: string[] = [];
      signalNames.forEach((name, i) => {
        if (signalValues[i] != null) availableSignals.push(name);
        else missingSignals.push(name);
      });
      const completenessRatio =
        signalNames.length > 0
          ? availableSignals.length / signalNames.length
          : 1;

      const goalType = profile?.goal || 'health';
      const goals = this.nutritionScoreService.calculateDailyGoals(profile);

      const todayCalories = summary.totalCalories;
      const todayProtein = Number(summary.totalProtein) || 0;
      const todayFat = Number(summary.totalFat) || 0;
      const todayCarbs = Number(summary.totalCarbs) || 0;
      const remainingCalories = goals.calories - todayCalories;
      const remainingProtein = goals.protein - todayProtein;
      const remainingFat = goals.fat - todayFat;
      const remainingCarbs = goals.carbs - todayCarbs;
      const resolvedLocalHour = profile?.timezone
        ? getUserLocalHour(profile.timezone)
        : localHour;
      const mealCount = summary.mealCount || 0;
      const budgetStatus = this.resolveBudgetStatus(
        remainingCalories,
        goals.calories,
      );
      const nutritionPriority = this.resolveNutritionPriority({
        remainingProtein,
        remainingFat,
        remainingCarbs,
        goalProtein: goals.protein,
        goalFat: goals.fat,
        goalCarbs: goals.carbs,
      });
      const contextSignals = this.resolveContextSignals({
        budgetStatus,
        remainingProtein,
        remainingFat,
        remainingCarbs,
        localHour: resolvedLocalHour,
        mealCount,
        hasHealthConstraint:
          ((profile?.allergens as string[] | undefined)?.length || 0) > 0 ||
          ((profile?.dietaryRestrictions as string[] | undefined)?.length ||
            0) > 0 ||
          ((profile?.healthConditions as string[] | undefined)?.length || 0) >
            0,
      });
      // V3.0: 宏量槽位状态
      const macroSlotStatus = this.resolveMacroSlotStatus({
        remainingCalories,
        remainingProtein,
        remainingFat,
        remainingCarbs,
        goalCalories: goals.calories,
        goalProtein: goals.protein,
        goalFat: goals.fat,
        goalCarbs: goals.carbs,
      });

      // V4.0: 目标执行进度
      const goalProgressData = goalProgress
        ? {
            executionRate: goalProgress.executionRate ?? 0,
            streakDays: goalProgress.streakDays ?? 0,
            calorieCompliance: goalProgress.calorieCompliance ?? 0,
            proteinCompliance: goalProgress.proteinCompliance ?? 0,
          }
        : undefined;

      // V4.0: 7天短期行为画像
      const shortTermBehavior = this.resolveShortTermBehavior(
        shortTermProfile,
        behaviorProfile,
      );

      // V4.0: 目标阶段权重调整
      const phaseWeightAdjustment = effectiveGoal?.weightAdjustment
        ? (effectiveGoal.weightAdjustment as Partial<Record<string, number>>)
        : undefined;

      return {
        goalType,
        goalLabel:
          cl(`goal.label.${goalType}`, locale) ||
          cl('goal.label.health', locale),
        todayCalories,
        todayProtein,
        todayFat,
        todayCarbs,
        goalCalories: goals.calories,
        goalProtein: goals.protein,
        goalFat: goals.fat,
        goalCarbs: goals.carbs,
        remainingCalories,
        remainingProtein,
        remainingFat,
        remainingCarbs,
        mealCount,
        profile,
        localHour: resolvedLocalHour,
        allergens: (profile?.allergens as string[]) || [],
        dietaryRestrictions: (profile?.dietaryRestrictions as string[]) || [],
        healthConditions: (profile?.healthConditions as string[]) || [],
        budgetStatus,
        nutritionPriority,
        contextSignals,
        macroSlotStatus,
        goalProgress: goalProgressData,
        shortTermBehavior,
        phaseWeightAdjustment,
        contextCompleteness: {
          availableSignals,
          missingSignals,
          completenessRatio,
        },
      };
    } catch (err) {
      this.logger.warn(
        `Failed to build user context: ${(err as Error).message}`,
      );
      return defaults;
    }
  }

  /**
   * 将结构化上下文格式化为 prompt 字符串（图片链路使用）
   */
  formatAsPromptString(ctx: UnifiedUserContext, locale?: Locale): string {
    if (!ctx.profile) return '';

    const gc = getGoalContext(ctx.goalType, locale);
    const mealHint =
      ctx.localHour < 10
        ? cl('ctx.meal.breakfast', locale)
        : ctx.localHour < 14
          ? cl('ctx.meal.lunch', locale)
          : ctx.localHour < 18
            ? cl('ctx.meal.afternoon', locale)
            : cl('ctx.meal.dinner', locale);

    let text = `${cl('ctx.prompt.goalHeader', locale)}${gc.label}
${gc.focus}

${cl('ctx.prompt.budgetHeader', locale)}
- ${cl('ctx.prompt.calories', locale, { remaining: ctx.remainingCalories, goal: ctx.goalCalories, consumed: ctx.todayCalories })}
- ${cl('ctx.prompt.protein', locale, { remaining: ctx.remainingProtein, goal: ctx.goalProtein, consumed: ctx.todayProtein })}
- ${cl('ctx.prompt.fat', locale, { remaining: ctx.remainingFat, goal: ctx.goalFat, consumed: ctx.todayFat })}
- ${cl('ctx.prompt.carbs', locale, { remaining: ctx.remainingCarbs, goal: ctx.goalCarbs, consumed: ctx.todayCarbs })}
- ${cl('ctx.prompt.mealCount', locale, { count: ctx.mealCount })}
- ${cl('ctx.prompt.mealPeriod', locale, { period: mealHint })}`;

    const profile = ctx.profile;
    if (profile.gender)
      text += `\n- ${cl('ctx.prompt.gender', locale, { value: profile.gender === 'male' ? cl('ctx.prompt.gender.male', locale) : cl('ctx.prompt.gender.female', locale) })}`;
    if (profile.activityLevel)
      text += `\n- ${cl('ctx.prompt.activityLevel', locale, { value: translateEnum('activityLevel', profile.activityLevel, locale) })}`;
    const enumerationSeparator = cl('separator.enumeration', locale);
    if ((profile.foodPreferences as string[])?.length)
      text += `\n- ${cl('ctx.prompt.foodPreferences', locale, { value: (profile.foodPreferences as string[]).join(enumerationSeparator) })}`;
    if (ctx.dietaryRestrictions.length)
      text += `\n- ${cl('ctx.prompt.dietaryRestrictions', locale, { value: ctx.dietaryRestrictions.map((r) => translateEnum('dietaryRestriction', r, locale)).join(enumerationSeparator) })}`;
    if (ctx.budgetStatus)
      text += `\n- ${cl('ctx.prompt.budgetStatus', locale, { value: translateEnum('budgetStatus', ctx.budgetStatus, locale) })}`;
    if (ctx.nutritionPriority?.length)
      text += `\n- ${cl('ctx.prompt.nutritionPriority', locale, { value: ctx.nutritionPriority.join(enumerationSeparator) })}`;
    if (ctx.contextSignals?.length)
      text += `\n- ${cl('ctx.prompt.contextSignals', locale, { value: ctx.contextSignals.join(enumerationSeparator) })}`;

    // V3.4 P1.1: 健康条件特异性指令
    const healthGuidance = buildHealthConditionGuidance(
      ctx.healthConditions,
      locale,
    );
    if (healthGuidance) {
      text += `\n\n${healthGuidance}`;
    }

    return text;
  }

  /**
   * V4.0: 从 ShortTermProfile + BehaviorProfile 组装短期行为画像
   */
  private resolveShortTermBehavior(
    shortTermProfile: any | null,
    behaviorProfile: any | null,
  ): UnifiedUserContext['shortTermBehavior'] | undefined {
    if (!shortTermProfile && !behaviorProfile) return undefined;

    // 从 shortTermProfile 提取拒绝模式
    const rejectedFoods = shortTermProfile?.rejectedFoods as
      | Record<string, number>
      | undefined;
    const recentRejectionPatterns = rejectedFoods
      ? Object.keys(rejectedFoods).slice(0, 10)
      : [];

    // 从 shortTermProfile.dailyIntakes 推导摄入趋势
    const dailyIntakes = (shortTermProfile?.dailyIntakes ?? []) as Array<{
      date: string;
      calories: number;
    }>;
    const intakeTrends = this.inferIntakeTrend(dailyIntakes);

    // 从 behaviorProfile 提取暴食风险小时
    const bingeRiskHours = (behaviorProfile?.bingeRiskHours ?? []) as number[];

    // 从 shortTermProfile 提取活跃时段
    const activeTimeSlots = shortTermProfile?.activeTimeSlots
      ? Object.keys(shortTermProfile.activeTimeSlots as Record<string, unknown>)
      : [];

    return {
      recentRejectionPatterns,
      intakeTrends,
      bingeRiskHours,
      activeTimeSlots,
    };
  }

  /**
   * V4.0: 基于近7天每日热量推导摄入趋势
   */
  private inferIntakeTrend(
    dailyIntakes: Array<{ date: string; calories: number }>,
  ): 'increasing' | 'stable' | 'decreasing' {
    if (dailyIntakes.length < 3) return 'stable';

    // 简单线性趋势：比较前半段和后半段的平均热量
    const mid = Math.floor(dailyIntakes.length / 2);
    const firstHalf = dailyIntakes.slice(0, mid);
    const secondHalf = dailyIntakes.slice(mid);

    const avgFirst =
      firstHalf.reduce((s, d) => s + d.calories, 0) / firstHalf.length;
    const avgSecond =
      secondHalf.reduce((s, d) => s + d.calories, 0) / secondHalf.length;

    const diff = avgSecond - avgFirst;
    const threshold = avgFirst * 0.1; // 10% 变化视为趋势

    if (diff > threshold) return 'increasing';
    if (diff < -threshold) return 'decreasing';
    return 'stable';
  }

  private resolveBudgetStatus(
    remainingCalories: number,
    goalCalories: number,
  ): 'under_target' | 'near_limit' | 'over_limit' {
    if (remainingCalories < 0) {
      return 'over_limit';
    }

    const safeGoal = goalCalories > 0 ? goalCalories : 2000;
    if (remainingCalories / safeGoal <= 0.15) {
      return 'near_limit';
    }

    return 'under_target';
  }

  private resolveNutritionPriority(input: {
    remainingProtein: number;
    remainingFat: number;
    remainingCarbs: number;
    goalProtein: number;
    goalFat: number;
    goalCarbs: number;
  }): string[] {
    const priorities: string[] = [];

    if (
      input.goalProtein > 0 &&
      input.remainingProtein / input.goalProtein > 0.35
    ) {
      priorities.push('protein_gap');
    }
    if (
      input.goalFat > 0 &&
      input.remainingFat < -Math.max(8, input.goalFat * 0.12)
    ) {
      priorities.push('fat_excess');
    }
    if (
      input.goalCarbs > 0 &&
      input.remainingCarbs < -Math.max(15, input.goalCarbs * 0.12)
    ) {
      priorities.push('carb_excess');
    }
    if (priorities.length === 0) {
      priorities.push('maintain_balance');
    }

    return priorities;
  }

  private resolveContextSignals(input: {
    budgetStatus: 'under_target' | 'near_limit' | 'over_limit';
    remainingProtein: number;
    remainingFat: number;
    remainingCarbs: number;
    localHour: number;
    mealCount: number;
    hasHealthConstraint: boolean;
  }): string[] {
    const signals: string[] = [input.budgetStatus];

    if (input.hasHealthConstraint) {
      signals.push('health_constraint');
    }

    if (input.remainingProtein > 20) {
      signals.push('protein_gap');
    }
    if (input.remainingFat < -10) {
      signals.push('fat_excess');
    }
    if (input.remainingCarbs < -20) {
      signals.push('carb_excess');
    }
    if (input.localHour >= 21 || input.localHour < 5) {
      signals.push('late_night_window');
    }
    if (input.mealCount <= 1 && input.localHour >= 13) {
      signals.push('meal_count_low');
    }

    return Array.from(new Set(signals));
  }

  /** V3.0: 计算四维宏量槽位状态 */
  private resolveMacroSlotStatus(input: {
    remainingCalories: number;
    remainingProtein: number;
    remainingFat: number;
    remainingCarbs: number;
    goalCalories: number;
    goalProtein: number;
    goalFat: number;
    goalCarbs: number;
  }): MacroSlotStatus {
    const threshold = 0.12; // 12% 阈值以内视为 ok

    const toStatus = (
      remaining: number,
      goal: number,
    ): 'deficit' | 'ok' | 'excess' => {
      if (goal <= 0) return 'ok';
      const ratio = remaining / goal;
      if (ratio < -threshold) return 'excess';
      if (ratio > threshold) return 'deficit';
      return 'ok';
    };

    const calories = toStatus(input.remainingCalories, input.goalCalories);
    const protein = toStatus(input.remainingProtein, input.goalProtein);
    const fat = toStatus(input.remainingFat, input.goalFat);
    const carbs = toStatus(input.remainingCarbs, input.goalCarbs);

    // 找到缺口最大的宏量
    const deficitRatios: Array<[string, number]> = [
      [
        'protein',
        input.goalProtein > 0 ? input.remainingProtein / input.goalProtein : 0,
      ] as [string, number],
      [
        'carbs',
        input.goalCarbs > 0 ? input.remainingCarbs / input.goalCarbs : 0,
      ] as [string, number],
      [
        'calories',
        input.goalCalories > 0
          ? input.remainingCalories / input.goalCalories
          : 0,
      ] as [string, number],
      ['fat', input.goalFat > 0 ? input.remainingFat / input.goalFat : 0] as [
        string,
        number,
      ],
    ].filter(([, r]) => r > threshold);
    deficitRatios.sort((a, b) => b[1] - a[1]);
    const dominantDeficit =
      deficitRatios[0]?.[0] as MacroSlotStatus['dominantDeficit'];

    // 找到超标最大的宏量
    const excessRatios: Array<[string, number]> = [
      [
        'protein',
        input.goalProtein > 0 ? -input.remainingProtein / input.goalProtein : 0,
      ] as [string, number],
      [
        'carbs',
        input.goalCarbs > 0 ? -input.remainingCarbs / input.goalCarbs : 0,
      ] as [string, number],
      [
        'calories',
        input.goalCalories > 0
          ? -input.remainingCalories / input.goalCalories
          : 0,
      ] as [string, number],
      ['fat', input.goalFat > 0 ? -input.remainingFat / input.goalFat : 0] as [
        string,
        number,
      ],
    ].filter(([, r]) => r > threshold);
    excessRatios.sort((a, b) => b[1] - a[1]);
    const dominantExcess =
      excessRatios[0]?.[0] as MacroSlotStatus['dominantExcess'];

    return { calories, protein, fat, carbs, dominantDeficit, dominantExcess };
  }
}
