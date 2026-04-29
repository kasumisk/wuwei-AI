/**
 * Decision 枚举互转
 *
 * 项目里同时存在三套表示，本文件是唯一互转入口：
 *  - Legacy 4 档：'SAFE' | 'OK' | 'LIMIT' | 'AVOID'         （AnalysisResult.decision）
 *  - V6.1  3 档：'recommend' | 'caution' | 'avoid'            （FoodAnalysisResultV61.decision.recommendation）
 *  - 风险 3 档：'low' | 'medium' | 'high'                    （+ 🟢🟡🔴 emoji 表示）
 *
 * 任何处需要互转时只走这里，避免再次散落到 controller / service 内部。
 */

export type LegacyDecision = 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
export type Recommendation = 'recommend' | 'caution' | 'avoid';
export type RiskLevel = 'low' | 'medium' | 'high';

const LEGACY_RANK: Record<LegacyDecision, number> = {
  SAFE: 0,
  OK: 1,
  LIMIT: 2,
  AVOID: 3,
};
const LEGACY_LIST: LegacyDecision[] = ['SAFE', 'OK', 'LIMIT', 'AVOID'];

/**
 * 评分覆盖：当 AI 与评分引擎决策差距 > 1 档时，取更严格的一档；否则以引擎为准。
 */
export function resolveDecision(
  aiDecision: string,
  engineDecision: string,
): LegacyDecision {
  const ai = LEGACY_RANK[aiDecision as LegacyDecision] ?? 1;
  const eng = LEGACY_RANK[engineDecision as LegacyDecision] ?? 1;
  return Math.abs(ai - eng) > 1 ? LEGACY_LIST[Math.max(ai, eng)] : LEGACY_LIST[eng];
}

export function legacyToRecommendation(decision: string): Recommendation {
  switch (decision) {
    case 'SAFE':
    case 'OK':
      return 'recommend';
    case 'LIMIT':
      return 'caution';
    case 'AVOID':
      return 'avoid';
    default:
      return 'caution';
  }
}

export function recommendationToLegacy(rec: Recommendation): LegacyDecision {
  switch (rec) {
    case 'avoid':
      return 'AVOID';
    case 'caution':
      return 'LIMIT';
    case 'recommend':
    default:
      return 'SAFE';
  }
}

export function emojiToRiskLevel(emoji: string): RiskLevel {
  if (emoji.includes('🔴')) return 'high';
  if (emoji.includes('🟡') || emoji.includes('🟠')) return 'medium';
  return 'low';
}

export function riskLevelToEmoji(level: RiskLevel): '🟢' | '🟡' | '🔴' {
  switch (level) {
    case 'high':
      return '🔴';
    case 'medium':
      return '🟡';
    case 'low':
    default:
      return '🟢';
  }
}
