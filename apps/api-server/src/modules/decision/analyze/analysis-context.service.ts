/**
 * V3.4 Phase 2.2 — 分析上下文构建服务（透传 healthConditions）
 *
 * 职责:
 * - buildContextualAnalysis() 组装上下文，包括宏量状态、当日进度、问题识别、推荐条件
 *
 * 设计原则:
 * - 编排 NutritionIssueDetector
 * - 聚合 MacroSlotStatus + MacroProgress，生成完整上下文
 * - 为推荐系统提供条件信息
 */

import { Injectable } from '@nestjs/common';
import {
  ContextualAnalysis,
  MacroSlotStatus,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { NutritionIssueDetector } from './nutrition-issue-detector.service';

/** 当日进度快照 */
interface MacroProgress {
  consumed: { calories: number; protein: number; fat: number; carbs: number };
  remaining: { calories: number; protein: number; fat: number; carbs: number };
  goals: { calories: number; protein: number; fat: number; carbs: number };
}

@Injectable()
export class AnalysisContextService {
  constructor(private readonly issueDetector: NutritionIssueDetector) {}

  /**
   * 构建完整的上下文分析
   *
   * @param ctx 统一用户上下文
   * @returns 上下文分析对象
   */
  buildContextualAnalysis(
    ctx: UnifiedUserContext,
    locale?: import('../../diet/app/recommendation/utils/i18n-messages').Locale,
  ): ContextualAnalysis {
    // 构建宏量进度快照
    const macroProgress: MacroProgress = {
      consumed: {
        calories: ctx.todayCalories,
        protein: ctx.todayProtein,
        fat: ctx.todayFat,
        carbs: ctx.todayCarbs,
      },
      remaining: {
        calories: ctx.remainingCalories,
        protein: ctx.remainingProtein,
        fat: ctx.remainingFat,
        carbs: ctx.remainingCarbs,
      },
      goals: {
        calories: ctx.goalCalories,
        protein: ctx.goalProtein,
        fat: ctx.goalFat,
        carbs: ctx.goalCarbs,
      },
    };

    // 获取宏量槽位状态（默认若不存在则推导）
    const macroSlotStatus =
      ctx.macroSlotStatus || this.inferMacroSlotStatus(macroProgress);

    // 用 NutritionIssueDetector 识别问题（V3.4: 透传 healthConditions）
    const identifiedIssues = this.issueDetector.detectIssues(
      macroSlotStatus,
      macroProgress,
      ctx.healthConditions,
      locale,
      // V4.0: 透传行为上下文
      {
        shortTermBehavior: ctx.shortTermBehavior
          ? {
              bingeRiskHours: ctx.shortTermBehavior.bingeRiskHours,
              intakeTrends: ctx.shortTermBehavior.intakeTrends,
            }
          : undefined,
        localHour: ctx.localHour,
      },
    );

    // 构建推荐系统条件
    const recommendationContext = {
      remainingCalories: ctx.remainingCalories,
      targetMacros: {
        protein: ctx.remainingProtein,
        fat: ctx.remainingFat,
        carbs: ctx.remainingCarbs,
      },
      excludeFoods: [], // 由外部提供（当前用户今日已吃过的食物）
      preferredScenarios: this.inferPreferredScenarios(ctx.localHour),
    };

    return {
      macroSlotStatus,
      macroProgress: {
        consumed: macroProgress.consumed,
        remaining: macroProgress.remaining,
      },
      identifiedIssues,
      recommendationContext,
    };
  }

  /**
   * 根据进度推导宏量槽位状态
   *
   * 如果用户上下文中未包含 macroSlotStatus，基于 consumed vs goals 推导
   *
   * 边界条件（V4.2: 与 UserContextBuilderService 统一为 12% 阈值）：
   * - remaining/goal > 12% → deficit
   * - remaining/goal < -12% → excess
   * - 其他 → ok
   */
  private inferMacroSlotStatus(progress: MacroProgress): MacroSlotStatus {
    const threshold = 0.12; // V4.2: 统一 12% 阈值（与 UserContextBuilderService 一致）
    const inferSlot = (
      consumed: number,
      goal: number,
    ): 'deficit' | 'ok' | 'excess' => {
      if (goal <= 0) return 'ok';
      const remaining = goal - consumed;
      const ratio = remaining / goal;
      if (ratio < -threshold) return 'excess';
      if (ratio > threshold) return 'deficit';
      return 'ok';
    };

    const slot: MacroSlotStatus = {
      calories: inferSlot(progress.consumed.calories, progress.goals.calories),
      protein: inferSlot(progress.consumed.protein, progress.goals.protein),
      fat: inferSlot(progress.consumed.fat, progress.goals.fat),
      carbs: inferSlot(progress.consumed.carbs, progress.goals.carbs),
    };

    // 计算主要缺/超项（V4.2: 按 remaining/goal 比值排序取最大缺口）
    const macroKeys: Array<'protein' | 'fat' | 'carbs' | 'calories'> = [
      'calories',
      'protein',
      'fat',
      'carbs',
    ];
    const goalMap = {
      calories: progress.goals.calories,
      protein: progress.goals.protein,
      fat: progress.goals.fat,
      carbs: progress.goals.carbs,
    };
    const remainingMap = {
      calories: progress.goals.calories - progress.consumed.calories,
      protein: progress.goals.protein - progress.consumed.protein,
      fat: progress.goals.fat - progress.consumed.fat,
      carbs: progress.goals.carbs - progress.consumed.carbs,
    };

    const deficitEntries = macroKeys
      .filter((k) => slot[k] === 'deficit')
      .map(
        (k) => [k, goalMap[k] > 0 ? remainingMap[k] / goalMap[k] : 0] as const,
      )
      .sort((a, b) => b[1] - a[1]);
    if (deficitEntries.length > 0) {
      slot.dominantDeficit = deficitEntries[0][0];
    }

    const excessEntries = macroKeys
      .filter((k) => slot[k] === 'excess')
      .map(
        (k) => [k, goalMap[k] > 0 ? -remainingMap[k] / goalMap[k] : 0] as const,
      )
      .sort((a, b) => b[1] - a[1]);
    if (excessEntries.length > 0) {
      slot.dominantExcess = excessEntries[0][0];
    }

    return slot;
  }

  /**
   * V4.2: 基于时间推断场景偏好
   */
  private inferPreferredScenarios(localHour?: number): string[] {
    const hour = localHour ?? 12;
    if (hour >= 6 && hour < 10) return ['homeCook', 'convenience'];
    if (hour >= 10 && hour < 14) return ['takeout', 'homeCook'];
    if (hour >= 17 && hour < 21) return ['homeCook', 'takeout'];
    return ['convenience', 'homeCook'];
  }

  /**
   * 取消推荐上下文中的特定食物（去重）
   */
  excludeFoodsFromRecommendation(
    analysis: ContextualAnalysis,
    foodNames: string[],
  ): ContextualAnalysis {
    return {
      ...analysis,
      recommendationContext: {
        ...analysis.recommendationContext,
        excludeFoods: [
          ...analysis.recommendationContext.excludeFoods,
          ...foodNames,
        ],
      },
    };
  }
}
