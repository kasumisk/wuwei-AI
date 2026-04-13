import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { FoodLibrary } from '../../../modules/food/food.types';

export interface TranslationResult {
  locale: string;
  name: string;
  aliases: string;
  description: string;
  servingDesc: string;
}

/**
 * AI 食物翻译服务
 * 使用 DeepSeek V3 进行食物名称多语言翻译
 * 支持语言: zh-CN, en-US, ja-JP, ko-KR, zh-TW
 */
@Injectable()
export class FoodAiTranslateService {
  private readonly logger = new Logger(FoodAiTranslateService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  private readonly LOCALE_NAMES: Record<string, string> = {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'en-US': 'English',
    'ja-JP': '日本語',
    'ko-KR': '한국어',
  };

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  /**
   * 翻译单个食物到目标语言
   */
  async translateFood(
    food: Partial<FoodLibrary>,
    targetLocale: string,
  ): Promise<TranslationResult | null> {
    if (!this.apiKey) return null;
    const langName = this.LOCALE_NAMES[targetLocale] || targetLocale;

    const prompt = `你是食品翻译专家。请将以下中文食物翻译为 ${targetLocale} (${langName})。

食物:
- 中文名: ${food.name}
- 分类: ${food.category || 'unknown'}
- 热量: ${food.calories || '-'} kcal/100g
- 标准份量: ${food.standardServingDesc || '-'}

翻译要求:
1. 使用当地人最常用的名称（不是直译）
2. 别名列出当地其他常见叫法，逗号分隔
3. 份量描述使用当地计量习惯
4. 不要翻译品牌名

返回JSON:
{"name": "翻译后名称", "aliases": "别名1,别名2", "description": "简短描述（一句话）", "serving_desc": "本地化份量描述"}`;

    try {
      const response = await this.client.post('/chat/completions', {
        model: 'deepseek-chat',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是食品翻译专家，严格按JSON格式返回翻译结果。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      return {
        locale: targetLocale,
        name: parsed.name || '',
        aliases: parsed.aliases || '',
        description: parsed.description || '',
        servingDesc: parsed.serving_desc || parsed.servingDesc || '',
      };
    } catch (e) {
      this.logger.error(
        `Translation failed for "${food.name}" to ${targetLocale}: ${e.message}`,
      );
      return null;
    }
  }

  /**
   * 翻译单个食物到全部支持语言
   */
  async translateToAll(
    food: Partial<FoodLibrary>,
    excludeLocales: string[] = [],
  ): Promise<TranslationResult[]> {
    const results: TranslationResult[] = [];
    const targets = Object.keys(this.LOCALE_NAMES).filter(
      (l) => !excludeLocales.includes(l),
    );

    for (const locale of targets) {
      const result = await this.translateFood(food, locale);
      if (result) results.push(result);
      await this.sleep(300); // Rate limiting
    }

    return results;
  }

  /**
   * 批量翻译食物到目标语言
   */
  async translateBatch(
    foods: Partial<FoodLibrary>[],
    targetLocale: string,
    batchSize = 5,
  ): Promise<Map<number, TranslationResult>> {
    const results = new Map<number, TranslationResult>();

    for (let i = 0; i < foods.length; i += batchSize) {
      const batch = foods.slice(i, i + batchSize);
      const batchResults = await this.translateBatchRequest(
        batch,
        targetLocale,
      );

      for (const [idx, result] of batchResults) {
        results.set(i + idx, result);
      }
      await this.sleep(500);
    }

    return results;
  }

  private async translateBatchRequest(
    foods: Partial<FoodLibrary>[],
    targetLocale: string,
  ): Promise<Map<number, TranslationResult>> {
    const langName = this.LOCALE_NAMES[targetLocale] || targetLocale;
    const results = new Map<number, TranslationResult>();

    const foodList = foods
      .map(
        (f, i) =>
          `[${i}] ${f.name} (${f.category || '-'}, ${f.calories || '-'}kcal)`,
      )
      .join('\n');

    const prompt = `请将以下 ${foods.length} 个食物翻译为 ${targetLocale} (${langName})。

食物列表:
${foodList}

要求: 使用当地最常用名称、列出别名、简短描述。

返回JSON: {"results": [{"index": 0, "name": "...", "aliases": "...", "description": "...", "serving_desc": "..."}, ...]}`;

    try {
      const response = await this.client.post('/chat/completions', {
        model: 'deepseek-chat',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是食品翻译专家，严格按JSON格式返回翻译结果。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 3000,
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) return results;

      const parsed = JSON.parse(content);
      const items = parsed.results || parsed;

      if (Array.isArray(items)) {
        for (const item of items) {
          const idx = item.index ?? items.indexOf(item);
          results.set(idx, {
            locale: targetLocale,
            name: item.name || '',
            aliases: item.aliases || '',
            description: item.description || '',
            servingDesc: item.serving_desc || item.servingDesc || '',
          });
        }
      }
    } catch (e) {
      this.logger.error(
        `Batch translation to ${targetLocale} failed: ${e.message}`,
      );
    }

    return results;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
