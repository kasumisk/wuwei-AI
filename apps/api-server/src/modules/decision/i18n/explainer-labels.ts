/**
 * V4.0 P3.5 — 决策链路标签 i18n
 *
 * V8 (i18n migration): 数据源改为 decision/i18n/{en-US,zh-CN,ja-JP}.json，
 *  原嵌入式 `CHAIN_LABELS` 字典已迁移；运行时从 _load.ts 派生。
 *
 *  JSON 中 chain key 形如 `chain.step.aggregation`，本文件向外暴露的 CHAIN_LABELS
 *  保持原 shape（key 为 `step.xxx`），便于既有调用方零改动。
 */

import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { ClsServiceManager } from 'nestjs-cls';
import { DECISION_LABELS_BY_LOCALE } from './_load';

const CHAIN_PREFIX = 'chain.';

function buildChainLabelsFor(locale: string): Record<string, string> {
  const all = DECISION_LABELS_BY_LOCALE[locale] ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(CHAIN_PREFIX)) {
      out[k.slice(CHAIN_PREFIX.length)] = v;
    }
  }
  return out;
}

export const CHAIN_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': buildChainLabelsFor('zh-CN'),
  'en-US': buildChainLabelsFor('en-US'),
  'ja-JP': buildChainLabelsFor('ja-JP'),
};

function resolveChainLocale(): Locale {
  try {
    const cls = ClsServiceManager.getClsService();
    const raw = cls?.get('locale');
    if (raw === 'en-US' || raw === 'zh-CN' || raw === 'ja-JP') {
      return raw;
    }
  } catch {
    // Ignore missing CLS context and fallback below.
  }
  return 'en-US';
}

/**
 * 查询链路标签，支持变量替换。
 *
 * 兼容历史调用方：
 *  - 原 JSON 中占位符已统一为 {{var}}（双花括号，与 I18nService 对齐）
 *  - 本函数同时支持 {var} 与 {{var}} 两种写法
 */
export function chainLabel(
  key: string,
  vars?: Record<string, string>,
  locale?: Locale,
): string {
  const loc = locale || resolveChainLocale();
  const labels =
    CHAIN_LABELS[loc] || CHAIN_LABELS['en-US'] || CHAIN_LABELS['zh-CN'];
  let text = labels[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{?${k}\\}?\\}`, 'g'), v);
    }
  }
  return text;
}
