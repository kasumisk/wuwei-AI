/**
 * V2.2 Phase 1.1 — 动态阈值计算服务
 *
 * 核心思想：所有决策阈值基于用户画像（日目标、健康状况）动态计算，
 * 不再使用绝对硬编码值。50kg 女性和 100kg 男性得到不同的阈值。
 *
 * 无状态，纯计算。输入 UnifiedUserContext，输出 UserThresholds。
 */
import { Injectable } from '@nestjs/common';
import { UnifiedUserContext } from '../types/analysis-result.types';
import {
  THRESHOLD_RATIOS,
  PORTION_BUFFER,
  PORTION_MIN_PERCENT,
  SODIUM_LIMITS,
  ADDED_SUGAR_LIMITS,
  TIME_BOUNDARIES,
} from './decision-thresholds';

// ==================== 输出类型 ====================

export interface UserThresholds {
  // —— 餐级营养阈值 ——
  /** 显著餐热量门槛（kcal） */
  significantMealCal: number;
  /** 高蛋白餐门槛（g） */
  highProteinMeal: number;
  /** 低蛋白餐门槛（g） */
  lowProteinMeal: number;
  /** 极低蛋白餐门槛（g） */
  veryLowProteinMeal: number;
  /** 高脂肪餐门槛（g） */
  highFatMeal: number;
  /** 晚间高碳水门槛（g） */
  highCarbMeal: number;
  /** 晚餐高碳水门槛（g） */
  dinnerHighCarb: number;
  /** 零食高热量门槛（kcal） */
  snackHighCal: number;

  // —— 预算阈值 ——
  /** 超预算边界（kcal，正数） */
  overBudgetMargin: number;
  /** 单餐最大热量占日目标比例 */
  singleMealMaxRatio: number;
  /** 碳水超标比 */
  carbExcessRatio: number;
  /** 碳水严重超标比 */
  carbCriticalRatio: number;
  /** 脂肪超标比 */
  fatExcessRatio: number;
  /** 脂肪严重超标比 */
  fatCriticalRatio: number;

  // —— 份量阈值 ——
  /** 份量 buffer ratio */
  portionBufferRatio: number;
  /** 份量最低推荐百分比 */
  portionMinPercent: number;
  /** 下一餐低预算门槛（kcal） */
  nextMealLowBudget: number;

  // —— 健康检查阈值 ——
  /** 钠摄入限制（mg/餐） */
  sodiumLimit: number;
  /** 添加糖限制（g/餐） */
  addedSugarLimit: number;

  // —— 时间边界 ——
  lateNightStart: number;
  lateNightEnd: number;
  eveningStart: number;
}

@Injectable()
export class DynamicThresholdsService {
  /**
   * 根据用户上下文计算个性化阈值。
   * 纯计算，无副作用。
   */
  compute(ctx: UnifiedUserContext): UserThresholds {
    const gc = ctx.goalCalories || 2000;
    const gp = ctx.goalProtein || 65;
    const gf = ctx.goalFat || 65;
    const gCarbs = ctx.goalCarbs || 275;

    // 健康状况检测
    const hasHypertension = ctx.healthConditions?.some((c) =>
      ['高血压', 'hypertension', '高血圧'].includes(c.toLowerCase()),
    );
    const hasDiabetes = ctx.healthConditions?.some((c) =>
      ['糖尿病', 'diabetes'].includes(c.toLowerCase()),
    );

    return {
      // 餐级营养阈值
      significantMealCal: Math.round(
        gc * THRESHOLD_RATIOS.significantMealCalRatio,
      ),
      highProteinMeal: Math.round(gp * THRESHOLD_RATIOS.highProteinMealRatio),
      lowProteinMeal: Math.round(gp * THRESHOLD_RATIOS.lowProteinMealRatio),
      veryLowProteinMeal: Math.round(
        gp * THRESHOLD_RATIOS.veryLowProteinMealRatio,
      ),
      highFatMeal: Math.round(gf * THRESHOLD_RATIOS.highFatMealRatio),
      highCarbMeal: Math.round(gCarbs * THRESHOLD_RATIOS.highCarbMealRatio),
      dinnerHighCarb: Math.round(gCarbs * THRESHOLD_RATIOS.dinnerHighCarbRatio),
      snackHighCal: Math.round(gc * THRESHOLD_RATIOS.snackHighCalRatio),

      // 预算阈值
      overBudgetMargin: Math.round(gc * THRESHOLD_RATIOS.overBudgetMarginRatio),
      singleMealMaxRatio: THRESHOLD_RATIOS.singleMealMaxRatio,
      carbExcessRatio: THRESHOLD_RATIOS.carbExcessRatio,
      carbCriticalRatio: THRESHOLD_RATIOS.carbCriticalRatio,
      fatExcessRatio: THRESHOLD_RATIOS.fatExcessRatio,
      fatCriticalRatio: THRESHOLD_RATIOS.fatCriticalRatio,

      // 份量阈值
      portionBufferRatio:
        PORTION_BUFFER[ctx.goalType!] || PORTION_BUFFER.health,
      portionMinPercent: PORTION_MIN_PERCENT,
      nextMealLowBudget: Math.round(
        gc * THRESHOLD_RATIOS.nextMealLowBudgetRatio,
      ),

      // 健康检查阈值
      sodiumLimit: hasHypertension
        ? SODIUM_LIMITS.hypertension
        : SODIUM_LIMITS.default,
      addedSugarLimit: hasDiabetes
        ? ADDED_SUGAR_LIMITS.diabetes
        : ADDED_SUGAR_LIMITS.default,

      // 时间边界
      lateNightStart: TIME_BOUNDARIES.lateNightStart,
      lateNightEnd: TIME_BOUNDARIES.lateNightEnd,
      eveningStart: TIME_BOUNDARIES.eveningStart,
    };
  }
}
