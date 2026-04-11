/**
 * V5 Phase 3.5 — 推荐解释生成器
 * V6 Phase 2.7 — ExplainV2: 可视化解释数据结构
 * V6 Phase 2.11 — i18n L2: 推荐解释模板国际化
 *
 * 将 ScoringExplanation（技术评分）转换为用户可读的推荐理由。
 *
 * V6 2.11 重构:
 * - 所有硬编码中文文案迁移到 i18n-messages.ts 的 explain.* key
 * - DIMENSION_LABELS / GOAL_TEXT 改为通过 t() 动态查询
 * - generate/generateV2/explainWhyNot 方法新增可选 locale 参数
 * - 支持 zh-CN / en-US / ja-JP 三语解释输出
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
} from './recommendation.types';
import { GoalType } from '../../app/nutrition-score.service';
import { t, Locale } from './i18n-messages';
import {
  MealCompositionScorer,
  MealCompositionScore,
} from './meal-composition-scorer.service';

// ==================== 用户可读解释类型 ====================

/**
 * V6.6 Phase 2-E: 推荐变化解释
 * 今日推荐与昨日显著不同时生成，向用户说明变化原因
 */
export interface DeltaExplanation {
  /** 今日新出现（昨日没有）的食物名称列表 */
  changedFoods: string[];
  /** 主要变化原因（人类可读） */
  primaryReason: string;
  /** 置信度 — 数据质量越高置信度越高 */
  confidence: 'high' | 'medium' | 'low';
}

/** 营养亮点标签 */
export interface NutritionTag {
  /** 标签文案：如 "高蛋白" | "低GI" | "富含膳食纤维" */
  label: string;
  /** 标签倾向 */
  type: 'positive' | 'neutral';
  /** 具体数值描述：如 "28g 蛋白质" | "GI 35" */
  value: string;
}

/** 简化评分柱 */
export interface SimpleScoreBar {
  /** 维度名称（国际化后的显示名） */
  dimension: string;
  /** 0-100 分 */
  score: number;
}

/** 用户可读的推荐解释 */
export interface UserFacingExplanation {
  /** 主要推荐理由（1-2 句话） */
  primaryReason: string;
  /** 营养亮点标签（最多 3 个） */
  nutritionHighlights: NutritionTag[];
  /** 健康相关提示（如果有健康条件） */
  healthTip?: string;
  /** 评分概览（简化版，最多 5 个维度） */
  scoreBreakdown: SimpleScoreBar[];
  /** V6.3 P3-3: 解释风格实验分桶 */
  styleVariant?: 'concise' | 'coaching';
}

/** V6.3 P3-1: 整餐层面解释 */
/** V6.5 Phase 2E: 从一句话升级为结构化整餐分析 */
export interface MealCompositionExplanation {
  /** 一句话解释为什么这样搭配 */
  summary: string;
  /** V6.5: 整餐组合评分（由 MealCompositionScorer 计算） */
  compositionScore?: MealCompositionScore;
  /** V6.5: 营养互补关系列表 */
  complementaryPairs?: ComplementaryPairExplanation[];
  /** V6.5: 宏量营养素分布 */
  macroBalance?: MacroBalanceInfo;
  /** V6.5: 多样性建议（如"建议增加一道蒸菜"） */
  diversityTips?: string[];
}

/** V6.5: 营养互补对解释 */
export interface ComplementaryPairExplanation {
  nutrientA: string;
  foodA: string;
  nutrientB: string;
  foodB: string;
  benefit: string;
}

/** V6.5: 宏量营养素分布信息 */
export interface MacroBalanceInfo {
  caloriesTotal: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
  /** 与目标的匹配度 0-100 */
  targetMatch: number;
}

export type ExplanationStyleVariant = 'concise' | 'coaching';

// ==================== 内部工具函数 ====================

/**
 * 获取评分维度的国际化标签
 * V6 2.11: 从 t('explain.dim.*') 动态获取，替代原硬编码 DIMENSION_LABELS
 */
function getDimensionLabel(dim: ScoreDimension, locale?: Locale): string {
  return t(`explain.dim.${dim}`, {}, locale);
}

/**
 * 获取目标类型的国际化文案
 * V6 2.11: 从 t('explain.goal.*') 动态获取，替代原硬编码 GOAL_TEXT
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
  ) {}

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

    const complementaryPairs = this.detectComplementaryPairs(picks);
    const macroBalance = this.calcMacroBalance(picks, target);
    const diversityTips = this.generateDiversityTips(picks, compositionScore);

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
  ): ComplementaryPairExplanation[] {
    if (picks.length < 2) return [];

    const PAIRS: ReadonlyArray<{
      a: keyof FoodLibrary;
      b: keyof FoodLibrary;
      labelA: string;
      labelB: string;
      benefit: string;
    }> = [
      {
        a: 'iron',
        b: 'vitaminC',
        labelA: '铁',
        labelB: '维生素C',
        benefit: '维C帮助铁吸收，提高铁的生物利用率',
      },
      {
        a: 'calcium',
        b: 'vitaminD',
        labelA: '钙',
        labelB: '维生素D',
        benefit: '维D促进钙的肠道吸收',
      },
      {
        a: 'fat',
        b: 'vitaminA',
        labelA: '脂肪',
        labelB: '维生素A',
        benefit: '脂肪帮助脂溶性维生素A的吸收',
      },
      {
        a: 'protein',
        b: 'vitaminB12',
        labelA: '蛋白质',
        labelB: '维生素B12',
        benefit: 'B12参与蛋白质代谢和合成',
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
          nutrientA: pair.labelA,
          foodA: foodWithA.food.name,
          nutrientB: pair.labelB,
          foodB: foodWithB.food.name,
          benefit: pair.benefit,
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
  ): string[] {
    const tips: string[] = [];

    if (!compositionScore) return tips;

    if (compositionScore.ingredientDiversity < 60) {
      tips.push('部分食材重复，建议替换为不同食材的菜品');
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
        const alternatives =
          dominant[0] === '炒'
            ? '蒸或煮'
            : dominant[0] === '炸'
              ? '蒸或烤'
              : '其他烹饪方式';
        tips.push(`${dominant[0]}类菜品较多，建议增加一道${alternatives}的菜`);
      }
    }

    if (compositionScore.flavorBalance < 40) {
      tips.push('口味较为单一，建议搭配不同风味的菜品');
    }

    if (compositionScore.nutritionComplementarity < 25) {
      tips.push('建议搭配富含维C的蔬菜水果，帮助铁等矿物质的吸收');
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
      segments.push(`${topProtein.food.name}提供主要蛋白质`);
    }

    if (
      topFiber &&
      topFiber.servingFiber >= 3 &&
      topFiber.food.id !== topProtein?.food.id
    ) {
      segments.push(`${topFiber.food.name}补充膳食纤维和饱腹感`);
    }

    if (topScore?.explanation) {
      const topDim = this.rankDimensions(topScore.explanation)[0]?.dim;
      if (topDim === 'nutrientDensity') {
        segments.push('整体搭配注重营养密度');
      } else if (topDim === 'glycemic') {
        segments.push('整体搭配兼顾血糖稳定');
      } else if (topDim === 'protein') {
        segments.push('整体搭配偏向高蛋白恢复');
      } else if (topDim === 'fiber') {
        segments.push('整体搭配强调纤维补充');
      }
    }

    if (segments.length === 0) {
      segments.push(
        `这餐围绕${getGoalLabel(goalType, locale)}目标做了均衡搭配`,
      );
    }

    if (userProfile?.healthConditions?.length) {
      segments.push('并兼顾你的健康约束');
    }

    return segments.join('，');
  }

  /**
   * 为单个推荐食物生成用户可读解释
   *
   * @param scored  评分后的食物（须含 explanation）
   * @param userProfile 用户健康/饮食约束
   * @param goalType 用户目标类型
   * @param locale   可选语言覆盖（V6 2.11 新增）
   * @returns UserFacingExplanation，如果无评分数据则返回 null
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
    const scoreBreakdown: SimpleScoreBar[] = dimEntries
      .slice(0, 5)
      .map(({ dim, raw }) => ({
        dimension: getDimensionLabel(dim, locale),
        score: Math.round(raw * 100),
      }));

    // ── 4. 兜底：无理由时提供通用文案 ──
    if (reasons.length === 0) {
      reasons.push(t('explain.reason.fallback', { goal: goalLabel }, locale));
    }

    const primaryReason =
      styleVariant === 'coaching'
        ? `${reasons.join('；')}。继续按这个方向吃，更容易贴近${goalLabel}目标`
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
   *
   * 包含: 雷达图 (10 维) + 营养素进度条 + 对比卡片 + 原有 V1 字段
   *
   * @param scored      评分后的食物（须含 explanation）
   * @param target      餐次目标（用于进度条计算）
   * @param userProfile 用户健康/饮食约束
   * @param goalType    用户目标类型
   * @param mealType    餐次类型（可选，用于计算权重）
   * @param locale      可选语言覆盖（V6 2.11 新增）
   * @returns ExplanationV2，如果无评分数据则返回 null
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

    // 复用 V1 生成器获取基础文案（传递 locale）
    const v1 = this.generate(
      scored,
      userProfile,
      goalType,
      locale,
      styleVariant,
    );
    if (!v1) return null;

    // 构建 10 维雷达图数据（传递 locale）
    const radarChart = this.buildRadarChart(
      explanation,
      (goalType as GoalType) || 'health',
      mealType,
      locale,
    );

    // 构建营养素进度条（传递 locale）
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

      // locale 标记（V6 2.11: 标记当前解释使用的语言）
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
   *
   * 先用轻量哈希实现 deterministic bucket，后续可无缝切换到真实 ab_experiments。
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
   * V6 2.11: 所有文案通过 t() 国际化
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
   * V6 2.11: 所有文案通过 t() 国际化
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
   * V6 2.9: 付费内容门控 — 对 ExplanationV2 应用付费预览策略
   *
   * 免费用户可见:
   *   - summary, primaryReason, healthTip（V1 基础字段）
   *   - radarChart 的 Top-3 维度（其余维度 score 置 0、标注 locked）
   *   - upgradeTeaser 提示文案
   *
   * 免费用户不可见（置空）:
   *   - progressBars（清空为空数组）
   *   - comparisonCard（置为零值）
   *   - whyNotExplanation（清空）
   *
   * 付费用户: 原样返回，不做任何裁剪
   *
   * 设计说明:
   *   此方法为纯函数，不依赖订阅状态查询。
   *   调用方（Controller/Service 层）负责判断用户是否为付费用户，
   *   并在返回前对 ExplanationV2 调用此方法。
   *   当 SubscriptionModule（2.12-2.14）上线后，由功能门控自动调用。
   *
   * @param explanation  完整的 V2 解释对象
   * @param isPremium    用户是否为付费用户
   * @returns 门控后的 ExplanationV2（免费用户裁剪版 / 付费用户原样）
   */
  applyUpgradeTeaser(
    explanation: ExplanationV2,
    isPremium: boolean,
  ): ExplanationV2 {
    // 付费用户 — 原样返回
    if (isPremium) {
      return explanation;
    }

    // 免费用户 — 裁剪高级内容

    // 雷达图: 仅展示权重最高的 3 个维度，其余 score 置 0
    const topDims = [...explanation.radarChart.dimensions]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((d) => d.name);

    const gatedRadarDimensions = explanation.radarChart.dimensions.map(
      (dim) => {
        if (topDims.includes(dim.name)) {
          return dim; // Top-3 维度完整展示
        }
        return {
          ...dim,
          score: 0, // 隐藏分数
          benchmark: 0, // 隐藏基准
        };
      },
    );

    return {
      // V1 基础字段 — 免费可见
      summary: explanation.summary,
      primaryReason: explanation.primaryReason,
      healthTip: explanation.healthTip,

      // 雷达图 — 仅 Top-3 可见
      radarChart: { dimensions: gatedRadarDimensions },

      // 进度条 — 付费内容，清空
      progressBars: [],

      // 对比卡片 — 付费内容，置零
      comparisonCard: {
        vsUserAvg: 0,
        vsHealthyTarget: 0,
        trend7d: [],
      },

      // 反向解释 — 付费内容，清空
      whyNotExplanation: undefined,

      // 付费预览提示（V6 2.11: 国际化）
      upgradeTeaser: t(
        'premium.upgradeTeaser',
        {},
        explanation.locale as Locale,
      ),

      locale: explanation.locale,
    };
  }

  /**
   * V6 2.9: 批量应用付费预览门控
   *
   * 对一组 ExplanationV2 统一应用付费/免费策略。
   * 适用于日计划等批量返回场景。
   */
  applyUpgradeTeaserBatch(
    explanations: Map<string, ExplanationV2>,
    isPremium: boolean,
  ): Map<string, ExplanationV2> {
    if (isPremium) return explanations; // 付费用户不处理

    const gated = new Map<string, ExplanationV2>();
    for (const [key, exp] of explanations) {
      gated.set(key, this.applyUpgradeTeaser(exp, false));
    }
    return gated;
  }

  // ==================== V6 2.8: 反向解释（"为什么不推荐 X？"） ====================

  /**
   * 为指定食物生成反向解释 — 分析该食物未被推荐的原因
   * V6 2.11: 所有文案通过 t() 国际化
   *
   * 分析维度（按优先级）：
   * 1. 硬过滤原因（过敏原冲突、餐次不匹配、禁忌标签、热量超标、蛋白不足）
   * 2. 健康修正否决（penaltyResult.vetoed = true）
   * 3. 评分偏低维度（各维度分数 < 0.4 的维度列出）
   * 4. 偏好不匹配（用户 avoids 列表命中）
   * 5. 短期拒绝历史
   *
   * @param food         食物库对象
   * @param scored       该食物跑完评分流程后的 ScoredFood（含 explanation）
   * @param filterReasons 硬过滤原因列表（由调用方预先检测）
   * @param userProfile  用户画像约束
   * @param goalType     用户目标类型
   * @param locale       可选语言覆盖（V6 2.11 新增）
   * @returns 用户可读的反向解释文案
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

    // ── 1. 硬过滤原因 — 直接被排除，无法进入评分阶段 ──
    if (filterReasons.length > 0) {
      reasons.push(...filterReasons);
    }

    // ── 2. 健康修正否决 — 被健康引擎直接否决 ──
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

    // ── 4. 评分偏低维度分析 — 找到拉低总分的维度 ──
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
   * V6 2.11: 维度标签通过 t() 国际化
   *
   * 每个维度包含: 原始分 (0-1)、当前权重 (0-1)、基准线分数
   * 前端可直接渲染为雷达图/蛛网图
   */
  private buildRadarChart(
    explanation: ScoringExplanation,
    goalType: GoalType,
    mealType?: string,
    locale?: Locale,
  ): RadarChartData {
    // 获取当前目标+餐次下的归一化权重
    const weights = computeWeights(goalType, mealType);

    const dimensions: RadarChartDimension[] = SCORE_DIMENSIONS.map((dim, i) => {
      const d = explanation.dimensions[dim];
      return {
        name: dim,
        label: getDimensionLabel(dim, locale),
        score: d?.raw ?? 0,
        weight: weights[i] ?? 0,
        // 基准线: 暂用 0.5（中位线），后续可从用户群体画像系统填充真实均值
        benchmark: 0.5,
      };
    });

    return { dimensions };
  }

  /**
   * 构建营养素进度条数据
   * V6 2.11: 营养素名称通过 t() 国际化
   *
   * 将食物的份量营养与餐次目标对比，计算完成百分比和状态
   * 前端可渲染为水平进度条组
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
        status: this.nutrientStatus(percent, 60, 200), // 纤维越多越好，上限放宽
      });
    }

    return bars;
  }

  /**
   * 构建对比卡片数据
   *
   * vsUserAvg: 基于 finalScore 与理论中位分 (0.5) 的差异
   * vsHealthyTarget: 基于 10 维评分的加权健康达标率
   * trend7d: 暂为空数组（由画像系统在返回时填充 7 日趋势数据）
   */
  private buildComparisonCard(explanation: ScoringExplanation): ComparisonData {
    // 综合评分与中位基准的差异 (-1 ~ 1)
    // finalScore 通常在 0~2 范围，归一化为 -1~1 区间
    const normalizedScore = Math.min(
      1,
      Math.max(-1, (explanation.finalScore - 0.5) / 0.5),
    );

    // 健康达标率: 计算 10 维中有多少维度的原始分 >= 0.6（合格线）
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
      trend7d: [], // 暂为空，由画像系统在上层填充
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
  // V6.6 Phase 2-E: 变化解释 & 渠道解释
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 变化解释：今天推荐 X，昨天推荐 Y，向用户解释为什么变了
   * 仅在今日推荐与昨日显著不同（有新食物出现）时返回非 null 结果。
   *
   * @param todayTop      今日推荐的食物列表（FoodLibrary）
   * @param yesterdayTop  昨日推荐的食物列表（FoodLibrary）
   * @param profile       增强型画像上下文（用于判断变化原因和数据质量）
   * @returns DeltaExplanation 或 null（推荐未显著变化时）
   */
  generateDeltaExplanation(
    todayTop: FoodLibrary[],
    yesterdayTop: FoodLibrary[],
    profile: EnrichedProfileContext,
  ): DeltaExplanation | null {
    const yesterdayIds = new Set(yesterdayTop.map((f) => f.id));
    const newFoods = todayTop.filter((f) => !yesterdayIds.has(f.id));

    // 今日推荐无新食物 → 无变化，不生成解释
    if (newFoods.length === 0) return null;

    const primaryReason = this.detectChangeReason(
      profile,
      yesterdayTop,
      todayTop,
    );

    // 数据质量评估：有足够的声明画像 + 行为画像 → 高置信度
    const hasRichProfile =
      !!profile.declared &&
      !!profile.inferred &&
      !!profile.observed &&
      (profile.observed.totalRecords ?? 0) >= 7;

    return {
      changedFoods: newFoods.map((f) => f.name),
      primaryReason,
      confidence: hasRichProfile ? 'high' : 'medium',
    };
  }

  /**
   * 推断推荐变化的主要原因
   * 优先级：营养缺口变化 > 场景变化 > 策略刷新 > 多样性轮换
   */
  private detectChangeReason(
    profile: EnrichedProfileContext,
    yesterdayTop: FoodLibrary[],
    todayTop: FoodLibrary[],
  ): string {
    // 1. 场景变化（上下文画像不同）
    if (profile.contextual?.scene) {
      const scene = profile.contextual.scene;
      if (scene === 'post_exercise')
        return '今日有运动计划，已为你优化了蛋白质补充';
      if (scene === 'late_night') return '深夜时段，已为你调整为更轻量的选择';
      if (
        scene === 'weekday_lunch' ||
        scene === 'weekday_dinner' ||
        scene === 'weekday_breakfast'
      )
        return '工作日场景，推荐更方便快手的搭配';
    }

    // 2. 营养缺口存在
    const gaps = profile.inferred?.nutritionGaps;
    if (gaps?.length) {
      return `根据近期饮食分析，你的 ${gaps.slice(0, 2).join('、')} 摄入偏少，已优先推荐含量更高的食物`;
    }

    // 3. 品类多样性轮换（今昨日品类重叠少）
    const yesterdayCategories = new Set(yesterdayTop.map((f) => f.category));
    const todayCategories = new Set(todayTop.map((f) => f.category));
    const overlapCount = [...todayCategories].filter((c) =>
      yesterdayCategories.has(c),
    ).length;
    if (overlapCount <= todayCategories.size / 2) {
      return '为保持饮食多样性，今日为你推荐了不同类型的食物组合';
    }

    // 4. 默认：策略定期刷新
    return '推荐系统已根据你的饮食习惯更新了今日方案';
  }

  /**
   * 渠道过滤解释：因为当前渠道（如外卖、食堂），过滤了 N 个不适合的选项
   *
   * @param channel       当前推荐渠道
   * @param filteredCount 被渠道过滤的食物数量
   * @param locale        语言（默认 zh-CN）
   * @returns 用户可读的解释字符串，filteredCount = 0 时返回 null
   */
  generateChannelFilterExplanation(
    channel: AcquisitionChannel,
    filteredCount: number,
    locale: Locale = 'zh-CN',
  ): string | null {
    if (filteredCount <= 0) return null;

    const channelNames: Partial<Record<AcquisitionChannel, string>> = {
      [AcquisitionChannel.DELIVERY]: '外卖',
      [AcquisitionChannel.HOME_COOK]: '自己做',
      [AcquisitionChannel.CANTEEN]: '食堂',
      [AcquisitionChannel.CONVENIENCE]: '便利店',
      [AcquisitionChannel.RESTAURANT]: '餐厅',
    };

    const channelName = channelNames[channel] ?? '当前场景';

    return `基于你当前的${channelName}场景，已筛除 ${filteredCount} 个不适合的选项`;
  }
}
