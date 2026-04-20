/**
 * V3.4 Phase 2.1 — 营养问题检测服务（含健康条件特异性规则）
 *
 * 职责:
 * - detectIssues() 基于 MacroSlotStatus 和 MacroProgress 识别结构化问题
 * - 计算严重程度、偏差值、阈值等
 *
 * 设计原则:
 * - 纯函数，可独立测试
 * - 问题按严重程度排序
 * - 驱动决策建议
 */

import { Injectable } from '@nestjs/common';
import {
  MacroSlotStatus,
  NutritionIssue,
  IssueType,
} from '../types/analysis-result.types';
import { cl } from '../i18n/decision-labels';
import { hasCondition } from '../config/condition-aliases';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

interface MacroProgress {
  consumed: { calories: number; protein: number; fat: number; carbs: number };
  remaining: { calories: number; protein: number; fat: number; carbs: number };
  goals: { calories: number; protein: number; fat: number; carbs: number };
}

interface IssueDetectionRule {
  type: IssueType;
  condition: (slot: MacroSlotStatus, progress: MacroProgress) => boolean;
  severityCalculator: (
    slot: MacroSlotStatus,
    progress: MacroProgress,
  ) => 'low' | 'medium' | 'high';
  metricCalculator: (progress: MacroProgress) => number;
  thresholdCalculator: (progress: MacroProgress) => number;
  implicationTemplate: (
    metric: number,
    threshold: number,
    locale?: Locale,
  ) => string;
}

@Injectable()
export class NutritionIssueDetector {
  private readonly rules: IssueDetectionRule[] = [
    // 蛋白质缺口
    {
      type: 'protein_deficit',
      condition: (slot) => slot.protein === 'deficit',
      severityCalculator: (_, progress) => {
        const ratio = progress.remaining.protein / progress.goals.protein;
        if (ratio < 0.5) return 'high';
        if (ratio < 0.8) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) => progress.remaining.protein,
      thresholdCalculator: (progress) => progress.goals.protein * 0.1, // 10% 差值认为缺口
      implicationTemplate: (metric, _threshold, locale) =>
        cl('issue.proteinDeficit', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },

    // 脂肪超标
    {
      type: 'fat_excess',
      condition: (slot) => slot.fat === 'excess',
      severityCalculator: (_, progress) => {
        const excess = progress.consumed.fat - progress.goals.fat;
        const ratio = excess / progress.goals.fat;
        if (ratio > 0.3) return 'high';
        if (ratio > 0.15) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) =>
        progress.consumed.fat - progress.goals.fat,
      thresholdCalculator: (progress) => progress.goals.fat * 0.15,
      implicationTemplate: (metric, _threshold, locale) =>
        cl('issue.fatExcess', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },

    // 碳水超标
    {
      type: 'carb_excess',
      condition: (slot) => slot.carbs === 'excess',
      severityCalculator: (_, progress) => {
        const excess = progress.consumed.carbs - progress.goals.carbs;
        const ratio = excess / progress.goals.carbs;
        if (ratio > 0.3) return 'high';
        if (ratio > 0.15) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) =>
        progress.consumed.carbs - progress.goals.carbs,
      thresholdCalculator: (progress) => progress.goals.carbs * 0.15,
      implicationTemplate: (metric, _threshold, locale) =>
        cl('issue.carbExcess', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },

    // 热量超标
    {
      type: 'calorie_excess',
      condition: (slot) => slot.calories === 'excess',
      severityCalculator: (_, progress) => {
        const excess = progress.consumed.calories - progress.goals.calories;
        const ratio = excess / progress.goals.calories;
        if (ratio > 0.15) return 'high';
        if (ratio > 0.08) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) =>
        progress.consumed.calories - progress.goals.calories,
      thresholdCalculator: (progress) => progress.goals.calories * 0.08,
      implicationTemplate: (metric, _threshold, locale) =>
        cl('issue.calorieExcess', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },

    // 热量不足
    {
      type: 'calorie_deficit',
      condition: (slot) => slot.calories === 'deficit',
      severityCalculator: (_, progress) => {
        const deficit = progress.goals.calories - progress.consumed.calories;
        const ratio = deficit / progress.goals.calories;
        if (ratio > 0.25) return 'high';
        if (ratio > 0.15) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) =>
        progress.goals.calories - progress.consumed.calories,
      thresholdCalculator: (progress) => progress.goals.calories * 0.1,
      implicationTemplate: (metric, _threshold, locale) =>
        cl('issue.calorieDeficit', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },

    // 纤维素不足（仅当 slot.carbs 不超标时才检测，作为代理信号）
    {
      type: 'fiber_deficit',
      condition: (slot, progress) => {
        // V3.6 P1.6: 修复永为真的 bug —— 只在蔬菜/水果明显不足时触发
        // 代理信号：碳水不超标（说明主食不多）且热量不低（有进食），但整体碳水偏低
        return (
          slot.carbs !== 'excess' &&
          progress.consumed.calories > 0 &&
          progress.consumed.carbs < progress.goals.carbs * 0.4
        );
      },
      severityCalculator: () => 'low', // 纤维问题通常低优先级
      metricCalculator: () => 0, // 占位
      thresholdCalculator: () => 0,
      implicationTemplate: (_m, _t, locale) => cl('issue.fiberDeficit', locale),
    },

    // 糖分超标（V3.6 P1.6 新增）
    {
      type: 'sugar_excess',
      condition: (slot) => slot.carbs === 'excess',
      severityCalculator: (_, progress) => {
        const excess = progress.consumed.carbs - progress.goals.carbs;
        const ratio = excess / progress.goals.carbs;
        if (ratio > 0.3) return 'high';
        if (ratio > 0.15) return 'medium';
        return 'low';
      },
      metricCalculator: (progress) =>
        progress.consumed.carbs - progress.goals.carbs,
      thresholdCalculator: (progress) => progress.goals.carbs * 0.15,
      implicationTemplate: (metric, _t, locale) =>
        cl('issue.sugarExcess', locale).replace(
          '{amount}',
          String(Math.round(metric)),
        ),
    },
  ];

  /**
   * 检测营养问题
   *
   * @param slot 宏量槽位状态
   * @param progress 当日进度
   * @param healthConditions 用户健康条件（可选），用于生成特异性风险
   * @returns 按严重程度排序的问题列表
   */
  detectIssues(
    slot: MacroSlotStatus,
    progress: MacroProgress,
    healthConditions?: string[],
    locale?: Locale,
    /** V4.0: 短期行为画像 + 当前小时 */
    behaviorContext?: {
      shortTermBehavior?: {
        bingeRiskHours: number[];
        intakeTrends: 'increasing' | 'stable' | 'decreasing';
      };
      localHour?: number;
    },
  ): NutritionIssue[] {
    const issues: NutritionIssue[] = [];

    for (const rule of this.rules) {
      if (rule.condition(slot, progress)) {
        const severity = rule.severityCalculator(slot, progress);
        const metric = rule.metricCalculator(progress);
        const threshold = rule.thresholdCalculator(progress);

        issues.push({
          type: rule.type,
          severity,
          metric: Math.round(metric * 100) / 100, // 保留2位小数
          threshold: Math.round(threshold * 100) / 100,
          implication: rule.implicationTemplate(metric, threshold, locale),
        });
      }
    }

    // V3.4 P2.1: 健康条件特异性规则
    if (healthConditions && healthConditions.length > 0) {
      const condSet = new Set(healthConditions.map((c) => c.toLowerCase()));

      const condArr = [...condSet];

      // 糖尿病：碳水超标 → 血糖风险
      if (hasCondition(condArr, 'diabetes') && slot.carbs === 'excess') {
        const carbsExcess = progress.consumed.carbs - progress.goals.carbs;
        issues.push({
          type: 'glycemic_risk',
          severity:
            carbsExcess > progress.goals.carbs * 0.2 ? 'high' : 'medium',
          metric: Math.round(carbsExcess * 100) / 100,
          threshold: 0,
          implication: cl('issue.glycemicRisk', locale).replace(
            '{amount}',
            String(Math.round(carbsExcess)),
          ),
        });
      }

      // 高血压：钠摄入风险（当 fat_excess 或 calorie_excess 时附加提醒）
      if (hasCondition(condArr, 'hypertension')) {
        if (slot.fat === 'excess' || slot.calories === 'excess') {
          issues.push({
            type: 'sodium_risk',
            severity: 'medium',
            metric: 0,
            threshold: 0,
            implication: cl('issue.sodiumRisk', locale),
          });
        }
      }

      // 心脏病/心血管：脂肪超标 → 心血管风险
      if (hasCondition(condArr, 'cardiovascular') && slot.fat === 'excess') {
        const fatExcess = progress.consumed.fat - progress.goals.fat;
        issues.push({
          type: 'cardiovascular_risk',
          severity: fatExcess > progress.goals.fat * 0.25 ? 'high' : 'medium',
          metric: Math.round(fatExcess * 100) / 100,
          threshold: 0,
          implication: cl('issue.cardiovascularRisk', locale).replace(
            '{amount}',
            String(Math.round(fatExcess)),
          ),
        });
      }

      // 痛风：高嘌呤风险（蛋白质超标时提示）
      if (hasCondition(condArr, 'gout') && slot.protein === 'excess') {
        issues.push({
          type: 'purine_risk',
          severity: 'medium',
          metric: 0,
          threshold: 0,
          implication: cl('issue.purineRisk', locale),
        });
      }

      // 肾病：蛋白质/钾磷风险（蛋白质超标时提示）
      if (
        hasCondition(condArr, 'kidney_disease') &&
        slot.protein === 'excess'
      ) {
        const proteinExcess =
          progress.consumed.protein - progress.goals.protein;
        issues.push({
          type: 'kidney_stress',
          severity:
            proteinExcess > progress.goals.protein * 0.2 ? 'high' : 'medium',
          metric: Math.round(proteinExcess * 100) / 100,
          threshold: 0,
          implication: cl('issue.kidneyStress', locale).replace(
            '{amount}',
            String(Math.round(proteinExcess)),
          ),
        });
      }
    }

    // V4.0: 行为感知问题识别
    if (behaviorContext?.shortTermBehavior) {
      const stb = behaviorContext.shortTermBehavior;
      const hour = behaviorContext.localHour ?? new Date().getHours();

      // 暴食风险小时窗口
      if (stb.bingeRiskHours.length > 0 && stb.bingeRiskHours.includes(hour)) {
        issues.push({
          type: 'binge_risk_window',
          severity: 'medium',
          metric: hour,
          threshold: 0,
          implication: cl('issue.bingeRiskWindow', locale).replace(
            '{hour}',
            String(hour),
          ),
        });
      }

      // 连续多日摄入上升趋势 + 当前已超标
      if (
        stb.intakeTrends === 'increasing' &&
        (slot.calories === 'excess' || slot.fat === 'excess')
      ) {
        issues.push({
          type: 'trend_excess',
          severity: 'medium',
          metric: 0,
          threshold: 0,
          implication: cl('issue.trendExcess', locale),
        });
      }
    }

    // V4.2: 时间归一化 — 早晨deficit类issue降级（早餐前不足是正常的）
    const hour = behaviorContext?.localHour ?? new Date().getHours();
    if (hour >= 6 && hour < 12) {
      const deficitTypes: IssueType[] = [
        'protein_deficit',
        'calorie_deficit',
        'fiber_deficit',
      ];
      for (const issue of issues) {
        if (deficitTypes.includes(issue.type)) {
          if (hour < 10) {
            // 早餐时段：降两级 high→low, medium→low
            issue.severity =
              issue.severity === 'high'
                ? 'medium'
                : issue.severity === 'medium'
                  ? 'low'
                  : 'low';
          } else {
            // 午餐前(10-12)：降一级
            issue.severity =
              issue.severity === 'high' ? 'medium' : issue.severity;
          }
        }
      }
    }

    // 按严重程度排序：high > medium > low
    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );

    return issues;
  }

  /**
   * 获取主要问题（Top-1）
   */
  getPrimaryIssue(issues: NutritionIssue[]): NutritionIssue | null {
    return issues.length > 0 ? issues[0] : null;
  }

  /**
   * 获取指定类型的问题
   */
  getIssueByType(
    issues: NutritionIssue[],
    type: IssueType,
  ): NutritionIssue | null {
    return issues.find((i) => i.type === type) || null;
  }
}
