/**
 * V7.6 P2-C: 对比 & 替代解释服务
 *
 * 从 ExplanationGeneratorService 拆分。
 * 负责：
 * - 食物对比解释（generateComparisonExplanation）
 * - 食物替代解释（generateSubstitutionExplanation）
 * - 变化解释（generateDeltaExplanation）
 * - 渠道过滤解释（generateChannelFilterExplanation）
 */

import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  ScoredFood,
  MealTarget,
  AcquisitionChannel,
  EnrichedProfileContext,
} from '../types/recommendation.types';
import { t, Locale } from '../utils/i18n-messages';
import { ClsServiceManager } from 'nestjs-cls';
import type {
  ComparisonExplanation,
  SubstitutionExplanation,
  DeltaExplanation,
} from '../types/explanation.types';

@Injectable()
export class ComparisonExplanationService {
  private resolveLocale(locale?: Locale): Locale {
    if (locale === 'en-US' || locale === 'zh-CN' || locale === 'ja-JP') {
      return locale;
    }

    try {
      const raw = ClsServiceManager.getClsService()?.get('locale');
      if (raw === 'en-US' || raw === 'zh-CN' || raw === 'ja-JP') {
        return raw;
      }
    } catch {
      // Ignore missing CLS context and fallback below.
    }

    return 'zh-CN';
  }

  /**
   * V7.4 P2-F: 生成两个食物之间的对比解释
   *
   * 用于"为什么推荐 A 而不是 B"的场景，比较两个食物在关键营养维度和评分上的差异。
   * 输出人类可读的中文对比文案。
   */
  generateComparisonExplanation(
    recommended: ScoredFood,
    alternative: ScoredFood,
    goalType: string,
    locale?: Locale,
  ): ComparisonExplanation {
    const resolvedLocale = this.resolveLocale(locale);
    const recFood = recommended.food;
    const altFood = alternative.food;

    // 计算关键维度差异
    const advantages: string[] = [];
    const disadvantages: string[] = [];

    // 热量对比
    const recCal = recommended.servingCalories ?? recFood.calories ?? 0;
    const altCal = alternative.servingCalories ?? altFood.calories ?? 0;
    if (recCal < altCal * 0.9) {
      advantages.push(
        t(
          'compare.caloriesLower',
          {
            recCal: String(Math.round(recCal)),
            altCal: String(Math.round(altCal)),
          },
          locale,
        ),
      );
    } else if (recCal > altCal * 1.1) {
      disadvantages.push(
        t(
          'compare.caloriesHigher',
          {
            recCal: String(Math.round(recCal)),
            altCal: String(Math.round(altCal)),
          },
          locale,
        ),
      );
    }

    // 蛋白质对比
    const recProt = recommended.servingProtein ?? recFood.protein ?? 0;
    const altProt = alternative.servingProtein ?? altFood.protein ?? 0;
    if (recProt > altProt * 1.1) {
      advantages.push(
        t(
          'compare.proteinRicher',
          {
            recProt: recProt.toFixed(1),
            altProt: altProt.toFixed(1),
          },
          locale,
        ),
      );
    }

    // 纤维对比
    const recFiber = recommended.servingFiber ?? recFood.fiber ?? 0;
    const altFiber = alternative.servingFiber ?? altFood.fiber ?? 0;
    if (recFiber > altFiber * 1.2) {
      advantages.push(t('compare.fiberBetter', {}, locale));
    }

    // 综合评分对比
    const scoreDiff = recommended.score - alternative.score;
    const scorePercent =
      alternative.score > 0
        ? Math.round((scoreDiff / alternative.score) * 100)
        : 0;

    // 获取难度对比
    const recDiff = recFood.acquisitionDifficulty ?? 3;
    const altDiff = altFood.acquisitionDifficulty ?? 3;
    if (recDiff < altDiff) {
      advantages.push(t('compare.easierToAcquire', {}, locale));
    }

    // 生成总结
    const summary = this.buildComparisonSummary(
      recFood.name,
      altFood.name,
      advantages,
      disadvantages,
      scorePercent,
      goalType,
      resolvedLocale,
    );

    return {
      recommendedFood: recFood.name,
      alternativeFood: altFood.name,
      advantages,
      disadvantages,
      scoreDifference: scoreDiff,
      scorePercentage: scorePercent,
      summary,
    };
  }

  /**
   * V7.4 P2-F: 生成食物替代解释
   *
   * 当用户替换推荐食物时，解释替代食物与原推荐食物的关系。
   * 帮助用户理解替代选择的营养影响。
   */
  generateSubstitutionExplanation(
    original: ScoredFood,
    substitute: ScoredFood,
    goalType: string,
    target: MealTarget,
    locale?: Locale,
  ): SubstitutionExplanation {
    const resolvedLocale = this.resolveLocale(locale);
    const origFood = original.food;
    const subFood = substitute.food;

    // 分析营养变化
    const calorieChange =
      (substitute.servingCalories ?? subFood.calories ?? 0) -
      (original.servingCalories ?? origFood.calories ?? 0);

    const proteinChange =
      (substitute.servingProtein ?? subFood.protein ?? 0) -
      (original.servingProtein ?? origFood.protein ?? 0);

    const fiberChange =
      (substitute.servingFiber ?? subFood.fiber ?? 0) -
      (original.servingFiber ?? origFood.fiber ?? 0);

    // 评估替代合理性
    const isGoodSubstitute =
      Math.abs(calorieChange) <= target.calories * 0.15 && // 热量变化不超过15%
      (proteinChange >= 0 || Math.abs(proteinChange) < 3); // 蛋白质不显著减少

    // 生成影响列表
    const impacts: string[] = [];

    if (Math.abs(calorieChange) > 10) {
      const direction =
        calorieChange > 0
          ? t('substitute.direction.increase', {}, locale)
          : t('substitute.direction.decrease', {}, locale);
      impacts.push(
        t(
          'substitute.caloriesChange',
          {
            direction,
            amount: String(Math.abs(Math.round(calorieChange))),
          },
          locale,
        ),
      );
    }

    if (Math.abs(proteinChange) > 1) {
      const direction =
        proteinChange > 0
          ? t('substitute.direction.increase', {}, locale)
          : t('substitute.direction.decrease', {}, locale);
      impacts.push(
        t(
          'substitute.proteinChange',
          {
            direction,
            amount: Math.abs(proteinChange).toFixed(1),
          },
          locale,
        ),
      );
    }

    if (Math.abs(fiberChange) > 0.5) {
      const direction =
        fiberChange > 0
          ? t('substitute.direction.increase', {}, locale)
          : t('substitute.direction.decrease', {}, locale);
      impacts.push(
        t(
          'substitute.fiberChange',
          {
            direction,
            amount: Math.abs(fiberChange).toFixed(1),
          },
          locale,
        ),
      );
    }

    // 品类兼容性
    const sameCategorySubstitute = origFood.category === subFood.category;

    // 生成建议
    const suggestion = this.buildSubstitutionSuggestion(
      origFood.name,
      subFood.name,
      isGoodSubstitute,
      impacts,
      sameCategorySubstitute,
      goalType,
      resolvedLocale,
    );

    return {
      originalFood: origFood.name,
      substituteFood: subFood.name,
      calorieChange,
      proteinChange,
      fiberChange,
      isGoodSubstitute,
      sameCategorySubstitute,
      impacts,
      suggestion,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V6.6 Phase 2-E: 变化解释 & 渠道解释
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 变化解释：今天推荐 X，昨天推荐 Y，向用户解释为什么变了
   * 仅在今日推荐与昨日显著不同（有新食物出现）时返回非 null 结果。
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
   * 渠道过滤解释：因为当前渠道（如外卖、食堂），过滤了 N 个不适合的选项
   */
  generateChannelFilterExplanation(
    channel: AcquisitionChannel,
    filteredCount: number,
    locale?: Locale,
  ): string | null {
    if (filteredCount <= 0) return null;

    const channelKeyMap: Partial<Record<AcquisitionChannel, string>> = {
      [AcquisitionChannel.DELIVERY]: 'explain.channel.delivery',
      [AcquisitionChannel.HOME_COOK]: 'explain.channel.homeCook',
      [AcquisitionChannel.CANTEEN]: 'explain.channel.canteen',
      [AcquisitionChannel.CONVENIENCE]: 'explain.channel.convenience',
      [AcquisitionChannel.RESTAURANT]: 'explain.channel.restaurant',
    };

    const channelName = t(
      channelKeyMap[channel] ?? 'explain.channel.default',
      {},
      locale,
    );

    return t(
      'explain.channel.filterNote',
      { channel: channelName, count: String(filteredCount) },
      locale,
    );
  }

  // ─── 内部辅助方法 ───

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
      if (scene === 'post_exercise') return t('explain.delta.postExercise');
      if (scene === 'late_night') return t('explain.delta.lateNight');
      if (
        scene === 'weekday_lunch' ||
        scene === 'weekday_dinner' ||
        scene === 'weekday_breakfast'
      )
        return t('explain.delta.weekday');
    }

    // 2. 营养缺口存在
    const gaps = profile.inferred?.nutritionGaps;
    if (gaps?.length) {
      return t('explain.delta.nutritionGap', {
        gaps: gaps.slice(0, 2).join('、'),
      });
    }

    // 3. 品类多样性轮换（今昨日品类重叠少）
    const yesterdayCategories = new Set(yesterdayTop.map((f) => f.category));
    const todayCategories = new Set(todayTop.map((f) => f.category));
    const overlapCount = [...todayCategories].filter((c) =>
      yesterdayCategories.has(c),
    ).length;
    if (overlapCount <= todayCategories.size / 2) {
      return t('explain.delta.diversityRotation');
    }

    // 4. 默认：策略定期刷新
    return t('explain.delta.strategyRefresh');
  }

  private buildComparisonSummary(
    recName: string,
    altName: string,
    advantages: string[],
    disadvantages: string[],
    scorePercent: number,
    goalType: string,
    locale: Locale,
  ): string {
    const goalText =
      t(`explain.goal.${goalType}`, {}, locale) ||
      t('explain.goal.daily', {}, locale);

    if (advantages.length === 0) {
      return t(
        'compare.summary.noAdvantage',
        {
          goalText,
          recName,
          altName,
        },
        locale,
      );
    }

    const advText = advantages
      .slice(0, 2)
      .join(locale === 'zh-CN' ? '，' : ', ');
    const scoreNote =
      scorePercent > 5
        ? t(
            'compare.summary.scoreHigher',
            { scorePercent: String(scorePercent) },
            locale,
          )
        : '';
    return t(
      'compare.summary.withAdvantage',
      {
        altName,
        recName,
        advText,
        scoreNote,
      },
      locale,
    );
  }

  private buildSubstitutionSuggestion(
    origName: string,
    subName: string,
    isGood: boolean,
    impacts: string[],
    sameCategory: boolean,
    goalType: string,
    locale: Locale,
  ): string {
    const quality = isGood
      ? t('substitute.quality.good', {}, locale)
      : t('substitute.quality.acceptable', {}, locale);

    const categoryNote = sameCategory
      ? t('substitute.category.same', {}, locale)
      : t('substitute.category.cross', {}, locale);

    const separator = locale === 'zh-CN' ? '，' : ', ';
    const impactText =
      impacts.length > 0
        ? t(
            'substitute.impacts.note',
            { impacts: impacts.join(separator) },
            locale,
          )
        : t('substitute.impacts.minor', {}, locale);

    return t(
      'substitute.suggestion',
      {
        subName,
        origName,
        quality,
        categoryNote,
        impactText,
      },
      locale,
    );
  }
}
