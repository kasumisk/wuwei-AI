/**
 * V2.4 I18n Management Service
 *
 * 提供complete i18n支持，包含extended translations和fallback机制
 */

import { Injectable } from '@nestjs/common';
import { EXTENDED_I18N_TRANSLATIONS } from './extended-i18n';

@Injectable()
export class I18nManagementService {
  private readonly translations = EXTENDED_I18N_TRANSLATIONS;
  private readonly supportedLanguages = Object.keys(this.translations);
  private readonly defaultLanguage = 'en';
  private readonly aliases: Record<string, string> = {
    zh: 'zh',
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    en: 'en',
    'en-us': 'en',
    ja: 'ja',
    'ja-jp': 'ja',
    ko: 'ko',
    'ko-kr': 'ko',
    pt: 'en',
    'pt-br': 'en',
  };

  private normalizeLanguage(language?: string): string {
    const normalized = (language || this.defaultLanguage).toLowerCase();
    return this.aliases[normalized] || language || this.defaultLanguage;
  }

  /**
   * 获取完整翻译
   */
  translate(
    key: string,
    language: string = this.defaultLanguage,
    variables?: Record<string, any>,
  ): string {
    // 验证语言有效性，无效则使用默认语言
    const normalizedLanguage = this.normalizeLanguage(language);
    const lang = this.supportedLanguages.includes(normalizedLanguage)
      ? normalizedLanguage
      : this.defaultLanguage;
    const translations = this.translations[lang];

    if (!translations) {
      return key;
    }

    let text = translations[key];

    // 如果翻译不存在，尝试英文
    if (!text && lang !== 'en') {
      text = this.translations.en[key];
    }

    // 如果还是不存在，返回key
    if (!text) {
      return key;
    }

    // 替换变量
    if (variables) {
      Object.entries(variables).forEach(([varKey, varValue]) => {
        text = text.replace(`{{${varKey}}}`, String(varValue));
      });
    }

    return text;
  }

  /**
   * 批量翻译keys
   */
  translateBatch(
    keys: string[],
    language: string = this.defaultLanguage,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    keys.forEach((key) => {
      result[key] = this.translate(key, language);
    });
    return result;
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages(): string[] {
    return this.supportedLanguages;
  }

  /**
   * 检查语言是否被支持
   */
  isLanguageSupported(language: string): boolean {
    return this.supportedLanguages.includes(this.normalizeLanguage(language));
  }

  /**
   * 获取默认语言
   */
  getDefaultLanguage(): string {
    return this.defaultLanguage;
  }

  /**
   * 获取语言的所有翻译
   */
  getAllTranslations(language: string): Record<string, string> {
    const normalizedLanguage = this.normalizeLanguage(language);
    const lang = this.supportedLanguages.includes(normalizedLanguage)
      ? normalizedLanguage
      : this.defaultLanguage;
    return this.translations[lang] || {};
  }
}
