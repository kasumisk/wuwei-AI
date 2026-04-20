/**
 * V5.1 P2.3/P2.5 — 共享评分维度常量
 *
 * 维度标签/解释/建议已迁移至 labels-*.ts，通过 cl() 查询。
 * getDimensionLabel/Explanation/Suggestion 保持公开 API 不变。
 *
 * NOTE: 不可从 decision-labels.ts barrel 导入（循环依赖）。
 * 直接从各 locale 子文件导入，组合为内部 LABELS map。
 */
import { COACH_LABELS_ZH } from '../i18n/labels-zh';
import { COACH_LABELS_EN } from '../i18n/labels-en';
import { COACH_LABELS_JA } from '../i18n/labels-ja';

const _DIM_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': COACH_LABELS_ZH,
  'en-US': COACH_LABELS_EN,
  'ja-JP': COACH_LABELS_JA,
};

function _cl(key: string, locale: string = 'zh-CN'): string {
  return (
    _DIM_LABELS[locale]?.[key] ||
    _DIM_LABELS['zh-CN']?.[key] ||
    key
  );
}

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

// ==================== 维度标签（三语言）— 已迁移至 labels-*.ts ====================

/**
 * @deprecated Use getDimensionLabel() instead. Kept for callers that iterate the Record directly.
 * Data now lives in labels-*.ts under `dim.label.*` keys.
 */
export const DIMENSION_LABELS: Record<
  string,
  Record<ScoringDimension, string>
> = {
  'zh-CN': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [d, COACH_LABELS_ZH[`dim.label.${d}`] ?? d]),
  ) as Record<ScoringDimension, string>,
  'en-US': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [d, COACH_LABELS_EN[`dim.label.${d}`] ?? d]),
  ) as Record<ScoringDimension, string>,
  'ja-JP': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [d, COACH_LABELS_JA[`dim.label.${d}`] ?? d]),
  ) as Record<ScoringDimension, string>,
};

/**
 * @deprecated Use getDimensionExplanation() instead.
 */
export const DIMENSION_EXPLANATIONS: Record<
  string,
  Record<ScoringDimension, Record<'positive' | 'warning' | 'critical', string>>
> = {
  'zh-CN': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        positive: COACH_LABELS_ZH[`dim.explain.${d}.positive`] ?? '',
        warning: COACH_LABELS_ZH[`dim.explain.${d}.warning`] ?? '',
        critical: COACH_LABELS_ZH[`dim.explain.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'positive' | 'warning' | 'critical', string>>,
  'en-US': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        positive: COACH_LABELS_EN[`dim.explain.${d}.positive`] ?? '',
        warning: COACH_LABELS_EN[`dim.explain.${d}.warning`] ?? '',
        critical: COACH_LABELS_EN[`dim.explain.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'positive' | 'warning' | 'critical', string>>,
  'ja-JP': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        positive: COACH_LABELS_JA[`dim.explain.${d}.positive`] ?? '',
        warning: COACH_LABELS_JA[`dim.explain.${d}.warning`] ?? '',
        critical: COACH_LABELS_JA[`dim.explain.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'positive' | 'warning' | 'critical', string>>,
};

/**
 * @deprecated Use getDimensionSuggestion() instead.
 */
export const DIMENSION_SUGGESTIONS: Record<
  string,
  Record<ScoringDimension, Record<'warning' | 'critical', string>>
> = {
  'zh-CN': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        warning: COACH_LABELS_ZH[`dim.suggest.${d}.warning`] ?? '',
        critical: COACH_LABELS_ZH[`dim.suggest.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'warning' | 'critical', string>>,
  'en-US': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        warning: COACH_LABELS_EN[`dim.suggest.${d}.warning`] ?? '',
        critical: COACH_LABELS_EN[`dim.suggest.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'warning' | 'critical', string>>,
  'ja-JP': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        warning: COACH_LABELS_JA[`dim.suggest.${d}.warning`] ?? '',
        critical: COACH_LABELS_JA[`dim.suggest.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<ScoringDimension, Record<'warning' | 'critical', string>>,
};

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
  locale: string = 'zh-CN',
): string {
  const labels = DIMENSION_LABELS[locale] || DIMENSION_LABELS['zh-CN'];
  return labels[dimension as ScoringDimension] || dimension;
}

/**
 * 获取维度解释
 */
export function getDimensionExplanation(
  dimension: string,
  impact: 'positive' | 'warning' | 'critical',
  locale: string = 'zh-CN',
): string {
  const explanations =
    DIMENSION_EXPLANATIONS[locale] || DIMENSION_EXPLANATIONS['zh-CN'];
  return explanations[dimension as ScoringDimension]?.[impact] || '';
}

/**
 * V1.9: 获取维度改善建议
 */
export function getDimensionSuggestion(
  dimension: string,
  impact: 'warning' | 'critical',
  locale: string = 'zh-CN',
): string | undefined {
  const suggestions =
    DIMENSION_SUGGESTIONS[locale] || DIMENSION_SUGGESTIONS['zh-CN'];
  return suggestions[dimension as ScoringDimension]?.[impact];
}
