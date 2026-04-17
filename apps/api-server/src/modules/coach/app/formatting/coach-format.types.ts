/**
 * V2.4 Coach Format Service Types
 * 
 * 教练文本格式化的配置与类型：
 */

export interface CoachFormatOptions {
  language: 'en' | 'zh' | 'ja' | 'ko';
  persona: 'strict' | 'friendly' | 'data';
  style?: 'brief' | 'detailed';
}

export interface FormattedCoachOutput {
  suggestion: string;
  actionPlan: string;
  encouragement?: string;
}
