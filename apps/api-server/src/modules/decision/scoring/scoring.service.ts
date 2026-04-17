/**
 * V2.4 ScoringService
 * 
 * 职责：接收 AnalysisState + UserProfile，输出单一的 NutritionScore，对标用户目标并识别问题。
 * 
 * 关键方法：
 * - scoreNutrition(state, userProfile) → NutritionScore
 * - detectIssues(score, state) → Issue[]
 * - getProgressStatus(score) → { consumed, target, remaining, status }
 * - getActionDirection(score, food) → ActionDirection
 */

import { Injectable } from '@nestjs/common';
import { NutritionScore, Issue, ActionDirectionContext } from './scoring.types';

@Injectable()
export class ScoringService {
  /**
   * 计算用户当前摄入与目标的营养评分
   */
  scoreNutrition(
    analysisState: any,
    userProfile: any,
    userNutritionGoal?: any,
  ): NutritionScore {
    // 获取用户的营养目标
    const targetCalories = userNutritionGoal?.recommendedCalories || 2000;
    const targets = {
      calories: targetCalories,
      protein: userNutritionGoal?.macroTargets?.protein || 100,
      fat: userNutritionGoal?.macroTargets?.fat || 70,
      carbs: userNutritionGoal?.macroTargets?.carbs || 250,
      fiber: userNutritionGoal?.macroTargets?.fiber || 25,
    };

    // 从 analysisState 获取已消耗的营养
    const consumed = analysisState?.nutritionTotals || {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
    };

    // 计算剩余
    const remaining = {
      calories: Math.max(0, targets.calories - consumed.calories),
      protein: Math.max(0, targets.protein - consumed.protein),
      fat: Math.max(0, targets.fat - consumed.fat),
      carbs: Math.max(0, targets.carbs - consumed.carbs),
      fiber: Math.max(0, targets.fiber - (consumed.fiber || 0)),
    };

    // 判断进度状态
    const status = this.getProgressStatusInternal(consumed, targets);

    // 计算宏量均衡度 (0-100)
    const macroBalance = this.calculateMacroBalance(consumed, targets);

    // 识别问题
    const issues = this.detectIssues(consumed, targets, status);

    // 计算置信度权重 (基于分析状态的置信度)
    const confidence = analysisState?.confidence || 0.8;

    return {
      consumed,
      target: targets,
      remaining,
      status,
      macroBalance,
      issues,
      actionDirection: 'should_eat', // placeholder，后续通过 DecisionEngine 确定
      confidence,
      timestamp: new Date(),
    };
  }

  /**
   * 识别营养问题
   */
  detectIssues(
    consumed: any,
    targets: any,
    progressStatus: 'under' | 'balanced' | 'over',
  ): Issue[] {
    const issues: Issue[] = [];

    // 检查蛋白质
    if (consumed.protein < targets.protein * 0.8) {
      const deficit = targets.protein - consumed.protein;
      const severity = deficit > 20 ? 'high' : deficit > 10 ? 'medium' : 'low';
      issues.push({
        type: 'protein',
        status: 'deficit',
        value: deficit,
        severity,
        msg_i18n: `scoring.issue.protein_${severity}`,
      });
    }

    // 检查脂肪
    if (consumed.fat > targets.fat * 1.2) {
      const excess = consumed.fat - targets.fat;
      issues.push({
        type: 'fat',
        status: 'excess',
        value: excess,
        severity: excess > 20 ? 'high' : 'medium',
        msg_i18n: 'scoring.issue.fat_excess',
      });
    }

    // 检查碳水
    if (consumed.carbs > targets.carbs * 1.1) {
      const excess = consumed.carbs - targets.carbs;
      issues.push({
        type: 'carbs',
        status: 'excess',
        value: excess,
        severity: excess > 50 ? 'high' : 'medium',
        msg_i18n: 'scoring.issue.carbs_excess',
      });
    }

    // 检查纤维
    if ((consumed.fiber || 0) < targets.fiber * 0.7) {
      issues.push({
        type: 'fiber',
        status: 'deficit',
        value: targets.fiber - (consumed.fiber || 0),
        severity: 'low',
        msg_i18n: 'scoring.issue.fiber_low',
      });
    }

    // 检查热量
    if (progressStatus === 'over') {
      const excess = consumed.calories - targets.calories;
      issues.push({
        type: 'calories',
        status: 'excess',
        value: excess,
        severity: excess > 200 ? 'high' : 'medium',
        msg_i18n: 'scoring.issue.calories_over',
      });
    }

    return issues;
  }

  /**
   * 判断进度状态
   */
  private getProgressStatusInternal(
    consumed: any,
    targets: any,
  ): 'under' | 'balanced' | 'over' {
    const calorieRatio = consumed.calories / targets.calories;

    if (calorieRatio < 0.9) return 'under';
    if (calorieRatio > 1.1) return 'over';
    return 'balanced';
  }

  /**
   * 计算宏量均衡度 (0-100)
   */
  private calculateMacroBalance(consumed: any, targets: any): number {
    const proteinRatio = consumed.protein / targets.protein;
    const fatRatio = consumed.fat / targets.fat;
    const carbRatio = consumed.carbs / targets.carbs;

    // 计算偏差程度
    const proteinDeviation = Math.abs(proteinRatio - 1);
    const fatDeviation = Math.abs(fatRatio - 1);
    const carbDeviation = Math.abs(carbRatio - 1);

    // 越接近 1，越均衡
    const avgDeviation = (proteinDeviation + fatDeviation + carbDeviation) / 3;
    return Math.max(0, Math.round((1 - avgDeviation) * 100));
  }

  /**
   * 获取进度状态的详细信息
   */
  getProgressStatus(score: NutritionScore): {
    consumed: any;
    target: any;
    remaining: any;
    status: 'under' | 'balanced' | 'over';
  } {
    return {
      consumed: score.consumed,
      target: score.target,
      remaining: score.remaining,
      status: score.status,
    };
  }

  /**
   * 基于评分和食物信息，推荐决策方向
   */
  getActionDirection(score: NutritionScore, foodNutrition: any): string {
    // 如果热量已满或超标，应该避免
    if (score.status === 'over' || score.remaining.calories < foodNutrition.calories) {
      return 'should_avoid';
    }

    // 如果热量充足但有特定宏量缺陷，根据食物是否能补充来决定
    if (score.issues && score.issues.length > 0) {
      score.issues.forEach(issue => {
        if (issue.status === 'deficit' && issue.severity === 'high') {
          const nutrientMap = {
            protein: foodNutrition.protein,
            fat: foodNutrition.fat,
            carbs: foodNutrition.carbs,
            fiber: foodNutrition.fiber,
          };
          if (nutrientMap[issue.type] > 0) {
            return 'should_eat';
          }
        }
      });
    }

    return 'can_skip';
  }
}
