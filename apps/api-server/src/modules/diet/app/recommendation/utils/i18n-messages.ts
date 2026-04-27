/**
 * 推荐系统 i18n 文案资源 (V4 Phase 3.5)
 * V6 Phase 2.10 — i18n L1: 系统消息国际化框架
 * V8 i18n 重构 — 数据源迁移至 diet/i18n/{locale}.json (recommendation.* 命名空间)
 *
 * 设计动机:
 * - 所有用户可见的 tip / strategy / label 集中管理
 * - 数据源统一到 NestJS I18nService 同源 JSON：apps/api-server/src/modules/diet/i18n/
 * - t() 仍以纯函数形式存在，保持对 54+ 调用方零改动；同时 NestJS I18nService 也能通过
 *   `i18n.t('diet.recommendation.xxx')` 访问相同内容（双源加载，数据等价）
 * - 模板字符串使用 {{var}} 占位符，由 t() 函数替换
 * - t() 支持可选的 locale 参数，优先级: 参数 > fallback(zh-CN)
 *
 * 用法:
 *   import { t } from './i18n-messages';
 *   const tip = t('tip.caloriesOver');                    // 使用默认 locale (zh-CN)
 *   const tip = t('tip.caloriesOver', {}, 'en-US');       // 指定 locale
 *   const note = t('adjust.lunchDinner', { lunchBudget: 800 });
 *
 * Key 命名兼容：
 * - 调用方传入的 key 不含前缀，例如 'tip.caloriesOver'
 * - JSON 中以 `recommendation.tip.caloriesOver` 存储
 * - t() 内部自动加 `recommendation.` 前缀
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClsServiceManager } from 'nestjs-cls';

export type Locale = 'zh-CN' | 'en-US' | 'ja-JP';

/** 默认回退语言 — 与 core/i18n/i18n.types.ts 的 I18N_DEFAULT_LOCALE 对齐 */
const FALLBACK_LOCALE: Locale = 'en-US';

/** JSON key 前缀（与 dump-recommendation-i18n.ts 保持一致） */
const KEY_PREFIX = 'recommendation.';

// ==================== JSON 同步加载 ====================
// JSON 文件位置：apps/api-server/src/modules/diet/i18n/{locale}.json
// __dirname = .../modules/diet/app/recommendation/utils → 上溯 3 层到 modules/diet/i18n
const I18N_DIR = path.resolve(__dirname, '..', '..', '..', 'i18n');

function loadLocaleJson(locale: Locale): Record<string, string> {
  const file = path.join(I18N_DIR, `${locale}.json`);
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt) as Record<string, string>;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[recommendation/i18n-messages] failed to load ${file}: ${(err as Error).message}`,
    );
    return {};
  }
}

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': loadLocaleJson('zh-CN'),
  'en-US': loadLocaleJson('en-US'),
  'ja-JP': loadLocaleJson('ja-JP'),
};

// ==================== 公共 API ====================

/**
 * 获取所有支持的语言列表
 */
export function getSupportedLocales(): Locale[] {
  return Object.keys(messages) as Locale[];
}

/**
 * 检查指定 locale 是否受支持
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return locale in messages;
}

function resolveRequestLocale(): Locale {
  try {
    const cls = ClsServiceManager.getClsService();
    const raw = cls?.get('locale');
    if (typeof raw === 'string' && isLocaleSupported(raw)) {
      return raw;
    }
  } catch {
    // Ignore missing CLS context and fallback below.
  }
  return FALLBACK_LOCALE;
}

/**
 * 翻译函数 — 获取指定 key 的文案，支持模板变量替换
 *
 * 回退策略: 指定 locale → fallback(zh-CN) → key 本身
 *
 * @param key    文案 key（不含 recommendation. 前缀），如 'tip.caloriesOver'
 * @param vars   模板变量，如 { lunchBudget: 800 }
 * @param locale 可选语言覆盖（不改变全局设置）
 * @returns 替换后的文案，key 不存在时返回 key 本身
 */
export function t(
  key: string,
  vars?: Record<string, string | number>,
  locale?: Locale,
): string {
  const fullKey = KEY_PREFIX + key;
  const resolvedLocale = locale || resolveRequestLocale();
  const dict = messages[resolvedLocale];
  let text = dict?.[fullKey];

  // 如果指定 locale 没有该 key，回退到 zh-CN
  if (text === undefined && resolvedLocale !== FALLBACK_LOCALE) {
    text = messages[FALLBACK_LOCALE]?.[fullKey];
  }

  // 最终兜底: 返回 key 本身（保持原 t() 行为）
  if (text === undefined) {
    text = key;
  }

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }

  return text;
}
