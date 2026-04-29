/**
 * V5.1 P2.3/P2.5 — 共享评分维度常量
 *
 * V8 (i18n migration): 数据源改为 decision/i18n/{en-US,zh-CN,ja-JP}.json，
 *  通过 _load.ts 同步加载，labels-*.ts 已删除。
 *
 * 维度标签/解释/建议存放于 JSON 中（key 形如 `dim.label.energy`），
 * getDimensionLabel/Explanation/Suggestion 公共 API 不变。
 *
 * NOTE: 不从 decision-labels.ts barrel 导入（避免循环依赖），
 * 直接从 _load.ts 拿到 BY_LOCALE 字典。
 */
import { DECISION_LABELS_BY_LOCALE } from '../i18n/_load';
import { resolveDecisionLocale } from '../i18n/decision-labels';

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

/**
 * 获取维度标签
 */
export function getDimensionLabel(
  dimension: string,
  locale?: string,
): string {
  const loc = locale || resolveDecisionLocale();
  const labels = DECISION_LABELS_BY_LOCALE[loc] ?? DECISION_LABELS_BY_LOCALE['zh-CN'];
  return labels[`dim.label.${dimension}`] || dimension;
}

/**
 * 获取维度解释
 */
export function getDimensionExplanation(
  dimension: string,
  impact: 'positive' | 'warning' | 'critical',
  locale?: string,
): string {
  const loc = locale || resolveDecisionLocale();
  const labels = DECISION_LABELS_BY_LOCALE[loc] ?? DECISION_LABELS_BY_LOCALE['zh-CN'];
  return labels[`dim.explain.${dimension}.${impact}`] || '';
}

/**
 * V1.9: 获取维度改善建议
 */
export function getDimensionSuggestion(
  dimension: string,
  impact: 'warning' | 'critical',
  locale?: string,
): string | undefined {
  const loc = locale || resolveDecisionLocale();
  const labels = DECISION_LABELS_BY_LOCALE[loc] ?? DECISION_LABELS_BY_LOCALE['zh-CN'];
  return labels[`dim.suggest.${dimension}.${impact}`] || undefined;
}
