/**
 * EnrichmentStageService
 *
 * 拆分自 food-enrichment.service.ts（步骤 4）。
 * 职责：
 *  - enrichFoodByStage：5 阶段分阶段补全
 *  - buildStagePrompt / buildStageSpecificRules / buildStageSystemPrompt：Prompt 构造
 *  - fallbackFromCategory / getCategoryAverage：同类均值降级
 *  - validateCrossNutrient：宏量营养素交叉验证
 *  - persistFailedFields：失败字段持久化
 *  - markEnrichmentFailed：标记补全失败
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';
import { EnrichmentAiClient } from './ai-client.service';
import {
  EnrichmentCompletenessService,
  COMPLETENESS_SOURCE_FIELDS,
} from './enrichment-completeness.service';
import {
  snakeToCamel,
  camelToSnake,
  ENRICHABLE_FIELDS,
  type EnrichableField,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
} from '../constants/enrichable-fields';
import {
  type EnrichmentStage,
  ENRICHMENT_STAGES,
  type StageEnrichmentResult,
  type MultiStageEnrichmentResult,
} from '../constants/enrichment-stages';
import {
  NUTRIENT_RANGES,
} from '../constants/nutrient-ranges';
import { FIELD_DESC } from '../constants/field-descriptions';
import {
  type EnrichmentResult,
} from '../constants/enrichment.types';
import {
  getFieldSqlRef,
  getFoodSplitFromSql,
  buildPresentFieldSqlCondition,
} from '../helpers/enrichment-sql.helper';

@Injectable()
export class EnrichmentStageService {
  private readonly logger = new Logger(EnrichmentStageService.name);
  private readonly apiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly aiClient: EnrichmentAiClient,
    private readonly provenanceRepo: FoodProvenanceRepository,
    private readonly completenessService: EnrichmentCompletenessService,
  ) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
  }

  // ─── 辅助：成功来源检测 ────────────────────────────────────────────────

  async getSuccessSourcePresence(
    foodId: string,
    fields: string[],
  ): Promise<Record<string, boolean>> {
    const trackedFields = fields.filter((field) =>
      COMPLETENESS_SOURCE_FIELDS.has(field),
    );
    return this.provenanceRepo.hasSuccessfulSources(foodId, trackedFields);
  }

  // ─── V7.9: 分阶段补全（核心新增）────────────────────────────────────────

  /**
   * 分阶段补全单个食物：依次执行 5 个阶段
   * 每阶段独立 Prompt → 独立验证 → 独立入库
   * 前阶段补全结果作为后阶段上下文
   */
  async enrichFoodByStage(
    foodId: string,
    targetStages?: number[],
    /** V8.1: 仅补全这些字段（可选，与阶段字段取交集） */
    fieldFilter?: EnrichableField[],
  ): Promise<MultiStageEnrichmentResult | null> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置');
      return null;
    }

    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) {
      this.logger.warn(`食物 ${foodId} 不存在`);
      return null;
    }

    const stages = targetStages
      ? ENRICHMENT_STAGES.filter((s) => targetStages.includes(s.stage))
      : ENRICHMENT_STAGES;
    const successSourcePresence = await this.getSuccessSourcePresence(
      foodId,
      stages.flatMap((stage) => stage.fields as readonly string[]),
    );

    const stageResults: StageEnrichmentResult[] = [];
    // 累积已补全数据，供后续阶段作为上下文
    const accumulatedData: Record<string, any> = {};
    let totalEnriched = 0;
    let totalFailed = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const stage of stages) {
      // 过滤出该阶段实际缺失的字段
      // V8.1: 如果指定了 fieldFilter，仅保留 fieldFilter 中的字段
      const candidateFields = fieldFilter
        ? stage.fields.filter((f) => (fieldFilter as string[]).includes(f))
        : stage.fields;

      const missingFields = candidateFields.filter((field) => {
        // 先检查累积数据中是否已有
        if (
          accumulatedData[field] !== undefined &&
          accumulatedData[field] !== null
        )
          return false;
        // field 是 snake_case，Prisma 对象用 camelCase
        const value = (food as any)[snakeToCamel(field)];
        if (value === null || value === undefined) return true;
        // V8.0: 空数组视为缺失
        if (
          (JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
          Array.isArray(value) &&
          value.length === 0
        )
          return true;
        // V8.2: 空对象视为缺失（如 compatibility: {}）
        if (
          (JSON_OBJECT_FIELDS as readonly string[]).includes(field) &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0
        )
          return true;
        // V8.2: 默认值字段 — 检查 field_sources 判断是否被真正补全过
        if (COMPLETENESS_SOURCE_FIELDS.has(field)) {
          if (!successSourcePresence[field]) return true;
        }
        return false;
      });

      if (missingFields.length === 0) {
        stageResults.push({
          stage: stage.stage,
          stageName: stage.name,
          result: null,
          usedFallback: false,
          enrichedFields: [],
          failedFields: [],
        });
        continue;
      }

      this.logger.log(
        `[阶段${stage.stage}/${stage.name}] "${food.name}": 缺失 ${missingFields.join(', ')}`,
      );

      // 构造阶段专用 Prompt（包含前阶段已补全数据作为上下文）
      const prompt = this.buildStagePrompt(
        food,
        missingFields,
        stage,
        accumulatedData,
      );
      let result = await this.aiClient.callAIForStage(
        food.name,
        prompt,
        missingFields,
        stage,
        (s) => this.buildStageSystemPrompt(s),
      );

      let usedFallback = false;
      let fallbackSource: string | undefined;

      // AI 失败时尝试 fallback
      if (!result && stage.supportsFallback) {
        this.logger.log(
          `[阶段${stage.stage}] AI 失败，尝试同类食物均值 fallback`,
        );
        const fallbackResult = await this.fallbackFromCategory(
          food,
          missingFields,
        );
        if (fallbackResult) {
          result = fallbackResult.result;
          usedFallback = true;
          fallbackSource = fallbackResult.source;
        }
      }

      const enrichedFields: string[] = [];
      const failedFields: string[] = [];

      if (result) {
        // 阶段 1 完成后执行交叉验证
        if (stage.stage === 1) {
          this.validateCrossNutrient(food, result);
        }

        for (const field of missingFields) {
          if (result[field] !== null && result[field] !== undefined) {
            accumulatedData[field] = result[field];
            enrichedFields.push(field);
          } else {
            failedFields.push(field);
          }
        }

        // V8.2: null 字段智能重试 — 对 AI 返回 null 的字段进行一次定向重试
        if (
          failedFields.length > 0 &&
          failedFields.length <= missingFields.length * 0.7
        ) {
          // 仅在部分字段失败时重试（全部失败说明AI确实无法估算，不重试）
          this.logger.log(
            `[阶段${stage.stage}] ${failedFields.length} 个字段为null，尝试定向重试: ${failedFields.join(', ')}`,
          );
          const retryPrompt = this.buildStagePrompt(
            food,
            failedFields as EnrichableField[],
            stage,
            { ...accumulatedData }, // 传递包含本阶段已成功字段的上下文
          );
          const retryResult = await this.aiClient.callAIForStage(
            food.name,
            retryPrompt,
            failedFields,
            stage,
            (s) => this.buildStageSystemPrompt(s),
          );
          if (retryResult) {
            const retriedFields: string[] = [];
            for (const field of [...failedFields]) {
              if (
                retryResult[field] !== null &&
                retryResult[field] !== undefined
              ) {
                accumulatedData[field] = retryResult[field];
                // 将重试成功的字段从 failedFields 移到 enrichedFields
                const idx = failedFields.indexOf(field);
                if (idx !== -1) failedFields.splice(idx, 1);
                enrichedFields.push(field);
                // 合并到原始 result 中
                result[field] = retryResult[field];
                retriedFields.push(field);
              }
            }
            if (retriedFields.length > 0) {
              this.logger.log(
                `[阶段${stage.stage}] 重试成功恢复 ${retriedFields.length} 个字段: ${retriedFields.join(', ')}`,
              );
            }
          }
        }

        confidenceSum += result.confidence;
        confidenceCount++;
        totalEnriched += enrichedFields.length;
        totalFailed += failedFields.length;
      } else {
        failedFields.push(...missingFields);
        totalFailed += missingFields.length;
      }

      stageResults.push({
        stage: stage.stage,
        stageName: stage.name,
        result,
        usedFallback,
        fallbackSource,
        enrichedFields,
        failedFields,
      });
    }

    return {
      foodId,
      foodName: food.name,
      stages: stageResults,
      totalEnriched,
      totalFailed,
      overallConfidence:
        confidenceCount > 0
          ? Math.round((confidenceSum / confidenceCount) * 100) / 100
          : 0,
    };
  }

  // ─── V7.9/V8.2: 分阶段 Prompt 构造器 ─────────────────────────────────

  buildStagePrompt(
    food: any,
    missingFields: EnrichableField[],
    stage: EnrichmentStage,
    accumulatedData: Record<string, any>,
  ): string {
    // 构造已知数据上下文（原始数据 + 前阶段已补全数据）
    const knownParts = [
      `Name: ${food.name}`,
      food.aliases ? `Aliases: ${food.aliases}` : null,
      `Category: ${food.category}`,
      food.subCategory || accumulatedData.subCategory
        ? `Sub-category: ${food.subCategory || accumulatedData.subCategory}`
        : null,
      food.foodGroup || accumulatedData.foodGroup
        ? `Food group: ${food.foodGroup || accumulatedData.foodGroup}`
        : null,
    ];

    // V8.2: 动态传递前序阶段所有已补全数据（不再仅限硬编码10个营养素字段）
    // 按阶段顺序遍历，将所有已累积的数据作为上下文传递
    const CONTEXT_LABELS: Record<string, [string, string?]> = {
      // Stage 1 核心营养素
      calories: ['Calories', 'kcal/100g'],
      protein: ['Protein', 'g/100g'],
      fat: ['Fat', 'g/100g'],
      carbs: ['Carbs', 'g/100g'],
      fiber: ['Fiber', 'g/100g'],
      sugar: ['Sugar', 'g/100g'],
      sodium: ['Sodium', 'mg/100g'],
      // Stage 2 微量营养素
      calcium: ['Calcium', 'mg/100g'],
      iron: ['Iron', 'mg/100g'],
      potassium: ['Potassium', 'mg/100g'],
      cholesterol: ['Cholesterol', 'mg/100g'],
      vitaminA: ['Vitamin A', 'μg RAE/100g'],
      vitaminC: ['Vitamin C', 'mg/100g'],
      vitaminD: ['Vitamin D', 'μg/100g'],
      vitaminE: ['Vitamin E', 'mg/100g'],
      vitaminB12: ['Vitamin B12', 'μg/100g'],
      vitaminB6: ['Vitamin B6', 'mg/100g'],
      folate: ['Folate', 'μg DFE/100g'],
      zinc: ['Zinc', 'mg/100g'],
      magnesium: ['Magnesium', 'mg/100g'],
      saturatedFat: ['Saturated fat', 'g/100g'],
      transFat: ['Trans fat', 'g/100g'],
      purine: ['Purine', 'mg/100g'],
      phosphorus: ['Phosphorus', 'mg/100g'],
      addedSugar: ['Added sugar', 'g/100g'],
      naturalSugar: ['Natural sugar', 'g/100g'],
      omega3: ['Omega-3', 'mg/100g'],
      omega6: ['Omega-6', 'mg/100g'],
      solubleFiber: ['Soluble fiber', 'g/100g'],
      insolubleFiber: ['Insoluble fiber', 'g/100g'],
      waterContentPercent: ['Moisture', '%'],
      // Stage 3 健康属性
      glycemicIndex: ['Glycemic index'],
      glycemicLoad: ['Glycemic load'],
      fodmapLevel: ['FODMAP level'],
      oxalateLevel: ['Oxalate level'],
      processingLevel: ['NOVA processing level'],
      // Stage 3 补全后可作为 Stage 4/5 上下文
      allergens: ['Allergens'],
      tags: ['Diet tags'],
      // Stage 4 使用属性
      cuisine: ['Cuisine'],
      cookingMethods: ['Cooking methods'],
      mealTypes: ['Meal types'],
      dishType: ['Dish type'],
      mainIngredient: ['Main ingredient'],
      foodForm: ['Food form'],
      // Stage 4 补全后可作为 Stage 5 上下文
      qualityScore: ['Quality score'],
      satietyScore: ['Satiety score'],
      nutrientDensity: ['Nutrient density'],
      commonalityScore: ['Commonality score'],
      standardServingDesc: ['Standard serving'],
      flavorProfile: ['Flavor profile'],
      // V8.2 新增（Stage 5）
      requiredEquipment: ['Required equipment'],
    };

    // 遍历所有前序阶段累积的数据
    for (const [field, labelInfo] of Object.entries(CONTEXT_LABELS)) {
      // 跳过已在 knownParts 初始化中处理的字段
      if (['sub_category', 'food_group'].includes(field)) continue;

      // field 是 camelCase（来自 CONTEXT_LABELS），accumulatedData 用 snake_case key
      const snakeField = camelToSnake(field);
      const value = accumulatedData[snakeField] ?? food[field];
      if (value != null) {
        const [label, unit] = labelInfo;
        const displayValue = Array.isArray(value)
          ? value.join(', ')
          : value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        knownParts.push(
          unit
            ? `${label}: ${displayValue} ${unit}`
            : `${label}: ${displayValue}`,
        );
      }
    }

    // 其他原始食物属性（非累积）
    if (food.isProcessed != null)
      knownParts.push(`Processed food: ${food.isProcessed}`);

    const ctx = knownParts.filter(Boolean).join('\n');

    // 构造字段描述（阶段专用）
    const fieldsList = missingFields
      .map((f) => `- ${FIELD_DESC[snakeToCamel(f)] || f}`)
      .join('\n');

    // 阶段专属附加规则（在通用 Rules 之后注入，提升精度）
    const stageSpecificRules = this.buildStageSpecificRules(
      stage,
      missingFields,
    );

    return `Known food data:
${ctx}

Fields to estimate for [${stage.name}] stage (${missingFields.length} fields):
${fieldsList}

Rules:
1. All numeric values are per 100g edible portion
2. Primary reference: USDA FoodData Central; cross-reference FAO/INFOODS and EUROFIR where applicable
3. ALWAYS provide an estimated value — return null ONLY if a field is physically impossible or genuinely inapplicable for this specific food type
4. Estimation is expected: use food category averages, macronutrient composition science, or similar food comparisons
5. Per-field confidence in "field_confidence" (0.0-1.0): authoritative DB match ≥0.85, reasonable estimate 0.6-0.85, rough estimate 0.4-0.6
6. "confidence" is the overall stage confidence (0.0-1.0)
7. "reasoning" must cite the data source (e.g. "USDA SR Legacy #01234", "FAO/INFOODS ASIAFOODS", "category average [est]")
8. For array fields: return a non-empty array when any value applies; [] only when truly none apply
9. For object fields (flavor_profile, compatibility, common_portions): return a fully populated object with all expected keys
${stageSpecificRules}
Return JSON:
{
  ${missingFields.map((f) => `"${f}": <value or null>`).join(',\n  ')},
  "confidence": <0.0-1.0 overall>,
  "field_confidence": {
    ${missingFields.map((f) => `"${f}": <0.0-1.0>`).join(',\n    ')}
  },
  "reasoning": "<data source and estimation notes>"
}`;
  }

  // ─── 阶段专属追加规则（注入到用户 Prompt 的 Rules 末尾）────────────────

  buildStageSpecificRules(
    stage: EnrichmentStage,
    missingFields: EnrichableField[],
  ): string {
    const fields = new Set(missingFields);
    switch (stage.stage) {
      case 1:
        return `10. Macronutrient closure: protein + fat + carbs + fiber + moisture ≈ 100g (±5g tolerance for ash/minor components); adjust estimates accordingly
11. food_form decision: classify as the food is COMMONLY SOLD TO CONSUMERS — not raw ingredient state
12. sodium: 0 for fresh whole plant foods; estimate from salt content for processed/seasoned foods
`;
      case 2:
        return `10. Vitamin A must be reported as RAE (μg), not IU; β-carotene/12 = RAE contribution
11. Folate must be DFE (μg); for fortified foods apply folic acid ×1.7 conversion
12. Vitamin D ≈ 0 for all plant foods unless explicitly fortified; estimate from UV exposure for mushrooms
13. Omega-3 in plant foods = ALA only; in fatty fish = ALA+EPA+DHA sum; in lean fish/chicken ≈ 50-200mg
14. Trans fat = 0 for unprocessed plant foods; dairy/beef have small ruminant trans fat (~0.5-3g); partially hydrogenated oils 2-10g
15. water_content_percent cross-check: should be consistent with macronutrient sum (protein+fat+carbs+fiber+moisture ≈ 100g)
`;
      case 3: {
        const rules: string[] = [];
        if (fields.has('glycemic_index') || fields.has('glycemic_load')) {
          rules.push(
            '10. GI applies only to carbohydrate-containing foods; for pure protein/fat foods (meat, eggs, oils, most cheeses) set GI=0 and GL=0',
          );
          rules.push(
            '11. GL = (GI × carbs_per_100g) / 100; verify this calculation is internally consistent',
          );
        }
        if (fields.has('processing_level')) {
          rules.push(
            `${rules.length + 10}. NOVA level 1 must be a whole/unprocessed food; level 2 is a culinary ingredient (salt, oil, flour); level 3 uses preservation techniques; level 4 has ≥5 industrial additives or is heavily reformulated`,
          );
        }
        if (fields.has('allergens')) {
          rules.push(
            `${rules.length + 10}. allergens: only list allergens present AS INGREDIENTS — do not include cross-contamination risks`,
          );
        }
        return rules.map((r) => r + '\n').join('');
      }
      case 4: {
        const rules: string[] = [];
        if (fields.has('aliases')) {
          rules.push(
            '10. aliases: MUST include at least 3 entries; for non-English food names always include the original native-script name AND common English transliteration/translation',
          );
          rules.push(
            '11. aliases format: plain comma-separated string, NO JSON, NO brackets — just "name1, name2, name3"',
          );
        }
        if (fields.has('common_portions')) {
          rules.push(
            `${rules.length + 10}. common_portions: provide exactly 2-4 objects; first should be the most common serving; always include a gram-based option`,
          );
        }
        if (fields.has('flavor_profile')) {
          rules.push(
            `${rules.length + 10}. flavor_profile: ALL 6 keys required (sweet/salty/sour/spicy/bitter/umami); use 0 for absent dimensions, do not omit any key`,
          );
        }
        return rules.map((r) => r + '\n').join('');
      }
      case 5:
        return `10. ingredient_list: for single-ingredient whole foods, return single-element array; for dishes order by weight (largest first)
11. cooking_methods: first element = primary/recommended method; include ALL applicable methods; raw/uncooked foods must include "raw" if applicable
12. compatibility.good and compatibility.avoid: both keys required (can be empty arrays []); prefer specific food names over vague categories
13. shelf_life_days: use refrigerated shelf life for perishables; room temperature for shelf-stable; for cooked leftovers use 3-5 days
`;
      default:
        return '';
    }
  }

  // ─── 分阶段专属 System Prompt 构造器 ─────────────────────────────────

  buildStageSystemPrompt(stage: EnrichmentStage): string {
    const BASE = `You are an expert food scientist and nutritionist with deep knowledge of international food composition databases:
- USDA FoodData Central (primary reference, https://fdc.nal.usda.gov)
- FAO/INFOODS International Food Composition Tables (global secondary reference)
- EUROFIR — European Food Information Resource (EU foods supplement)
- Codex Alimentarius international food standards (FAO/WHO)
- Monash University Low FODMAP Diet App (FODMAP classification authority)
- International Glycemic Index Database — University of Sydney (GI/GL authority)
- NOVA food processing classification system (Monteiro et al., Public Health Nutrition)`;

    const CORE_RULES = `
Core principles (apply to ALL stages):
1. ALWAYS provide an estimated value — do NOT return null unless the field is physically impossible or genuinely inapplicable for this specific food type
2. Estimation from food composition science, macronutrient ratios, category averages, or similar food comparisons is expected and acceptable
3. For numeric fields: derive from USDA category data, Atwater factors, or known food science — null is a last resort only
4. For array fields: return a non-empty array whenever any value applies; empty array [] only if truly none apply
5. For object fields: return a fully populated object with all expected keys
6. All numeric values are per 100g edible portion (unless field explicitly states otherwise)
7. Return strict JSON — only the requested fields plus confidence/field_confidence/reasoning`;

    const stageGuides: Record<number, string> = {
      1: `
Stage 1 focus — Core Macronutrients & Food Form:
- Primary source: USDA FoodData Central SR Legacy or Foundation Foods entries
- Cross-reference: FAO/INFOODS LATINFOODS / ASIAFOODS for Asian foods
- Macronutrient closure check: protein + fat + carbs + fiber + moisture ≈ 100g (allow ±5g tolerance for ash/other)
- food_form is a classification decision: base it on the food AS COMMONLY SOLD/SERVED, not its raw ingredient state
- For processed/prepared foods, infer macros from standard recipe composition if direct data is unavailable`,

      2: `
Stage 2 focus — Micronutrients & Minor Components:
- Primary source: USDA FoodData Central (prefer SR Legacy > Foundation Foods > Survey FNDDS)
- Cross-reference: EUROFIR for European foods; FAO/INFOODS regional tables for Asian/African/Latin foods
- Vitamin A: report as Retinol Activity Equivalents (RAE, μg); β-carotene contribution = β-carotene(μg)/12
- Folate: report as Dietary Folate Equivalents (DFE, μg); synthetic folic acid × 1.7 = DFE
- Omega-3: sum ALA + EPA + DHA (mg); for plant foods ALA dominates; for fatty fish EPA+DHA dominate
- Trans fat: industrial trans fat near 0 for whole/unprocessed foods; ruminant sources (dairy, beef) have small amounts
- Purine: report total purine mg/100g; use available food-specific tables (Kaneko et al., or ADA guidelines)
- water_content_percent: cross-check moisture with macronutrient sum`,

      3: `
Stage 3 focus — Health Classification Attributes:
- Glycemic Index: use University of Sydney International GI Database (glycemicindex.com) as primary; estimate from food structure/processing if not listed; reference food = glucose (GI=100) or white bread (GI=70)
- Glycemic Load: GL = (GI × available carbohydrate g per 100g) / 100; report per 100g basis
- FODMAP: use Monash University Low FODMAP App data as authority; consider serving size context but report food's inherent FODMAP level
- Oxalate: <10mg/100g = low; 10–50mg/100g = medium; >50mg/100g = high; reference Harvard/MGH oxalate lists
- NOVA processing level: 1=unprocessed/minimally processed, 2=processed culinary ingredient, 3=processed food, 4=ultra-processed; cite specific NOVA criteria
- Allergens: use "Big-9" (US FDA) standard: gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame; add others only if widely recognized
- Tags: apply only clearly supported diet tags; do not over-tag`,

      4: `
Stage 4 focus — Usage, Classification & Identity Attributes:
- cuisine: assign based on the food's most prominent cultural origin; use "international" for globally ubiquitous foods
- aliases: this is a critical discoverability field — include English synonyms, regional variants, and native-script names for widely recognized non-English foods; target 3-8 aliases
- sub_category / food_group: use USDA food group taxonomy or FAO/INFOODS food group codes as reference
- common_portions: use standard international measurements (cups, tablespoons, ounces) AND metric equivalents; prefer USDA FNDDS standard portion sizes
- quality_score: base on nutrient density, processing level, and WHO/dietary guideline alignment
- satiety_score: use satiety index research (Holt et al. 1995) as reference; protein and fiber are primary drivers
- standard_serving_desc: use serving sizes consistent with USDA FNDDS or national dietary guidelines`,

      5: `
Stage 5 focus — Extended Culinary & Practical Attributes:
- ingredient_list: order by weight predominance (largest first); use standard food ingredient names; for whole/unprocessed foods list as single ingredient
- cooking_methods: list ALL applicable methods, not just the primary; first element should be the most common/recommended method
- compatibility: good pairings should reflect culinary tradition and nutritional complementarity; avoid pairings are foods that clash in flavor, texture, or create unhealthy combinations
- prep_time / cook_time: use realistic times for home cooking; reference standard recipe databases (e.g. Allrecipes, BBC Good Food averages)
- shelf_life_days: use FDA food safety guidelines / USDA storage recommendations as reference
- estimated_cost_level: consider global average market pricing (1=staple grain/common vegetable, 5=premium/specialty/imported)
- acquisition_difficulty: 1=available in any supermarket globally, 5=rare/highly seasonal/requires specialty import`,
    };

    return `${BASE}
${stageGuides[stage.stage] || ''}
${CORE_RULES}`;
  }

  // ─── V7.9: Fallback 降级机制（同类食物均值）───────────────────────────

  /**
   * 当 AI 补全失败时，从同 category + sub_category 的已有食物中取均值
   * 仅对数值型营养素字段生效，JSON/枚举字段不使用 fallback
   */
  async fallbackFromCategory(
    food: any,
    missingFields: EnrichableField[],
  ): Promise<{
    result: EnrichmentResult;
    source: string;
  } | null> {
    // 只对数值型字段做 fallback
    const numericFields = missingFields.filter(
      (f) => NUTRIENT_RANGES[snakeToCamel(f)] !== undefined,
    );
    if (numericFields.length === 0) return null;

    // 第一优先级：同 category + sub_category
    let source = `${food.category}/${food.subCategory}`;
    let avgResult = await this.getCategoryAverage(
      numericFields,
      food.category,
      food.subCategory,
    );

    // 第二优先级：仅同 category
    if (!avgResult && food.category) {
      source = food.category;
      avgResult = await this.getCategoryAverage(
        numericFields,
        food.category,
        null,
      );
    }

    if (!avgResult) return null;

    const result: EnrichmentResult = {
      ...avgResult,
      confidence: 0.45, // fallback 数据置信度固定为 0.45
      reasoning: `基于同类食物(${source})均值推算，非精确值`,
    };

    this.logger.log(
      `Fallback 成功: "${food.name}" 使用 ${source} 均值, 字段: ${Object.keys(avgResult).join(',')}`,
    );

    return { result, source: `category_avg:${source}` };
  }

  /**
   * 查询同类食物的字段均值
   */
  private async getCategoryAverage(
    fields: string[],
    category: string,
    subCategory: string | null,
  ): Promise<Record<string, number> | null> {
    if (!category) return null;

    // V8.0: 使用参数化查询，杜绝SQL注入（原 $queryRawUnsafe 存在二阶注入风险）
    const countResult = subCategory
      ? await this.prisma.$queryRaw<[{ count: string }]>(
          Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE category = ${category} AND sub_category = ${subCategory}`,
        )
      : await this.prisma.$queryRaw<[{ count: string }]>(
          Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE category = ${category}`,
        );
    const count = parseInt(countResult[0]?.count ?? '0', 10);
    if (count < 3) return null;

    // 字段名来自 ENRICHABLE_FIELDS 常量白名单，使用 Prisma.raw 安全构建列引用
    const validFields = fields.filter((f) =>
      ENRICHABLE_FIELDS.includes(f as any),
    );
    if (validFields.length === 0) return null;

    const selectParts = validFields
      .map((f) => `ROUND(AVG(${getFieldSqlRef(f)})::numeric, 2) AS "${f}"`)
      .join(', ');
    const notNullParts = validFields
      .map((f) => buildPresentFieldSqlCondition(f))
      .join(' AND ');

    const result = subCategory
      ? await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} ${Prisma.raw(getFoodSplitFromSql())} WHERE foods.category = ${category} AND foods.sub_category = ${subCategory} AND ${Prisma.raw(notNullParts)}`,
        )
      : await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} ${Prisma.raw(getFoodSplitFromSql())} WHERE foods.category = ${category} AND ${Prisma.raw(notNullParts)}`,
        );

    if (!result[0]) return null;

    const avgData: Record<string, number> = {};
    let hasValue = false;
    for (const field of validFields) {
      const val = result[0][field];
      if (val !== null && val !== undefined) {
        avgData[field] = parseFloat(val);
        hasValue = true;
      }
    }

    return hasValue ? avgData : null;
  }

  // ─── V7.9: 交叉验证增强（宏量营养素一致性修正）────────────────────────

  /**
   * 对阶段 1 补全结果执行宏量营养素交叉验证
   * 如果计算热量与实际热量偏差 > 25%，尝试自动修正
   */
  validateCrossNutrient(food: any, result: EnrichmentResult): void {
    const protein = result.protein ?? (food.protein as number | null);
    const fat = result.fat ?? (food.fat as number | null);
    const carbs = result.carbs ?? (food.carbs as number | null);
    const fiber = result.fiber ?? (food.fiber as number | null) ?? 0;
    const calories = food.calories as number | null;

    if (
      protein == null ||
      fat == null ||
      carbs == null ||
      calories == null ||
      calories === 0
    )
      return;

    const expectedCal = protein * 4 + carbs * 4 + fat * 9 + fiber * 2;
    const errorRate = Math.abs(calories - expectedCal) / calories;

    if (errorRate <= 0.25) return;

    this.logger.warn(
      `交叉验证: "${food.name}" 误差 ${(errorRate * 100).toFixed(1)}%, ` +
        `实际=${calories}kcal, 推算=${Math.round(expectedCal)}kcal`,
    );

    // 根据数据来源决定修正方向
    const isCaloriesAuthoritative =
      food.primarySource === 'usda' ||
      food.primarySource === 'cn_food_composition';

    if (isCaloriesAuthoritative) {
      // 热量来自权威来源 → 按比例微调 AI 补全的宏量营养素
      const ratio = calories / expectedCal;
      if (result.protein != null)
        result.protein = Math.round(result.protein * ratio * 10) / 10;
      if (result.fat != null)
        result.fat = Math.round(result.fat * ratio * 10) / 10;
      if (result.carbs != null)
        result.carbs = Math.round(result.carbs * ratio * 10) / 10;
      result.reasoning =
        (result.reasoning || '') +
        ` [交叉验证: 按权威热量${calories}kcal校准宏量营养素]`;
    }
    // 如果热量来自 AI，不修正——后续由 FoodDataCleaner 处理
  }

  // ─── V8.2: 失败字段持久化（迁移到 food_field_provenance 表） ──────────

  /**
   * 将补全失败的字段记录到 food_field_provenance 表（status='failed'）
   */
  async persistFailedFields(
    foodId: string,
    failedFields: string[],
    stageResults: StageEnrichmentResult[],
  ): Promise<void> {
    if (failedFields.length === 0) return;
    const PROVENANCE_SOURCE = 'ai_enrichment';

    for (const field of failedFields) {
      const stageResult = stageResults.find((sr) =>
        sr.failedFields.includes(field),
      );

      let reason: string;
      let reasonCode: string;
      if (!stageResult?.result && !stageResult?.usedFallback) {
        reason = 'AI调用失败（网络/解析错误）';
        reasonCode = 'ai_call_failed';
      } else if (!stageResult?.result && stageResult?.usedFallback) {
        reason = 'AI和Fallback均失败';
        reasonCode = 'all_sources_failed';
      } else if (stageResult?.result) {
        reason = 'AI无法估算（返回null）';
        reasonCode = 'ai_returned_null';
      } else {
        reason = '未知原因';
        reasonCode = 'unknown';
      }

      // 累加 attempts、保留 firstAttempt（V8.2 收口到 FoodProvenanceRepository）
      await this.provenanceRepo.recordFailureWithAttempts({
        foodId,
        fieldName: field,
        source: PROVENANCE_SOURCE,
        reason,
        extra: {
          reasonCode,
          stage: stageResult?.stage ?? null,
          stageName: stageResult?.stageName ?? null,
        },
      });
    }

    this.logger.log(
      `Persisted ${failedFields.length} failed fields for food ${foodId}: [${failedFields.join(', ')}]`,
    );
  }

  // ─── V8.3: 标记食物补全失败 ─────────────────────────────────────────────

  /**
   * 将食物的 enrichment_status 标记为 'failed'
   * 由 Processor onFailed 在最终失败时调用
   */
  async markEnrichmentFailed(foodId: string, errorMsg?: string): Promise<void> {
    await this.prisma.food.update({
      where: { id: foodId },
      data: {
        enrichmentStatus: 'failed',
        lastEnrichedAt: new Date(),
      },
    });
    this.logger.warn(
      `[markEnrichmentFailed] foodId=${foodId}, error=${errorMsg ?? 'unknown'}`,
    );
  }

  // ─── 委托：完整度评分 ────────────────────────────────────────────────

  computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean> = {},
  ) {
    return this.completenessService.computeCompletenessScore(
      food,
      successSourcePresence,
    );
  }
}
