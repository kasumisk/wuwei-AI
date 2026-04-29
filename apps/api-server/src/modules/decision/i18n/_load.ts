/**
 * Decision i18n 同步加载器
 *
 * Phase 11.B (V8): 全局 I18nService 已接管 decision 字典加载与启动校验，
 *   本文件保留唯一职责：在 I18nService.onModuleInit 之前的早期阶段
 *   （模块顶层 eager 执行 / 单元测试 / spec），为 cl() 提供同步 fallback
 *   数据源 — 否则 cl() 在 singleton 就绪前会返回 key 字面量。
 *
 * 不再做：
 *   - 启动一致性校验（已迁移到 scripts/i18n-check.ts CI 脚本 + decision-i18n.spec.ts）
 *   - 占位符语法检查（同上）
 *
 * Key 命名约定:
 *   - 顶层分组 key (chain.* / dim.* / score.* / ui.* / coach.* / …)
 *   - 占位符 {{var}} 双花括号
 *   - I18nService 加载时自动加 'decision.' 前缀，cl() 内部对齐
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
