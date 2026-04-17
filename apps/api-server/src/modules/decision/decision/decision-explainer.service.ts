/**
 * V1.6 Phase 2 — 决策解释服务
 *
 * 职责:
 * - generateDecisionChain: 生成决策推理链（从评分到最终建议的步骤记录）
 * - generateExplanation: 生成增强版 AnalysisExplanation
 *
 * 设计原则:
 * - 无状态，所有数据通过参数传入
 * - 使用本地 i18n 映射，不修改 diet 模块的 i18n 文件
 */
import { Injectable } from '@nestjs/common';
import {
  AnalysisExplanation,
  DecisionChainStep,
  FoodDecision,
  UnifiedUserContext,
  DetailedRationale,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { DecisionFoodItem } from './food-decision.service';
import { DIMENSION_LABELS } from '../config/scoring-dimensions';
import { cl as dlCl } from '../i18n/decision-labels';
import {
  checkAllergenConflict,
  checkRestrictionConflict,
} from './decision-checks';
import {
  DynamicThresholdsService,
  UserThresholds,
} from '../config/dynamic-thresholds.service';

// ==================== 输入类型 ====================

export interface DecisionChainInput {
  baseScore: number;
  scoreBreakdown?: NutritionScoreBreakdown;
  allergenCheck: { triggered: boolean; allergens: string[] };
  healthCheck: { triggered: boolean; conditions: string[] };
  timingCheck: { isLateNight: boolean; localHour: number };
  dailyBudgetCheck: { remainingCalories: number; mealCalories: number };
  finalDecision: 'recommend' | 'caution' | 'avoid';
}

export interface ExplanationInput {
  foods: DecisionFoodItem[];
  decision: FoodDecision;
  ctx: UnifiedUserContext;
  breakdown?: NutritionScoreBreakdown;
}

// ==================== 本地 i18n 映射 ====================

const CHAIN_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': {
    'step.scoring': '营养评分计算',
    'step.scoring.input': '基于7维评分引擎计算',
    'step.scoring.output.high': '评分 {score}，整体优秀',
    'step.scoring.output.mid': '评分 {score}，中等水平',
    'step.scoring.output.low': '评分 {score}，需要改善',
    'step.allergen': '过敏原检查',
    'step.allergen.input': '检查食物是否含有用户过敏原',
    'step.allergen.triggered': '检测到过敏原: {allergens}，强制标记为避免',
    'step.allergen.clear': '未检测到过敏原',
    'step.health': '健康状况检查',
    'step.health.input': '检查食物是否与用户健康状况冲突',
    'step.health.triggered': '与健康状况冲突: {conditions}',
    'step.health.clear': '无健康状况冲突',
    'step.timing': '用餐时间检查',
    'step.timing.input': '当前时间 {hour}:00',
    'step.timing.lateNight': '深夜用餐，建议控制摄入',
    'step.timing.normal': '用餐时间正常',
    'step.budget': '热量预算检查',
    'step.budget.input': '剩余预算 {remaining} kcal，本餐 {meal} kcal',
    'step.budget.over': '超出每日热量预算',
    'step.budget.ok': '在热量预算范围内',
    'step.final': '最终决策',
    'step.final.input': '综合所有因素',
    'step.final.recommend': '建议食用',
    'step.final.caution': '谨慎食用',
    'step.final.avoid': '不建议食用',
  },
  'en-US': {
    'step.scoring': 'Nutrition Scoring',
    'step.scoring.input': 'Calculated via 7-dimension scoring engine',
    'step.scoring.output.high': 'Score {score}, excellent overall',
    'step.scoring.output.mid': 'Score {score}, moderate level',
    'step.scoring.output.low': 'Score {score}, needs improvement',
    'step.allergen': 'Allergen Check',
    'step.allergen.input': 'Checking for user allergens in food',
    'step.allergen.triggered':
      'Allergens detected: {allergens}, marked as avoid',
    'step.allergen.clear': 'No allergens detected',
    'step.health': 'Health Condition Check',
    'step.health.input': 'Checking food against user health conditions',
    'step.health.triggered': 'Conflicts with health conditions: {conditions}',
    'step.health.clear': 'No health condition conflicts',
    'step.timing': 'Meal Timing Check',
    'step.timing.input': 'Current time {hour}:00',
    'step.timing.lateNight': 'Late night meal, suggest controlling intake',
    'step.timing.normal': 'Normal meal time',
    'step.budget': 'Calorie Budget Check',
    'step.budget.input':
      'Remaining budget {remaining} kcal, this meal {meal} kcal',
    'step.budget.over': 'Exceeds daily calorie budget',
    'step.budget.ok': 'Within calorie budget',
    'step.final': 'Final Decision',
    'step.final.input': 'Combining all factors',
    'step.final.recommend': 'Recommended to eat',
    'step.final.caution': 'Eat with caution',
    'step.final.avoid': 'Not recommended',
  },
  'ja-JP': {
    'step.scoring': '栄養スコア計算',
    'step.scoring.input': '7次元スコアリングエンジンで計算',
    'step.scoring.output.high': 'スコア {score}、全体的に優秀',
    'step.scoring.output.mid': 'スコア {score}、中程度',
    'step.scoring.output.low': 'スコア {score}、改善が必要',
    'step.allergen': 'アレルゲンチェック',
    'step.allergen.input': '食品にユーザーのアレルゲンが含まれているか確認',
    'step.allergen.triggered': 'アレルゲン検出: {allergens}、回避として設定',
    'step.allergen.clear': 'アレルゲンは検出されませんでした',
    'step.health': '健康状態チェック',
    'step.health.input': '食品がユーザーの健康状態と矛盾しないか確認',
    'step.health.triggered': '健康状態と矛盾: {conditions}',
    'step.health.clear': '健康状態との矛盾なし',
    'step.timing': '食事時間チェック',
    'step.timing.input': '現在時刻 {hour}:00',
    'step.timing.lateNight': '深夜の食事、摂取量の制御を推奨',
    'step.timing.normal': '通常の食事時間',
    'step.budget': 'カロリー予算チェック',
    'step.budget.input': '残り予算 {remaining} kcal、この食事 {meal} kcal',
    'step.budget.over': '1日のカロリー予算を超過',
    'step.budget.ok': 'カロリー予算内',
    'step.final': '最終判定',
    'step.final.input': '全ての要素を総合',
    'step.final.recommend': '食べることを推奨',
    'step.final.caution': '注意して食べる',
    'step.final.avoid': '食べることを推奨しない',
  },
};

// V1.9: DIMENSION_LABELS 已提取到 ../config/scoring-dimensions.ts

// ==================== 辅助函数 ====================

function cl(
  key: string,
  vars?: Record<string, string>,
  locale?: Locale,
): string {
  const loc = locale || 'zh-CN';
  const labels = CHAIN_LABELS[loc] || CHAIN_LABELS['zh-CN'];
  let text = labels[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

@Injectable()
export class DecisionExplainerService {
  constructor(private readonly dynamicThresholds: DynamicThresholdsService) {}

  // ==================== V3.7 P2.1: 从 DecisionEngineService 提取的文案生成 ====================

  /**
   * 生成行动建议文案（原 DecisionEngineService.generateDecisionAdvice）
   */
  generateDecisionAdvice(
    decision: FoodDecision,
    ctx: UnifiedUserContext,
    totalCalories: number,
    totalProtein: number,
    locale?: Locale,
    totalFat?: number,
    totalCarbs?: number,
    th?: UserThresholds,
  ): string {
    const lowProtein = th?.lowProteinMeal ?? 15;
    const significantCal = th?.significantMealCal ?? 300;
    const highFat = th?.highFatMeal ?? 30;
    const highProtein = th?.highProteinMeal ?? 25;

    if (decision.recommendation === 'recommend') {
      if (ctx.goalType === 'muscle_gain' && totalProtein >= highProtein) {
        return t('decision.advice.goodProtein', {}, locale);
      }
      return t('decision.advice.balanced', {}, locale);
    }

    if (decision.recommendation === 'avoid') {
      if (decision.reason?.includes('⚠️')) {
        return t('decision.advice.switch', {}, locale);
      }
      const remaining = ctx.remainingCalories - totalCalories;
      if (remaining < -(th?.overBudgetMargin ?? 100)) {
        const excessCal = Math.abs(Math.round(remaining));
        const excessSuffix = dlCl('suffix.excessCal', locale).replace(
          '{amount}',
          String(excessCal),
        );
        return (
          t(
            'decision.advice.reducePortion',
            {
              percent: String(
                Math.max(
                  30,
                  Math.round((ctx.remainingCalories / totalCalories) * 100),
                ),
              ),
            },
            locale,
          ) + excessSuffix
        );
      }
      return t('decision.advice.switch', {}, locale);
    }

    // caution
    const tips: string[] = [];
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < lowProtein &&
      totalCalories > significantCal
    ) {
      const proteinQuantSuffix = dlCl('suffix.currentProtein', locale).replace(
        '{amount}',
        String(Math.round(totalProtein)),
      );
      tips.push(
        t('decision.advice.addProtein', {}, locale) + proteinQuantSuffix,
      );
    }
    if (ctx.remainingCalories - totalCalories < 0) {
      tips.push(t('decision.advice.halfPortion', {}, locale));
    }
    if (
      totalFat != null &&
      totalFat > highFat &&
      ctx.goalFat > 0 &&
      (ctx.todayFat + totalFat) / ctx.goalFat > (th?.fatExcessRatio ?? 1)
    ) {
      tips.push(t('decision.advice.reduceFat', {}, locale));
    }
    if (
      totalCarbs != null &&
      ctx.goalCarbs > 0 &&
      (ctx.todayCarbs + totalCarbs) / ctx.goalCarbs >
        (th?.carbExcessRatio ?? 1.1) &&
      ctx.goalType === 'fat_loss'
    ) {
      tips.push(t('decision.advice.reduceCarbs', {}, locale));
    }
    if (tips.length === 0) {
      tips.push(t('decision.advice.controlOther', {}, locale));
    }
    return tips.join('，');
  }

  /**
   * 构建多维决策原因（原 DecisionEngineService.buildDetailedRationale）
   */
  buildDetailedRationale(
    decision: FoodDecision,
    ctx: UnifiedUserContext,
    nutritionScore: number,
    hour: number,
    foods: DecisionFoodItem[],
    locale?: Locale,
  ): DetailedRationale {
    const baseline = decision.reason || '';

    const calorieProgress =
      ctx.goalCalories > 0
        ? Math.round((ctx.todayCalories / ctx.goalCalories) * 100)
        : 0;
    const contextual = dlCl('rationale.contextual', locale).replace(
      '{percent}',
      String(calorieProgress),
    );

    const goalLabel = ctx.goalLabel || ctx.goalType;
    const goalAlignment = dlCl('rationale.goalAlignment', locale).replace(
      '{goalLabel}',
      goalLabel,
    );

    const allergenCheck = checkAllergenConflict(foods, ctx, locale);
    const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
    const healthRisk = allergenCheck?.triggered
      ? allergenCheck.reason || null
      : restrictionCheck?.triggered
        ? restrictionCheck.reason || null
        : null;

    let timelinessNote: string | null = null;
    const dynamicTh = this.dynamicThresholds.compute(ctx);
    if (hour >= dynamicTh.lateNightStart || hour < dynamicTh.lateNightEnd) {
      timelinessNote = dlCl('rationale.timelinessLateNight', locale);
    }

    return {
      baseline,
      contextual,
      goalAlignment,
      healthRisk,
      timelinessNote,
    };
  }

  // ==================== 决策推理链 ====================

  generateDecisionChain(
    input: DecisionChainInput,
    locale?: Locale,
  ): DecisionChainStep[] {
    const steps: DecisionChainStep[] = [];

    // Step 1: 营养评分
    const scoreLabel =
      input.baseScore >= 75
        ? 'step.scoring.output.high'
        : input.baseScore >= 45
          ? 'step.scoring.output.mid'
          : 'step.scoring.output.low';
    steps.push({
      step: cl('step.scoring', {}, locale),
      input: cl('step.scoring.input', {}, locale),
      output: cl(
        scoreLabel,
        { score: String(Math.round(input.baseScore)) },
        locale,
      ),
      confidence: input.baseScore >= 75 || input.baseScore < 30 ? 0.95 : 0.7,
    });

    // Step 2: 过敏原检查
    steps.push({
      step: cl('step.allergen', {}, locale),
      input: cl('step.allergen.input', {}, locale),
      output: input.allergenCheck.triggered
        ? cl(
            'step.allergen.triggered',
            { allergens: input.allergenCheck.allergens.join(', ') },
            locale,
          )
        : cl('step.allergen.clear', {}, locale),
      confidence: 0.95,
    });

    // Step 3: 健康状况检查
    steps.push({
      step: cl('step.health', {}, locale),
      input: cl('step.health.input', {}, locale),
      output: input.healthCheck.triggered
        ? cl(
            'step.health.triggered',
            { conditions: input.healthCheck.conditions.join(', ') },
            locale,
          )
        : cl('step.health.clear', {}, locale),
      confidence: input.healthCheck.triggered ? 0.75 : 0.95,
    });

    // Step 4: 用餐时间检查
    steps.push({
      step: cl('step.timing', {}, locale),
      input: cl(
        'step.timing.input',
        { hour: String(input.timingCheck.localHour) },
        locale,
      ),
      output: input.timingCheck.isLateNight
        ? cl('step.timing.lateNight', {}, locale)
        : cl('step.timing.normal', {}, locale),
      confidence: 0.95,
    });

    // Step 5: 热量预算检查
    const budgetOver =
      input.dailyBudgetCheck.mealCalories >
      input.dailyBudgetCheck.remainingCalories;
    const budgetExcess = Math.round(
      input.dailyBudgetCheck.mealCalories -
        input.dailyBudgetCheck.remainingCalories,
    );
    // 量化：超出时附带超出量，如 "超出每日热量预算（超出 120kcal）"
    const budgetOverSuffix = budgetOver
      ? locale === 'en-US'
        ? ` (+${budgetExcess}kcal over)`
        : locale === 'ja-JP'
          ? `（${budgetExcess}kcal超過）`
          : `（超出 ${budgetExcess}kcal）`
      : '';
    steps.push({
      step: cl('step.budget', {}, locale),
      input: cl(
        'step.budget.input',
        {
          remaining: String(
            Math.round(input.dailyBudgetCheck.remainingCalories),
          ),
          meal: String(Math.round(input.dailyBudgetCheck.mealCalories)),
        },
        locale,
      ),
      output: budgetOver
        ? cl('step.budget.over', {}, locale) + budgetOverSuffix
        : cl('step.budget.ok', {}, locale),
      confidence: 0.95,
    });

    // Step 6: 最终决策
    const finalConfidence =
      input.allergenCheck.triggered || input.healthCheck.triggered
        ? 0.95
        : input.baseScore >= 60 || input.baseScore < 30
          ? 0.9
          : 0.7;
    steps.push({
      step: cl('step.final', {}, locale),
      input: cl('step.final.input', {}, locale),
      output: cl(`step.final.${input.finalDecision}`, {}, locale),
      confidence: finalConfidence,
    });

    return steps;
  }

  // ==================== 增强版解释 ====================

  generateExplanation(
    input: ExplanationInput,
    locale?: Locale,
  ): AnalysisExplanation {
    const { foods, decision, ctx, breakdown } = input;

    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const foodNames = foods.map((f) => f.name).join('、');

    const verdict = decision.shouldEat
      ? t('decision.explain.suitable', {}, locale)
      : t('decision.explain.adjust', {}, locale);
    const summary = t(
      'decision.explain.summary',
      { foods: foodNames, calories: String(totalCalories), verdict },
      locale,
    );

    const primaryReason = decision.reason;

    const userContextImpact: string[] = [];
    if (ctx.goalType !== 'health') {
      userContextImpact.push(
        t('decision.explain.goal', { goal: ctx.goalLabel }, locale),
      );
    }
    if (ctx.remainingCalories < totalCalories && ctx.goalCalories > 0) {
      userContextImpact.push(
        t(
          'decision.explain.remaining',
          {
            remaining: String(Math.round(ctx.remainingCalories)),
            meal: String(totalCalories),
          },
          locale,
        ),
      );
    }
    if (totalProtein > 0) {
      const proteinPercent = Math.round(
        (totalProtein * 4 * 100) / Math.max(1, totalCalories),
      );
      const proteinGrams = Math.round(totalProtein);
      // 量化：附带绝对蛋白克数，如 "蛋白质占比 15%（18g）"
      const proteinQuantSuffix =
        locale === 'en-US'
          ? ` (${proteinGrams}g)`
          : locale === 'ja-JP'
            ? `（${proteinGrams}g）`
            : `（${proteinGrams}g）`;
      userContextImpact.push(
        t(
          'decision.explain.proteinRatio',
          { percent: String(proteinPercent) },
          locale,
        ) + proteinQuantSuffix,
      );
    }

    // 脂肪/碳水进度
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    if (ctx.goalFat > 0 && totalFat > 0) {
      const fatProgress = Math.round(
        ((ctx.todayFat + totalFat) / ctx.goalFat) * 100,
      );
      userContextImpact.push(
        t(
          'decision.explain.fatProgress',
          { percent: String(fatProgress) },
          locale,
        ),
      );
    }
    if (ctx.goalCarbs > 0 && totalCarbs > 0) {
      const carbsProgress = Math.round(
        ((ctx.todayCarbs + totalCarbs) / ctx.goalCarbs) * 100,
      );
      userContextImpact.push(
        t(
          'decision.explain.carbsProgress',
          { percent: String(carbsProgress) },
          locale,
        ),
      );
    }

    // Breakdown 弱项分析
    if (breakdown) {
      const loc = locale || 'zh-CN';
      const labels = DIMENSION_LABELS[loc] || DIMENSION_LABELS['zh-CN'];
      const weakDims = Object.entries(breakdown)
        .filter(([_, score]) => (score as number) < 50)
        .sort((a, b) => (a[1] as number) - (b[1] as number));

      if (weakDims.length > 0) {
        const weakList = weakDims
          .slice(0, 3)
          .map(
            ([dim, score]) =>
              `${labels[dim] || dim}(${Math.round(score as number)})`,
          )
          .join('、');
        userContextImpact.push(
          t(
            'decision.explain.weakDimensions',
            { dimensions: weakList },
            locale,
          ),
        );
      }
    }

    return {
      summary,
      primaryReason,
      userContextImpact:
        userContextImpact.length > 0 ? userContextImpact : undefined,
    };
  }
}
