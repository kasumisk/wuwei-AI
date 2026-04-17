import { Injectable } from '@nestjs/common';
import {
  MacroProgress,
  RecoveryAction,
  SignalTraceItem,
  UnifiedUserContext,
} from '../types/analysis-result.types';

@Injectable()
export class PostMealRecoveryService {
  build(input: {
    mode: 'pre_eat' | 'post_eat';
    macroProgress?: MacroProgress;
    userContext: UnifiedUserContext;
    signalTrace?: SignalTraceItem[]; // V3.1: 联动信号追踪
  }): RecoveryAction | undefined {
    const { mode, macroProgress, userContext, signalTrace } = input;
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
    let nextMealDirection = '下一餐保持清淡，优先蔬菜和优质蛋白';

    // V3.1: signal trace takes priority over raw macro checks
    if (dominantSignal === 'protein_gap') {
      nextMealDirection = '下一餐补足蛋白质，优先鸡蛋、鸡胸肉、豆腐等';
    } else if (dominantSignal === 'fat_excess') {
      nextMealDirection = '下一餐减少油脂，优先蒸煮类蛋白和蔬菜';
    } else if (dominantSignal === 'carb_excess') {
      nextMealDirection = '下一餐减少主食量，优先高蛋白和高纤维食物';
    } else if (dominantSignal === 'over_limit') {
      nextMealDirection =
        '今日热量已超标，建议下一餐以低热量、高饱腹感食物为主';
    } else if (lowProtein) {
      nextMealDirection = '下一餐补足蛋白质，优先鸡蛋、鸡胸肉、豆腐等';
    } else if (highFat) {
      nextMealDirection = '下一餐减少油脂，优先蒸煮类蛋白和蔬菜';
    } else if (highCarbs) {
      nextMealDirection = '下一餐减少主食量，优先高蛋白和高纤维食物';
    } else if (overBudget) {
      nextMealDirection =
        '今日热量已超标，建议下一餐以低热量、高饱腹感食物为主';
    }

    const todayAdjustment = overBudget
      ? `今日剩余热量建议控制在 ${Math.max(0, Math.round(userContext.goalCalories - macroProgress.calories.consumed))} kcal 以内`
      : '今日其余餐次以稳态控制为主，避免继续叠加高热量食物';

    return {
      nextMealDirection,
      todayAdjustment,
    };
  }
}
