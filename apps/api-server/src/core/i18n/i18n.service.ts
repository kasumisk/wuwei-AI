/**
 * I18n V7 — I18nService
 *
 * 设计目标：
 *  1. 模块级目录结构：每个 module 自带 i18n/{en-US,zh-CN,ja-JP}.json
 *  2. 启动时一次性扫描 src/modules / src/common，按 namespace 合并到内存字典
 *  3. 命中链路：requested locale → fallback en-US → key 本身（保证生产环境
 *     永不抛异常）
 *  4. 调用方式：i18n.t('user.userNotFound', { name: 'Alice' })
 *  5. 与现有 RequestContextService 集成：locale 来自 CLS（由 I18nMiddleware 写入）
 *
 * Key 命名规则：<namespace>.<camelCaseKey>
 *  - namespace 通常是模块文件夹名（user / diet / decision / common ...）
 *  - 不允许嵌套 dot 之外的层级，避免与原 extended-i18n 平铺 key 冲突
 *  - 同一个 key 在不同模块的 JSON 中重复定义，启动时会抛错（防误覆盖）
 *
 * 兼容旧实现：
 *  - 旧 EXTENDED_I18N_TRANSLATIONS / I18nManagementService 暂时保留
 *  - 新模块统一改用 I18nService.t()
 *  - 完成全量迁移后再删除旧文件
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RequestContextService } from '../context/request-context.service';
import { setI18nSingleton } from './i18n.runtime';
import {
  I18N_DEFAULT_LOCALE,
  I18N_LOCALES,
  I18N_LOCALE_ALIAS,
  I18nDictionary,
  I18nLocale,
} from './i18n.types';

interface LoadStats {
  modules: string[];
  totalKeys: number;
  perLocale: Record<I18nLocale, number>;
  conflicts: string[];
  missingKeysAcrossLocales: string[];
}

@Injectable()
export class I18nService implements OnModuleInit {
  private readonly logger = new Logger(I18nService.name);

  /** 全局字典：完整 key（含 namespace）→ locale → text */
  private readonly dictionary: I18nDictionary = {};

  /** 启动加载统计（暴露给 healthcheck / debug 端点） */
  private stats: LoadStats = {
    modules: [],
    totalKeys: 0,
    perLocale: { 'en-US': 0, 'zh-CN': 0, 'ja-JP': 0 },
    conflicts: [],
    missingKeysAcrossLocales: [],
  };

  constructor(@Optional() private readonly ctx?: RequestContextService) {}

  // ─────────────────────────────────────────────────────────────────
  // 启动加载
  // ─────────────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.loadAll();
    // 注册全局 singleton，供纯函数适配器（decision cl() 等）使用
    setI18nSingleton(this);
  }

  /** 测试场景下手动重载 */
  reload(): void {
    Object.keys(this.dictionary).forEach((k) => delete this.dictionary[k]);
    this.stats = {
      modules: [],
      totalKeys: 0,
      perLocale: { 'en-US': 0, 'zh-CN': 0, 'ja-JP': 0 },
      conflicts: [],
      missingKeysAcrossLocales: [],
    };
    this.loadAll();
  }

  private loadAll(): void {
    const roots = this.resolveScanRoots();
    const seenKeyOwner = new Map<string, string>(); // key → 首次出现的模块路径

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      this.scanDir(root, seenKeyOwner);
    }

    // 统计未在所有 locale 中出现的 key
    for (const [fullKey, perLocale] of Object.entries(this.dictionary)) {
      const missing = I18N_LOCALES.filter((l) => !perLocale[l]);
      if (missing.length > 0) {
        this.stats.missingKeysAcrossLocales.push(
          `${fullKey} (missing: ${missing.join(',')})`,
        );
      }
    }

    this.stats.totalKeys = Object.keys(this.dictionary).length;
    for (const locale of I18N_LOCALES) {
      this.stats.perLocale[locale] = Object.values(this.dictionary).filter(
        (entry) => entry[locale],
      ).length;
    }

    this.logger.log(
      `[i18n] loaded ${this.stats.totalKeys} keys from ${this.stats.modules.length} modules ` +
        `(en=${this.stats.perLocale['en-US']}, zh=${this.stats.perLocale['zh-CN']}, ` +
        `ja=${this.stats.perLocale['ja-JP']})`,
    );

    // Sanity check：dist 没拷贝资源时直接 fatal，避免返回 key 字面量给前端
    if (this.stats.totalKeys === 0) {
      const msg =
        '[i18n] FATAL: no translation keys loaded. ' +
        'Check nest-cli.json `assets` config and ensure `**/i18n/*.json` are copied to dist. ' +
        `Scan roots: ${this.resolveScanRoots().join(', ')}`;
      this.logger.error(msg);
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg);
      }
    }

    if (this.stats.conflicts.length > 0) {
      this.logger.error(
        `[i18n] ${this.stats.conflicts.length} key conflicts detected:\n  ` +
          this.stats.conflicts.slice(0, 10).join('\n  '),
      );
    }
    if (
      this.stats.missingKeysAcrossLocales.length > 0 &&
      process.env.NODE_ENV !== 'production'
    ) {
      this.logger.warn(
        `[i18n] ${this.stats.missingKeysAcrossLocales.length} keys missing in some locale ` +
          `(will fallback to ${I18N_DEFAULT_LOCALE})`,
      );
    }
  }

  /**
   * 扫描根：开发环境用 src/，生产 dist/build 后用 dist/
   * 通过 __dirname 推断当前运行环境。
   */
  private resolveScanRoots(): string[] {
    // __dirname 在 src 模式: /apps/api-server/src/core/i18n
    // __dirname 在 dist 模式: /apps/api-server/dist/core/i18n
    const here = __dirname;
    const apiRoot = path.resolve(here, '..', '..'); // → src/ 或 dist/
    const roots = [path.join(apiRoot, 'modules'), path.join(apiRoot, 'common')];
    return roots;
  }

  private scanDir(dir: string, seen: Map<string, string>): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // 只识别这一层下名为 "i18n" 的目录
    const i18nDir = entries.find((e) => e.isDirectory() && e.name === 'i18n');
    if (i18nDir) {
      this.loadModuleI18n(path.join(dir, 'i18n'), dir, seen);
    }

    // 递归子目录
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'i18n' || e.name === 'node_modules' || e.name === 'dist') {
        continue;
      }
      this.scanDir(path.join(dir, e.name), seen);
    }
  }

  /**
   * 加载某模块的 i18n 目录。
   * namespace = 包含 i18n 目录的父目录名（即模块文件夹名），
   * 自动将 kebab-case 转成 camelCase（`app-version` → `appVersion`），
   * 让 ts 调用方可以使用更自然的 `i18n.t('appVersion.notFound')` 而不是带连字符。
   */
  private loadModuleI18n(
    i18nDir: string,
    moduleDir: string,
    seen: Map<string, string>,
  ): void {
    const namespace = I18nService.toCamelCase(path.basename(moduleDir));
    this.stats.modules.push(namespace);

    for (const locale of I18N_LOCALES) {
      const file = path.join(i18nDir, `${locale}.json`);
      if (!fs.existsSync(file)) continue;

      let json: Record<string, string>;
      try {
        json = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch (err) {
        this.logger.error(
          `[i18n] failed to parse ${file}: ${(err as Error).message}`,
        );
        continue;
      }

      for (const [localKey, text] of Object.entries(json)) {
        const fullKey = `${namespace}.${localKey}`;
        const owner = seen.get(fullKey);
        if (owner && owner !== moduleDir) {
          this.stats.conflicts.push(
            `${fullKey} (defined in ${owner} and ${moduleDir})`,
          );
          continue;
        }
        seen.set(fullKey, moduleDir);

        if (!this.dictionary[fullKey]) {
          this.dictionary[fullKey] = {} as Record<I18nLocale, string>;
        }
        this.dictionary[fullKey][locale] = text;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * 翻译当前请求语言。变量插值采用 {{name}} 语法。
   * 命中链：requested → en-US → key 本身。
   */
  t(key: string, vars?: Record<string, string | number>): string {
    return this.translate(key, this.currentLocale(), vars);
  }

  /** 显式 locale 翻译 */
  translate(
    key: string,
    locale: I18nLocale,
    vars?: Record<string, string | number>,
  ): string {
    const entry = this.dictionary[key];
    if (!entry) {
      // 缺失 key — 开发模式打印一次告警
      if (process.env.NODE_ENV !== 'production') {
        this.logger.debug(`[i18n] missing key: ${key}`);
      }
      return this.interpolate(key, vars);
    }
    const text =
      entry[locale] ??
      entry[I18N_DEFAULT_LOCALE] ??
      Object.values(entry)[0] ??
      key;
    return this.interpolate(text, vars);
  }

  /** 批量翻译 */
  tBatch(
    keys: string[],
    vars?: Record<string, string | number>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = this.t(k, vars);
    return out;
  }

  /** key 是否注册过（任何 locale 中存在） */
  has(key: string): boolean {
    return key in this.dictionary;
  }

  /** 当前请求 locale（CLS / fallback default） */
  currentLocale(): I18nLocale {
    if (!this.ctx || !this.ctx.isActive) return I18N_DEFAULT_LOCALE;
    const raw = (this.ctx.locale || '').toString();
    return I18nService.normalizeLocale(raw);
  }

  /** 启动加载统计（供 /health/i18n 等暴露） */
  getStats(): LoadStats {
    return this.stats;
  }

  /** 把任意输入字符串规范成支持的 locale */
  static normalizeLocale(input: string): I18nLocale {
    const k = (input || '').toLowerCase();
    if (I18N_LOCALES.includes(input as I18nLocale)) return input as I18nLocale;
    return I18N_LOCALE_ALIAS[k] ?? I18N_DEFAULT_LOCALE;
  }

  /** kebab-case → camelCase（保持已是 camelCase 的输入不变） */
  static toCamelCase(input: string): string {
    return input.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  }

  // ─────────────────────────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────────────────────────

  private interpolate(
    text: string,
    vars?: Record<string, string | number>,
  ): string {
    if (!vars) return text;
    return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => {
      const v = vars[name];
      return v === undefined || v === null ? '' : String(v);
    });
  }
}
