/**
 * V7.6 P2-B: 整餐解释服务
 *
 * 从 ExplanationGeneratorService 拆分。
 * 负责整餐层面的解释生成：
 * - 整餐搭配摘要（explainMealComposition）
 * - 营养互补对检测
 * - 宏量营养素分布计算
 * - 多样性改善建议
 */

import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import {
  ScoredFood,
  MealTarget,
  UserProfileConstraints,
  ScoreDimension,
  SCORE_DIMENSIONS,
} from './recommendation.types';
import type { ScoringExplanation } from './scoring-explanation.interface';
import { t, Locale } from './i18n-messages';
import {
  MealCompositionScorer,
  MealCompositionScore,
} from './meal-composition-scorer.service';
import type {
  MealCompositionExplanation,
  ComplementaryPairExplanation,
  MacroBalanceInfo,
} from './explanation.types';

/**
 * 获取目标类型的国际化文案（内部使用）
 */
function getGoalLabel(goalType: string | undefined, locale?: Locale): string {
  if (
    goalType &&
    ['fat_loss', 'muscle_gain', 'health', 'habit'].includes(goalType)
  ) {
    return t(`explain.goal.${goalType}`, {}, locale);
  }
  return t('explain.goal.default', {}, locale);
}

@Injectable()
export class MealExplanationService {
  constructor(private readonly mealCompositionScorer: MealCompositionScorer) {}

  /**
   * V6.3 P3-1: 解释整餐搭配逻辑
   * V6.5 Phase 2E: 升级为结构化整餐分析
   *
   * 包含：组合评分、互补营养素对、宏量分布、多样性建议。
   */
  explainMealComposition(
    picks: ScoredFood[],
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
    target?: MealTarget,
  ): MealCompositionExplanation {
    const summary = this.buildMealSummary(picks, userProfile, goalType, locale);

    // V6.5: 使用 MealCompositionScorer 计算组合评分
    const compositionScore =
      this.mealCompositionScorer.scoreMealComposition(picks);

    const complementaryPairs = this.detectComplementaryPairs(picks, locale);
    const macroBalance = this.calcMacroBalance(picks, target);
    const diversityTips = this.generateDiversityTips(
      picks,
      compositionScore,
      locale,
    );

    return {
      summary,
      compositionScore,
      complementaryPairs: complementaryPairs.length
        ? complementaryPairs
        : undefined,
      macroBalance,
      diversityTips: diversityTips.length ? diversityTips : undefined,
    };
  }

  // ─── V6.5 Phase 2E: 整餐解释增强私有方法 ───

  /**
   * 检测整餐中的营养互补关系
   */
  private detectComplementaryPairs(
    picks: ScoredFood[],
    locale?: Locale,
  ): ComplementaryPairExplanation[] {
    if (picks.length < 2) return [];

    const PAIRS: ReadonlyArray<{
      a: keyof FoodLibrary;
      b: keyof FoodLibrary;
      labelAKey: string;
      labelBKey: string;
      benefitKey: string;
    }> = [
      {
        a: 'iron',
        b: 'vitaminC',
        labelAKey: 'explain.synergy.label.iron',
        labelBKey: 'explain.synergy.label.vitaminC',
        benefitKey: 'explain.synergy.iron_vitaminC',
      },
      {
        a: 'calcium',
        b: 'vitaminD',
        labelAKey: 'explain.synergy.label.calcium',
        labelBKey: 'explain.synergy.label.vitaminD',
        benefitKey: 'explain.synergy.calcium_vitaminD',
      },
      {
        a: 'fat',
        b: 'vitaminA',
        labelAKey: 'explain.synergy.label.fat',
        labelBKey: 'explain.synergy.label.vitaminA',
        benefitKey: 'explain.synergy.fat_vitaminA',
      },
      {
        a: 'protein',
        b: 'vitaminB12',
        labelAKey: 'explain.synergy.label.protein',
        labelBKey: 'explain.synergy.label.vitaminB12',
        benefitKey: 'explain.synergy.protein_vitaminB12',
      },
    ];

    const result: ComplementaryPairExplanation[] = [];

    for (const pair of PAIRS) {
      const foodWithA = picks.find((p) => {
        const val = p.food[pair.a];
        return typeof val === 'number' && val > 0;
      });
      const foodWithB = picks.find((p) => {
        const val = p.food[pair.b];
        return typeof val === 'number' && val > 0;
      });

      if (foodWithA && foodWithB && foodWithA.food.id !== foodWithB.food.id) {
        result.push({
          nutrientA: t(pair.labelAKey, {}, locale),
          foodA: foodWithA.food.name,
          nutrientB: t(pair.labelBKey, {}, locale),
          foodB: foodWithB.food.name,
          benefit: t(pair.benefitKey, {}, locale),
        });
      }
    }

    return result;
  }

  /**
   * 计算宏量营养素分布
   */
  private calcMacroBalance(
    picks: ScoredFood[],
    target?: MealTarget,
  ): MacroBalanceInfo {
    const caloriesTotal = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);

    // 宏量营养素热量计算（4:4:9）
    const proteinCal = totalProtein * 4;
    const carbsCal = totalCarbs * 4;
    const fatCal = totalFat * 9;
    const totalMacroCal = proteinCal + carbsCal + fatCal || 1;

    const proteinPct = Math.round((proteinCal / totalMacroCal) * 100);
    const carbsPct = Math.round((carbsCal / totalMacroCal) * 100);
    const fatPct = Math.round((fatCal / totalMacroCal) * 100);

    // 计算与目标的匹配度
    let targetMatch = 50; // 默认中等
    if (target) {
      const calDiff =
        target.calories > 0
          ? Math.abs(caloriesTotal - target.calories) / target.calories
          : 0;
      const proteinDiff =
        target.protein > 0
          ? Math.abs(totalProtein - target.protein) / target.protein
          : 0;
      // 匹配度 = 100 - 平均偏差百分比 * 100，下限 0
      const avgDiff = (calDiff + proteinDiff) / 2;
      targetMatch = Math.max(0, Math.round((1 - avgDiff) * 100));
    }

    return {
      caloriesTotal: Math.round(caloriesTotal),
      proteinPct,
      carbsPct,
      fatPct,
      targetMatch,
    };
  }

  /**
   * 生成多样性改善建议
   */
  private generateDiversityTips(
    picks: ScoredFood[],
    compositionScore?: MealCompositionScore,
    locale?: Locale,
  ): string[] {
    const tips: string[] = [];

    if (!compositionScore) return tips;

    if (compositionScore.ingredientDiversity < 60) {
      tips.push(t('explain.diversity.ingredientRepeat', {}, locale));
    }

    if (compositionScore.cookingMethodDiversity < 50) {
      // 找到最常见的烹饪方式
      const methods = picks
        .map((p) => p.food.cookingMethod)
        .filter(Boolean) as string[];
      const methodCount = new Map<string, number>();
      for (const m of methods) {
        methodCount.set(m, (methodCount.get(m) ?? 0) + 1);
      }
      const dominant = [...methodCount.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (dominant && dominant[1] > 1) {
        const altKey =
          dominant[0] === '炒'
            ? 'explain.diversity.cookAlt.stir_fry'
            : dominant[0] === '炸'
              ? 'explain.diversity.cookAlt.deep_fry'
              : 'explain.diversity.cookAlt.default';
        tips.push(
          t(
            'explain.diversity.cookingMethodTooMany',
            { method: dominant[0], alternative: t(altKey, {}, locale) },
            locale,
          ),
        );
      }
    }

    if (compositionScore.flavorHarmony < 40) {
      tips.push(t('explain.diversity.flavorMonotone', {}, locale));
    }

    // V6.7 Phase 2-C: 质感多样性建议
    if (
      compositionScore.textureDiversity != null &&
      compositionScore.textureDiversity < 40
    ) {
      tips.push(t('explain.diversity.textureMonotone', {}, locale));
    }

    if (compositionScore.nutritionComplementarity < 25) {
      tips.push(t('explain.diversity.addVitaminC', {}, locale));
    }

    return tips;
  }

  /**
   * 原有 summary 生成逻辑（从 explainMealComposition 提取）
   */
  private buildMealSummary(
    picks: ScoredFood[],
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
  ): string {
    const topProtein = [...picks].sort(
      (a, b) => b.servingProtein - a.servingProtein,
    )[0];
    const topFiber = [...picks].sort(
      (a, b) => b.servingFiber - a.servingFiber,
    )[0];
    const topScore = [...picks].sort((a, b) => b.score - a.score)[0];

    const segments: string[] = [];

    if (topProtein && topProtein.servingProtein >= 10) {
      segments.push(
        t('explain.meal.mainProtein', { name: topProtein.food.name }, locale),
      );
    }

    if (
      topFiber &&
      topFiber.servingFiber >= 3 &&
      topFiber.food.id !== topProtein?.food.id
    ) {
      segments.push(
        t('explain.meal.fiberSource', { name: topFiber.food.name }, locale),
      );
    }

    if (topScore?.explanation) {
      const topDim = this.rankDimensions(topScore.explanation)[0]?.dim;
      if (topDim === 'nutrientDensity') {
        segments.push(t('explain.meal.theme.nutrientDensity', {}, locale));
      } else if (topDim === 'glycemic') {
        segments.push(t('explain.meal.theme.glycemic', {}, locale));
      } else if (topDim === 'protein') {
        segments.push(t('explain.meal.theme.protein', {}, locale));
      } else if (topDim === 'fiber') {
        segments.push(t('explain.meal.theme.fiber', {}, locale));
      }
    }

    if (segments.length === 0) {
      segments.push(
        t(
          'explain.meal.goalBalance',
          { goal: getGoalLabel(goalType, locale) },
          locale,
        ),
      );
    }

    if (userProfile?.healthConditions?.length) {
      segments.push(t('explain.meal.healthConstraint', {}, locale));
    }

    return segments.join('，');
  }

  /**
   * 对 10 维评分按加权分降序排列（内部工具方法）
   */
  private rankDimensions(
    explanation: ScoringExplanation,
  ): Array<{ dim: ScoreDimension; raw: number; weighted: number }> {
    return SCORE_DIMENSIONS.map((dim) => {
      const d = explanation.dimensions[dim];
      return { dim, raw: d?.raw ?? 0, weighted: d?.weighted ?? 0 };
    }).sort((a, b) => b.weighted - a.weighted);
  }
}
