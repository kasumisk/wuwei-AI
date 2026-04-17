/**
 * V3.4 Phase 1.4 — 分析准确度服务（增强版）
 *
 * 升级点：
 * - assessAccuracy(): 原三信号评估（不变）
 * - assessFromFoods(): 新增，基于 AnalyzedFoodItem[] 的多信号准确度评估
 *   新信号：营养完整率 + 食物数量置信衰减 + 品类分布
 */

import { Injectable } from '@nestjs/common';
import {
  AccuracyLevel,
  AnalysisAccuracyMetrics,
  MacroSlotStatus,
  AnalyzedFoodItem,
} from '../types/analysis-result.types';

/** 准确度评估规则 */
interface AccuracyThresholds {
  high: {
    minConfidence: number;
    minCompleteness: number;
    allowedReviewLevels: string[];
  };
  medium: {
    minConfidence: number;
    minCompleteness: number;
  };
  low: {
    maxConfidence: number;
  };
}

@Injectable()
export class AnalysisAccuracyService {
  private readonly thresholds: AccuracyThresholds = {
    high: {
      minConfidence: 0.85,
      minCompleteness: 0.8,
      allowedReviewLevels: ['auto_review', 'manual_review'],
    },
    medium: {
      minConfidence: 0.65,
      minCompleteness: 0.6,
    },
    low: {
      maxConfidence: 0.65,
    },
  };

  /**
   * 根据多个因素评估分析准确度
   *
   * @param confidence 识别置信度 (0-1)
   * @param reviewLevel 复核级别 (auto_review | manual_review)
   * @param completenessScore 分析完整度 (0-1)
   * @returns 准确度指标
   */
  assessAccuracy(
    confidence: number,
    reviewLevel: 'auto_review' | 'manual_review',
    completenessScore: number = 0.7,
  ): AnalysisAccuracyMetrics {
    // 规范化输入
    const norm = {
      confidence: Math.min(1, Math.max(0, confidence)),
      completeness: Math.min(1, Math.max(0, completenessScore)),
    };

    // 判定等级
    const level = this.assessLevel(
      norm.confidence,
      norm.completeness,
      reviewLevel,
    );

    // 计算评分 (0-100)
    const score = this.computeScore(
      norm.confidence,
      norm.completeness,
      reviewLevel,
      level,
    );

    return {
      level,
      score,
      factors: {
        confidence: norm.confidence,
        reviewLevel,
        completenessScore: norm.completeness,
      },
    };
  }

  /**
   * 根据因素判定准确度等级
   */
  private assessLevel(
    confidence: number,
    completeness: number,
    reviewLevel: string,
  ): AccuracyLevel {
    const th = this.thresholds;

    // High: 高置信度 + 高完整度 + 任何复核级别
    if (
      confidence >= th.high.minConfidence &&
      completeness >= th.high.minCompleteness &&
      th.high.allowedReviewLevels.includes(reviewLevel)
    ) {
      return 'high';
    }

    // Low: 低置信度或低完整度
    if (
      confidence < th.medium.minConfidence ||
      completeness < th.medium.minCompleteness
    ) {
      return 'low';
    }

    // Medium: 中等准确度
    return 'medium';
  }

  /**
   * 计算准确度评分 (0-100)
   *
   * 算法:
   * - 基础: confidence × 60 + completeness × 30
   * - 复核加分: manual_review +10
   * - 等级奖励: high +0, medium -0, low -20
   */
  private computeScore(
    confidence: number,
    completeness: number,
    reviewLevel: string,
    level: AccuracyLevel,
  ): number {
    // 基础评分
    let score = confidence * 60 + completeness * 30;

    // 复核加分
    if (reviewLevel === 'manual_review') {
      score += 10;
    }

    // 等级奖励/惩罚
    if (level === 'high') {
      // 高精度额外奖励
      score = Math.min(100, score + 5);
    } else if (level === 'low') {
      // 低精度惩罚
      score = Math.max(0, score - 20);
    }

    return Math.round(score);
  }

  /**
   * V3.2 Phase 1: 基于 MacroSlotStatus 评估四维宏量准确度
   *
   * @param macroSlot 四维宏量槽位状态
   * @returns 准确度指标with slot-level scores
   */
  evaluate(macroSlot: MacroSlotStatus): {
    overallAccuracy: number;
    slotAccuracies: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
  } {
    // 计算每个槽位的评分
    const slotScores = {
      calories: this.calculateSlotScore(macroSlot.calories),
      protein: this.calculateSlotScore(macroSlot.protein),
      fat: this.calculateSlotScore(macroSlot.fat),
      carbs: this.calculateSlotScore(macroSlot.carbs),
    };

    // 计算总体准确度（简单平均）
    const overallAccuracy =
      (slotScores.calories +
        slotScores.protein +
        slotScores.fat +
        slotScores.carbs) /
      4;

    return {
      overallAccuracy: Math.round(overallAccuracy),
      slotAccuracies: slotScores,
    };
  }

  /**
   * 根据单个槽位状态计算准确度分数
   */
  private calculateSlotScore(status: 'deficit' | 'ok' | 'excess'): number {
    switch (status) {
      case 'ok':
        return 100;
      case 'deficit':
        return 75; // 缺口是可以接受但不理想的
      case 'excess':
        return 70; // 超标同样不理想
      default:
        return 0;
    }
  }

  // ==================== V3.4 P1.4: 多信号增强评估 ====================

  /**
   * 基于 AnalyzedFoodItem[] 的多信号准确度评估
   *
   * 信号：
   * 1. avgConfidence — 各食物置信度均值（权重 50%）
   * 2. nutrientCompletenessRate — fiber/sodium 等扩展字段填充率（权重 25%）
   * 3. foodCountPenalty — 食物数量越多识别难度越大（权重 15%）
   * 4. categoryDiversityBonus — 成功识别多品类时给予准确度奖励（权重 10%）
   */
  assessFromFoods(
    foods: AnalyzedFoodItem[],
    reviewLevel: 'auto_review' | 'manual_review' = 'auto_review',
  ): AnalysisAccuracyMetrics {
    if (!foods || foods.length === 0) {
      return {
        level: 'low',
        score: 30,
        factors: {
          confidence: 0,
          reviewLevel,
          completenessScore: 0,
        },
      };
    }

    // 1. 平均置信度
    const avgConfidence =
      foods.reduce((s, f) => s + (f.confidence ?? 0.5), 0) / foods.length;

    // 2. 营养完整率（fiber, sodium, saturatedFat, addedSugar 四项）
    const extendedFields: Array<keyof AnalyzedFoodItem> = [
      'fiber',
      'sodium',
      'saturatedFat',
      'addedSugar',
    ];
    const totalSlots = foods.length * extendedFields.length;
    const filledSlots = foods.reduce((s, f) => {
      return (
        s +
        extendedFields.filter(
          (field) => f[field] !== null && f[field] !== undefined,
        ).length
      );
    }, 0);
    const nutrientCompletenessRate =
      totalSlots > 0 ? filledSlots / totalSlots : 0;

    // 3. 食物数量置信衰减（1-2个食物无惩罚，3-5个轻微，6+较高）
    const countPenaltyFactor =
      foods.length <= 2 ? 1.0 : foods.length <= 5 ? 0.95 : 0.88;

    // 4. 品类多样性奖励（识别出2+不同品类说明分析更全面）
    const categories = new Set(foods.map((f) => f.category).filter(Boolean));
    const diversityBonus =
      categories.size >= 3 ? 5 : categories.size >= 2 ? 2 : 0;

    // 综合评分 (0-100)
    const baseScore =
      avgConfidence * 50 +
      nutrientCompletenessRate * 25 +
      countPenaltyFactor * 15 +
      (reviewLevel === 'manual_review' ? 10 : 0);
    const score = Math.min(100, Math.round(baseScore + diversityBonus));

    // 等级判定（使用增强后的 completenessRate 作为 completenessScore）
    const level = this.assessLevel(
      avgConfidence,
      nutrientCompletenessRate,
      reviewLevel,
    );

    return {
      level,
      score,
      factors: {
        confidence: avgConfidence,
        reviewLevel,
        completenessScore: nutrientCompletenessRate,
      },
    };
  }
}
