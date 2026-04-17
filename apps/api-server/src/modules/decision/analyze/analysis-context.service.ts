/**
 * V3.2 Phase 1 — 分析上下文构建服务
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
  buildContextualAnalysis(ctx: UnifiedUserContext): ContextualAnalysis {
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
    const macroSlotStatus = ctx.macroSlotStatus || this.inferMacroSlotStatus(macroProgress);

    // 用 NutritionIssueDetector 识别问题
    const identifiedIssues = this.issueDetector.detectIssues(macroSlotStatus, macroProgress);

    // 构建推荐系统条件
    const recommendationContext = {
      remainingCalories: ctx.remainingCalories,
      targetMacros: {
        protein: ctx.remainingProtein,
        fat: ctx.remainingFat,
        carbs: ctx.remainingCarbs,
      },
      excludeFoods: [], // 由外部提供（当前用户今日已吃过的食物）
      preferredScenarios: ['homeCook'], // 默认，由用户偏好覆盖
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
   * 边界条件：
   * - < 90% → deficit
   * - >= 90% && <= 110% → ok
   * - > 110% → excess
   */
  private inferMacroSlotStatus(progress: MacroProgress): MacroSlotStatus {
    const inferSlot = (
      consumed: number,
      goal: number,
    ): 'deficit' | 'ok' | 'excess' => {
      const ratio = consumed / goal;
      if (ratio < 0.9) return 'deficit';
      if (ratio > 1.1) return 'excess';
      return 'ok';
    };

    const slot: MacroSlotStatus = {
      calories: inferSlot(progress.consumed.calories, progress.goals.calories),
      protein: inferSlot(progress.consumed.protein, progress.goals.protein),
      fat: inferSlot(progress.consumed.fat, progress.goals.fat),
      carbs: inferSlot(progress.consumed.carbs, progress.goals.carbs),
    };

    // 计算主要缺/超项
    const deficits: Array<'protein' | 'fat' | 'carbs' | 'calories'> = [];
    const excesses: Array<'protein' | 'fat' | 'carbs' | 'calories'> = [];

    if (slot.calories === 'deficit') deficits.push('calories');
    if (slot.calories === 'excess') excesses.push('calories');

    if (slot.protein === 'deficit') deficits.push('protein');
    if (slot.protein === 'excess') excesses.push('protein');

    if (slot.fat === 'deficit') deficits.push('fat');
    if (slot.fat === 'excess') excesses.push('fat');

    if (slot.carbs === 'deficit') deficits.push('carbs');
    if (slot.carbs === 'excess') excesses.push('carbs');

    // 计算最大缺/超项
    if (deficits.length > 0) {
      slot.dominantDeficit = deficits[0]; // 简化：取第一个
    }
    if (excesses.length > 0) {
      slot.dominantExcess = excesses[0];
    }

    return slot;
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
        excludeFoods: [...analysis.recommendationContext.excludeFoods, ...foodNames],
      },
    };
  }
}
