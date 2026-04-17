/**
 * V3.2 Phase 1 — 营养问题检测服务
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
import { MacroSlotStatus, NutritionIssue, IssueType } from '../types/analysis-result.types';

interface MacroProgress {
  consumed: { calories: number; protein: number; fat: number; carbs: number };
  remaining: { calories: number; protein: number; fat: number; carbs: number };
  goals: { calories: number; protein: number; fat: number; carbs: number };
}

interface IssueDetectionRule {
  type: IssueType;
  condition: (slot: MacroSlotStatus, progress: MacroProgress) => boolean;
  severityCalculator: (slot: MacroSlotStatus, progress: MacroProgress) => 'low' | 'medium' | 'high';
  metricCalculator: (progress: MacroProgress) => number;
  thresholdCalculator: (progress: MacroProgress) => number;
  implicationTemplate: (metric: number, threshold: number) => string;
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
      implicationTemplate: (metric, _threshold) =>
        `蛋白质还差 ${Math.round(metric)}g，建议下餐补足`,
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
      metricCalculator: (progress) => progress.consumed.fat - progress.goals.fat,
      thresholdCalculator: (progress) => progress.goals.fat * 0.15,
      implicationTemplate: (metric, _threshold) =>
        `脂肪超标 ${Math.round(metric)}g，建议减少油炸食物`,
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
      metricCalculator: (progress) => progress.consumed.carbs - progress.goals.carbs,
      thresholdCalculator: (progress) => progress.goals.carbs * 0.15,
      implicationTemplate: (metric, _threshold) =>
        `碳水超标 ${Math.round(metric)}g，建议减少主食`,
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
      metricCalculator: (progress) => progress.consumed.calories - progress.goals.calories,
      thresholdCalculator: (progress) => progress.goals.calories * 0.08,
      implicationTemplate: (metric, _threshold) =>
        `热量超标 ${Math.round(metric)} kcal，建议今日剩余餐控制`,
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
      metricCalculator: (progress) => progress.goals.calories - progress.consumed.calories,
      thresholdCalculator: (progress) => progress.goals.calories * 0.1,
      implicationTemplate: (metric, _threshold) =>
        `热量不足 ${Math.round(metric)} kcal，建议适度增加摄入`,
    },

    // 纤维素不足（可选检测）
    {
      type: 'fiber_deficit',
      condition: (_, progress) => {
        // 如果没有纤维数据则不检测
        return progress.goals.carbs > 0; // 简化条件（实际应基于是否有纤维数据）
      },
      severityCalculator: () => 'low', // 纤维问题通常低优先级
      metricCalculator: () => 0, // 占位
      thresholdCalculator: () => 0,
      implicationTemplate: () => '建议增加高纤维食物',
    },
  ];

  /**
   * 检测营养问题
   *
   * @param slot 宏量槽位状态
   * @param progress 当日进度
   * @returns 按严重程度排序的问题列表
   */
  detectIssues(slot: MacroSlotStatus, progress: MacroProgress): NutritionIssue[] {
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
          implication: rule.implicationTemplate(metric, threshold),
        });
      }
    }

    // 按严重程度排序：high > medium > low
    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

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
  getIssueByType(issues: NutritionIssue[], type: IssueType): NutritionIssue | null {
    return issues.find((i) => i.type === type) || null;
  }
}
