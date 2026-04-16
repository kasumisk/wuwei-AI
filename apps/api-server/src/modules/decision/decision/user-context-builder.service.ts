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
import { UnifiedUserContext } from '../types/analysis-result.types';

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
        remainingCalories: goals.calories - todayCalories,
        remainingProtein: goals.protein - todayProtein,
        remainingFat: goals.fat - todayFat,
        remainingCarbs: goals.carbs - todayCarbs,
        mealCount: summary.mealCount || 0,
        profile,
        localHour: profile?.timezone
          ? getUserLocalHour(profile.timezone)
          : localHour,
        allergens: (profile?.allergens as string[]) || [],
        dietaryRestrictions: (profile?.dietaryRestrictions as string[]) || [],
        healthConditions: (profile?.healthConditions as string[]) || [],
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

    return text;
  }
}
