/**
 * 枚举值本地化（V8 i18n audit）
 *
 * 用途：
 *   将后端常驻的英文 enum（allergens、mealType、budgetStatus、goalType…）映射到
 *   面向终端用户的多语言可读文本。这样 service 可以继续用稳定的英文 enum 做逻辑，
 *   而响应体里只输出已翻译的字符串。
 *
 * 数据源：apps/api-server/src/common/i18n/{en-US,zh-CN,ja-JP}.json，统一前缀 enum.
 *
 * 设计动机：
 *   - 与 decision/i18n/_load.ts、recommendation/utils/i18n-messages.ts 的同步加载
 *     模式一致，可在 service / 纯函数 / 模板字符串里直接使用，不强依赖 DI。
 *   - 同时通过 NestJS I18nService 也能扫描到（双源加载，数据等价）。
 *
 * 用法：
 *   import { translateEnum } from '@/common/i18n/enum-i18n';
 *   translateEnum('allergen', 'soy', 'zh-CN'); // '大豆'
 *   translateEnum('mealType', 'snack');         // 跟随 CLS locale
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClsServiceManager } from 'nestjs-cls';

export type EnumLocale = 'zh-CN' | 'en-US' | 'ja-JP';

/** 与 core/i18n/i18n.types.ts I18N_DEFAULT_LOCALE 对齐 */
const FALLBACK_LOCALE: EnumLocale = 'en-US';

const SUPPORTED: readonly EnumLocale[] = ['zh-CN', 'en-US', 'ja-JP'] as const;

/** 已知 enum 类别名（仅做类型提示，未列出的也可以用 string） */
export type EnumCategory =
  | 'allergen'
  | 'dietaryRestriction'
  | 'healthCondition'
  | 'mealType'
  | 'budgetStatus'
  | 'activityLevel'
  | 'gender'
  | 'goal'
  | 'accuracyLevel'
  | 'reviewLevel'
  | 'analysisQuality'
  | 'recommendation';

function loadJson(locale: EnumLocale): Record<string, string> {
  const file = path.join(__dirname, `${locale}.json`);
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt) as Record<string, string>;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[common/i18n/enum-i18n] failed to load ${file}: ${(err as Error).message}`,
    );
    return {};
  }
}

const DICT: Record<EnumLocale, Record<string, string>> = {
  'zh-CN': loadJson('zh-CN'),
  'en-US': loadJson('en-US'),
  'ja-JP': loadJson('ja-JP'),
};

function resolveLocale(): EnumLocale {
  try {
    const cls = ClsServiceManager.getClsService();
    const raw = cls?.get('locale');
    if (typeof raw === 'string' && (SUPPORTED as readonly string[]).includes(raw)) {
      return raw as EnumLocale;
    }
  } catch {
    // CLS 不可用（cron / worker / 测试）→ fallback
  }
  return FALLBACK_LOCALE;
}

/**
 * 翻译单个 enum 值。
 *
 * @param category enum 类别（如 'allergen'）
 * @param value    后端英文 enum 值（如 'soy'）。允许 undefined / 空 → 原样返回。
 * @param locale   可选；缺省走 CLS，再缺省到 en-US。
 * @returns 已翻译文本；未命中时回退到 en-US 词典；再缺失则返回原 value（可见调试）。
 */
export function translateEnum(
  category: EnumCategory | string,
  value: string | null | undefined,
  locale?: EnumLocale | string,
): string {
  if (!value) return '';
  const key = `enum.${category}.${value}`;
  const loc = ((SUPPORTED as readonly string[]).includes(String(locale))
    ? locale
    : resolveLocale()) as EnumLocale;
  return (
    DICT[loc]?.[key] ||
    (loc !== FALLBACK_LOCALE ? DICT[FALLBACK_LOCALE]?.[key] : undefined) ||
    value
  );
}

/**
 * 批量翻译 enum 数组（如 allergens: string[]）。
 */
export function translateEnumList(
  category: EnumCategory | string,
  values: ReadonlyArray<string> | null | undefined,
  locale?: EnumLocale | string,
): string[] {
  if (!values || values.length === 0) return [];
  return values.map((v) => translateEnum(category, v, locale));
}
