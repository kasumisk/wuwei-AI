import { Injectable, Logger } from '@nestjs/common';
import { MealPlan } from '../../diet.types';
import { DailyPlanService, PreloadedContext } from './daily-plan.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { RecommendationEngineService } from './recommendation-engine.service';
import { PreferenceProfileService } from '../recommendation/profile/preference-profile.service';
import { RecommendationFeedbackService } from '../recommendation/feedback/feedback.service';
import { getUserLocalDate } from '../../../../common/utils/timezone.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/**
 * 周计划生成服务 (V4 Phase 4.3)
 *
 * 在单日计划基础上增加跨天维度：
 * 1. **跨天多样性** — 确保 7 天内同一食物不超过 2 次
 * 2. **营养周期化** — 支持训练日/休息日的碳水/蛋白质差异化
 * 3. **周均衡** — 7 天平均营养接近目标，允许单日小幅波动
 *
 * 工作方式：
 * - 不替换已存在的当日计划（尊重用户修改）
 * - 为未来缺失的天数生成计划
 * - 跨天多样性通过传递历史食物名实现（利用现有 recentFoodNames 机制）
 */

/** 周计划响应 */
export interface WeeklyPlanResponse {
  weekStart: string; // ISO date, Monday
  weekEnd: string; // ISO date, Sunday
  plans: DailyPlanSummary[];
  weeklyNutrition: WeeklyNutritionSummary;
}

/** 单日计划摘要 */
export interface DailyPlanSummary {
  date: string;
  isNew: boolean; // 是否由本次周计划生成
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  meals: {
    morning: MealPlan | null;
    lunch: MealPlan | null;
    dinner: MealPlan | null;
    snack: MealPlan | null;
  };
}

/** 周营养汇总 */
export interface WeeklyNutritionSummary {
  avgCalories: number;
  avgProtein: number;
  avgFat: number;
  avgCarbs: number;
  /** 各天热量波动（标准差/均值） */
  calorieCV: number;
  /** 7 天内不重复的食物数量 */
  uniqueFoodCount: number;
}

@Injectable()
export class WeeklyPlanService {
  private readonly logger = new Logger(WeeklyPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyPlanService: DailyPlanService,
    private readonly userProfileService: UserProfileService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly feedbackService: RecommendationFeedbackService,
  ) {}

  /**
   * 获取或生成本周计划
   * - 已存在的日计划保留不动
   * - 缺失的日自动生成（传入前几天已选食物以保证跨天多样性）
   */
  async getWeeklyPlan(userId: string): Promise<WeeklyPlanResponse> {
    // 获取用户时区，用于准确计算"本周"日期范围
    const tz = await this.userProfileService.getTimezone(userId);
    const { monday, sunday, dates } = this.getCurrentWeekDates(tz);

    // 查询本周已有的计划
    const existingPlans = (await this.prisma.dailyPlans.findMany({
      where: {
        userId: userId,
        date: { gte: new Date(monday), lte: new Date(sunday) },
      },
    })) as any[];

    const existingMap = new Map<string, any>();
    for (const plan of existingPlans) {
      // plan.date is a Date object from Prisma; normalize to YYYY-MM-DD string for lookup
      const dateKey =
        plan.date instanceof Date
          ? plan.date.toISOString().slice(0, 10)
          : String(plan.date).slice(0, 10);
      existingMap.set(dateKey, plan);
    }

    // 收集已有计划中的食物名（用于跨天多样性）
    const weekFoodNames = new Set<string>();
    for (const plan of existingPlans) {
      this.extractFoodNames(plan, weekFoodNames);
    }

    // V5 2.5: 一次性预加载所有共享数据，避免 N天×5 次重复查询
    // 先获取 profile（用于确定 regionCode），再并行加载其余数据
    const profile = await this.userProfileService.getProfile(userId);
    const regionCode = profile?.regionCode || 'CN';

    const [
      allFoods,
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      regionalBoostMap,
    ] = await Promise.all([
      this.recommendationEngine.getAllFoods(),
      this.preferenceProfileService.getRecentFoodNames(userId, 7),
      this.feedbackService.getUserFeedbackStats(userId),
      this.preferenceProfileService.getUserPreferenceProfile(userId),
      this.preferenceProfileService.getRegionalBoostMap(regionCode),
    ]);

    const preloaded: PreloadedContext = {
      profile,
      allFoods,
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      regionalBoostMap,
    };

    // V6.3 P1-9: 并行化生成缺失的计划
    // 将缺失日期收集后 Promise.all 并行生成，替代串行 for-of 循环
    // 所有缺失天共享同一份 weekFoodNames 排除集（已有计划的食物名），
    // 牺牲缺失天之间的严格互斥多样性，换取 ~50% 延迟降低
    const dailySummaries: DailyPlanSummary[] = [];
    const missingDates: string[] = [];
    const existingDates: { date: string; plan: any }[] = [];

    for (const date of dates) {
      const plan = existingMap.get(date);
      if (plan) {
        existingDates.push({ date, plan });
      } else {
        missingDates.push(date);
      }
    }

    // Final-fix P0-2 V2：跨天重复修复（foodId 维度去重）
    // 原实现按 name 维度计 frequency，但同一 foodId 在不同天经过 i18n 后
    // 可能产生不同 name（如"红薯（蒸）"→ "Steamed Sweet Potato"），
    // 导致同 foodId 出现 3-4 次仍未触发 cap → 用户体验差。
    // 修复：frequency Map 用 foodId 作为 key；超 cap 的 foodId 把它在
    // 各天出现过的所有 name 都加入 excludeSet（daily-plan 下游按 name 排除）。
    const FREQUENCY_CAP = 2;
    const foodIdFrequency = new Map<string, number>();
    const foodIdToNames = new Map<string, Set<string>>();
    // 已有计划先入账
    for (const plan of existingPlans) {
      this.extractFoodIdNameMap(plan, foodIdToNames);
    }
    for (const [id, names] of foodIdToNames) {
      foodIdFrequency.set(id, names.size === 0 ? 0 : 1);
      // 注：已有计划同 id 同天可能多 item，但保守按 1 计入；下方循环每新增一天 +1
    }
    const buildExcludeSet = (): Set<string> => {
      const ex = new Set<string>();
      for (const [id, count] of foodIdFrequency) {
        if (count >= FREQUENCY_CAP) {
          const names = foodIdToNames.get(id);
          if (names) for (const n of names) ex.add(n);
        }
      }
      // 兼容：把 weekFoodNames（已有计划）也并入软排除
      for (const n of weekFoodNames) ex.add(n);
      return ex;
    };

    const generatedPlans: { date: string; plan: any }[] = [];
    for (const date of missingDates) {
      const excludeSet = buildExcludeSet();
      const plan = await this.dailyPlanService.generatePlanForDate(
        userId,
        date,
        excludeSet,
        preloaded,
      );
      // 累积新一天的 foodId 到频次表
      const dayMap = new Map<string, Set<string>>();
      this.extractFoodIdNameMap(plan, dayMap);
      const dupItems: string[] = [];
      for (const [id, names] of dayMap) {
        const before = foodIdFrequency.get(id) ?? 0;
        if (before >= FREQUENCY_CAP) {
          dupItems.push(`${id.slice(0, 8)}[${[...names].join('|')}](${before + 1})`);
        }
        foodIdFrequency.set(id, before + 1);
        if (!foodIdToNames.has(id)) foodIdToNames.set(id, new Set());
        for (const n of names) {
          foodIdToNames.get(id)!.add(n);
          weekFoodNames.add(n); // 兼容外部统计
        }
      }
      if (dupItems.length > 0) {
        this.logger.warn(
          `[WeeklyPlan][${userId.slice(0, 8)}] date=${date} ` +
            `EXCEEDED CAP despite excludeSet: ${dupItems.join(', ')}`,
        );
      }
      generatedPlans.push({ date, plan });
    }

    // 按原始日期顺序组装结果
    const generatedMap = new Map(generatedPlans.map((g) => [g.date, g.plan]));
    for (const date of dates) {
      const existing = existingMap.get(date);
      if (existing) {
        const localized = await this.dailyPlanService.localizePlan(
          existing,
          userId,
        );
        dailySummaries.push(this.toPlanSummary(localized, false));
      } else {
        const plan = generatedMap.get(date);
        if (plan) {
          const localized = await this.dailyPlanService.localizePlan(
            plan,
            userId,
          );
          dailySummaries.push(this.toPlanSummary(localized, true));
        }
      }
    }

    // 计算周汇总
    const weeklyNutrition = this.calcWeeklySummary(
      dailySummaries,
      weekFoodNames,
    );

    return {
      weekStart: monday,
      weekEnd: sunday,
      plans: dailySummaries,
      weeklyNutrition,
    };
  }

  /**
   * 计算当前周的日期范围（周一到周日）
   * 基于用户本地时区确定"今天是周几"，避免跨时区日期偏移
   */
  private getCurrentWeekDates(timezone: string): {
    monday: string;
    sunday: string;
    dates: string[];
  } {
    // 用户本地"今天"的日期字符串，如 "2024-03-15"
    const todayStr = getUserLocalDate(timezone);
    // 解析为纯日期分量（不受 server 时区影响）
    const [year, month, day] = todayStr.split('-').map(Number);
    // 用 UTC 构造日期对象以避免 DST 偏移
    const todayUtc = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = todayUtc.getUTCDay(); // 0=Sunday, 1=Monday, ...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const mondayUtc = new Date(todayUtc);
    mondayUtc.setUTCDate(todayUtc.getUTCDate() + diffToMonday);

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayUtc);
      d.setUTCDate(mondayUtc.getUTCDate() + i);
      // 格式化为 YYYY-MM-DD
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }

    return {
      monday: dates[0],
      sunday: dates[6],
      dates,
    };
  }

  /**
   * 从计划中提取所有食物名
   */
  private extractFoodNames(plan: any, target: Set<string>): void {
    const meals = [
      plan.morningPlan ?? plan.morningPlan,
      plan.lunchPlan ?? plan.lunchPlan,
      plan.dinnerPlan ?? plan.dinnerPlan,
      plan.snackPlan ?? plan.snackPlan,
    ];
    for (const meal of meals) {
      if (!meal?.foodItems) continue;
      for (const item of meal.foodItems) {
        if (item.name) target.add(item.name);
      }
    }
  }

  /**
   * Final-fix P0-2 V2: 从计划中提取所有 foodId + name 映射
   * weekly-plan 用 foodId 维度做硬 cap（同 foodId 在不同天 i18n 出不同 name），
   * 同时收集对应 names 推到 excludeSet（daily-plan 下游按 name 排除）。
   */
  private extractFoodIdNameMap(
    plan: any,
    target: Map<string, Set<string>>,
  ): void {
    const meals = [
      plan.morningPlan,
      plan.lunchPlan,
      plan.dinnerPlan,
      plan.snackPlan,
    ];
    for (const meal of meals) {
      if (!meal?.foodItems) continue;
      for (const item of meal.foodItems) {
        const id = item.foodId as string | undefined;
        const name = item.name as string | undefined;
        if (!id || !name) continue;
        if (!target.has(id)) target.set(id, new Set());
        target.get(id)!.add(name);
      }
    }
  }

  /**
   * 将 DailyPlan 转换为摘要
   */
  private toPlanSummary(plan: any, isNew: boolean): DailyPlanSummary {
    const meals = {
      morning: plan.morningPlan ?? plan.morningPlan,
      lunch: plan.lunchPlan ?? plan.lunchPlan,
      dinner: plan.dinnerPlan ?? plan.dinnerPlan,
      snack: plan.snackPlan ?? plan.snackPlan,
    };

    const totalCalories =
      (meals.morning?.calories ?? 0) +
      (meals.lunch?.calories ?? 0) +
      (meals.dinner?.calories ?? 0) +
      (meals.snack?.calories ?? 0);

    const totalProtein =
      (meals.morning?.protein ?? 0) +
      (meals.lunch?.protein ?? 0) +
      (meals.dinner?.protein ?? 0) +
      (meals.snack?.protein ?? 0);

    const totalFat =
      (meals.morning?.fat ?? 0) +
      (meals.lunch?.fat ?? 0) +
      (meals.dinner?.fat ?? 0) +
      (meals.snack?.fat ?? 0);

    const totalCarbs =
      (meals.morning?.carbs ?? 0) +
      (meals.lunch?.carbs ?? 0) +
      (meals.dinner?.carbs ?? 0) +
      (meals.snack?.carbs ?? 0);

    return {
      date:
        plan.date instanceof Date
          ? plan.date.toISOString().slice(0, 10)
          : String(plan.date).slice(0, 10),
      isNew,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      meals,
    };
  }

  /**
   * 计算周营养汇总
   */
  private calcWeeklySummary(
    plans: DailyPlanSummary[],
    weekFoodNames: Set<string>,
  ): WeeklyNutritionSummary {
    const n = plans.length || 1;

    const avgCalories = plans.reduce((s, p) => s + p.totalCalories, 0) / n;
    const avgProtein = plans.reduce((s, p) => s + p.totalProtein, 0) / n;
    const avgFat = plans.reduce((s, p) => s + p.totalFat, 0) / n;
    const avgCarbs = plans.reduce((s, p) => s + p.totalCarbs, 0) / n;

    // 热量变异系数 (CV = stdDev / mean)
    const meanCal = avgCalories;
    const variance =
      plans.reduce((s, p) => s + Math.pow(p.totalCalories - meanCal, 2), 0) / n;
    const calorieCV = meanCal > 0 ? Math.sqrt(variance) / meanCal : 0;

    return {
      avgCalories: Math.round(avgCalories),
      avgProtein: Math.round(avgProtein),
      avgFat: Math.round(avgFat),
      avgCarbs: Math.round(avgCarbs),
      calorieCV: Number(calorieCV.toFixed(3)),
      uniqueFoodCount: weekFoodNames.size,
    };
  }
}
