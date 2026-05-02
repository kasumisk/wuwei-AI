/**
 * V7.3 P2-B: 自然语言推荐解释服务
 *
 * 从 ScoringChain 的 ScoringAdjustment[] 结果生成人类可读的中文叙述，
 * 替代原有的纯数值型评分解释。
 *
 * 职责：
 * 1. generateNarrative() — 综合所有调整记录，产出一段简短的推荐理由
 * 2. generateWhyThisDish() — 为单个食物生成结构化的"为什么推荐"解释
 *
 * 设计原则：
 * - 不依赖 AI/LLM，纯模板拼接 + 规则优先级排序
 * - 最多输出 3 个理由点，避免信息过载
 * - 支持 i18n（通过 NarrativeContext.locale）
 */
import { Injectable } from '@nestjs/common';
import type { FoodLibrary } from '../../../../food/food.types';
import type { ScoredFood } from '../types/recommendation.types';
import type { ScoringAdjustment } from '../scoring-chain/scoring-factor.interface';
import { t, type Locale } from '../utils/i18n-messages';

// ─── 类型定义 ───

export interface NarrativeContext {
  locale: string;
  goalType: string;
  mealType: string;
  nutritionGaps?: string[];
  recentFoodNames?: string[];
  executionRate?: number;
}

export interface WhyThisDishExplanation {
  /** 主要推荐原因（1句话） */
  primaryReason: string;
  /** 营养说明（0-2句） */
  nutritionNote?: string;
  /** 场景说明（0-1句） */
  sceneNote?: string;
  /** 合并后的完整叙述 */
  narrative: string;
}

// ─── 因子名 → 叙述优先级映射 ───
// 优先级越小越重要，最多取 top 3
const FACTOR_PRIORITY: Record<string, number> = {
  'preference-signal': 1,
  'analysis-profile': 2,
  'scene-context': 3,
  'short-term-profile': 4,
  'collaborative-filtering': 5,
  'regional-boost': 6,
  'lifestyle-boost': 7,
  popularity: 8,
  'replacement-feedback': 9,
  'rule-weight': 10,
};

// ─── 因子名 → 叙述模板 key ───
const FACTOR_NARRATIVE_KEY: Record<string, string> = {
  'preference-signal': 'narrative.preference_match',
  'scene-context': 'narrative.scene_fit',
  'short-term-profile': 'narrative.diversity',
  'analysis-profile': 'narrative.health_benefit',
  'regional-boost': 'narrative.seasonal',
  'collaborative-filtering': 'narrative.execution_boost',
  popularity: 'narrative.execution_boost',
  'replacement-feedback': 'narrative.preference_match',
};

// ─── 营养素标签：通过 i18n 取本地化名称（P3-3.1） ───
// 历史 NUTRIENT_CN 硬编码中文导致 en/ja locale 输出仍是中文，
// 现统一通过 t('explain.nutrient.{key}', {}, locale) 解析。
function getNutrientLabel(nutrient: string, locale: Locale): string {
  // i18n key 自动加 'recommendation.' 前缀，故使用 'explain.nutrient.xxx'
  const translated = t(`explain.nutrient.${nutrient}`, {}, locale);
  // t() miss 时回退原 key（避免暴露未翻译占位符）
  if (!translated || translated === `explain.nutrient.${nutrient}`) {
    return nutrient;
  }
  return translated;
}

// 多个营养素之间的连接词（locale 感知）
function getAndConnector(locale: Locale): string {
  const conn = t('narrative.and_connector', {}, locale);
  if (!conn || conn === 'narrative.and_connector') {
    // 回退（zh 用「和」，其他用「, 」）
    return locale === 'zh-CN' ? '和' : ', ';
  }
  return conn;
}

@Injectable()
export class NaturalLanguageExplainerService {
  /**
   * 从 ScoringAdjustment[] 生成综合叙述
   *
   * 策略：
   * 1. 按因子优先级排序
   * 2. 取 top 3 有意义的调整（multiplier != 1 或 additive != 0）
   * 3. 拼接为简短的中文段落
   */
  generateNarrative(
    adjustments: ScoringAdjustment[],
    food: FoodLibrary,
    ctx: NarrativeContext,
  ): string {
    const reasons = this.extractTopReasons(adjustments, food, ctx, 3);
    if (reasons.length === 0) {
      return `推荐${food.name || '该食物'}作为${this.getMealLabel(ctx.mealType)}选择。`;
    }
    return reasons.join('；') + '。';
  }

  /**
   * 为单个食物生成结构化"为什么推荐"解释
   */
  generateWhyThisDish(
    food: ScoredFood,
    adjustments: ScoringAdjustment[],
    ctx: NarrativeContext,
  ): WhyThisDishExplanation {
    const foodLib = food.food;
    const foodName = foodLib.name || '该食物';

    // 主要原因: 最高优先级的因子
    const reasons = this.extractTopReasons(adjustments, foodLib, ctx, 3);
    const primaryReason =
      reasons[0] || `${foodName}适合作为${this.getMealLabel(ctx.mealType)}选择`;

    // 营养说明: 如果有营养缺口匹配
    let nutritionNote: string | undefined;
    if (ctx.nutritionGaps?.length) {
      const matchingGaps = ctx.nutritionGaps.filter((gap) => {
        const val =
          Number((foodLib as unknown as Record<string, unknown>)[gap]) || 0;
        return val > 0;
      });
      if (matchingGaps.length > 0) {
        const locale = ctx.locale as Locale;
        const gapNames = matchingGaps
          .slice(0, 2)
          .map((g) => getNutrientLabel(g, locale))
          .join(getAndConnector(locale));
        // P3-3.1: 用 narrative.nutrition_gap i18n key 替代硬编码中文
        nutritionNote = t(
          'narrative.nutrition_gap',
          { nutrient: gapNames, food: foodName },
          locale,
        );
      }
    }

    // 场景说明
    let sceneNote: string | undefined;
    const sceneAdj = adjustments.find(
      (a) => a.factorName === 'scene-context' && a.multiplier !== 1.0,
    );
    if (sceneAdj) {
      sceneNote = t(
        'narrative.scene_fit',
        { food: foodName, scene: ctx.mealType, reason: sceneAdj.reason },
        ctx.locale as Locale,
      );
    }

    // 合并叙述
    const parts = [primaryReason, nutritionNote, sceneNote].filter(Boolean);
    const narrative = parts.join('。') + '。';

    return {
      primaryReason,
      nutritionNote,
      sceneNote,
      narrative,
    };
  }

  // ─── 私有方法 ───

  /**
   * 从调整记录中提取 top N 个推荐理由
   */
  private extractTopReasons(
    adjustments: ScoringAdjustment[],
    food: FoodLibrary,
    ctx: NarrativeContext,
    maxReasons: number,
  ): string[] {
    const foodName = food.name || '该食物';

    // 过滤有意义的调整 & 按优先级排序
    const meaningful = adjustments
      .filter(
        (a) =>
          Math.abs(a.multiplier - 1.0) > 0.01 || Math.abs(a.additive) > 0.1,
      )
      .sort(
        (a, b) =>
          (FACTOR_PRIORITY[a.factorName] ?? 99) -
          (FACTOR_PRIORITY[b.factorName] ?? 99),
      )
      .slice(0, maxReasons);

    const reasons: string[] = [];

    for (const adj of meaningful) {
      const reason = this.factorToReason(adj, foodName, ctx);
      if (reason) reasons.push(reason);
    }

    // 补充营养缺口理由
    if (reasons.length < maxReasons && ctx.nutritionGaps?.length) {
      const matchingGaps = ctx.nutritionGaps.filter((gap) => {
        const val =
          Number((food as unknown as Record<string, unknown>)[gap]) || 0;
        return val > 0;
      });
      if (matchingGaps.length > 0) {
        const gapName = getNutrientLabel(matchingGaps[0], ctx.locale as Locale);
        reasons.push(
          t(
            'narrative.nutrition_gap',
            { nutrient: gapName, food: foodName },
            ctx.locale as Locale,
          ),
        );
      }
    }

    // 补充执行率理由
    if (
      reasons.length < maxReasons &&
      ctx.executionRate !== undefined &&
      ctx.executionRate > 0.7
    ) {
      reasons.push(
        t(
          'narrative.execution_boost',
          { food: foodName },
          ctx.locale as Locale,
        ),
      );
    }

    return reasons;
  }

  /**
   * 单个因子调整 → 中文理由
   */
  private factorToReason(
    adj: ScoringAdjustment,
    foodName: string,
    ctx: NarrativeContext,
  ): string | null {
    const locale = ctx.locale as Locale;
    const direction = adj.multiplier > 1.0 ? '加分' : '适度调整';

    switch (adj.factorName) {
      case 'preference-signal':
        return t(
          'narrative.preference_match',
          { food: foodName, reason: adj.reason },
          locale,
        );

      case 'scene-context':
        return t(
          'narrative.scene_fit',
          {
            food: foodName,
            scene: this.getMealLabel(ctx.mealType),
            reason: direction,
          },
          locale,
        );

      case 'short-term-profile': {
        const recent =
          ctx.recentFoodNames?.slice(0, 2).join('、') || '同类食物';
        return t(
          'narrative.diversity',
          { recentCategory: recent, food: foodName },
          locale,
        );
      }

      case 'analysis-profile':
        return t(
          'narrative.health_benefit',
          { food: foodName, healthBenefit: adj.reason },
          locale,
        );

      case 'regional-boost':
        return t('narrative.seasonal', { food: foodName }, locale);

      case 'collaborative-filtering':
      case 'popularity':
        return t('narrative.execution_boost', { food: foodName }, locale);

      default:
        // 通用回退
        return adj.multiplier > 1.0
          ? `${foodName}在${adj.factorName}维度获得${direction}`
          : null;
    }
  }

  /** 餐次中文标签 */
  private getMealLabel(mealType: string): string {
    const labels: Record<string, string> = {
      breakfast: '早餐',
      lunch: '午餐',
      dinner: '晚餐',
      snack: '加餐',
    };
    return labels[mealType] || mealType;
  }
}
