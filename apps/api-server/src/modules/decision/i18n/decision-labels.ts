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

/** 默认回退语言 — 与 core/i18n/i18n.types.ts 的 I18N_DEFAULT_LOCALE 保持一致 */
const FALLBACK_LOCALE: Locale = 'en-US';

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
  return FALLBACK_LOCALE;
}

/**
 * Interpolate {{var}} placeholders inside a label template.
 * - 与 NestJS I18nService.interpolate / recommendation/utils/i18n-messages.t() 保持
 *   完全一致的占位符语法（双花括号），是修复"调用方用 .replace('{x}',v) 单花括号
 *   匹配不到 JSON 模板里的 {{x}}，导致响应体出现 `{食物名}` 等原文字符串"这一根因。
 * - V9 (Phase 9): 全部调用方已迁移到 cl(key, loc, vars) 形式，移除单花括号兼容
 *   与有损的 {{xxx}} → {xxx} 转换，杜绝未替换占位符在响应体中出现。
 */
function interpolate(
  text: string,
  vars?: Record<string, string | number | undefined | null>,
): string {
  if (!vars) return text;
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) continue;
    const safe = String(v);
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), safe);
  }
  return out;
}

/**
 * Coach / Decision 标签查询辅助函数。
 *
 * 回退链: 指定 locale → en-US (FALLBACK_LOCALE) → key 本身
 *
 * 占位符:
 *   - JSON 模板使用 {{var}}（与 I18nService 一致）
 *   - 通过第 3 个参数 `vars` 传入变量, 自动完成插值
 *   - 同时兼容历史 {var} 单花括号语法
 *
 * 调用方迁移:
 *   旧: cl('summary.headline', loc).replace('{food}', f).replace('{cal}', c)
 *   新: cl('summary.headline', loc, { food: f, cal: c })
 */
export function cl(
  key: string,
  locale?: Locale,
  vars?: Record<string, string | number | undefined | null>,
): string {
  const loc = locale || resolveDecisionLocale();
  const raw =
    COACH_LABELS[loc]?.[key] ||
    (loc !== FALLBACK_LOCALE ? COACH_LABELS[FALLBACK_LOCALE]?.[key] : undefined) ||
    key;
  return interpolate(raw, vars);
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
