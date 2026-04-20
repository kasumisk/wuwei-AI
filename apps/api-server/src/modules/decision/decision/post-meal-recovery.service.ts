import { Injectable } from '@nestjs/common';
import {
  MacroProgress,
  RecoveryAction,
  SignalTraceItem,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { cl } from '../i18n/decision-labels';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

@Injectable()
export class PostMealRecoveryService {
  build(input: {
    mode: 'pre_eat' | 'post_eat';
    macroProgress?: MacroProgress;
    userContext: UnifiedUserContext;
    signalTrace?: SignalTraceItem[]; // V3.1: 联动信号追踪
    locale?: Locale;
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
    let nextMealDirection = cl('recovery.defaultDirection', locale);

    // V3.1: signal trace takes priority over raw macro checks
    if (dominantSignal === 'protein_gap') {
      nextMealDirection = cl('recovery.proteinGap', locale);
    } else if (dominantSignal === 'fat_excess') {
      nextMealDirection = cl('recovery.fatExcess', locale);
    } else if (dominantSignal === 'carb_excess') {
      nextMealDirection = cl('recovery.carbExcess', locale);
    } else if (dominantSignal === 'over_limit') {
      nextMealDirection = cl('recovery.overLimit', locale);
    } else if (lowProtein) {
      nextMealDirection = cl('recovery.proteinGap', locale);
    } else if (highFat) {
      nextMealDirection = cl('recovery.fatExcess', locale);
    } else if (highCarbs) {
      nextMealDirection = cl('recovery.carbExcess', locale);
    } else if (overBudget) {
      nextMealDirection = cl('recovery.overLimit', locale);
    }

    const todayAdjustment = overBudget
      ? cl('recovery.todayRemaining', locale).replace(
          '{amount}',
          String(
            Math.max(
              0,
              Math.round(
                userContext.goalCalories - macroProgress.calories.consumed,
              ),
            ),
          ),
        )
      : cl('recovery.todaySteady', locale);

    return {
      nextMealDirection,
      todayAdjustment,
    };
  }
}
