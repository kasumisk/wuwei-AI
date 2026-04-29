/**
 * V2.4 AnalysisQualityFeedbackService
 *
 * 职责：聚合分析审核、用户接受度、推荐反馈，生成改进建议
 */

import { Injectable } from '@nestjs/common';
import {
  UserDecisionFeedback,
  AnalysisQualityMetrics,
  PolicySuggestion,
} from './feedback.types';
import { cl } from '../i18n/decision-labels';

@Injectable()
export class AnalysisQualityFeedbackService {
  // 内存中存储反馈 (实际应持久化到数据库)
  private feedbackStore: Map<string, UserDecisionFeedback> = new Map();
  private metricsCache: AnalysisQualityMetrics | null = null;

  /**
   * 记录用户对决策的反馈
   */
  recordUserFeedback(feedback: UserDecisionFeedback): void {
    const key = `${feedback.analysisId}_${feedback.userId}`;
    this.feedbackStore.set(key, feedback);
    // 清除缓存，下次查询时重新计算
    this.metricsCache = null;
  }

  /**
   * 获取质量指标
   */
  getQualityMetrics(dateRange?: {
    start: Date;
    end: Date;
  }): AnalysisQualityMetrics {
    const start =
      dateRange?.start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = dateRange?.end || new Date();

    // 从存储中获取指定范围内的反馈
    const feedbackList = Array.from(this.feedbackStore.values()).filter(
      (f) => f.timestamp >= start && f.timestamp <= end,
    );

    const totalAnalyses = feedbackList.length;
    const acceptedCount = feedbackList.filter(
      (f) => f.decision === 'accepted',
    ).length;
    const rejectedCount = feedbackList.filter(
      (f) => f.decision === 'rejected',
    ).length;
    const acceptanceRate =
      totalAnalyses > 0 ? (acceptedCount / totalAnalyses) * 100 : 0;

    const issueBreakdown = feedbackList.reduce<Record<string, number>>(
      (acc, feedback) => {
        for (const issueKey of feedback.issueKeys || []) {
          acc[issueKey] = (acc[issueKey] || 0) + 1;
        }
        return acc;
      },
      {},
    );

    const alternativePairs = feedbackList.reduce<
      Record<
        string,
        { original: string; replacement: string; frequency: number }
      >
    >((acc, feedback) => {
      if (!feedback.originalFoodName || !feedback.selectedAlternative) {
        return acc;
      }

      const pairKey = `${feedback.originalFoodName}=>${feedback.selectedAlternative}`;
      if (!acc[pairKey]) {
        acc[pairKey] = {
          original: feedback.originalFoodName,
          replacement: feedback.selectedAlternative,
          frequency: 0,
        };
      }
      acc[pairKey].frequency += 1;
      return acc;
    }, {});

    const commonAlternatives = Object.values(alternativePairs)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    const metrics: AnalysisQualityMetrics = {
      dateRange: { start, end },
      totalAnalyses,
      acceptedCount,
      rejectedCount,
      acceptanceRate,
      issueBreakdown,
      commonAlternatives,
    };

    this.metricsCache = metrics;
    return metrics;
  }

  /**
   * 生成改进建议
   */
  suggestPolicyChanges(): PolicySuggestion[] {
    const metrics = this.metricsCache || this.getQualityMetrics();
    const suggestions: PolicySuggestion[] = [];

    // 如果接受率低于70%，建议调整决策规则
    if (metrics.acceptanceRate < 70) {
      suggestions.push({
        suggestionId: 'pol_001',
        type: 'decision_rule',
        description: cl('feedback.reduceStrictness'),
        rationale: cl('feedback.reduceStrictnessRationale', undefined, {
          rate: metrics.acceptanceRate.toFixed(1),
        }),
        impact: 'high',
      });
    }

    // 如果蛋白质缺陷问题频繁，建议调整蛋白质评分权重
    if (metrics.issueBreakdown['protein_deficit'] > 10) {
      suggestions.push({
        suggestionId: 'pol_002',
        type: 'scoring_weight',
        description: cl('feedback.boostProteinWeight'),
        rationale: cl('feedback.boostProteinRationale'),
        impact: 'medium',
      });
    }

    return suggestions;
  }

  /**
   * 获取用户-决策反馈分布
   */
  getFeedbackDistribution(): {
    accepted: number;
    rejected: number;
    modified: number;
  } {
    const allFeedback = Array.from(this.feedbackStore.values());
    return {
      accepted: allFeedback.filter((f) => f.decision === 'accepted').length,
      rejected: allFeedback.filter((f) => f.decision === 'rejected').length,
      modified: allFeedback.filter((f) => f.decision === 'modified').length,
    };
  }
}
