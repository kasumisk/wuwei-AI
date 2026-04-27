/**
 * Decision i18n 同步加载器
 *
 * 模块加载时一次性读取 en-US.json / zh-CN.json / ja-JP.json，
 * 提供给 cl() / chainLabel() / scoring-dimensions / coach-i18n 等纯函数使用。
 *
 * 不依赖 NestJS DI（这些函数在 service 之外的纯函数模块中也会被调用）。
 *
 * Key 命名约定（来自 dump-decision-i18n.ts）：
 *   - 顶层 key：来自 labels-*.ts 的 COACH_LABELS_* 字典 (cl/ci 路径)
 *   - chain.step.*：来自 explainer-labels.ts 的 CHAIN_LABELS (chainLabel 路径)
 *
 * 占位符：统一为 {{var}} 双花括号，由 chainLabel/ci 内部 .replace 完成。
 *        cl() 不做替换 (调用方手工 .replace)。
 *
 * NOTE: I18nService 在 NestJS 启动后会再次扫描这些 JSON 用于 i18n.t('decision.xxx')
 *       调用 — 这是双源加载，但数据等价、互不冲突。
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
