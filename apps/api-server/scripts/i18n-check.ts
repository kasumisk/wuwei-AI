/* eslint-disable no-console */
/**
 * i18n-check — 静态校验所有模块的 i18n JSON 与 ts 调用面。
 *
 * 检查项：
 *   1. 三 locale (en-US / zh-CN / ja-JP) key 集合一致
 *   2. 单花括号占位符（{var} 而非 {{var}}）—— 视为错误
 *   3. 跨 locale 同一 key 的 {{var}} 占位符集合一致
 *   4. 孤儿 key — JSON 定义但 ts 源码无任何引用
 *   5. 死引用 — ts 源码引用了 JSON 未定义的 key（仅静态可识别的字面量调用）
 *
 * 退出码：发现任何错误 → 1；仅 warn → 0
 *
 * 使用：
 *   pnpm --dir apps/api-server i18n:check
 */

import * as fs from 'fs';
import * as path from 'path';

type Locale = 'en-US' | 'zh-CN' | 'ja-JP';
const LOCALES: Locale[] = ['en-US', 'zh-CN', 'ja-JP'];

interface ModuleInfo {
  namespace: string; // 父目录名（如 decision / coach / common）
  i18nDir: string;
  moduleDir: string;
  /** 已扁平化的 key → text（嵌套对象用 dot-notation 展开） */
  perLocale: Partial<Record<Locale, Record<string, string>>>;
}

/**
 * 把任意 JSON（含嵌套对象/数组）扁平成 dot-notation 字符串字典。
 * 数组元素用索引：foo.0.bar
 * 非字符串叶子（数字/布尔）一律 toString。
 */
function flatten(
  input: unknown,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (input === null || input === undefined) return out;
  if (typeof input === 'string') {
    out[prefix] = input;
    return out;
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    out[prefix] = String(input);
    return out;
  }
  if (Array.isArray(input)) {
    input.forEach((v, i) =>
      flatten(v, prefix ? `${prefix}.${i}` : String(i), out),
    );
    return out;
  }
  if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** kebab-case → camelCase（与 I18nService.toCamelCase 同语义） */
function toCamelCase(input: string): string {
  return input.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

const ROOT = path.resolve(__dirname, '..', 'src');
const SCAN_ROOTS = [path.join(ROOT, 'modules'), path.join(ROOT, 'common')];

const errors: string[] = [];
const warnings: string[] = [];

function err(msg: string) {
  errors.push(msg);
}
function warn(msg: string) {
  warnings.push(msg);
}

// ─────────────────────────────────────────────────────────────────
// 1. 收集 i18n 模块
// ─────────────────────────────────────────────────────────────────

function scanI18nModules(): ModuleInfo[] {
  const result: ModuleInfo[] = [];
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root)) continue;
    walk(root, result);
  }
  return result;
}

function walk(dir: string, out: ModuleInfo[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const i18n = entries.find((e) => e.isDirectory() && e.name === 'i18n');
  if (i18n) {
    const moduleDir = dir;
    const i18nDir = path.join(dir, 'i18n');
    const info: ModuleInfo = {
      // 与 I18nService 保持一致：kebab-case → camelCase
      namespace: toCamelCase(path.basename(moduleDir)),
      moduleDir,
      i18nDir,
      perLocale: {},
    };
    for (const locale of LOCALES) {
      const file = path.join(i18nDir, `${locale}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        info.perLocale[locale] = flatten(raw);
      } catch (e) {
        err(`[parse] ${file}: ${(e as Error).message}`);
      }
    }
    out.push(info);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'i18n' || e.name === 'node_modules' || e.name === 'dist') {
      continue;
    }
    walk(path.join(dir, e.name), out);
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. 校验 key 一致 / 占位符
// ─────────────────────────────────────────────────────────────────

function extractDoubleBraceVars(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return out;
}

function hasSingleBracePlaceholder(text: string): boolean {
  // 先把 {{...}} 抠掉，再检查剩余文本里是否有 {var} 形式的单花括号占位符。
  // 单花括号占位符的特征：{identifier} —— 内部仅含 [\w.]，不含空格/引号/换行/逗号
  // 这样可以避免误伤 JSON schema 示例文本（含 `{ "foods": [...] }` 等真正的 JSON 字面量）
  const stripped = text.replace(/\{\{[\s\S]*?\}\}/g, '');
  return /\{[\w.]+\}/.test(stripped);
}

function checkModule(info: ModuleInfo): void {
  const { namespace, perLocale } = info;
  const present = LOCALES.filter((l) => perLocale[l]);
  if (present.length === 0) return;

  // 2.1 key 集合一致
  const keysByLocale: Record<Locale, Set<string>> = {
    'en-US': new Set(),
    'zh-CN': new Set(),
    'ja-JP': new Set(),
  };
  for (const l of present) {
    Object.keys(perLocale[l]!).forEach((k) => keysByLocale[l].add(k));
  }
  if (present.length > 1) {
    const ref = keysByLocale[present[0]];
    for (const l of present.slice(1)) {
      const cur = keysByLocale[l];
      const missing = [...ref].filter((k) => !cur.has(k));
      const extra = [...cur].filter((k) => !ref.has(k));
      for (const k of missing) {
        err(`[key-missing] ${namespace}/${l}.json missing key: ${k}`);
      }
      for (const k of extra) {
        err(
          `[key-extra] ${namespace}/${l}.json has extra key not in ${present[0]}: ${k}`,
        );
      }
    }
  }

  // 2.2 单花括号占位符 + 2.3 跨 locale 占位符一致
  const allKeys = new Set<string>();
  present.forEach((l) =>
    Object.keys(perLocale[l]!).forEach((k) => allKeys.add(k)),
  );

  for (const k of allKeys) {
    const varsByLocale: Partial<Record<Locale, Set<string>>> = {};
    for (const l of present) {
      const text = perLocale[l]?.[k];
      if (text === undefined) continue;
      if (hasSingleBracePlaceholder(text)) {
        err(
          `[single-brace] ${namespace}/${l}.json key="${k}" contains single-brace placeholder; use {{var}}`,
        );
      }
      varsByLocale[l] = extractDoubleBraceVars(text);
    }
    const definedLocales = present.filter((l) => varsByLocale[l]);
    if (definedLocales.length > 1) {
      const ref = varsByLocale[definedLocales[0]]!;
      for (const l of definedLocales.slice(1)) {
        const cur = varsByLocale[l]!;
        const refArr = [...ref].sort();
        const curArr = [...cur].sort();
        if (
          refArr.length !== curArr.length ||
          refArr.some((v, i) => v !== curArr[i])
        ) {
          err(
            `[placeholder-mismatch] ${namespace} key="${k}" placeholders differ: ` +
              `${definedLocales[0]}={${refArr.join(',')}} vs ${l}={${curArr.join(',')}}`,
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// 3. ts 源码扫描 — 静态收集 i18n key 引用
// ─────────────────────────────────────────────────────────────────

interface TsRefScan {
  /** key（裸 key，不含 namespace 前缀，因为 cl() 写法用裸 key）*/
  bareKeys: Set<string>;
  /** key（已含 namespace 的 fullKey，i18n.t() 用法）*/
  fullKeys: Set<string>;
  /** 出现过 cl(`...${var}...`) 这种动态拼接，标记跳过 dead-key 检查 */
  hasDynamic: boolean;
}

function scanTsSources(): TsRefScan {
  const out: TsRefScan = {
    bareKeys: new Set(),
    fullKeys: new Set(),
    hasDynamic: false,
  };
  walkTs(ROOT, out);
  return out;
}

function walkTs(dir: string, out: TsRefScan): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'i18n') {
        continue;
      }
      walkTs(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.ts')) continue;
    if (e.name.endsWith('.spec.ts') || e.name.endsWith('.d.ts')) continue;
    scanTsFile(full, out);
  }
}

// 匹配以下调用形式（仅静态字符串字面量）：
//   cl('key.path', ...)                         → bareKeys
//   cl("key.path", ...)                         → bareKeys
//   i18n.t('namespace.key.path', ...)           → fullKeys
//   i18n.translate('namespace.key.path', ...)   → fullKeys
//   this.i18n.t(...) / .translate(...)          → 同上
//
// 模板字符串包含 ${} 的视为动态：标记 hasDynamic
const RE_CL_STATIC = /\bcl\(\s*['"]([\w.]+)['"]/g;
const RE_CL_DYNAMIC = /\bcl\(\s*`[^`]*\$\{/g;
const RE_T_STATIC =
  /\bi18n(?:Service)?\.(?:t|translate)\(\s*['"]([\w.]+)['"]/g;
const RE_T_DYNAMIC = /\bi18n(?:Service)?\.(?:t|translate)\(\s*`[^`]*\$\{/g;

function scanTsFile(file: string, out: TsRefScan): void {
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  // 抠掉 /* ... */ 与 // ... 注释，避免 JSDoc 中的示例代码被误判为真实引用
  src = stripComments(src);
  let m: RegExpExecArray | null;
  while ((m = RE_CL_STATIC.exec(src)) !== null) out.bareKeys.add(m[1]);
  while ((m = RE_T_STATIC.exec(src)) !== null) out.fullKeys.add(m[1]);
  if (RE_CL_DYNAMIC.test(src) || RE_T_DYNAMIC.test(src)) {
    out.hasDynamic = true;
  }
}

/** 简易 ts 注释剥离：保留行号占位（用空格替换），不解析字符串内的 // 这种边角情况。 */
function stripComments(src: string): string {
  // 块注释
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // 行注释
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

// ─────────────────────────────────────────────────────────────────
// 4. 孤儿 / 死引用对账
// ─────────────────────────────────────────────────────────────────

function reconcile(modules: ModuleInfo[], scan: TsRefScan): void {
  // 全部已定义的 key 集合（按 fullKey 与 bareKey 双视角）
  const definedFull = new Set<string>(); // namespace.key
  const definedByNs = new Map<string, Set<string>>(); // namespace → bare key set
  for (const m of modules) {
    const set = new Set<string>();
    for (const l of LOCALES) {
      const dict = m.perLocale[l];
      if (!dict) continue;
      for (const k of Object.keys(dict)) {
        set.add(k);
        definedFull.add(`${m.namespace}.${k}`);
      }
    }
    definedByNs.set(m.namespace, set);
  }

  // 4.1 死引用
  // cl() bare key 默认归属 decision namespace（cl 实现固定 'decision.' 前缀）
  const decisionKeys = definedByNs.get('decision') ?? new Set();
  for (const k of scan.bareKeys) {
    if (!decisionKeys.has(k)) {
      err(`[dead-ref] cl('${k}') referenced but not defined in decision/i18n`);
    }
  }
  for (const fk of scan.fullKeys) {
    if (!definedFull.has(fk)) {
      err(`[dead-ref] i18n.t('${fk}') referenced but not defined in any module/i18n`);
    }
  }

  // 4.2 孤儿（仅当没有动态拼接时报 warn — 动态拼接可能引用任意 key）
  const referenced = new Set<string>();
  for (const k of scan.bareKeys) referenced.add(`decision.${k}`);
  for (const fk of scan.fullKeys) referenced.add(fk);

  if (!scan.hasDynamic) {
    for (const fk of definedFull) {
      if (!referenced.has(fk)) {
        warn(`[orphan] ${fk} defined but never referenced in ts sources`);
      }
    }
  } else {
    // 有动态拼接 → 只在该 namespace 内做对账（保守：跳过 decision 与含动态调用的 ns）
    // 简化处理：全局存在动态 → 整个孤儿检查降级为 info 不输出
  }
}

// ─────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────

function main(): void {
  const modules = scanI18nModules();
  console.log(`[i18n-check] scanning ${modules.length} i18n module(s)...`);

  for (const m of modules) checkModule(m);
  const scan = scanTsSources();
  console.log(
    `[i18n-check] ts refs: cl()=${scan.bareKeys.size} static keys, ` +
      `i18n.t()=${scan.fullKeys.size} static keys, dynamic=${scan.hasDynamic}`,
  );
  reconcile(modules, scan);

  if (warnings.length > 0) {
    console.warn(`\n[i18n-check] ${warnings.length} warning(s):`);
    warnings.slice(0, 50).forEach((w) => console.warn('  ' + w));
    if (warnings.length > 50) {
      console.warn(`  ... and ${warnings.length - 50} more`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n[i18n-check] ${errors.length} error(s):`);
    errors.slice(0, 100).forEach((e) => console.error('  ' + e));
    if (errors.length > 100) {
      console.error(`  ... and ${errors.length - 100} more`);
    }
    console.error('\n[i18n-check] FAILED');
    process.exit(1);
  }

  console.log('\n[i18n-check] OK');
}

main();
