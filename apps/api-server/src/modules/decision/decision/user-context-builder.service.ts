/**
 * V1.9 Phase 1.5 — 统一用户上下文构建服务
 *
 * 合并 TextFoodAnalysisService.buildUserContext() 和
 * ImageFoodAnalysisService.buildUserContext() 的重复逻辑。
 *
 * 职责:
 * - build(): 构建结构化用户上下文（含目标/今日摄入/目标值/画像信息）
 * - formatAsPromptString(): 将结构化上下文格式化为 prompt 字符串（供图片链路使用）
 */
import { Injectable, Logger } from '@nestjs/common';
import { FoodService } from '../../diet/app/services/food.service';
import { NutritionScoreService } from '../../diet/app/services/nutrition-score.service';
import { UserProfileService } from '../../user/app/services/profile/user-profile.service';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import {
  UnifiedUserContext,
  MacroSlotStatus,
} from '../types/analysis-result.types';

// ==================== 输出类型 ====================

/**
 * @deprecated Use UnifiedUserContext from analysis-result.types.ts instead.
 * Kept as alias for backward compatibility.
 */
export type UserContext = UnifiedUserContext;

// ==================== 目标上下文（图片链路格式化用） ====================

const GOAL_CONTEXT: Record<string, { label: string; focus: string }> = {
  fat_loss: { label: '减脂', focus: '优先关注：热量不超标 + 蛋白质充足' },
  muscle_gain: {
    label: '增肌',
    focus: '优先关注：蛋白质是否充足 + 热量不能太低',
  },
  health: { label: '均衡健康', focus: '优先关注：食物质量和营养均衡' },
  habit: {
    label: '改善饮食习惯',
    focus: '优先关注：食物质量和饱腹感，鼓励坚持记录',
  },
};

// ==================== 服务 ====================

/**
 * V3.4 P1.1: 根据健康条件生成专用 AI 指令块
 *
 * 目的：让 Vision AI / LLM 在分析时优先关注对该用户最重要的营养维度
 */
function buildHealthConditionGuidance(conditions: string[]): string {
  if (!conditions || conditions.length === 0) return '';

  const lines: string[] = ['【健康条件特别注意】'];

  if (conditions.includes('diabetes')) {
    lines.push(
      '- 糖尿病用户：必须关注碳水化合物总量和升糖指数。高淀粉/高糖食物（白米、白面、甜品、含糖饮料）要在 reason 中明确标注风险，decision 倾向 LIMIT/AVOID。',
    );
  }
  if (conditions.includes('hypertension')) {
    lines.push(
      '- 高血压用户：必须关注钠含量。腌制食品、酱料、外卖重口味食物要标注高钠风险，建议低钠替代，decision 倾向 LIMIT。',
    );
  }
  if (
    conditions.includes('heart_disease') ||
    conditions.includes('cardiovascular')
  ) {
    lines.push(
      '- 心脏病/心血管风险用户：必须关注饱和脂肪和总脂肪。油炸食品、肥肉、全脂乳制品要明确标注风险，decision 倾向 LIMIT/AVOID。',
    );
  }
  if (conditions.includes('gout')) {
    lines.push(
      '- 痛风用户：关注高嘌呤食物（海鲜、动物内脏、浓肉汤）。识别到高嘌呤食物时在 reason 中提示，建议低嘌呤替代。',
    );
  }
  if (conditions.includes('kidney_disease')) {
    lines.push(
      '- 肾病用户：关注蛋白质总量（不宜过高）、钾和磷含量。高蛋白食物不等于好，需在 suggestion 中提示适量。',
    );
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
  ) {}

  /**
   * 构建结构化用户上下文
   */
  async build(userId?: string, locale?: Locale): Promise<UserContext> {
    const localHour = getUserLocalHour(DEFAULT_TIMEZONE);
    const defaults: UserContext = {
      goalType: 'health',
      goalLabel: t('decision.goal.health', {}, locale),
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
      const [summary, profile] = await Promise.all([
        this.foodService.getTodaySummary(userId),
        this.userProfileService.getProfile(userId),
      ]);

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

      return {
        goalType,
        goalLabel:
          t(`decision.goal.${goalType}`, {}, locale) ||
          t('decision.goal.health', {}, locale),
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
      };
    } catch (err) {
      this.logger.warn(`构建用户上下文失败: ${(err as Error).message}`);
      return defaults;
    }
  }

  /**
   * 将结构化上下文格式化为 prompt 字符串（图片链路使用）
   */
  formatAsPromptString(ctx: UserContext): string {
    if (!ctx.profile) return '';

    const gc = GOAL_CONTEXT[ctx.goalType] || GOAL_CONTEXT.health;
    const mealHint =
      ctx.localHour < 10
        ? '早餐'
        : ctx.localHour < 14
          ? '午餐'
          : ctx.localHour < 18
            ? '下午茶'
            : '晚餐';

    let text = `【用户饮食目标】${gc.label}
${gc.focus}

【今日营养预算剩余】
- 热量：剩余 ${ctx.remainingCalories} kcal（总目标 ${ctx.goalCalories}，已摄入 ${ctx.todayCalories}）
- 蛋白质：剩余 ${ctx.remainingProtein}g（总目标 ${ctx.goalProtein}g，已摄入 ${ctx.todayProtein}g）
- 脂肪：剩余 ${ctx.remainingFat}g（总目标 ${ctx.goalFat}g，已摄入 ${ctx.todayFat}g）
- 碳水：剩余 ${ctx.remainingCarbs}g（总目标 ${ctx.goalCarbs}g，已摄入 ${ctx.todayCarbs}g）
- 已记录餐数：${ctx.mealCount} 餐
- 当前时段：${mealHint}`;

    const profile = ctx.profile;
    if (profile.gender)
      text += `\n- 性别：${profile.gender === 'male' ? '男' : '女'}`;
    if (profile.activityLevel) text += `\n- 活动等级：${profile.activityLevel}`;
    if ((profile.foodPreferences as string[])?.length)
      text += `\n- 饮食偏好：${(profile.foodPreferences as string[]).join('、')}`;
    if (ctx.dietaryRestrictions.length)
      text += `\n- 忌口：${ctx.dietaryRestrictions.join('、')}`;
    if (ctx.budgetStatus) text += `\n- 预算状态：${ctx.budgetStatus}`;
    if (ctx.nutritionPriority?.length)
      text += `\n- 当前优先修正：${ctx.nutritionPriority.join('、')}`;
    if (ctx.contextSignals?.length)
      text += `\n- 决策信号：${ctx.contextSignals.join('、')}`;

    // V3.4 P1.1: 健康条件特异性指令
    const healthGuidance = buildHealthConditionGuidance(ctx.healthConditions);
    if (healthGuidance) {
      text += `\n\n${healthGuidance}`;
    }

    return text;
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
