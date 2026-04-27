/**
 * V4.5 P2.4 — 统一 i18n 标签入口（barrel）
 *
 * V8 (i18n migration): 数据源改为 decision/i18n/{en-US,zh-CN,ja-JP}.json，
 *  通过 _load.ts 同步加载，labels-*.ts 已删除。
 *
 * 1. COACH_LABELS + cl()：组合三个 locale 字典，供教练 prompt 构建使用。
 * 2. DIMENSION_* 重导出：从 scoring-dimensions.ts 统一对外暴露。
 *
 * 公共 API（cl 函数签名）保持不变，所有调用方零改动。
 */

import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { ClsServiceManager } from 'nestjs-cls';
import {
  DECISION_LABELS_BY_LOCALE,
  DECISION_LABELS_ZH,
  DECISION_LABELS_EN,
  DECISION_LABELS_JA,
} from './_load';

// ==================== Coach 上下文标签国际化 ====================

export const COACH_LABELS: Record<
  string,
  Record<string, string>
> = DECISION_LABELS_BY_LOCALE;

function resolveDecisionLocale(): Locale {
  try {
    const cls = ClsServiceManager.getClsService();
    const raw = cls?.get('locale');
    if (raw === 'en-US' || raw === 'zh-CN' || raw === 'ja-JP') {
      return raw;
    }
  } catch {
    // Ignore missing CLS context and fallback below.
  }
  return 'zh-CN';
}

/**
 * Coach 标签查询辅助函数。
 * 按 locale 查找 key，fallback 到 zh-CN，再 fallback 到 key 本身。
 */
export function cl(key: string, locale?: Locale): string {
  const loc = locale || resolveDecisionLocale();
  return COACH_LABELS[loc]?.[key] || COACH_LABELS['zh-CN']?.[key] || key;
}

// ==================== labels 直接导出（向后兼容 scoring-dimensions 等内部消费方）====================

export {
  DECISION_LABELS_ZH as COACH_LABELS_ZH,
  DECISION_LABELS_EN as COACH_LABELS_EN,
  DECISION_LABELS_JA as COACH_LABELS_JA,
};

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
