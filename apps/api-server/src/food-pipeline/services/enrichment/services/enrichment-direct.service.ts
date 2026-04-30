/**
 * EnrichmentDirectService
 *
 * direct_fields 模式补全：跳过 5 阶段流程，直接对指定字段发起一次性 AI 补全。
 * 拆分自 food-enrichment.service.ts。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { EnrichmentAiClient } from './ai-client.service';
import {
  snakeToCamel,
  type EnrichableField,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  AI_OVERRIDABLE_FIELDS,
} from '../constants/enrichable-fields';
import { type EnrichmentResult } from '../constants/enrichment.types';
import {
  ALL_COOKING_METHODS,
} from '../../../../modules/food/cooking-method.constants';
import { FIELD_DESC } from '../constants/field-descriptions';

// 这些常量用于 buildDirectFieldsPrompt 类型检查
const JSON_ARRAY_FIELDS_CONST = JSON_ARRAY_FIELDS as readonly string[];
const JSON_OBJECT_FIELDS_CONST = JSON_OBJECT_FIELDS as readonly string[];

@Injectable()
export class EnrichmentDirectService {
  private readonly logger = new Logger(EnrichmentDirectService.name);
  private readonly apiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly aiClient: EnrichmentAiClient,
  ) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
  }

  /**
   * 跳过 5 阶段流程，直接对指定 fields 发起一次性 AI 补全并写入。
   */
  async enrichFieldsDirect(
    foodId: string,
    fields: EnrichableField[],
  ): Promise<EnrichmentResult | null> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置');
      return null;
    }
    if (!fields || fields.length === 0) return null;

    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) {
      this.logger.warn(`enrichFieldsDirect: 食物 ${foodId} 不存在`);
      return null;
    }

    const systemPrompt = this.buildDirectFieldsSystemPrompt();
    const userPrompt = this.buildDirectFieldsPrompt(food, fields);
    // max_tokens：每字段约 80 token，基础 300，上限 2000
    const maxTokens = Math.min(2000, 300 + fields.length * 80);

    const result = await this.callAIForDirectFields(
      food.name,
      systemPrompt,
      userPrompt,
      fields,
      maxTokens,
    );
    if (!result) {
      this.logger.warn(
        `enrichFieldsDirect: AI 全部失败 foodId=${foodId}, fields=[${fields.join(',')}]`,
      );
    }
    return result;
  }

  /**
   * direct_fields 模式专属 System Prompt。
   */
  buildDirectFieldsSystemPrompt(): string {
    return `You are an expert food scientist and nutritionist with deep knowledge of international food composition databases:
- USDA FoodData Central (primary reference, https://fdc.nal.usda.gov)
- FAO/INFOODS International Food Composition Tables (global secondary reference)
- EUROFIR — European Food Information Resource (EU foods supplement)
- Codex Alimentarius international food standards (FAO/WHO)
- Monash University Low FODMAP Diet App (FODMAP classification authority)
- International Glycemic Index Database — University of Sydney (GI/GL authority)
- NOVA food processing classification system (Monteiro et al., Public Health Nutrition)

You are performing a targeted re-enrichment pass: the fields listed have been identified as missing, incorrect, or needing AI correction. Existing food data is provided as context — use it to produce internally consistent estimates.

Core principles (apply to ALL fields):
1. ALWAYS provide an estimated value — do NOT return null unless a field is physically impossible or genuinely inapplicable for this specific food type
2. Estimation from food composition science, macronutrient ratios, category averages, or similar food comparisons is expected and acceptable
3. For numeric fields: derive from USDA category data, Atwater factors, or known food science relationships
4. For array fields: return a non-empty array whenever any value applies; empty array [] only if truly none apply
5. For object fields: return a fully populated object with all expected keys present
6. All numeric values are per 100g edible portion (unless the field definition explicitly states otherwise)
7. Return strict JSON — only the requested fields plus confidence/field_confidence/reasoning
8. "reasoning" 必须用中文写，引用具体数据来源（如"参考 USDA SR Legacy #01234"、"基于同类食物均值估算"）`;
  }

  /**
   * direct_fields 模式专属 User Prompt。
   * 携带食物全量已有字段值作为上下文，并为每个目标字段注入 FIELD_DESC 详细规范。
   */
  buildDirectFieldsPrompt(food: any, fields: EnrichableField[]): string {
    // ── 1. 构建食物已有数据上下文 ────────────────────────────────────────
    const CTX_FIELDS: Array<[string, string, string?]> = [
      ['name', 'Name'],
      ['aliases', 'Aliases'],
      ['category', 'Category'],
      ['subCategory', 'Sub-category'],
      ['foodGroup', 'Food group'],
      ['foodForm', 'Food form'],
      ['isProcessed', 'Processed food'],
      ['cuisine', 'Cuisine'],
      ['mainIngredient', 'Main ingredient'],
      ['protein', 'Protein', 'g/100g'],
      ['fat', 'Fat', 'g/100g'],
      ['carbs', 'Carbs', 'g/100g'],
      ['fiber', 'Fiber', 'g/100g'],
      ['sugar', 'Sugar', 'g/100g'],
      ['sodium', 'Sodium', 'mg/100g'],
      ['calcium', 'Calcium', 'mg/100g'],
      ['iron', 'Iron', 'mg/100g'],
      ['potassium', 'Potassium', 'mg/100g'],
      ['cholesterol', 'Cholesterol', 'mg/100g'],
      ['saturatedFat', 'Saturated fat', 'g/100g'],
      ['transFat', 'Trans fat', 'g/100g'],
      ['waterContentPercent', 'Moisture', '%'],
      ['glycemicIndex', 'Glycemic index'],
      ['glycemicLoad', 'Glycemic load'],
      ['fodmapLevel', 'FODMAP level'],
      ['processingLevel', 'NOVA processing level'],
      ['qualityScore', 'Quality score'],
      ['satietyScore', 'Satiety score'],
      ['nutrientDensity', 'Nutrient density'],
      ['commonalityScore', 'Commonality score'],
      ['popularity', 'Popularity score'],
      ['standardServingDesc', 'Standard serving'],
    ];

    const targetSet = new Set<string>(fields.map((f) => snakeToCamel(f)));
    const knownParts: string[] = [];
    for (const [camel, label, unit] of CTX_FIELDS) {
      if (targetSet.has(camel)) continue;
      const val = food[camel];
      if (val == null) continue;
      knownParts.push(unit ? `${label}: ${val} ${unit}` : `${label}: ${val}`);
    }
    const jsonCtx: Array<[string, string]> = [
      ['mealTypes', 'Meal types'],
      ['allergens', 'Allergens'],
      ['tags', 'Diet tags'],
      ['cookingMethods', 'Cooking methods'],
      ['textureTags', 'Texture tags'],
    ];
    for (const [camel, label] of jsonCtx) {
      if (targetSet.has(camel)) continue;
      const val = food[camel];
      if (Array.isArray(val) && val.length > 0) {
        knownParts.push(`${label}: ${(val as string[]).join(', ')}`);
      }
    }

    const ctx =
      knownParts.length > 0
        ? knownParts.join('\n')
        : `Name: ${food.name}\nCategory: ${food.category}`;

    // ── 2. 字段详细规范（FIELD_DESC）────────────────────────────────────
    const fieldSpecs = fields
      .map((f) => {
        const desc = FIELD_DESC[snakeToCamel(f)];
        return desc ? `${f}:\n  ${desc}` : `${f}: (no description available)`;
      })
      .join('\n\n');

    // ── 3. 字段类型专属规则 ───────────────────────────────────────────────
    const fieldSet = new Set<string>(fields);
    const typeRules: string[] = [];

    const macros = ['protein', 'fat', 'carbs', 'fiber'] as const;
    const hasMacro = macros.some((m) => fieldSet.has(m));
    if (hasMacro) {
      typeRules.push(
        'Macronutrient closure: protein + fat + carbs + fiber + moisture ≈ 100g (±5g tolerance for ash/minor components)',
      );
    }
    if (fieldSet.has('glycemic_index') || fieldSet.has('glycemic_load')) {
      typeRules.push(
        'GL = (GI × available carbohydrate g per 100g) / 100; ensure this is internally consistent',
      );
      typeRules.push(
        'GI=0 and GL=0 for pure protein/fat foods (meat, eggs, oils, most cheeses)',
      );
    }
    if (fieldSet.has('aliases')) {
      typeRules.push(
        'aliases: comma-separated plain string — NO JSON, NO brackets; MUST include ≥3 entries; include native-script names for non-English foods',
      );
    }
    const arrayFields = fields.filter((f) =>
      JSON_ARRAY_FIELDS_CONST.includes(f),
    );
    if (arrayFields.length > 0) {
      typeRules.push(
        `Array fields (${arrayFields.join(', ')}): return non-empty arrays where any value applies; [] only if truly none apply`,
      );
    }
    const objectFields = fields.filter((f) =>
      JSON_OBJECT_FIELDS_CONST.includes(f),
    );
    if (objectFields.length > 0) {
      typeRules.push(
        `Object fields (${objectFields.join(', ')}): ALL expected keys must be present; do not omit any key`,
      );
    }
    if (fieldSet.has('allergens')) {
      typeRules.push(
        'allergens: use FDA Big-9 standard only (gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame); cross-contamination does NOT qualify',
      );
    }
    if (fieldSet.has('food_form')) {
      typeRules.push(
        'food_form: classify as the food is COMMONLY SOLD/SERVED to consumers, not the raw ingredient state',
      );
    }

    const rulesSection =
      typeRules.length > 0
        ? `\nField-type constraints:\n${typeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '';

    // ── 4. JSON schema 输出格式 ──────────────────────────────────────────
    const jsonSchema = `{\n  ${fields.map((f) => `"${f}": <value or null>`).join(',\n  ')},\n  "confidence": <0.0–1.0 overall>,\n  "field_confidence": {\n    ${fields.map((f) => `"${f}": <0.0–1.0>`).join(',\n    ')}\n  },\n  "reasoning": "<中文说明：数据来源 + 估算依据>"\n}`;

    return `Current food data (use as context):
${ctx}

Fields to estimate (${fields.length} fields):
${fieldSpecs}
${rulesSection}

Return JSON (no extra keys, no markdown):
${jsonSchema}`;
  }

  /**
   * direct_fields 专属 AI 调用，支持自定义 max_tokens 和专属 system prompt。
   */
  private async callAIForDirectFields(
    foodName: string,
    systemPrompt: string,
    userPrompt: string,
    requestedFields: readonly string[],
    maxTokens: number,
  ): Promise<EnrichmentResult | null> {
    const raw = await this.aiClient.callAIRaw(foodName, userPrompt, {
      systemPrompt,
      maxTokens,
    });
    if (!raw) return null;
    return this.aiClient.validateAndClean(raw, requestedFields, 'foods');
  }
}
