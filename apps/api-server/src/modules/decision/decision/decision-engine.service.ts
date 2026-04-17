/**
 * V2.2 Phase 1.6 — 决策引擎服务（动态阈值版）
 *
 * V2.1 提取的核心决策逻辑，V2.2 改为消费 DynamicThresholdsService
 * 产出的 UserThresholds，所有绝对阈值替换为用户画像驱动的动态值。
 */
import { Injectable } from '@nestjs/common';
import {
  FoodDecision,
  UnifiedUserContext,
  StructuredDecision,
  DecisionFactorDetail,
  DetailedRationale,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';
import { DIMENSION_LABELS } from '../config/scoring-dimensions';
import {
  GOAL_DECISION_THRESHOLDS,
  DEFAULT_THRESHOLDS,
} from '../config/decision-thresholds';
import {
  checkAllergenConflict,
  checkRestrictionConflict,
  checkHealthConditionRisk,
} from './decision-checks';
import { DecisionFoodItem, DecisionFactor } from './food-decision.service';
import {
  DynamicThresholdsService,
  UserThresholds,
} from '../config/dynamic-thresholds.service';
import { DecisionExplainerService } from './decision-explainer.service';

@Injectable()
export class DecisionEngineService {
  constructor(
    private readonly dynamicThresholds: DynamicThresholdsService,
    private readonly explainer: DecisionExplainerService,
  ) {}

  // ==================== 核心决策 ====================

  /**
   * 基于评分 + 上下文计算三档决策
   * V2.2: 所有绝对阈值由 UserThresholds 动态计算
   */
  computeDecision(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    nutritionScore: number,
    locale?: Locale,
  ): FoodDecision {
    const th = this.dynamicThresholds.compute(ctx);

    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    const remainingAfter = ctx.remainingCalories - totalCalories;

    let scoreDecision = this.scoreToFoodDecision(
      nutritionScore,
      locale,
      ctx.goalType,
    );
    const contextReasons: string[] = [];

    // 时间感知决策调整（V2.2: 动态时间边界 + 动态热量阈值）
    const hour = ctx.localHour ?? 12;
    if (hour >= th.lateNightStart || hour < th.lateNightEnd) {
      if (totalCalories > th.significantMealCal) {
        contextReasons.push(t('decision.context.lateNightHighCal', {}, locale));
        if (scoreDecision.recommendation === 'recommend') {
          scoreDecision = this.scoreToFoodDecision(
            Math.min(nutritionScore, 50),
            locale,
            ctx.goalType,
          );
        }
      }
    } else if (hour >= th.eveningStart && hour < th.lateNightStart) {
      if (totalCarbs > th.highCarbMeal && ctx.goalType === 'fat_loss') {
        contextReasons.push(t('decision.context.eveningHighCarb', {}, locale));
      }
    }

    // 餐次感知决策调整（V2.2: 动态阈值）
    const mealType = ctx.mealType;
    if (mealType === 'breakfast') {
      if (
        (ctx.goalType === 'fat_loss' || ctx.goalType === 'muscle_gain') &&
        totalProtein < th.lowProteinMeal &&
        totalCalories > th.snackHighCal
      ) {
        contextReasons.push(
          t('decision.context.breakfastLowProtein', {}, locale),
        );
      }
    } else if (mealType === 'dinner') {
      if (ctx.goalType === 'fat_loss' && totalCarbs > th.dinnerHighCarb) {
        contextReasons.push(t('decision.context.dinnerHighCarb', {}, locale));
      }
    } else if (mealType === 'snack') {
      if (totalCalories > th.snackHighCal) {
        contextReasons.push(t('decision.context.snackHighCal', {}, locale));
      }
    }

    // 热量预算检查（V2.2: 动态 overBudgetMargin）
    if (remainingAfter < -th.overBudgetMargin) {
      contextReasons.push(
        t(
          'decision.context.overBudget',
          { amount: String(Math.abs(Math.round(remainingAfter))) },
          locale,
        ),
      );
    } else if (remainingAfter < 0) {
      contextReasons.push(t('decision.context.nearLimit', {}, locale));
    }

    // 蛋白质检查（V2.2: 动态阈值）
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < th.lowProteinMeal &&
      totalCalories > th.significantMealCal
    ) {
      contextReasons.push(t('decision.context.lowProtein', {}, locale));
    }

    if (ctx.goalType === 'muscle_gain') {
      if (totalProtein >= th.highProteinMeal) {
        contextReasons.push(t('decision.context.goodProtein', {}, locale));
      } else if (
        totalProtein < th.veryLowProteinMeal &&
        totalCalories > th.significantMealCal
      ) {
        contextReasons.push(t('decision.context.lowProteinMuscle', {}, locale));
      }
    }

    // 单餐热量占比检查
    const calorieRatio =
      ctx.goalCalories > 0 ? totalCalories / ctx.goalCalories : 0;
    if (totalCalories > 0 && calorieRatio > th.singleMealMaxRatio) {
      contextReasons.push(t('decision.context.highCalMeal', {}, locale));
    }

    // 脂肪超标检测（V2.2: 动态阈值）
    const projectedFatPct =
      ctx.goalFat > 0 ? ((ctx.todayFat + totalFat) / ctx.goalFat) * 100 : 0;
    if (
      totalFat > th.highFatMeal &&
      projectedFatPct > th.fatExcessRatio * 100 &&
      (ctx.goalType === 'fat_loss' || ctx.goalType === 'health')
    ) {
      contextReasons.push(
        t(
          'decision.context.highFat',
          {
            fat: String(Math.round(totalFat)),
            percent: String(Math.round(projectedFatPct)),
          },
          locale,
        ),
      );
    }

    // 碳水超标检测（V2.2: 动态阈值）
    const projectedCarbsPct =
      ctx.goalCarbs > 0
        ? ((ctx.todayCarbs + totalCarbs) / ctx.goalCarbs) * 100
        : 0;
    if (
      projectedCarbsPct > th.carbExcessRatio * 100 &&
      ctx.goalType === 'fat_loss'
    ) {
      contextReasons.push(
        t(
          'decision.context.highCarbs',
          { percent: String(Math.round(projectedCarbsPct)) },
          locale,
        ),
      );
    }

    // 全目标蛋白检测（午餐后）（V2.2: 动态阈值）
    if (
      hour >= 12 &&
      totalProtein < th.veryLowProteinMeal &&
      totalCalories > th.significantMealCal &&
      ctx.goalProtein > 0
    ) {
      const proteinProgress =
        ((ctx.todayProtein + totalProtein) / ctx.goalProtein) * 100;
      if (proteinProgress < 50 && ctx.goalType !== 'fat_loss') {
        contextReasons.push(
          t('decision.context.lowProteinGeneral', {}, locale),
        );
      }
    }

    // 过敏原检查 → 强制 avoid
    const allergenCheck = checkAllergenConflict(foods, ctx, locale);
    if (allergenCheck?.triggered) {
      contextReasons.unshift(allergenCheck.reason!);
      scoreDecision = {
        recommendation: 'avoid',
        shouldEat: false,
        reason: allergenCheck.reason!,
        riskLevel: 'high',
      };
    }

    // 饮食限制检查
    const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
    if (restrictionCheck?.triggered) {
      contextReasons.unshift(restrictionCheck.reason!);
      scoreDecision = {
        recommendation: 'avoid',
        shouldEat: false,
        reason: restrictionCheck.reason!,
        riskLevel: 'high',
      };
    }

    // 健康状况警告（V2.2: 动态阈值）
    const healthChecks = checkHealthConditionRisk(foods, ctx, locale, th);
    for (const check of healthChecks) {
      if (check.triggered && check.reason) {
        contextReasons.push(check.reason);
      }
    }

    const reason =
      contextReasons.length > 0
        ? contextReasons.join('；')
        : scoreDecision.reason;

    const advice = this.explainer.generateDecisionAdvice(
      scoreDecision,
      ctx,
      totalCalories,
      totalProtein,
      locale,
      totalFat,
      totalCarbs,
      th,
    );

    return { ...scoreDecision, reason, advice };
  }

  // ==================== 评分→决策映射 ====================

  scoreToFoodDecision(
    score: number,
    locale?: Locale,
    goalType?: string,
  ): FoodDecision {
    const thresholds = goalType
      ? GOAL_DECISION_THRESHOLDS[goalType] || DEFAULT_THRESHOLDS
      : DEFAULT_THRESHOLDS;

    if (score >= thresholds.excellent) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: t('decision.score.excellent', {}, locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.good) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: t('decision.score.good', {}, locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.caution) {
      return {
        recommendation: 'caution',
        shouldEat: true,
        reason: t('decision.score.low', {}, locale),
        riskLevel: 'medium',
      };
    }
    return {
      recommendation: 'avoid',
      shouldEat: false,
      reason: t('decision.score.veryLow', {}, locale),
      riskLevel: 'high',
    };
  }

  // ==================== 决策因子提取 ====================

  extractDecisionFactors(
    breakdown: NutritionScoreBreakdown,
    locale?: Locale,
  ): DecisionFactor[] {
    const loc = locale || 'zh-CN';
    const labels = DIMENSION_LABELS[loc] || DIMENSION_LABELS['zh-CN'];
    const factors: DecisionFactor[] = [];

    const entries: Array<[string, number]> = [
      ['energy', breakdown.energy],
      ['proteinRatio', breakdown.proteinRatio],
      ['macroBalance', breakdown.macroBalance],
      ['foodQuality', breakdown.foodQuality],
      ['satiety', breakdown.satiety],
      ['stability', breakdown.stability],
      ['glycemicImpact', breakdown.glycemicImpact],
    ];

    for (const [dim, score] of entries) {
      const roundedScore = Math.round(score);
      if (roundedScore < 30) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'critical',
          message: t(
            'decision.factor.critical',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      } else if (roundedScore < 50) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'warning',
          message: t(
            'decision.factor.warning',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      } else if (roundedScore >= 85) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'positive',
          message: t(
            'decision.factor.positive',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      }
    }

    factors.sort((a, b) => a.score - b.score);
    return factors;
  }

  // ==================== V3.3: 结构化决策 ====================

  /**
   * V3.3: 计算结构化决策（含四维因素明细 + 多维原因）
   *
   * 在原有 computeDecision 基础上，额外输出：
   * - 四维因素评分（nutritionAlignment, macroBalance, healthConstraint, timeliness）
   * - 多维原因（baseline, contextual, goalAlignment, healthRisk, timelinessNote）
   */
  computeStructuredDecision(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    nutritionScore: number,
    breakdown: NutritionScoreBreakdown | undefined,
    locale?: Locale,
  ): StructuredDecision {
    // 先计算基础决策
    const baseDecision = this.computeDecision(
      foods,
      ctx,
      nutritionScore,
      locale,
    );

    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    const hour = ctx.localHour ?? 12;
    const th = this.dynamicThresholds.compute(ctx);

    // 1. nutritionAlignment: 与用户营养目标的匹配度
    const nutritionAlignment = this.computeNutritionAlignment(
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      ctx,
      locale,
    );

    // 2. macroBalance: 宏量均衡性
    const macroBalance = this.computeMacroBalance(breakdown, locale);

    // 3. healthConstraint: 健康约束
    const healthConstraint = this.computeHealthConstraint(foods, ctx, locale);

    // 4. timeliness: 时机合理性
    const timeliness = this.computeTimeliness(
      hour,
      totalCalories,
      totalCarbs,
      ctx,
      th,
      locale,
    );

    // 加权综合评分
    const finalScore = Math.round(
      nutritionAlignment.score * 0.35 +
        macroBalance.score * 0.25 +
        healthConstraint.score * 0.25 +
        timeliness.score * 0.15,
    );

    // 多维原因
    const rationale = this.explainer.buildDetailedRationale(
      baseDecision,
      ctx,
      nutritionScore,
      hour,
      foods,
      locale,
    );

    return {
      verdict: baseDecision.recommendation,
      factors: {
        nutritionAlignment,
        macroBalance,
        healthConstraint,
        timeliness,
      },
      finalScore,
      rationale,
    };
  }

  /**
   * 营养目标匹配度评分
   */
  private computeNutritionAlignment(
    totalCal: number,
    totalProtein: number,
    totalFat: number,
    totalCarbs: number,
    ctx: UnifiedUserContext,
    locale?: Locale,
  ): DecisionFactorDetail {
    const remainingAfter = ctx.remainingCalories - totalCal;
    let score = 80; // 基础

    // 热量匹配
    if (remainingAfter < 0) {
      score -= Math.min(40, Math.abs(remainingAfter) / 10);
    } else if (remainingAfter > ctx.goalCalories * 0.5) {
      score -= 10; // 吃得太少也不理想
    }

    // 蛋白质匹配（对增肌/减脂很重要）
    if (ctx.goalType === 'muscle_gain' || ctx.goalType === 'fat_loss') {
      const proteinRatio =
        ctx.goalProtein > 0
          ? totalProtein / (ctx.remainingProtein || ctx.goalProtein * 0.3)
          : 0.5;
      if (proteinRatio < 0.3) score -= 15;
      else if (proteinRatio > 0.8) score += 10;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const rationale =
      remainingAfter >= 0
        ? t('decision.factor.nutritionOk', {}, locale) ||
          cl('factor.nutritionOk', locale)
        : t(
            'decision.factor.nutritionOver',
            { amount: String(Math.abs(Math.round(remainingAfter))) },
            locale,
          ) ||
          cl('factor.nutritionOver', locale).replace(
            '{amount}',
            String(Math.abs(Math.round(remainingAfter))),
          );

    return { score, rationale };
  }

  /**
   * 宏量均衡性评分
   */
  private computeMacroBalance(
    breakdown: NutritionScoreBreakdown | undefined,
    locale?: Locale,
  ): DecisionFactorDetail {
    if (!breakdown) {
      return {
        score: 60,
        rationale:
          t('decision.factor.noBreakdown', {}, locale) ||
          cl('factor.noBreakdown', locale),
      };
    }

    // 使用已有的 macroBalance 维度 + proteinRatio 维度
    const score = Math.round(
      (breakdown.macroBalance + breakdown.proteinRatio) / 2,
    );
    const rationale =
      score >= 70
        ? t('decision.factor.macroBalanced', {}, locale) ||
          cl('factor.macroBalanced', locale)
        : score >= 40
          ? t('decision.factor.macroImbalanced', {}, locale) ||
            cl('factor.macroImbalanced', locale)
          : t('decision.factor.macroSeverelyImbalanced', {}, locale) ||
            cl('factor.macroSeverelyImbalanced', locale);

    return { score, rationale };
  }

  /**
   * 健康约束评分
   */
  private computeHealthConstraint(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    locale?: Locale,
  ): DecisionFactorDetail {
    let score = 100;
    const issues: string[] = [];

    // 过敏原检查
    const allergenCheck = checkAllergenConflict(foods, ctx, locale);
    if (allergenCheck?.triggered) {
      score = 0;
      issues.push(
        allergenCheck.reason ||
          t('decision.factor.allergenDetected', {}, locale) ||
          'Allergen detected',
      );
    }

    // 饮食限制检查
    const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
    if (restrictionCheck?.triggered) {
      score = Math.min(score, 10);
      issues.push(
        restrictionCheck.reason ||
          t('decision.factor.restrictionViolated', {}, locale) ||
          'Dietary restriction violated',
      );
    }

    // 健康状况检查
    const th = this.dynamicThresholds.compute(ctx);
    const healthChecks = checkHealthConditionRisk(foods, ctx, locale, th);
    for (const check of healthChecks) {
      if (check.triggered) {
        score = Math.min(score, 30);
        if (check.reason) issues.push(check.reason);
      }
    }

    const rationale =
      issues.length > 0
        ? issues[0]
        : t('decision.factor.noHealthIssue', {}, locale) ||
          cl('factor.noHealthIssue', locale);

    return { score, rationale };
  }

  /**
   * 时机合理性评分
   */
  private computeTimeliness(
    hour: number,
    totalCalories: number,
    totalCarbs: number,
    ctx: UnifiedUserContext,
    th: UserThresholds,
    locale?: Locale,
  ): DecisionFactorDetail {
    let score = 90;
    let rationale =
      t('decision.factor.goodTiming', {}, locale) ||
      cl('factor.goodTiming', locale);

    // 深夜
    if (hour >= th.lateNightStart || hour < th.lateNightEnd) {
      if (totalCalories > th.significantMealCal) {
        score = 30;
        rationale =
          t('decision.factor.lateNight', {}, locale) ||
          cl('factor.lateNight', locale);
      } else {
        score = 60;
        rationale =
          t('decision.factor.lateNightLight', {}, locale) ||
          cl('factor.lateNightLight', locale);
      }
    }
    // 晚间高碳水
    else if (hour >= th.eveningStart && hour < th.lateNightStart) {
      if (totalCarbs > th.highCarbMeal && ctx.goalType === 'fat_loss') {
        score = 50;
        rationale =
          t('decision.factor.eveningHighCarb', {}, locale) ||
          cl('factor.eveningHighCarb', locale);
      }
    }

    return { score, rationale };
  }
}
