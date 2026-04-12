/**
 * V7.2 P1-D: InsightContext 参数对象
 *
 * 将 ExplanationGenerator.generateStructuredInsights() 的 9 个位置参数
 * 合并为单一上下文对象，提升可读性和可扩展性。
 *
 * 设计原则：
 * - 必填字段只有 foods 和 target（最小依赖）
 * - 其余全部 optional，与现有签名向后兼容
 * - 新增字段无需修改签名，只需在此接口扩展
 */

import type {
  CrossMealAdjustment,
  DailyPlanState,
  MealTarget,
  SceneContext,
  ScoredFood,
} from './recommendation.types';
import type { Locale } from './i18n-messages';
import type { EffectiveGoal } from '../../../user/app/goal-phase.service';
import type { GoalProgress } from '../../../user/app/goal-tracker.service';
import type { SubstitutionPattern } from './execution-tracker.service';

// ─── InsightContext：洞察生成上下文 ───

/**
 * 洞察生成器的统一输入上下文
 *
 * 替代 generateStructuredInsights() 的 9 个位置参数：
 * 1. foods              → ctx.foods
 * 2. target             → ctx.target
 * 3. sceneContext       → ctx.sceneContext
 * 4. dailyPlan          → ctx.dailyPlan
 * 5. _locale            → ctx.locale
 * 6. effectiveGoal      → ctx.effectiveGoal
 * 7. goalProgress       → ctx.goalProgress
 * 8. crossMealAdjustment → ctx.crossMealAdjustment
 * 9. substitutions      → ctx.substitutions
 */
export interface InsightContext {
  /** 已推荐的食物列表（必填） */
  foods: ScoredFood[];

  /** 餐次营养目标（必填） */
  target: MealTarget;

  /** 场景上下文 */
  sceneContext?: SceneContext | null;

  /** 日计划状态（用于多样性提示） */
  dailyPlan?: DailyPlanState | null;

  /** 语言 */
  locale?: Locale;

  /** 有效目标（含复合目标 + 当前阶段） */
  effectiveGoal?: EffectiveGoal | null;

  /** 目标进度（热量/蛋白合规率、执行率等） */
  goalProgress?: GoalProgress | null;

  /** 跨餐补偿调整 */
  crossMealAdjustment?: CrossMealAdjustment;

  /** 高频替换模式 */
  substitutions?: SubstitutionPattern[] | null;
}

// ─── InsightContext 工厂函数 ───

/**
 * 从位置参数创建 InsightContext（过渡期兼容用）
 *
 * 在 Phase 2 改造 ExplanationGenerator 时，
 * 旧的调用方可通过此函数将 9 参数转为 InsightContext。
 */
export function createInsightContext(
  foods: ScoredFood[],
  target: MealTarget,
  sceneContext?: SceneContext | null,
  dailyPlan?: DailyPlanState | null,
  locale?: Locale,
  effectiveGoal?: EffectiveGoal | null,
  goalProgress?: GoalProgress | null,
  crossMealAdjustment?: CrossMealAdjustment,
  substitutions?: SubstitutionPattern[] | null,
): InsightContext {
  return {
    foods,
    target,
    sceneContext,
    dailyPlan,
    locale,
    effectiveGoal,
    goalProgress,
    crossMealAdjustment,
    substitutions,
  };
}
