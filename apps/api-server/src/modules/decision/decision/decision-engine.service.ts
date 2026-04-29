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
import { I18nService, I18nLocale } from '../../../core/i18n';

import {
  GOAL_DECISION_THRESHOLDS,
  DEFAULT_THRESHOLDS,
} from '../config/decision-thresholds';
import { ConflictReportBuilderService } from '../checks/conflict-report-builder.service';
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
    private readonly i18n: I18nService,
    private readonly conflictReport: ConflictReportBuilderService,
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
    locale?: I18nLocale,
    breakdown?: NutritionScoreBreakdown,
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
      ctx.goalProgress,
    );
    const contextReasons: string[] = [];

    // V4.6: 小份健康零食/零热量饮品豁免
    // 场景：低热量、高食物质量但低蛋白的天然食物（苹果/胡萝卜/白开水等）
    // 原始评分会因 proteinRatio/macroBalance 偏低落到 caution，但语义上不应建议"减少份量"。
    // 条件：snack 餐次 + kcal<200 + foodQuality≥60 + 在预算内 + 评分为 caution。
    const isLightHealthySnack =
      breakdown !== undefined &&
      ctx.mealType === 'snack' &&
      totalCalories < 200 &&
      breakdown.foodQuality >= 60 &&
      remainingAfter >= 0 &&
      scoreDecision.recommendation === 'caution';
    if (isLightHealthySnack) {
      scoreDecision = {
        recommendation: 'recommend',
        shouldEat: true,
        reason: this.i18n.t('decision.score.lightSnackOk', locale),
        riskLevel: 'low',
      };
    }

    // 时间感知决策调整（V2.2: 动态时间边界 + 动态热量阈值）
    const hour = ctx.localHour ?? 12;
    if (hour >= th.lateNightStart || hour < th.lateNightEnd) {
      if (totalCalories > th.significantMealCal) {
        contextReasons.push(
          this.i18n.t('decision.context.lateNightHighCal', locale),
        );
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
        contextReasons.push(
          this.i18n.t('decision.context.eveningHighCarb', locale),
        );
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
          this.i18n.t('decision.context.breakfastLowProtein', locale),
        );
      }
    } else if (mealType === 'dinner') {
      if (ctx.goalType === 'fat_loss' && totalCarbs > th.dinnerHighCarb) {
        contextReasons.push(
          this.i18n.t('decision.context.dinnerHighCarb', locale),
        );
      }
    } else if (mealType === 'snack') {
      if (totalCalories > th.snackHighCal) {
        contextReasons.push(
          this.i18n.t('decision.context.snackHighCal', locale),
        );
      }
    }

    // 热量预算检查（V2.2: 动态 overBudgetMargin）
    if (remainingAfter < -th.overBudgetMargin) {
      contextReasons.push(
        this.i18n.t('decision.context.overBudget', locale, {
          amount: Math.abs(Math.round(remainingAfter)),
        }),
      );
    } else if (remainingAfter < 0) {
      contextReasons.push(this.i18n.t('decision.context.nearLimit', locale));
    }

    // 蛋白质检查（V2.2: 动态阈值）
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < th.lowProteinMeal &&
      totalCalories > th.significantMealCal
    ) {
      contextReasons.push(this.i18n.t('decision.context.lowProtein', locale));
    }

    if (ctx.goalType === 'muscle_gain') {
      if (totalProtein >= th.highProteinMeal) {
        contextReasons.push(
          this.i18n.t('decision.context.goodProtein', locale),
        );
      } else if (
        totalProtein < th.veryLowProteinMeal &&
        totalCalories > th.significantMealCal
      ) {
        contextReasons.push(
          this.i18n.t('decision.context.lowProteinMuscle', locale),
        );
      }
    }

    // 单餐热量占比检查
    const calorieRatio =
      ctx.goalCalories > 0 ? totalCalories / ctx.goalCalories : 0;
    if (totalCalories > 0 && calorieRatio > th.singleMealMaxRatio) {
      contextReasons.push(this.i18n.t('decision.context.highCalMeal', locale));
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
        this.i18n.t('decision.context.highFat', locale, {
          fat: Math.round(totalFat),
          percent: Math.round(projectedFatPct),
        }),
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
        this.i18n.t('decision.context.highCarbs', locale, {
          percent: Math.round(projectedCarbsPct),
        }),
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
          this.i18n.t('decision.context.lowProteinGeneral', locale),
        );
      }
    }

    // 过敏原 / 饮食限制 / 健康状况 → 统一冲突报告（V4.5）
    const conflictReport = this.conflictReport.build(foods, ctx, locale, th);
    if (conflictReport.hasConflict) {
      for (const item of conflictReport.items) {
        if (item.message) {
          // override 项优先插到最前
          if (item.decisionOverride) {
            contextReasons.unshift(item.message);
          } else {
            contextReasons.push(item.message);
          }
        }
      }
      if (conflictReport.forceOverride === 'avoid') {
        scoreDecision = {
          recommendation: 'avoid',
          shouldEat: false,
          reason:
            conflictReport.items[0]?.message ??
            this.i18n.t('decision.score.veryLow', locale),
          riskLevel: 'high',
        };
      } else if (
        conflictReport.forceOverride === 'caution' &&
        scoreDecision.recommendation === 'recommend'
      ) {
        scoreDecision = {
          recommendation: 'caution',
          shouldEat: true,
          reason:
            conflictReport.items[0]?.message ??
            this.i18n.t('decision.score.low', locale),
          riskLevel: 'medium',
        };
      }
    }

    const reason =
      contextReasons.length > 0
        ? contextReasons.join(this.i18n.t('decision.separator.list', locale))
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
    locale?: I18nLocale,
    goalType?: string,
    goalProgress?: UnifiedUserContext['goalProgress'],
  ): FoodDecision {
    const baseThresholds = goalType
      ? GOAL_DECISION_THRESHOLDS[goalType] || DEFAULT_THRESHOLDS
      : DEFAULT_THRESHOLDS;

    // V4.0: 根据执行率和连续天数动态调整阈值
    // 执行率低（<50%）→ 适当放宽（降低阈值5分，避免过严导致放弃）
    // 连续天数高（>7天）→ 可适当收紧（提高阈值3分，用户已建立习惯）
    let thresholdAdjust = 0;
    if (goalProgress) {
      if (goalProgress.executionRate < 0.5) {
        thresholdAdjust = -5;
      } else if (
        goalProgress.executionRate > 0.8 &&
        goalProgress.streakDays > 7
      ) {
        thresholdAdjust = 3;
      }
    }

    const thresholds = {
      excellent: baseThresholds.excellent + thresholdAdjust,
      good: baseThresholds.good + thresholdAdjust,
      caution: baseThresholds.caution + thresholdAdjust,
    };

    if (score >= thresholds.excellent) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: this.i18n.t('decision.score.excellent', locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.good) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: this.i18n.t('decision.score.good', locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.caution) {
      return {
        recommendation: 'caution',
        shouldEat: true,
        reason: this.i18n.t('decision.score.low', locale),
        riskLevel: 'medium',
      };
    }
    return {
      recommendation: 'avoid',
      shouldEat: false,
      reason: this.i18n.t('decision.score.veryLow', locale),
      riskLevel: 'high',
    };
  }

  // ==================== 决策因子提取 ====================

  extractDecisionFactors(
    breakdown: NutritionScoreBreakdown,
    locale?: I18nLocale,
  ): DecisionFactor[] {
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
      // i18n-allow-dynamic
      const dimensionLabel = this.i18n.t(`decision.dim.label.${dim}`, locale);
      if (roundedScore < 30) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'critical',
          message: this.i18n.t('decision.factor.critical', locale, {
            dimension: dimensionLabel,
            score: roundedScore,
          }),
        });
      } else if (roundedScore < 50) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'warning',
          message: this.i18n.t('decision.factor.warning', locale, {
            dimension: dimensionLabel,
            score: roundedScore,
          }),
        });
      } else if (roundedScore >= 85) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'positive',
          message: this.i18n.t('decision.factor.positive', locale, {
            dimension: dimensionLabel,
            score: roundedScore,
          }),
        });
      }
    }

    factors.sort((a, b) => a.score - b.score);
    return factors;
  }

  // ==================== V3.3: 结构化决策 ====================

  /** V4.2: 目标自适应权重 */
  private static readonly GOAL_FACTOR_WEIGHTS: Record<
    string,
    {
      nutrition: number;
      macroBalance: number;
      healthConstraint: number;
      timeliness: number;
    }
  > = {
    fat_loss: {
      nutrition: 0.4,
      macroBalance: 0.25,
      healthConstraint: 0.2,
      timeliness: 0.15,
    },
    muscle_gain: {
      nutrition: 0.3,
      macroBalance: 0.35,
      healthConstraint: 0.2,
      timeliness: 0.15,
    },
    health: {
      nutrition: 0.25,
      macroBalance: 0.2,
      healthConstraint: 0.4,
      timeliness: 0.15,
    },
    maintain: {
      nutrition: 0.3,
      macroBalance: 0.3,
      healthConstraint: 0.2,
      timeliness: 0.2,
    },
    habit: {
      nutrition: 0.3,
      macroBalance: 0.25,
      healthConstraint: 0.25,
      timeliness: 0.2,
    },
  };

  private static readonly DEFAULT_FACTOR_WEIGHTS = {
    nutrition: 0.3,
    macroBalance: 0.25,
    healthConstraint: 0.25,
    timeliness: 0.2,
  };

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
    locale?: I18nLocale,
  ): StructuredDecision {
    // 先计算基础决策
    const baseDecision = this.computeDecision(
      foods,
      ctx,
      nutritionScore,
      locale,
      breakdown,
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

    // V4.2: 目标自适应加权综合评分
    const w =
      DecisionEngineService.GOAL_FACTOR_WEIGHTS[ctx.goalType] ||
      DecisionEngineService.DEFAULT_FACTOR_WEIGHTS;
    const finalScore = Math.round(
      nutritionAlignment.score * w.nutrition +
        macroBalance.score * w.macroBalance +
        healthConstraint.score * w.healthConstraint +
        timeliness.score * w.timeliness,
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
    locale?: I18nLocale,
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
        ? this.i18n.t('decision.factor.nutritionOk', locale)
        : this.i18n.t('decision.factor.nutritionOver', locale, {
            amount: Math.abs(Math.round(remainingAfter)),
          });

    return { score, rationale };
  }

  /**
   * 宏量均衡性评分
   */
  private computeMacroBalance(
    breakdown: NutritionScoreBreakdown | undefined,
    locale?: I18nLocale,
  ): DecisionFactorDetail {
    if (!breakdown) {
      return {
        score: 60,
        rationale: this.i18n.t('decision.factor.noBreakdown', locale),
      };
    }

    // 使用已有的 macroBalance 维度 + proteinRatio 维度
    const score = Math.round(
      (breakdown.macroBalance + breakdown.proteinRatio) / 2,
    );
    const rationale =
      score >= 70
        ? this.i18n.t('decision.factor.macroBalanced', locale)
        : score >= 40
          ? this.i18n.t('decision.factor.macroImbalanced', locale)
          : this.i18n.t('decision.factor.macroSeverelyImbalanced', locale);

    return { score, rationale };
  }

  /**
   * 健康约束评分
   */
  private computeHealthConstraint(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    locale?: I18nLocale,
  ): DecisionFactorDetail {
    let score = 100;
    const issues: string[] = [];

    const th = this.dynamicThresholds.compute(ctx);
    const conflictReport = this.conflictReport.build(foods, ctx, locale, th);

    for (const item of conflictReport.items) {
      if (item.severity === 'critical' && item.decisionOverride === 'avoid') {
        score = 0;
      } else if (item.decisionOverride === 'avoid') {
        score = Math.min(score, 10);
      } else {
        score = Math.min(score, 30);
      }
      if (item.message) issues.push(item.message);
    }

    const rationale =
      issues.length > 0
        ? issues[0]
        : this.i18n.t('decision.factor.noHealthIssue', locale);

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
    locale?: I18nLocale,
  ): DecisionFactorDetail {
    let score = 90;
    let rationale = this.i18n.t('decision.factor.goodTiming', locale);

    // 深夜
    if (hour >= th.lateNightStart || hour < th.lateNightEnd) {
      if (totalCalories > th.significantMealCal) {
        score = 30;
        rationale = this.i18n.t('decision.factor.lateNight', locale);
      } else {
        score = 60;
        rationale = this.i18n.t('decision.factor.lateNightLight', locale);
      }
    }
    // 晚间高碳水
    else if (hour >= th.eveningStart && hour < th.lateNightStart) {
      if (totalCarbs > th.highCarbMeal && ctx.goalType === 'fat_loss') {
        score = 50;
        rationale = this.i18n.t('decision.factor.eveningHighCarb', locale);
      }
    }

    return { score, rationale };
  }
}
