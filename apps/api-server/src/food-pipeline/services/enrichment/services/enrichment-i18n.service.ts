/**
 * EnrichmentI18nService
 *
 * 拆分自 food-enrichment.service.ts，负责多语言与地区信息的 AI 补全：
 *  - enrichTranslations — 调用 AI 补全 food_translations 多语言字段
 *  - enrichRegional     — 调用 AI 补全 food_regional_info 地区信息字段
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { type EnrichmentResult } from '../constants/enrichment.types';
import { EnrichmentAiClient } from './ai-client.service';
import {
  buildFoodRegionalWhere,
  parseFoodRegionScope,
} from '../../../../common/utils/food-regional-info.util';

@Injectable()
export class EnrichmentI18nService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: EnrichmentAiClient,
  ) {}

  private async callAIRaw(
    foodName: string,
    prompt: string,
    options?: { systemPrompt?: string; maxTokens?: number },
  ): Promise<Record<string, any> | null> {
    return this.aiClient.callAIRaw(foodName, prompt, options);
  }

  private async callAI(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    target: string,
  ): Promise<EnrichmentResult | null> {
    return this.aiClient.callAI(
      foodName,
      prompt,
      requestedFields,
      target as any,
    );
  }

  async enrichTranslations(
    foodId: string,
    locales: string[],
    apiKey: string,
  ): Promise<Record<string, Record<string, any>>> {
    if (!apiKey) return {};

    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) return {};

    const normalizedLocales = [...new Set(locales.filter(Boolean))];
    if (normalizedLocales.length === 0) return {};

    const existingTranslations = await this.prisma.foodTranslations.findMany({
      where: { foodId: foodId, locale: { in: normalizedLocales } },
    });

    const existingMap = new Map(
      existingTranslations.map((item) => [item.locale, item]),
    );
    const localeFieldMap = new Map<string, string[]>();

    for (const targetLocale of normalizedLocales) {
      const existing = existingMap.get(targetLocale);
      // 只补全对应表中完全没有记录的 locale，有记录则跳过（不做字段级补全）
      if (existing) continue;
      localeFieldMap.set(targetLocale, ['name', 'aliases', 'description']);
    }

    if (localeFieldMap.size === 0) return {};

    const localeNames: Record<string, string> = {
      'zh-CN': '简体中文',
      'zh-TW': '繁体中文',
      'en-US': '英语',
      'ja-JP': '日语',
      'ko-KR': '韩语',
      'es-ES': '西班牙语',
    };

    const localeInstructions = Array.from(localeFieldMap.entries())
      .map(
        ([targetLocale, fields]) =>
          `- ${targetLocale} (${localeNames[targetLocale] ?? targetLocale}): ${fields.join(', ')}`,
      )
      .join('\n');

    const prompt = `食物信息（中文）：
名称: ${food.name}
别名: ${food.aliases ?? '无'}
分类: ${food.category}

要求：
1. name 使用目标地区最常见、最稳定、最适合普通用户理解的食品名称，优先常用名，不要机械直译。
2. 必须保持食品类别正确，不要把原材料翻成菜名，也不要把菜名翻成原材料。
3. aliases 只保留真实常见别名/异名/拼写变体，逗号分隔；不可靠时返回空字符串。
4. description 只写 1 句客观描述，简洁、非营销、非功效宣称。
5. 不要返回 serving_desc 或任何份量克重；份量属于结构化营养数据，不属于翻译。
6. 遇到地区差异时，按 locale 对应地区习惯翻译；不确定时采用保守、通用、可信的叫法。
7. 不要返回未请求字段，不要返回营养数据、价格、法规、季节性或来源字段。
8. aliases 必须是普通字符串，不要返回数组；多个别名用英文逗号分隔。
9. 严格返回 JSON，不要输出任何额外文本。

请按 locale 一次性返回以下翻译缺失字段：
${localeInstructions}

返回 JSON：
{
  "translations": {
    ${Array.from(localeFieldMap.entries())
      .map(
        ([targetLocale, fields]) => `"${targetLocale}": {
      ${fields.map((f) => `"${f}": "<${localeNames[targetLocale] ?? targetLocale}内容>"`).join(',\n      ')}
    }`,
      )
      .join(',\n    ')}
  },
  "confidence": <0.0-1.0>,
  "reasoning": "<说明>"
}`;

    const raw = await this.callAIRaw(food.name, prompt, {
      systemPrompt:
        '你是权威食品多语言本地化专家。为食品数据库生成准确、保守、可直接入库的翻译。严格返回完整 JSON，不要输出 JSON 之外的任何文本。',
      maxTokens: 2800,
    });
    if (
      !raw ||
      typeof raw.translations !== 'object' ||
      Array.isArray(raw.translations)
    ) {
      return {};
    }

    const confidence =
      typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5;
    const reasoning =
      typeof raw.reasoning === 'string' ? raw.reasoning : undefined;
    const translationMap = raw.translations as Record<
      string,
      Record<string, any>
    >;
    const results: Record<string, Record<string, any>> = {};

    for (const [targetLocale, fields] of localeFieldMap.entries()) {
      const merged = {
        ...(translationMap[targetLocale] ?? {}),
        confidence,
        reasoning,
      };
      // 简单验证：剔除非对象结果
      if (!merged || typeof merged !== 'object') continue;
      results[targetLocale] = merged;
    }

    return results;
  }

  async enrichRegional(
    foodId: string,
    region: string,
    apiKey: string,
  ): Promise<Record<string, any> | null> {
    if (!apiKey) return null;

    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) return null;

    const scope = parseFoodRegionScope(region);
    const existing = await this.prisma.foodRegionalInfo.findFirst({
      where: { foodId: foodId, ...buildFoodRegionalWhere(region) },
    });

    // 只补全对应表中完全没有记录的 region，有记录则跳过（不做字段级补全）
    if (existing) return null;

    const missingFields = [
      'local_popularity',
      'price_min',
      'price_max',
      'currency_code',
      'price_unit',
      'availability',
      'month_weights',
      'seasonality_confidence',
      'regulatory_info',
    ];

    const prompt = `你正在为食品推荐系统补全 food_regional_info。请基于常识性食品知识、区域饮食习惯、零售可得性、季节性和法规常识做保守估算；不要假装有实时价格或官方统计。

食物信息：
- name: ${food.name}
- aliases: ${food.aliases ?? 'unknown'}
- category: ${food.category}
- sub_category: ${food.subCategory ?? 'unknown'}
- food_group: ${food.foodGroup ?? 'unknown'}
- food_form: ${food.foodForm ?? 'unknown'}
- primary_source: ${food.primarySource}

目标区域（由多语言补全 locale 映射而来，例如 en-US→US、ja-JP→JP）：
- raw_region: ${region}
- country_code: ${scope.countryCode}
- region_code: ${scope.regionCode ?? 'null'}
- city_code: ${scope.cityCode ?? 'null'}

补全原则：
1. 区域粒度要保守。若 city_code 缺少可靠常识，请按 region_code 或 country_code 的常见情况估算，并在 reasoning 说明。
2. 价格使用普通消费者常见零售价，不使用餐厅价、批发价、促销价或高端有机/进口专卖价，除非该食物通常只能这样购买。
3. price_min 和 price_max 必须是数字，price_min <= price_max；不确定价格时给宽区间并降低 confidence。
4. price_unit 只能用 per_kg、per_serving、per_piece。生鲜/散装优先 per_kg，成品菜/包装份量优先 per_serving，单个水果/鸡蛋等可用 per_piece。
5. currency_code 使用目标国家常用货币，例如 US=USD、CN=CNY、JP=JPY、KR=KRW、GB=GBP、EU 国家通常 EUR。
6. availability 只能是 year_round、seasonal、rare、limited、unknown：
   - year_round: 全年常见可买
   - seasonal: 明显季节性食材
   - rare: 当地少见但可通过特殊渠道获得
   - limited: 地区、渠道或法规限制明显
   - unknown: 缺乏可靠判断
7. month_weights 必须是长度 12 的数字数组，对应 1-12 月，范围 0-1。全年稳定食物用接近均衡的数组；季节性食物旺季高、淡季低。
8. local_popularity 表示该区域普通消费者对该食物的熟悉和常见程度，0-100。不要把“健康程度”当成人气。
9. regulatory_info 只放轻量信息，不做专业法律结论。未知则用空对象或低置信说明。
10. confidence 和 seasonality_confidence 均为 0-1。AI 推断没有明确来源时通常不要超过 0.75；城市级价格不确定时通常 0.35-0.6。
11. 不要返回 country_code、region_code、city_code、source 或 source_url；系统会负责地区键和 AI 来源标记。

字段要求：
- local_popularity: integer 0-100
- price_min: number
- price_max: number
- currency_code: string, ISO 4217
- price_unit: "per_kg" | "per_serving" | "per_piece"
- availability: "year_round" | "seasonal" | "rare" | "limited" | "unknown"
- month_weights: number[12]
- seasonality_confidence: number 0-1
- regulatory_info: object, 建议结构 {"labelingRequired": boolean|null, "allergenLabelRequired": boolean|null, "restrictedNotes": string|null}

只返回 JSON，不要 Markdown，不要额外解释：
{
  ${missingFields.map((f) => `"${f}": <value>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<用一句话说明估算依据、不确定性和区域粒度>"
}`;

    return this.callAI(food.name, prompt, missingFields as any, 'regional');
  }
}
