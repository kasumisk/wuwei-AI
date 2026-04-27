/**
 * PromptBuilderService — AI Prompt 模板按 locale 文件化加载器
 *
 * 解决问题：
 *  目前 prompt 拼装代码大量出现 `loc === 'en-US' ? '...' : loc === 'ja-JP' ? '...' : '...'`
 *  这种三元，扩展到 10+ 语言时不可维护。本 service 提供文件级模板：
 *
 *  modules/<module>/i18n/prompts/<locale>/<name>.md
 *
 *  调用：
 *    promptBuilder.render('coach', 'system-base', { user: 'Alice', goal: 'Lose fat' })
 *
 *  自动按 CLS locale 选择文件；缺失则 fallback en-US；插值用 {{var}}。
 *
 *  好处：
 *  - prompt 由产品/翻译人员维护，不需要改 TS
 *  - 新增语言：复制目录加 .md 即可
 *  - 文件级版本管理（git diff prompt 一目了然）
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageContextService } from './language-context.service';
import { I18N_DEFAULT_LOCALE, I18N_LOCALES, I18nLocale } from './i18n.types';

interface PromptCacheEntry {
  /** locale → template raw string */
  byLocale: Partial<Record<I18nLocale, string>>;
}

@Injectable()
export class PromptBuilderService implements OnModuleInit {
  private readonly logger = new Logger(PromptBuilderService.name);

  /** key = `${module}/${name}` → entry */
  private readonly cache = new Map<string, PromptCacheEntry>();

  constructor(@Optional() private readonly lang?: LanguageContextService) {}

  onModuleInit(): void {
    this.scanAll();
  }

  /** 测试或热重载触发 */
  reload(): void {
    this.cache.clear();
    this.scanAll();
  }

  /**
   * 渲染 prompt
   * @param module 模块名（与 modules/<module>/ 同名）
   * @param name   prompt 名（不含扩展名）
   * @param vars   变量插值
   * @param locale 显式 locale（默认从 LanguageContext 取）
   */
  render(
    module: string,
    name: string,
    vars?: Record<string, string | number>,
    locale?: I18nLocale,
  ): string {
    const loc =
      locale ?? this.lang?.locale ?? I18N_DEFAULT_LOCALE;
    const tpl = this.resolveTemplate(module, name, loc);
    if (tpl == null) {
      this.logger.warn(
        `[prompt] template not found: ${module}/${name} (any locale)`,
      );
      return '';
    }
    return this.interpolate(tpl, vars);
  }

  /** 是否存在某个 prompt 模板（任一 locale） */
  has(module: string, name: string): boolean {
    return this.cache.has(`${module}/${name}`);
  }

  /** 列出所有已加载的模板 key（调试用） */
  list(): string[] {
    return Array.from(this.cache.keys()).sort();
  }

  // ─────────────────────────────────────────────────────────────────

  private resolveTemplate(
    module: string,
    name: string,
    locale: I18nLocale,
  ): string | null {
    const entry = this.cache.get(`${module}/${name}`);
    if (!entry) return null;
    return (
      entry.byLocale[locale] ??
      entry.byLocale[I18N_DEFAULT_LOCALE] ??
      Object.values(entry.byLocale)[0] ??
      null
    );
  }

  private scanAll(): void {
    const roots = this.resolveScanRoots();
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      this.scanModulesDir(root);
    }
    this.logger.log(
      `[prompt] loaded ${this.cache.size} prompt templates from ${roots.length} roots`,
    );
  }

  private resolveScanRoots(): string[] {
    const here = __dirname;
    const apiRoot = path.resolve(here, '..', '..');
    return [path.join(apiRoot, 'modules')];
  }

  /** 递归找 modules/MODULE/i18n/prompts/LOCALE/NAME.md */
  private scanModulesDir(root: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name === 'dist') continue;

      const promptsDir = path.join(root, e.name, 'i18n', 'prompts');
      if (fs.existsSync(promptsDir)) {
        this.loadModulePrompts(e.name, promptsDir);
      }

      // 递归子目录（支持嵌套模块）
      this.scanModulesDir(path.join(root, e.name));
    }
  }

  private loadModulePrompts(moduleName: string, promptsDir: string): void {
    for (const locale of I18N_LOCALES) {
      const localeDir = path.join(promptsDir, locale);
      if (!fs.existsSync(localeDir)) continue;
      let files: string[];
      try {
        files = fs.readdirSync(localeDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
        const name = file.replace(/\.(md|txt)$/, '');
        const fullKey = `${moduleName}/${name}`;
        const content = fs.readFileSync(path.join(localeDir, file), 'utf-8');
        let entry = this.cache.get(fullKey);
        if (!entry) {
          entry = { byLocale: {} };
          this.cache.set(fullKey, entry);
        }
        entry.byLocale[locale] = content;
      }
    }
  }

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
