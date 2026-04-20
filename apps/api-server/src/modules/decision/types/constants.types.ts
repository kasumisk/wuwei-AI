/**
 * V4.4: 裁剪常量（从 analysis-result.types.ts 拆分）
 */

/**
 * 免费版需要隐藏的字段路径
 */
export const FREE_TIER_HIDDEN_FIELDS: string[] = [
  'alternatives',
  'explanation.primaryReason',
  'explanation.userContextImpact',
  'foods.*.fiber',
  'foods.*.sodium',
  'totals.fiber',
  'totals.sodium',
  'ingestion',
];

/**
 * Pro 版隐藏的字段路径（相对少）
 */
export const PRO_TIER_HIDDEN_FIELDS: string[] = ['ingestion'];

/**
 * Premium 版不隐藏任何字段
 */
export const PREMIUM_TIER_HIDDEN_FIELDS: string[] = [];
