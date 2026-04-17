/**
 * V2.4 Quality Feedback Types
 *
 * 反馈系统的数据类型定义
 */

export interface UserDecisionFeedback {
  analysisId: string;
  userId: string;
  decision: 'accepted' | 'modified' | 'rejected';
  userNote?: string;
  issueKeys?: string[];
  originalFoodName?: string;
  selectedAlternative?: string;
  locale?: string;
  timestamp: Date;
}

export interface AnalysisQualityMetrics {
  dateRange: { start: Date; end: Date };
  totalAnalyses: number;
  acceptedCount: number;
  rejectedCount: number;
  acceptanceRate: number; // percentage

  // 问题分布
  issueBreakdown: {
    [issueType: string]: number;
  };

  // 常见替代选择
  commonAlternatives?: {
    original: string;
    replacement: string;
    frequency: number;
  }[];
}

export interface PolicySuggestion {
  suggestionId: string;
  type: 'threshold' | 'scoring_weight' | 'decision_rule';
  description: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}
