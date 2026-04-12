/**
 * V5 Phase 3.5 — 推荐解释生成器
 * V6 Phase 2.7 — ExplainV2: 可视化解释数据结构
 * V6 Phase 2.11 — i18n L2: 推荐解释模板国际化
 * V7.6 P2: 拆分为 3 个子服务，本文件保留核心 generate/generateV2/explainWhyNot
 *
 * 将 ScoringExplanation（技术评分）转换为用户可读的推荐理由。
 *
 * V7.6 P2 拆分:
 * - explanation.types.ts        — 所有 interface/type 定义
 * - meal-explanation.service.ts — 整餐解释（explainMealComposition + 互补对 + 多样性）
 * - comparison-explanation.service.ts — 对比/替代/变化/渠道解释
 * - 本文件保留: generate, generateV2, explainWhyNot, 付费门控委托, 洞察委托, NL委托
 *
 * 设计原则：
 * - 仅对最终推荐的食物（Top-K）调用，不影响批量评分性能
 * - 每个食物生成 1-2 句主要理由 + 最多 3 个营养亮点标签
 * - 结合健康条件生成针对性提示
 * - 评分概览简化为 3-5 个维度的百分比柱状图
 * - V2 额外输出: 10 维雷达图 + 营养素进度条 + 对比卡片
 */

import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import {
  ScoringExplanation,
  ExplanationV2,
  RadarChartData,
  RadarChartDimension,
  ProgressBarData,
  NutrientStatus,
  ComparisonData,
} from './scoring-explanation.interface';
import {
  ScoredFood,
  MealTarget,
  UserProfileConstraints,
  SCORE_DIMENSIONS,
  ScoreDimension,
  computeWeights,
  AcquisitionChannel,
  EnrichedProfileContext,
  SceneContext,
  DailyPlanState,
  StructuredInsight,
  CrossMealAdjustment,
} from './recommendation.types';
import { GoalType } from '../../app/nutrition-score.service';
import { t, Locale } from './i18n-messages';
import type { EffectiveGoal } from '../../../user/app/goal-phase.service';
import type { GoalProgress } from '../../../user/app/goal-tracker.service';
import type { SubstitutionPattern } from './execution-tracker.service';
import { MealCompositionScorer } from './meal-composition-scorer.service';
import { InsightGeneratorService } from './insight-generator.service';
import { createInsightContext } from './insight.types';
import { ExplanationTierService } from './explanation-tier.service';
import {
  NaturalLanguageExplainerService,
  NarrativeContext,
  WhyThisDishExplanation,
} from './natural-language-explainer.service';
import type { ScoringAdjustment } from './scoring-chain/scoring-factor.interface';

// V7.6 P2: 拆分后的子服务
import { MealExplanationService } from './meal-explanation.service';
import { ComparisonExplanationService } from './comparison-explanation.service';

// V7.6 P2-A: 类型从 explanation.types.ts re-export（保持向后兼容）
export type {
  DeltaExplanation,
  NutritionTag,
  SimpleScoreBar,
  UserFacingExplanation,
  MealCompositionExplanation,
  ComplementaryPairExplanation,
  MacroBalanceInfo,
  ComparisonExplanation,
  SubstitutionExplanation,
} from './explanation.types';

export type { ExplanationStyleVariant } from './explanation.types';
import type {
  ExplanationStyleVariant,
  NutritionTag,
  UserFacingExplanation,
  MealCompositionExplanation,
  ComparisonExplanation,
  SubstitutionExplanation,
  DeltaExplanation,
} from './explanation.types';

// ==================== 内部工具函数 ====================

/**
 * 获取评分维度的国际化标签
 */
function getDimensionLabel(dim: ScoreDimension, locale?: Locale): string {
  return t(`explain.dim.${dim}`, {}, locale);
}

/**
 * 获取目标类型的国际化文案
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
export class ExplanationGeneratorService {
  constructor(
    /** V6.5 Phase 2E: 整餐组合评分器 */
    private readonly mealCompositionScorer: MealCompositionScorer,
    /** V7.4 DI修复: 洞察生成器（原 new InsightGeneratorService()） */
    private readonly insightGenerator: InsightGeneratorService,
    /** V7.4 DI修复: 解释分层服务（原 new ExplanationTierService()） */
    private readonly tierService: ExplanationTierService,
    /** V7.4 DI修复: 自然语言解释器（原 new NaturalLanguageExplainerService()） */
    private readonly nlExplainer: NaturalLanguageExplainerService,
    /** V7.6 P2-B: 整餐解释服务 */
    private readonly mealExplanation: MealExplanationService,
    /** V7.6 P2-C: 对比/替代解释服务 */
    private readonly comparisonExplanation: ComparisonExplanationService,
  ) {}

  /**
   * V6.3 P3-1: 解释整餐搭配逻辑
   * V7.6 P2-B: 委托给 MealExplanationService
   */
  explainMealComposition(
    picks: ScoredFood[],
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
    target?: MealTarget,
  ): MealCompositionExplanation {
    return this.mealExplanation.explainMealComposition(
      picks,
      userProfile,
      goalType,
      locale,
      target,
    );
  }

  /**
   * 为单个推荐食物生成用户可读解释
   */
  generate(
    scored: ScoredFood,
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
    styleVariant: ExplanationStyleVariant = 'concise',
  ): UserFacingExplanation | null {
    const explanation = scored.explanation;
    if (!explanation) return null;

    const food = scored.food;
    const reasons: string[] = [];
    const highlights: NutritionTag[] = [];
    const goalLabel = getGoalLabel(goalType, locale);

    // ── 1. 基于评分最高维度生成理由 ──
    const dimEntries = this.rankDimensions(explanation);
    for (const { dim, weighted } of dimEntries.slice(0, 3)) {
      const tag = this.buildDimensionHighlight(
        dim,
        weighted,
        food,
        goalLabel,
        locale,
      );
      if (tag) {
        if (tag.reason) reasons.push(tag.reason);
        if (tag.highlight) highlights.push(tag.highlight);
      }
    }

    // ── 2. 健康条件相关提示 ──
    const healthTip = this.buildHealthTip(food, userProfile, locale);

    // 如果健康提示也贡献了营养标签，追加
    if (healthTip?.highlight) {
      highlights.push(healthTip.highlight);
    }

    // ── 3. 评分概览（取加权分最高的 5 个维度） ──
    const scoreBreakdown = dimEntries.slice(0, 5).map(({ dim, raw }) => ({
      dimension: getDimensionLabel(dim, locale),
      score: Math.round(raw * 100),
    }));

    // ── 4. 兜底：无理由时提供通用文案 ──
    if (reasons.length === 0) {
      reasons.push(t('explain.reason.fallback', { goal: goalLabel }, locale));
    }

    const primaryReason =
      styleVariant === 'coaching'
        ? `${reasons.join('；')}。${t('explain.meal.coachingSuffix', { goal: goalLabel }, locale)}`
        : reasons.join('；');

    return {
      primaryReason,
      nutritionHighlights: highlights.slice(0, 3),
      healthTip: healthTip?.tip,
      scoreBreakdown,
      styleVariant,
    };
  }

  /**
   * 批量生成解释（为一餐的多个食物）
   */
  generateBatch(
    scoredFoods: ScoredFood[],
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
    styleVariant: ExplanationStyleVariant = 'concise',
  ): Map<string, UserFacingExplanation> {
    const result = new Map<string, UserFacingExplanation>();
    for (const scored of scoredFoods) {
      const explanation = this.generate(
        scored,
        userProfile,
        goalType,
        locale,
        styleVariant,
      );
      if (explanation) {
        result.set(scored.food.id, explanation);
      }
    }
    return result;
  }

  // ==================== V6 2.7 ExplainV2 — 可视化解释 ====================

  /**
   * 为单个推荐食物生成 V2 完整可视化解释
   */
  generateV2(
    scored: ScoredFood,
    target: MealTarget,
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    mealType?: string,
    locale?: Locale,
    styleVariant: ExplanationStyleVariant = 'concise',
  ): ExplanationV2 | null {
    const explanation = scored.explanation;
    if (!explanation) return null;

    // 复用 V1 生成器获取基础文案
    const v1 = this.generate(
      scored,
      userProfile,
      goalType,
      locale,
      styleVariant,
    );
    if (!v1) return null;

    // 构建 10 维雷达图数据
    const radarChart = this.buildRadarChart(
      explanation,
      (goalType as GoalType) || 'health',
      mealType,
      locale,
    );

    // 构建营养素进度条
    const progressBars = this.buildProgressBars(scored, target, locale);

    // 构建对比卡片
    const comparisonCard = this.buildComparisonCard(explanation);

    return {
      // V1 向后兼容字段
      summary: v1.primaryReason,
      primaryReason: v1.primaryReason,
      healthTip: v1.healthTip,

      // V2 新增可视化字段
      radarChart,
      progressBars,
      comparisonCard,
      styleVariant,

      // locale 标记
      locale: locale || 'zh-CN',
    };
  }

  /**
   * 批量生成 V2 解释（为一餐的多个食物）
   */
  generateV2Batch(
    scoredFoods: ScoredFood[],
    target: MealTarget,
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    mealType?: string,
    locale?: Locale,
    styleVariant: ExplanationStyleVariant = 'concise',
  ): Map<string, ExplanationV2> {
    const result = new Map<string, ExplanationV2>();
    for (const scored of scoredFoods) {
      const explanationV2 = this.generateV2(
        scored,
        target,
        userProfile,
        goalType,
        mealType,
        locale,
        styleVariant,
      );
      if (explanationV2) {
        result.set(scored.food.id, explanationV2);
      }
    }
    return result;
  }

  /**
   * V6.3 P3-3: 稳定解释风格分桶
   */
  resolveStyleVariant(userId?: string | null): ExplanationStyleVariant {
    if (!userId) return 'concise';

    let hash = 0x811c9dc5;
    for (let i = 0; i < userId.length; i++) {
      hash ^= userId.charCodeAt(i);
      hash = (hash * 0x01000193) | 0;
    }

    const bucket = (hash >>> 0) / 0xffffffff;
    return bucket < 0.5 ? 'concise' : 'coaching';
  }

  // ==================== 私有方法 ====================

  /**
   * 对 10 维评分按加权分降序排列
   */
  private rankDimensions(
    explanation: ScoringExplanation,
  ): Array<{ dim: ScoreDimension; raw: number; weighted: number }> {
    return SCORE_DIMENSIONS.map((dim) => {
      const d = explanation.dimensions[dim];
      return { dim, raw: d?.raw ?? 0, weighted: d?.weighted ?? 0 };
    }).sort((a, b) => b.weighted - a.weighted);
  }

  /**
   * 根据维度和食物数据构建亮点标签 + 理由文案
   */
  private buildDimensionHighlight(
    dim: ScoreDimension,
    weighted: number,
    food: FoodLibrary,
    goalLabel: string,
    locale?: Locale,
  ): { reason?: string; highlight?: NutritionTag } | null {
    // 加权分过低则跳过
    if (weighted < 0.05) return null;

    switch (dim) {
      case 'protein':
        if (Number(food.protein ?? 0) >= 15) {
          return {
            reason: t(
              'explain.reason.highProtein',
              { goal: goalLabel },
              locale,
            ),
            highlight: {
              label: t('explain.tag.highProtein', {}, locale),
              type: 'positive',
              value: `${food.protein}g/100g`,
            },
          };
        }
        return { reason: t('explain.reason.proteinModerate', {}, locale) };

      case 'calories':
        return {
          reason: t(
            'explain.reason.caloriesMatch',
            { goal: goalLabel },
            locale,
          ),
        };

      case 'fiber':
        if (Number(food.fiber ?? 0) >= 3) {
          return {
            reason: t('explain.reason.richFiber', {}, locale),
            highlight: {
              label: t('explain.tag.richFiber', {}, locale),
              type: 'positive',
              value: `${food.fiber}g/100g`,
            },
          };
        }
        return null;

      case 'glycemic':
        if (food.glycemicIndex != null && food.glycemicIndex <= 55) {
          return {
            reason: t('explain.reason.lowGI', {}, locale),
            highlight: {
              label: t('explain.tag.lowGI', {}, locale),
              type: 'positive',
              value: `GI ${food.glycemicIndex}`,
            },
          };
        }
        return { reason: t('explain.reason.glycemicGood', {}, locale) };

      case 'quality':
        if (food.processingLevel <= 2) {
          return {
            reason: t('explain.reason.naturalFood', {}, locale),
            highlight: {
              label: t('explain.tag.naturalFood', {}, locale),
              type: 'positive',
              value: `NOVA ${food.processingLevel}`,
            },
          };
        }
        return null;

      case 'nutrientDensity':
        if (Number(food.nutrientDensity ?? 0) > 50) {
          return {
            reason: t('explain.reason.highNutrientDensity', {}, locale),
            highlight: {
              label: t('explain.tag.highNutrientDensity', {}, locale),
              type: 'positive',
              value: `NRF ${Math.round(Number(food.nutrientDensity))}`,
            },
          };
        }
        return { reason: t('explain.reason.balancedNutrition', {}, locale) };

      case 'satiety':
        return { reason: t('explain.reason.highSatiety', {}, locale) };

      case 'inflammation':
        return { reason: t('explain.reason.antiInflammation', {}, locale) };

      case 'fat':
        if (Number(food.saturatedFat ?? 0) < 3) {
          return {
            reason: t('explain.reason.lowSaturatedFat', {}, locale),
            highlight: {
              label: t('explain.tag.lowSaturatedFat', {}, locale),
              type: 'positive',
              value: `${food.saturatedFat ?? 0}g/100g`,
            },
          };
        }
        return { reason: t('explain.reason.fatBalanced', {}, locale) };

      case 'carbs':
        return { reason: t('explain.reason.carbsMatch', {}, locale) };

      default:
        return null;
    }
  }

  /**
   * 根据用户健康条件和食物属性生成针对性健康提示
   */
  private buildHealthTip(
    food: FoodLibrary,
    userProfile?: UserProfileConstraints | null,
    locale?: Locale,
  ): { tip?: string; highlight?: NutritionTag } | null {
    if (!userProfile?.healthConditions?.length) return null;

    const conditions = userProfile.healthConditions;

    // 糖尿病 + 低 GI 食物
    if (
      conditions.includes('diabetes_type2') &&
      food.glycemicIndex != null &&
      food.glycemicIndex <= 55
    ) {
      return {
        tip: t('explain.health.diabetesLowGI', {}, locale),
        highlight: {
          label: t('explain.tag.lowGI', {}, locale),
          type: 'positive',
          value: `GI ${food.glycemicIndex}`,
        },
      };
    }

    // 高血压 + 低钠食物
    if (conditions.includes('hypertension') && Number(food.sodium ?? 0) < 200) {
      return {
        tip: t('explain.health.hypertensionLowSodium', {}, locale),
        highlight: {
          label: t('explain.tag.lowSodium', {}, locale),
          type: 'positive',
          value: `${food.sodium ?? 0}mg/100g`,
        },
      };
    }

    // 高血脂 + 低胆固醇
    if (
      conditions.includes('hyperlipidemia') &&
      Number(food.cholesterol ?? 0) < 50
    ) {
      return {
        tip: t('explain.health.hyperlipidemiaLowChol', {}, locale),
      };
    }

    // 痛风 + 低嘌呤
    if (conditions.includes('gout') && Number(food.purine ?? 0) < 100) {
      return {
        tip: t('explain.health.goutLowPurine', {}, locale),
      };
    }

    // 肾病 + 低磷低钾
    if (
      conditions.includes('kidney_disease') &&
      Number(food.phosphorus ?? 0) < 200 &&
      Number(food.potassium ?? 0) < 250
    ) {
      return {
        tip: t('explain.health.kidneyLowPhosK', {}, locale),
      };
    }

    // IBS + 低 FODMAP
    if (conditions.includes('ibs') && food.fodmapLevel === 'low') {
      return {
        tip: t('explain.health.ibsLowFODMAP', {}, locale),
        highlight: {
          label: t('explain.tag.lowFODMAP', {}, locale),
          type: 'positive',
          value: 'FODMAP Low',
        },
      };
    }

    // 骨质疏松 + 高钙
    if (
      conditions.includes('osteoporosis') &&
      Number(food.calcium ?? 0) >= 100
    ) {
      return {
        tip: t('explain.health.osteoHighCalcium', {}, locale),
        highlight: {
          label: t('explain.tag.highCalcium', {}, locale),
          type: 'positive',
          value: `${food.calcium}mg/100g`,
        },
      };
    }

    // 缺铁性贫血 + 高铁
    if (
      conditions.includes('iron_deficiency_anemia') &&
      Number(food.iron ?? 0) >= 3
    ) {
      return {
        tip: t('explain.health.anemiaHighIron', {}, locale),
        highlight: {
          label: t('explain.tag.richIron', {}, locale),
          type: 'positive',
          value: `${food.iron}mg/100g`,
        },
      };
    }

    // 脂肪肝 + 低脂
    if (conditions.includes('fatty_liver') && Number(food.fat ?? 0) < 5) {
      return {
        tip: t('explain.health.fattyLiverLowFat', {}, locale),
      };
    }

    return null;
  }

  // ==================== V6 2.9: 付费预览解释（商业化钩子） ====================

  /**
   * V6 2.9: 付费内容门控
   * V7.2 P2-F: 委托给 ExplanationTierService
   */
  applyUpgradeTeaser(
    explanation: ExplanationV2,
    isPremium: boolean,
  ): ExplanationV2 {
    return this.tierService.applyUpgradeTeaser(explanation, isPremium);
  }

  /**
   * V6 2.9: 批量应用付费预览门控
   */
  applyUpgradeTeaserBatch(
    explanations: Map<string, ExplanationV2>,
    isPremium: boolean,
  ): Map<string, ExplanationV2> {
    return this.tierService.applyUpgradeTeaserBatch(explanations, isPremium);
  }

  // ==================== V6 2.8: 反向解释 ====================

  /**
   * 为指定食物生成反向解释 — 分析该食物未被推荐的原因
   */
  explainWhyNot(
    food: FoodLibrary,
    scored: ScoredFood | null,
    filterReasons: string[],
    userProfile?: UserProfileConstraints | null,
    goalType?: string,
    locale?: Locale,
  ): string {
    const reasons: string[] = [];
    const goalLabel = getGoalLabel(goalType, locale);

    // ── 1. 硬过滤原因 ──
    if (filterReasons.length > 0) {
      reasons.push(...filterReasons);
    }

    // ── 2. 健康修正否决 ──
    if (scored?.explanation?.penaltyResult?.vetoed) {
      const penaltyReasons = scored.explanation.penaltyResult.reasons;
      if (penaltyReasons.length > 0) {
        reasons.push(
          t(
            'explain.whyNot.healthRisk',
            { reasons: penaltyReasons.join('、') },
            locale,
          ),
        );
      } else {
        reasons.push(t('explain.whyNot.healthVetoed', {}, locale));
      }
    }

    // ── 3. NOVA 加工惩罚严重 ──
    if (scored?.explanation && scored.explanation.novaPenalty < 0.7) {
      reasons.push(
        t(
          'explain.whyNot.novaPenalty',
          {
            penalty: String(Math.round(scored.explanation.novaPenalty * 100)),
            goal: goalLabel,
          },
          locale,
        ),
      );
    }

    // ── 4. 评分偏低维度分析 ──
    if (scored?.explanation) {
      const weakDims: string[] = [];
      for (const dim of SCORE_DIMENSIONS) {
        const d = scored.explanation.dimensions[dim];
        if (d && d.raw < 0.4) {
          weakDims.push(getDimensionLabel(dim, locale));
        }
      }
      if (weakDims.length > 0) {
        reasons.push(
          t(
            'explain.whyNot.weakDimensions',
            { dims: weakDims.join('、') },
            locale,
          ),
        );
      }
    }

    // ── 5. 偏好不匹配 ──
    if (scored?.explanation) {
      if (scored.explanation.preferenceBoost < 0.5) {
        reasons.push(t('explain.whyNot.preferenceNoMatch', {}, locale));
      }
      if (scored.explanation.shortTermBoost < 0.9) {
        reasons.push(t('explain.whyNot.recentNegative', {}, locale));
      }
    }

    // ── 6. 综合评分偏低 ──
    if (scored && scored.score > 0 && reasons.length === 0) {
      reasons.push(t('explain.whyNot.lowScore', { goal: goalLabel }, locale));
    }

    // ── 兜底 ──
    if (reasons.length === 0) {
      reasons.push(t('explain.whyNot.fallback', {}, locale));
    }

    return reasons.join('；');
  }

  // ==================== V6 2.7: V2 可视化数据构建器 ====================

  /**
   * 构建 10 维雷达图数据
   */
  private buildRadarChart(
    explanation: ScoringExplanation,
    goalType: GoalType,
    mealType?: string,
    locale?: Locale,
  ): RadarChartData {
    const weights = computeWeights(goalType, mealType);

    const dimensions: RadarChartDimension[] = SCORE_DIMENSIONS.map((dim, i) => {
      const d = explanation.dimensions[dim];
      return {
        name: dim,
        label: getDimensionLabel(dim, locale),
        score: d?.raw ?? 0,
        weight: weights[i] ?? 0,
        benchmark: 0.5,
      };
    });

    return { dimensions };
  }

  /**
   * 构建营养素进度条数据
   */
  private buildProgressBars(
    scored: ScoredFood,
    target: MealTarget,
    locale?: Locale,
  ): ProgressBarData[] {
    const bars: ProgressBarData[] = [];

    // 热量
    if (target.calories > 0) {
      const percent = (scored.servingCalories / target.calories) * 100;
      bars.push({
        nutrient: t('explain.nutrient.calories', {}, locale),
        current: Math.round(scored.servingCalories),
        target: Math.round(target.calories),
        unit: 'kcal',
        percent: Math.round(percent),
        status: this.nutrientStatus(percent, 70, 130),
      });
    }

    // 蛋白质
    if (target.protein > 0) {
      const percent = (scored.servingProtein / target.protein) * 100;
      bars.push({
        nutrient: t('explain.nutrient.protein', {}, locale),
        current: Math.round(scored.servingProtein * 10) / 10,
        target: Math.round(target.protein * 10) / 10,
        unit: 'g',
        percent: Math.round(percent),
        status: this.nutrientStatus(percent, 60, 140),
      });
    }

    // 碳水化合物
    if (target.carbs > 0) {
      const percent = (scored.servingCarbs / target.carbs) * 100;
      bars.push({
        nutrient: t('explain.nutrient.carbs', {}, locale),
        current: Math.round(scored.servingCarbs * 10) / 10,
        target: Math.round(target.carbs * 10) / 10,
        unit: 'g',
        percent: Math.round(percent),
        status: this.nutrientStatus(percent, 60, 140),
      });
    }

    // 脂肪
    if (target.fat > 0) {
      const percent = (scored.servingFat / target.fat) * 100;
      bars.push({
        nutrient: t('explain.nutrient.fat', {}, locale),
        current: Math.round(scored.servingFat * 10) / 10,
        target: Math.round(target.fat * 10) / 10,
        unit: 'g',
        percent: Math.round(percent),
        status: this.nutrientStatus(percent, 50, 120),
      });
    }

    // 膳食纤维（如果有目标）
    if (target.fiber && target.fiber > 0) {
      const percent = (scored.servingFiber / target.fiber) * 100;
      bars.push({
        nutrient: t('explain.nutrient.fiber', {}, locale),
        current: Math.round(scored.servingFiber * 10) / 10,
        target: Math.round(target.fiber * 10) / 10,
        unit: 'g',
        percent: Math.round(percent),
        status: this.nutrientStatus(percent, 60, 200),
      });
    }

    return bars;
  }

  /**
   * 构建对比卡片数据
   */
  private buildComparisonCard(explanation: ScoringExplanation): ComparisonData {
    const normalizedScore = Math.min(
      1,
      Math.max(-1, (explanation.finalScore - 0.5) / 0.5),
    );

    let qualifiedCount = 0;
    for (const dim of SCORE_DIMENSIONS) {
      const d = explanation.dimensions[dim];
      if ((d?.raw ?? 0) >= 0.6) {
        qualifiedCount++;
      }
    }
    const healthTarget = qualifiedCount / SCORE_DIMENSIONS.length;

    return {
      vsUserAvg: Math.round(normalizedScore * 100) / 100,
      vsHealthyTarget: Math.round(healthTarget * 100) / 100,
      trend7d: [],
    };
  }

  /**
   * 根据完成百分比和阈值判断营养素状态
   */
  private nutrientStatus(
    percent: number,
    lowerThreshold: number,
    upperThreshold: number,
  ): NutrientStatus {
    if (percent < lowerThreshold) return 'under';
    if (percent > upperThreshold) return 'over';
    return 'optimal';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V6.6 Phase 2-E: 变化解释 & 渠道解释 — V7.6 P2-C 委托
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 变化解释 — V7.6 P2-C 委托给 ComparisonExplanationService
   */
  generateDeltaExplanation(
    todayTop: FoodLibrary[],
    yesterdayTop: FoodLibrary[],
    profile: EnrichedProfileContext,
  ): DeltaExplanation | null {
    return this.comparisonExplanation.generateDeltaExplanation(
      todayTop,
      yesterdayTop,
      profile,
    );
  }

  /**
   * 渠道过滤解释 — V7.6 P2-C 委托给 ComparisonExplanationService
   */
  generateChannelFilterExplanation(
    channel: AcquisitionChannel,
    filteredCount: number,
    locale: Locale = 'zh-CN',
  ): string | null {
    return this.comparisonExplanation.generateChannelFilterExplanation(
      channel,
      filteredCount,
      locale,
    );
  }

  // ─── V6.9 Phase 2-B: 结构化洞察生成 ───

  /**
   * V7.2 P2-E: 委托给 InsightGeneratorService
   */
  generateStructuredInsights(
    foods: ScoredFood[],
    target: MealTarget,
    sceneContext?: SceneContext | null,
    dailyPlan?: DailyPlanState | null,
    _locale?: Locale,
    effectiveGoal?: EffectiveGoal | null,
    goalProgress?: GoalProgress | null,
    crossMealAdjustment?: CrossMealAdjustment,
    substitutions?: SubstitutionPattern[] | null,
  ): StructuredInsight[] {
    const ctx = createInsightContext(
      foods,
      target,
      sceneContext,
      dailyPlan,
      _locale,
      effectiveGoal,
      goalProgress,
      crossMealAdjustment,
      substitutions,
    );
    return this.insightGenerator.generate(ctx);
  }

  // ─── V7.3 P2-E: 自然语言推荐解释集成 ───

  /**
   * V7.3 P2-E: 为单个推荐食物生成自然语言叙述
   */
  generateNarrativeExplanation(
    food: FoodLibrary,
    adjustments: ScoringAdjustment[],
    ctx: NarrativeContext,
  ): string {
    return this.nlExplainer.generateNarrative(adjustments, food, ctx);
  }

  /**
   * V7.3 P2-E: 为单个推荐食物生成结构化"为什么推荐"解释
   */
  generateWhyThisDishExplanation(
    scored: ScoredFood,
    adjustments: ScoringAdjustment[],
    ctx: NarrativeContext,
  ): WhyThisDishExplanation {
    return this.nlExplainer.generateWhyThisDish(scored, adjustments, ctx);
  }

  /**
   * V7.3 P2-E: 批量生成自然语言叙述
   */
  generateNarrativeBatch(
    scoredFoods: ScoredFood[],
    adjustmentsMap: Map<string, ScoringAdjustment[]>,
    ctx: NarrativeContext,
  ): Map<string, string> {
    const result = new Map<string, string>();
    for (const scored of scoredFoods) {
      const adjustments = adjustmentsMap.get(scored.food.id) ?? [];
      const narrative = this.nlExplainer.generateNarrative(
        adjustments,
        scored.food,
        ctx,
      );
      result.set(scored.food.id, narrative);
    }
    return result;
  }

  // ─── V7.4 P2-F: 对比解释 + 替代解释 — V7.6 P2-C 委托 ───

  /**
   * V7.4 P2-F: 生成两个食物之间的对比解释 — 委托给 ComparisonExplanationService
   */
  generateComparisonExplanation(
    recommended: ScoredFood,
    alternative: ScoredFood,
    goalType: string,
    locale: Locale = 'zh-CN',
  ): ComparisonExplanation {
    return this.comparisonExplanation.generateComparisonExplanation(
      recommended,
      alternative,
      goalType,
      locale,
    );
  }

  /**
   * V7.4 P2-F: 生成食物替代解释 — 委托给 ComparisonExplanationService
   */
  generateSubstitutionExplanation(
    original: ScoredFood,
    substitute: ScoredFood,
    goalType: string,
    target: MealTarget,
    locale: Locale = 'zh-CN',
  ): SubstitutionExplanation {
    return this.comparisonExplanation.generateSubstitutionExplanation(
      original,
      substitute,
      goalType,
      target,
      locale,
    );
  }
}
