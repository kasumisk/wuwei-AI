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
import {
  DECISION_LABELS_ZH as COACH_LABELS_ZH,
  DECISION_LABELS_EN as COACH_LABELS_EN,
  DECISION_LABELS_JA as COACH_LABELS_JA,
} from '../i18n/_load';

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
  ) as Record<
    ScoringDimension,
    Record<'positive' | 'warning' | 'critical', string>
  >,
  'en-US': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        positive: COACH_LABELS_EN[`dim.explain.${d}.positive`] ?? '',
        warning: COACH_LABELS_EN[`dim.explain.${d}.warning`] ?? '',
        critical: COACH_LABELS_EN[`dim.explain.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<
    ScoringDimension,
    Record<'positive' | 'warning' | 'critical', string>
  >,
  'ja-JP': Object.fromEntries(
    SCORING_DIMENSIONS.map((d) => [
      d,
      {
        positive: COACH_LABELS_JA[`dim.explain.${d}.positive`] ?? '',
        warning: COACH_LABELS_JA[`dim.explain.${d}.warning`] ?? '',
        critical: COACH_LABELS_JA[`dim.explain.${d}.critical`] ?? '',
      },
    ]),
  ) as Record<
    ScoringDimension,
    Record<'positive' | 'warning' | 'critical', string>
  >,
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
  locale?: string,
): string {
  const resolvedLocale =
    locale || (ClsServiceManager.getClsService()?.get('locale') as string) || 'zh-CN';
  const labels = DIMENSION_LABELS[resolvedLocale] || DIMENSION_LABELS['zh-CN'];
  return labels[dimension as ScoringDimension] || dimension;
}

/**
 * 获取维度解释
 */
export function getDimensionExplanation(
  dimension: string,
  impact: 'positive' | 'warning' | 'critical',
  locale?: string,
): string {
  const resolvedLocale =
    locale || (ClsServiceManager.getClsService()?.get('locale') as string) || 'zh-CN';
  const explanations =
    DIMENSION_EXPLANATIONS[resolvedLocale] || DIMENSION_EXPLANATIONS['zh-CN'];
  return explanations[dimension as ScoringDimension]?.[impact] || '';
}

/**
 * V1.9: 获取维度改善建议
 */
export function getDimensionSuggestion(
  dimension: string,
  impact: 'warning' | 'critical',
  locale?: string,
): string | undefined {
  const resolvedLocale =
    locale || (ClsServiceManager.getClsService()?.get('locale') as string) || 'zh-CN';
  const suggestions =
    DIMENSION_SUGGESTIONS[resolvedLocale] || DIMENSION_SUGGESTIONS['zh-CN'];
  return suggestions[dimension as ScoringDimension]?.[impact];
}
import { ClsServiceManager } from 'nestjs-cls';
