import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import {
  MacroProgress,
  RecoveryAction,
  SignalTraceItem,
  UnifiedUserContext,
} from '../types/analysis-result.types';
@Injectable()
export class PostMealRecoveryService {
  constructor(private readonly i18n: I18nService) {}

  build(input: {
    mode: 'pre_eat' | 'post_eat';
    macroProgress?: MacroProgress;
    userContext: UnifiedUserContext;
    signalTrace?: SignalTraceItem[]; // V3.1: 联动信号追踪
    locale?: I18nLocale;
  }): RecoveryAction | undefined {
    const { mode, macroProgress, userContext, signalTrace, locale } = input;
    if (!macroProgress) return undefined;

    const overBudget = macroProgress.calories.percent > 100;
    const highFat = macroProgress.fat.percent > 100;
    const highCarbs = macroProgress.carbs.percent > 100;
    const lowProtein = macroProgress.protein.percent < 80;

    if (
      mode !== 'post_eat' &&
      !overBudget &&
      !highFat &&
      !highCarbs &&
      !lowProtein
    ) {
      return undefined;
    }

    // V3.1: 优先使用 signalTrace 顶部信号驱动建议方向
    const dominantSignal = signalTrace?.[0]?.signal;
    let nextMealDirection = this.i18n.t(
      'decision.recovery.defaultDirection',
      locale,
    );

    // V3.1: signal trace takes priority over raw macro checks
    if (dominantSignal === 'protein_gap') {
      nextMealDirection = this.i18n.t('decision.recovery.proteinGap', locale);
    } else if (dominantSignal === 'fat_excess') {
      nextMealDirection = this.i18n.t('decision.recovery.fatExcess', locale);
    } else if (dominantSignal === 'carb_excess') {
      nextMealDirection = this.i18n.t('decision.recovery.carbExcess', locale);
    } else if (dominantSignal === 'over_limit') {
      nextMealDirection = this.i18n.t('decision.recovery.overLimit', locale);
    } else if (lowProtein) {
      nextMealDirection = this.i18n.t('decision.recovery.proteinGap', locale);
    } else if (highFat) {
      nextMealDirection = this.i18n.t('decision.recovery.fatExcess', locale);
    } else if (highCarbs) {
      nextMealDirection = this.i18n.t('decision.recovery.carbExcess', locale);
    } else if (overBudget) {
      nextMealDirection = this.i18n.t('decision.recovery.overLimit', locale);
    }

    const todayAdjustment = overBudget
      ? this.i18n.t('decision.recovery.todayRemaining', locale, {
          amount: Math.max(
            0,
            Math.round(
              userContext.goalCalories - macroProgress.calories.consumed,
            ),
          ),
        })
      : this.i18n.t('decision.recovery.todaySteady', locale);

    return {
      nextMealDirection,
      todayAdjustment,
    };
  }
}
