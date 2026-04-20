/**
 * V4.5 P2.4 — 统一 i18n 标签入口（barrel）
 *
 * 1. COACH_LABELS + cl()：组合三个 locale 子文件，供教练 prompt 构建使用。
 * 2. DIMENSION_* 重导出：从 scoring-dimensions.ts 统一对外暴露。
 *
 * 子文件：
 *   labels-zh.ts  — zh-CN 字典
 *   labels-en.ts  — en-US 字典
 *   labels-ja.ts  — ja-JP 字典
 */

import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { COACH_LABELS_ZH } from './labels-zh';
import { COACH_LABELS_EN } from './labels-en';
import { COACH_LABELS_JA } from './labels-ja';

// ==================== Coach 上下文标签国际化 ====================

export const COACH_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': COACH_LABELS_ZH,
  'en-US': COACH_LABELS_EN,
  'ja-JP': COACH_LABELS_JA,
};

/**
 * Coach 标签查询辅助函数。
 * 按 locale 查找 key，fallback 到 zh-CN，再 fallback 到 key 本身。
 */
export function cl(key: string, locale?: Locale): string {
  const loc = locale || 'zh-CN';
  return COACH_LABELS[loc]?.[key] || COACH_LABELS['zh-CN']?.[key] || key;
}

// ==================== 评分维度标签重导出 ====================

export {
  SCORING_DIMENSIONS,
  type ScoringDimension,
  DIMENSION_LABELS,
  DIMENSION_EXPLANATIONS,
  DIMENSION_SUGGESTIONS,
  getDimensionLabel,
  getDimensionExplanation,
  getDimensionSuggestion,
  scoreToImpact,
} from '../config/scoring-dimensions';

// ==================== 决策链路标签重导出（P3.3）====================

export { CHAIN_LABELS, chainLabel } from './explainer-labels';
