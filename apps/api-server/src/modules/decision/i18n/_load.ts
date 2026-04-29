/**
 * Decision i18n 同步加载器
 *
 * 模块加载时一次性读取 en-US.json / zh-CN.json / ja-JP.json，
 * 提供给 cl() / scoring-dimensions / coach-i18n 等纯函数使用。
 *
 * 不依赖 NestJS DI（这些函数在 service 之外的纯函数模块中也会被调用）。
 *
 * Key 命名约定：
 *   - 顶层分组 key (chain.* / dim.* / score.* / ui.* / coach.* / …)
 *   - 占位符：统一为 {{var}} 双花括号
 *
 * 启动校验（末尾）：
 *   - dev  (NODE_ENV !== 'production'): key 集合不一致 / 单花括号占位符 → 抛出 Error
 *   - prod                            : 同上 → logger.warn 不中断启动
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES = ['zh-CN', 'en-US', 'ja-JP'] as const;
type Loc = (typeof LOCALES)[number];

function loadJson(locale: Loc): Record<string, string> {
  const file = path.join(__dirname, `${locale}.json`);
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt) as Record<string, string>;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[decision/i18n/_load] failed to load ${file}: ${(err as Error).message}`,
    );
    return {};
  }
}

export const DECISION_LABELS_ZH: Record<string, string> = loadJson('zh-CN');
export const DECISION_LABELS_EN: Record<string, string> = loadJson('en-US');
export const DECISION_LABELS_JA: Record<string, string> = loadJson('ja-JP');

export const DECISION_LABELS_BY_LOCALE: Record<
  string,
  Record<string, string>
> = {
  'zh-CN': DECISION_LABELS_ZH,
  'en-US': DECISION_LABELS_EN,
  'ja-JP': DECISION_LABELS_JA,
};

// ==================== 启动校验 ====================

(function validateOnLoad() {
  const isDev = process.env.NODE_ENV !== 'production';

  function warn(msg: string): void {
    if (isDev) {
      throw new Error(`[decision/i18n] ${msg}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[decision/i18n] WARN: ${msg}`);
    }
  }

  const localeEntries = Object.entries(DECISION_LABELS_BY_LOCALE) as [
    string,
    Record<string, string>,
  ][];
  const [baseLocale, baseLabels] = localeEntries[0];
  const baseKeys = new Set(Object.keys(baseLabels));

  // 1. Key set consistency check
  for (const [locale, labels] of localeEntries.slice(1)) {
    const keys = new Set(Object.keys(labels));
    const missing = [...baseKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !baseKeys.has(k));
    if (missing.length > 0) {
      warn(`[${locale}] missing ${missing.length} keys vs ${baseLocale}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    }
    if (extra.length > 0) {
      warn(`[${locale}] has ${extra.length} extra keys vs ${baseLocale}: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '…' : ''}`);
    }
  }

  // 2. Single-brace placeholder check
  const singleBraceRe = /(?<!\{)\{(\w+)\}(?!\})/g;
  for (const [locale, labels] of localeEntries) {
    for (const [key, value] of Object.entries(labels)) {
      const m = value.match(singleBraceRe);
      if (m) {
        warn(`[${locale}] key "${key}" has single-brace placeholder(s): ${m.join(', ')}`);
      }
    }
  }
})();
