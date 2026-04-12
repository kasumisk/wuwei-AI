/**
 * V7.2 P2-E: InsightGeneratorService — 结构化洞察生成器
 *
 * 从 ExplanationGeneratorService.generateStructuredInsights() 拆分而来。
 * 接受 InsightContext 参数对象（替代原 9 个位置参数），生成前端可视化的推荐洞察。
 *
 * 当前支持 10 种洞察类型：
 * 1. nutrient_contribution — 蛋白质贡献
 * 2. goal_alignment — 热量匹配度
 * 3. scene_match — 场景匹配
 * 4. diversity_note — 多样性提示（新品类 / 整餐多样性）
 * 5. execution_tip — 执行难度提示
 * 6. goal_progress — 目标进度（合规率 / 连续天数 / 阶段转换）
 * 7. substitution_rationale — 替换解释
 * 8. cross_meal_context — 跨餐补偿
 * 9. actionable_tip — 行动建议
 * 10. contrastive — 对比解释
 *
 * 设计原则：
 * - 纯逻辑，无外部 DI 依赖
 * - 仅对最终推荐的食物（Top-K）调用，不影响批量评分性能
 * - 按 importance 降序排列返回
 */

import { Injectable } from '@nestjs/common';
import type { InsightContext } from './insight.types';
import type { ScoreDimension, StructuredInsight } from './recommendation.types';

@Injectable()
export class InsightGeneratorService {
  /**
   * 生成结构化洞察
   *
   * @param ctx 洞察上下文（替代原 9 个位置参数）
   * @returns 按重要性降序排列的洞察列表
   */
  generate(ctx: InsightContext): StructuredInsight[] {
    const insights: StructuredInsight[] = [];
    const { foods, target } = ctx;

    if (foods.length === 0) return insights;

    // 1. 营养素贡献 — 蛋白质
    this.addProteinContribution(insights, ctx);

    // 2. 目标匹配度 — 热量
    this.addCalorieAlignment(insights, ctx);

    // 3. 场景匹配
    this.addSceneMatch(insights, ctx);

    // 4. 多样性提示
    this.addDiversityNotes(insights, ctx);

    // 5. 执行难度提示
    this.addExecutionTip(insights, ctx);

    // 6. 目标进度洞察
    this.addGoalProgress(insights, ctx);

    // 7. 替换解释
    this.addSubstitutionRationale(insights, ctx);

    // 8. 跨餐补偿
    this.addCrossMealContext(insights, ctx);

    // 9. 行动建议
    this.addActionableTips(insights, ctx);

    // 10. 对比解释
    this.addContrastive(insights, ctx);

    return insights.sort((a, b) => b.importance - a.importance);
  }

  // ─── 私有方法：各洞察类型生成 ───

  private addProteinContribution(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, target } = ctx;
    const totalProtein = foods.reduce((s, f) => s + f.servingProtein, 0);
    if (target.protein <= 0) return;

    const pctProtein = Math.round((totalProtein / target.protein) * 100);
    insights.push({
      type: 'nutrient_contribution',
      titleKey: 'insight.protein_contribution.title',
      contentKey: 'insight.protein_contribution.content',
      vars: {
        percent: pctProtein,
        grams: Math.round(totalProtein),
        protein: Math.round(totalProtein),
        foodName: foods[0]?.food.name ?? '',
        ratio: pctProtein,
      },
      visualization: {
        chartType: 'progress_bar',
        data: {
          current: Math.round(totalProtein),
          target: target.protein,
          percent: pctProtein,
        },
      },
      importance: pctProtein >= 80 ? 0.9 : 0.6,
    });
  }

  private addCalorieAlignment(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, target } = ctx;
    const totalCal = foods.reduce((s, f) => s + f.servingCalories, 0);
    if (target.calories <= 0) return;

    const calDeviation = Math.abs(totalCal - target.calories) / target.calories;
    const deviationPct = Math.round(calDeviation * 100);
    insights.push({
      type: 'goal_alignment',
      titleKey: 'insight.calorie_match.title',
      contentKey:
        calDeviation < 0.1
          ? 'insight.calorie_match.excellent'
          : 'insight.calorie_match.moderate',
      vars: {
        calories: Math.round(totalCal),
        target: target.calories,
        deviation: deviationPct,
      },
      visualization: {
        chartType: 'comparison',
        data: { actual: Math.round(totalCal), target: target.calories },
      },
      importance: calDeviation < 0.1 ? 0.8 : 0.5,
    });
  }

  private addSceneMatch(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { sceneContext } = ctx;
    if (!sceneContext || sceneContext.sceneType === 'general') return;

    insights.push({
      type: 'scene_match',
      titleKey: 'insight.scene_match.title',
      contentKey: `insight.scene_match.${sceneContext.sceneType}`,
      vars: { scene: sceneContext.sceneType },
      importance: 0.7,
    });
  }

  private addDiversityNotes(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, dailyPlan } = ctx;
    if (!dailyPlan) return;

    // 新品类
    const newCategories = foods
      .map((f) => f.food.category)
      .filter((c) => !dailyPlan.categoryCounts[c]);
    if (newCategories.length > 0) {
      const uniqueNew = [...new Set(newCategories)];
      insights.push({
        type: 'diversity_note',
        titleKey: 'insight.new_category.title',
        contentKey: 'insight.new_category.content',
        vars: {
          categories: uniqueNew.join(', '),
          foodName:
            foods.find((f) => uniqueNew.includes(f.food.category))?.food.name ??
            '',
          category: uniqueNew[0] ?? '',
          categoryCount: uniqueNew.length,
        },
        importance: 0.6,
      });
    }

    // 整餐多样性加分
    const mealCategories = new Set(foods.map((f) => f.food.category));
    if (mealCategories.size >= 3) {
      insights.push({
        type: 'diversity_note',
        titleKey: 'insight.diversity.title',
        contentKey: 'insight.diversity.content',
        vars: { categoryCount: mealCategories.size },
        visualization: {
          chartType: 'badge',
          data: { count: mealCategories.size },
        },
        importance: 0.55,
      });
    }
  }

  private addExecutionTip(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, sceneContext } = ctx;
    if (!sceneContext) return;

    const avgCookTime =
      foods.reduce((s, f) => s + (f.food.cookTimeMinutes ?? 0), 0) /
      Math.max(foods.length, 1);
    if (avgCookTime <= 0) return;

    const minutes = Math.round(avgCookTime);
    let difficultyKey: string;
    if (minutes <= 15) {
      difficultyKey = 'insight.execution.easy';
    } else if (minutes <= 40) {
      difficultyKey = 'insight.execution.medium';
    } else {
      difficultyKey = 'insight.execution.hard';
    }
    insights.push({
      type: 'execution_tip',
      titleKey: 'insight.execution.title',
      contentKey: difficultyKey,
      vars: { minutes },
      importance: 0.45,
    });
  }

  private addGoalProgress(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { effectiveGoal, goalProgress } = ctx;
    if (!goalProgress) return;

    const calCompliance = Math.round(goalProgress.calorieCompliance * 100);
    const protCompliance = Math.round(goalProgress.proteinCompliance * 100);
    const execRate = Math.round(goalProgress.executionRate * 100);

    // 连续天数徽章
    if (goalProgress.streakDays >= 3) {
      insights.push({
        type: 'goal_progress',
        titleKey: 'insight.goal_progress.streak.title',
        contentKey: 'insight.goal_progress.streak.content',
        vars: {
          streakDays: goalProgress.streakDays,
          executionRate: execRate,
        },
        visualization: {
          chartType: 'badge',
          data: { count: goalProgress.streakDays },
        },
        importance: 0.85,
      });
    }

    // 热量/蛋白合规率
    insights.push({
      type: 'goal_progress',
      titleKey: 'insight.goal_progress.compliance.title',
      contentKey:
        calCompliance >= 85
          ? 'insight.goal_progress.compliance.good'
          : 'insight.goal_progress.compliance.needs_improvement',
      vars: {
        calorieCompliance: calCompliance,
        proteinCompliance: protCompliance,
        executionRate: execRate,
      },
      visualization: {
        chartType: 'progress_bar',
        data: {
          current: calCompliance,
          target: 100,
          percent: calCompliance,
        },
      },
      importance: calCompliance >= 85 ? 0.75 : 0.8,
    });

    // 阶段转换提示
    if (
      effectiveGoal?.currentPhase &&
      goalProgress?.phaseRemainingDays != null
    ) {
      const remaining = goalProgress.phaseRemainingDays;
      const phaseProgress = Math.round((goalProgress.phaseProgress ?? 0) * 100);

      if (remaining <= 7 && remaining > 0) {
        insights.push({
          type: 'goal_progress',
          titleKey: 'insight.goal_progress.phase_transition.title',
          contentKey: 'insight.goal_progress.phase_transition.content',
          vars: {
            phaseName:
              effectiveGoal.currentPhase.name ?? effectiveGoal.goalType,
            remainingDays: remaining,
            phaseProgress,
          },
          importance: 0.9,
        });
      }
    }
  }

  private addSubstitutionRationale(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, substitutions } = ctx;
    if (!substitutions || substitutions.length === 0) return;

    const foodNames = new Set(foods.map((f) => f.food.name));
    const matchedSubs = substitutions.filter(
      (s) => foodNames.has(s.toFoodName) && s.frequency >= 2,
    );
    if (matchedSubs.length === 0) return;

    const topSub = matchedSubs.sort((a, b) => b.frequency - a.frequency)[0];
    insights.push({
      type: 'substitution_rationale',
      titleKey: 'insight.substitution_rationale.title',
      contentKey: 'insight.substitution_rationale.content',
      vars: {
        toFood: topSub.toFoodName,
        fromFood: topSub.fromFoodName,
        frequency: topSub.frequency,
      },
      importance: 0.65,
    });
  }

  private addCrossMealContext(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { crossMealAdjustment } = ctx;
    if (!crossMealAdjustment || crossMealAdjustment.reason === 'first_meal') {
      return;
    }

    const reasons = crossMealAdjustment.reason.split('+').map((r) => r.trim());
    const primaryReason = reasons[0] ?? 'adjustment';

    let contentKey = 'insight.cross_meal_context.generic';
    if (primaryReason.startsWith('light_breakfast')) {
      contentKey = 'insight.cross_meal_context.light_breakfast';
    } else if (primaryReason.startsWith('high_carb')) {
      contentKey = 'insight.cross_meal_context.high_carb';
    } else if (primaryReason.startsWith('low_protein')) {
      contentKey = 'insight.cross_meal_context.low_protein';
    } else if (primaryReason.startsWith('cuisine_monotony')) {
      contentKey = 'insight.cross_meal_context.cuisine_diversity';
    }

    insights.push({
      type: 'cross_meal_context',
      titleKey: 'insight.cross_meal_context.title',
      contentKey,
      vars: {
        calorieMultiplier:
          Math.round(crossMealAdjustment.calorieMultiplier * 100) / 100,
        cuisineDiversityBonus: Math.round(
          crossMealAdjustment.cuisineDiversityBonus * 100,
        ),
        reason: crossMealAdjustment.reason,
      },
      importance: 0.7,
    });
  }

  private addActionableTips(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods, target, sceneContext } = ctx;

    // 场景特定行动建议
    if (sceneContext && sceneContext.channel) {
      const channel = sceneContext.channel;

      // HOME_COOK 场景: 提前准备建议
      if (channel === 'home_cook' && foods.length >= 2) {
        const avgCookTime =
          foods.reduce((s, f) => s + ((f as any).food?.cookTime ?? 0), 0) /
          foods.length;
        if (avgCookTime > 30) {
          insights.push({
            type: 'actionable_tip',
            titleKey: 'insight.actionable_tip.prep_time.title',
            contentKey: 'insight.actionable_tip.prep_time.content',
            vars: {
              avgMinutes: Math.round(avgCookTime),
              foodCount: foods.length,
            },
            importance: 0.4,
          });
        }
      }

      // DELIVERY/CONVENIENCE: 点餐建议
      if (channel === 'delivery' || channel === 'convenience') {
        const totalCal = foods.reduce((s, f) => s + f.servingCalories, 0);
        if (target.calories > 0 && totalCal / target.calories > 0.9) {
          insights.push({
            type: 'actionable_tip',
            titleKey: 'insight.actionable_tip.portion_control.title',
            contentKey: 'insight.actionable_tip.portion_control.content',
            vars: {
              totalCalories: Math.round(totalCal),
              targetCalories: Math.round(target.calories),
            },
            importance: 0.35,
          });
        }
      }
    }

    // 蛋白质补充建议（通用）
    if (target.protein > 0) {
      const actualProtein = foods.reduce((s, f) => s + f.servingProtein, 0);
      const proteinGap = target.protein - actualProtein;
      if (proteinGap > target.protein * 0.3) {
        insights.push({
          type: 'actionable_tip',
          titleKey: 'insight.actionable_tip.protein_gap.title',
          contentKey: 'insight.actionable_tip.protein_gap.content',
          vars: {
            gapGrams: Math.round(proteinGap),
            targetProtein: Math.round(target.protein),
          },
          importance: 0.5,
        });
      }
    }
  }

  private addContrastive(
    insights: StructuredInsight[],
    ctx: InsightContext,
  ): void {
    const { foods } = ctx;
    if (foods.length < 2) return;

    const sorted = [...foods].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const runner = sorted[1];
    if (top.score <= 0 || runner.score <= 0) return;

    const diff = (top.score - runner.score) / top.score;
    if (diff <= 0.15) return;

    // 找到 top 的最大优势维度
    const topExpl = top.explanation;
    const runnerExpl = runner.explanation;
    let bestDim = 'quality';
    let bestDiff = 0;
    if (topExpl?.dimensions && runnerExpl?.dimensions) {
      for (const dim of Object.keys(topExpl.dimensions) as ScoreDimension[]) {
        const topVal = topExpl.dimensions[dim]?.weighted ?? 0;
        const runnerVal = runnerExpl.dimensions[dim]?.weighted ?? 0;
        const dimDiff = topVal - runnerVal;
        if (dimDiff > bestDiff) {
          bestDiff = dimDiff;
          bestDim = dim;
        }
      }
    }

    insights.push({
      type: 'contrastive',
      titleKey: 'insight.contrastive.title',
      contentKey: 'insight.contrastive.content',
      vars: {
        recommended: top.food.name,
        alternative: runner.food.name,
        advantageDimension: bestDim,
        differencePercent: Math.round(diff * 100),
      },
      importance: 0.5,
    });
  }
}
