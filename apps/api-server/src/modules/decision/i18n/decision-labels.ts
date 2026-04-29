/**
 * V4.5 P2.4 — 统一 i18n 标签入口（barrel）
 *
 * Phase 11.B (V8): cl() 改为全局 I18nService 适配器。
 *   - 主路径: 通过 i18n.runtime.getI18nSingleton() 调用 I18nService.translate()
 *     键名自动加 'decision.' 前缀（与全局 namespace 约定一致）
 *   - 兜底路径: I18nService 未就绪（启动早期 / 单元测试 / 模块顶层 eager
 *     执行）时回退到 _load.ts 的同步加载字典，保证不返回 key 字面量
 *
 * 公共 API（cl 函数签名）保持不变，所有调用方零改动。
 *
 * 历史背景:
 *   - 旧实现自维护 COACH_LABELS / interpolate / resolveDecisionLocale
 *   - Phase 11 收编后 decision 不再有第二套 i18n，整个仓库共享 I18nService
 *     的 字典 / locale 解析 / placeholder interpolation 逻辑
 */

import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { ClsServiceManager } from 'nestjs-cls';
import { getI18nSingleton, I18nService } from '../../../core/i18n';
import { DECISION_LABELS_BY_LOCALE } from './_load';

/** 默认回退语言 — 与 core/i18n/i18n.types.ts 的 I18N_DEFAULT_LOCALE 保持一致 */
const FALLBACK_LOCALE: Locale = 'en-US';

/** I18nService 全局 namespace 前缀（即模块文件夹名） */
const NS = 'decision.';

/**
 * 解析当前请求 locale。
 * 主路径: I18nService.currentLocale()（已就绪时）
 * 兜底  : 直接读 ClsServiceManager → fallback en-US
 */
export function resolveDecisionLocale(): Locale {
  const svc = getI18nSingleton();
  if (svc) return svc.currentLocale() as Locale;

  try {
    const cls = ClsServiceManager.getClsService();
    const raw = (cls?.get('locale') as string | undefined) ?? '';
    return I18nService.normalizeLocale(raw) as Locale;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/**
 * Decision 模块 i18n 查询入口。
 *
 * 命中链: 指定 locale → en-US (FALLBACK_LOCALE) → key 本身
 * 占位符: 双花括号 {{var}}，与 I18nService 一致
 *
 * 调用约定:
 *   cl('chain.step.aggregation', locale, { food: f, cal: c })
 *   ↳ 实际查询 'decision.chain.step.aggregation'
 */
export function cl(
  key: string,
  locale?: Locale,
  vars?: Record<string, string | number | undefined | null>,
): string {
  const loc = locale || resolveDecisionLocale();
  const fullKey = `${NS}${key}`;

  // 主路径: 走全局 I18nService（统一 fallback / interpolation 逻辑）
  const svc = getI18nSingleton();
  if (svc) {
    const text = svc.translate(fullKey, loc, sanitizeVars(vars));
    // I18nService 命中失败时返回 fullKey 本身；这里抹掉 namespace
    // 让历史语义保持（cl('foo') 未命中返回 'foo' 而不是 'decision.foo'）
    if (text === fullKey) return key;
    return text;
  }

  // 兜底路径: singleton 未就绪 — 直接查 _load 同步字典
  return fallbackLookup(key, loc, vars);
}

// ─────────────────────────────────────────────────────────────────
// 兜底实现（与原 cl() 行为完全等价，仅在 singleton 未就绪时使用）
// ─────────────────────────────────────────────────────────────────

function fallbackLookup(
  key: string,
  loc: Locale,
  vars?: Record<string, string | number | undefined | null>,
): string {
  const raw =
    DECISION_LABELS_BY_LOCALE[loc]?.[key] ||
    (loc !== FALLBACK_LOCALE
      ? DECISION_LABELS_BY_LOCALE[FALLBACK_LOCALE]?.[key]
      : undefined) ||
    key;
  return interpolate(raw, vars);
}

function interpolate(
  text: string,
  vars?: Record<string, string | number | undefined | null>,
): string {
  if (!vars) return text;
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) continue;
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
  }
  return out;
}

/** 把 nullable vars 过滤掉 undefined/null，适配 I18nService.translate 签名 */
function sanitizeVars(
  vars?: Record<string, string | number | undefined | null>,
): Record<string, string | number> | undefined {
  if (!vars) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// @deprecated 兼容导出 — 仅 cl() 内部 fallback 使用，不要新增引用
// ─────────────────────────────────────────────────────────────────

/**
 * @deprecated 改用 cl(key, locale, vars)；该字典仅用作 cl() 内部 fallback。
 *   下个版本将移除此导出。
 */
export const COACH_LABELS: Record<string, Record<string, string>> =
  DECISION_LABELS_BY_LOCALE;

// ==================== 评分维度标签重导出 ====================

export {
  SCORING_DIMENSIONS,
  type ScoringDimension,
  getDimensionLabel,
  getDimensionExplanation,
  getDimensionSuggestion,
  scoreToImpact,
} from '../config/scoring-dimensions';
