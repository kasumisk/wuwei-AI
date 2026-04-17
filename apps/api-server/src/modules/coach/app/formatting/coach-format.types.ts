/**
 * V2.4 Coach Format Service Types
 * 
 * 教练文本格式化的配置与类型：
 */

export interface CoachFormatOptions {
  language: 'en' | 'zh' | 'ja' | 'ko';
  persona: 'strict' | 'friendly' | 'data';
  style?: 'brief' | 'detailed';
  /** V2.7: 决策置信度 (0–1)，用于派生 confidenceLabel */
  decisionConfidence?: number;
  /** V2.7: 7维评分解释，用于派生 scoreInsight */
  breakdownExplanations?: Array<{
    dimension: string;
    label?: string;
    score: number;
    impact: 'positive' | 'warning' | 'critical';
    message?: string;
  }>;
}

export interface FormattedCoachOutput {
  suggestion: string;
  actionPlan: string;
  encouragement?: string;
  conclusion?: string;
  reasons?: string[];
  suggestions?: string[];
  tone?: 'strict' | 'friendly' | 'data';
  /** V2.7: 结论置信度标签 */
  confidenceLabel?: 'low' | 'medium' | 'high';
  /** V2.7: 最低分维度一句话洞察 */
  scoreInsight?: string;
}
