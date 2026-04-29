/**
 * V13.2 — 评分维度纯常量 + impact 阈值
 *
 * i18n 已下放到调用方：调用方注入 I18nService 后直接调
 *   this.i18n.t(`decision.dim.label.${dim}`, locale)
 *   this.i18n.t(`decision.dim.explain.${dim}.${impact}`, locale)
 *   this.i18n.t(`decision.dim.suggest.${dim}.${impact}`, locale)
 *
 * 此文件保留：
 *   - SCORING_DIMENSIONS / ScoringDimension（维度枚举）
 *   - IMPACT_THRESHOLDS（阈值）
 *   - scoreToImpact()（纯函数）
 */

// ==================== 维度键名 ====================

export const SCORING_DIMENSIONS = [
  'energy',
  'proteinRatio',
  'macroBalance',
  'foodQuality',
  'satiety',
  'stability',
  'glycemicImpact',
] as const;

export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

// ==================== Impact 阈值 ====================

export const IMPACT_THRESHOLDS = {
  positive: 70,
  warning: 40,
  // < 40 = critical
} as const;

/**
 * 分数 → 影响等级
 */
export function scoreToImpact(
  score: number,
): 'positive' | 'warning' | 'critical' {
  if (score >= IMPACT_THRESHOLDS.positive) return 'positive';
  if (score >= IMPACT_THRESHOLDS.warning) return 'warning';
  return 'critical';
}
