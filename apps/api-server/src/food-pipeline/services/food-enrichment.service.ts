/**
 * V7.9 Food Enrichment Service
 *
 * 使用 DeepSeek AI 对 foods 及其关联表中缺失字段进行补全。
 *
 * ── 核心约束 ──
 *  1. 只补全 null / undefined / 空数组 字段，不覆盖已有数据
 *  2. 支持 staging 模式：AI 结果先写入 food_change_logs (action=ai_enrichment_staged)
 *     人工审核后通过 approveStaged / rejectStaged 决定是否落库
 *  3. 直接入库模式：AI 结果直接写入 foods（action=ai_enrichment）
 *  4. 支持关联表补全：food_translations（翻译补全）、food_regional_info（地区信息）
 *  5. 所有补全必须携带 confidence，低于阈值自动进入 staged 等待人工确认
 *
 * ── V7.9 新增能力 ──
 *  6. 分阶段补全（4阶段）：核心营养素 → 微量营养素 → 健康属性 → 使用属性
 *  7. 每阶段独立 Prompt、独立验证、独立入库，前阶段结果作为后阶段上下文
 *  8. Fallback 降级机制：AI 失败时使用同类食物均值 / 规则推断
 *  9. 交叉验证增强：宏量营养素一致性自动修正
 * 10. 数据完整度评分：per food 加权计算
 * 11. scanMissingFields 单次 SQL 聚合优化
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  ENRICHMENT_FIELD_LABELS,
  ENRICHMENT_FIELD_UNITS,
} from '../../modules/food/food.types';

// ─── 可补全字段定义（foods 主表）───────────────────────────────────────────

export const ENRICHABLE_FIELDS = [
  // 营养素（per 100g）
  'protein',
  'fat',
  'carbs',
  'fiber',
  'sugar',
  'added_sugar',
  'natural_sugar',
  'sodium',
  'calcium',
  'iron',
  'potassium',
  'cholesterol',
  'vitamin_a',
  'vitamin_c',
  'vitamin_d',
  'vitamin_e',
  'vitamin_b12',
  'folate',
  'zinc',
  'magnesium',
  'saturated_fat',
  'trans_fat',
  'purine',
  'phosphorus',
  // 属性
  'sub_category',
  'food_group',
  'cuisine',
  'cooking_method',
  'glycemic_index',
  'glycemic_load',
  'fodmap_level',
  'oxalate_level',
  'processing_level',
  // JSON 数组/对象
  'meal_types',
  'allergens',
  'tags',
  'common_portions',
  // 评分
  'quality_score',
  'satiety_score',
  'nutrient_density',
  'commonality_score',
  // 描述
  'standard_serving_desc',
  'main_ingredient',
  'flavor_profile',
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

// 关联表补全目标
export type EnrichmentTarget = 'foods' | 'translations' | 'regional';

// ─── V7.9: 分阶段补全定义 ─────────────────────────────────────────────────

/**
 * 4 阶段补全分组：每阶段独立 Prompt、独立验证、独立入库
 * 前阶段补全结果作为后阶段的输入上下文，逐步提高数据精度
 */
export interface EnrichmentStage {
  /** 阶段编号 1-4 */
  stage: number;
  /** 阶段名称 */
  name: string;
  /** 该阶段负责补全的字段 */
  fields: EnrichableField[];
  /** AI max_tokens 限制 */
  maxTokens: number;
  /** 该阶段是否支持 fallback（同类食物均值降级） */
  supportsFallback: boolean;
}

export const ENRICHMENT_STAGES: EnrichmentStage[] = [
  {
    stage: 1,
    name: '核心营养素',
    fields: ['protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium'],
    maxTokens: 400,
    supportsFallback: true,
  },
  {
    stage: 2,
    name: '微量营养素',
    fields: [
      'calcium',
      'iron',
      'potassium',
      'cholesterol',
      'vitamin_a',
      'vitamin_c',
      'vitamin_d',
      'vitamin_e',
      'vitamin_b12',
      'folate',
      'zinc',
      'magnesium',
      'saturated_fat',
      'trans_fat',
      'purine',
      'phosphorus',
      'added_sugar',
      'natural_sugar',
    ],
    maxTokens: 600,
    supportsFallback: true,
  },
  {
    stage: 3,
    name: '健康属性',
    fields: [
      'glycemic_index',
      'glycemic_load',
      'fodmap_level',
      'oxalate_level',
      'processing_level',
      'allergens',
      'tags',
    ],
    maxTokens: 500,
    supportsFallback: false,
  },
  {
    stage: 4,
    name: '使用属性',
    fields: [
      'meal_types',
      'common_portions',
      'flavor_profile',
      'cuisine',
      'cooking_method',
      'sub_category',
      'food_group',
      'main_ingredient',
      'standard_serving_desc',
      'quality_score',
      'satiety_score',
      'nutrient_density',
      'commonality_score',
    ],
    maxTokens: 800,
    supportsFallback: false,
  },
];

// ─── V7.9: 分阶段补全结果 ────────────────────────────────────────────────

export interface StageEnrichmentResult {
  stage: number;
  stageName: string;
  result: EnrichmentResult | null;
  /** 是否使用了 fallback（同类均值） */
  usedFallback: boolean;
  /** fallback 来源说明 */
  fallbackSource?: string;
  /** 补全成功的字段 */
  enrichedFields: string[];
  /** 补全失败的字段 */
  failedFields: string[];
}

export interface MultiStageEnrichmentResult {
  foodId: string;
  foodName: string;
  stages: StageEnrichmentResult[];
  /** 总补全字段数 */
  totalEnriched: number;
  /** 总失败字段数 */
  totalFailed: number;
  /** 综合置信度（各阶段加权平均） */
  overallConfidence: number;
}

// ─── V7.9: 数据完整度评分 ────────────────────────────────────────────────

export interface CompletenessScore {
  /** 总分 0-100 */
  score: number;
  /** 核心营养素完整度 (权重 0.40) */
  coreNutrients: number;
  /** 微量营养素完整度 (权重 0.25) */
  microNutrients: number;
  /** 健康属性完整度 (权重 0.20) */
  healthAttributes: number;
  /** 使用属性完整度 (权重 0.15) */
  usageAttributes: number;
  /** 缺失的关键字段 */
  missingCritical: string[];
}

// ─── V7.9: 补全进度统计 ──────────────────────────────────────────────────

export interface EnrichmentProgress {
  /** 总食物数 */
  totalFoods: number;
  /** 已完整补全的食物数 (completeness >= 80%) */
  fullyEnriched: number;
  /** 部分补全的食物数 (40% <= completeness < 80%) */
  partiallyEnriched: number;
  /** 未补全的食物数 (completeness < 40%) */
  notEnriched: number;
  /** 全库平均完整度 */
  avgCompleteness: number;
  /** 按阶段的补全覆盖率 */
  stagesCoverage: Array<{
    stage: number;
    name: string;
    /** 该阶段所有字段均非 NULL 的食物占比 */
    coverageRate: number;
  }>;
}

// ─── 营养素合理范围（per 100g）────────────────────────────────────────────

export const NUTRIENT_RANGES: Record<string, { min: number; max: number }> = {
  protein: { min: 0, max: 100 },
  fat: { min: 0, max: 100 },
  carbs: { min: 0, max: 100 },
  fiber: { min: 0, max: 80 },
  sugar: { min: 0, max: 100 },
  added_sugar: { min: 0, max: 100 },
  natural_sugar: { min: 0, max: 100 },
  sodium: { min: 0, max: 50000 },
  calcium: { min: 0, max: 2000 },
  iron: { min: 0, max: 100 },
  potassium: { min: 0, max: 10000 },
  cholesterol: { min: 0, max: 2000 },
  vitamin_a: { min: 0, max: 50000 },
  vitamin_c: { min: 0, max: 2000 },
  vitamin_d: { min: 0, max: 1000 },
  vitamin_e: { min: 0, max: 500 },
  vitamin_b12: { min: 0, max: 100 },
  folate: { min: 0, max: 5000 },
  zinc: { min: 0, max: 100 },
  magnesium: { min: 0, max: 1000 },
  saturated_fat: { min: 0, max: 100 },
  trans_fat: { min: 0, max: 10 },
  purine: { min: 0, max: 2000 },
  phosphorus: { min: 0, max: 2000 },
  glycemic_index: { min: 0, max: 100 },
  glycemic_load: { min: 0, max: 50 },
  quality_score: { min: 0, max: 10 },
  satiety_score: { min: 0, max: 10 },
  nutrient_density: { min: 0, max: 100 },
  commonality_score: { min: 0, max: 100 },
  processing_level: { min: 1, max: 4 },
};

// ─── 字段描述映射（用于 Prompt 构造）─────────────────────────────────────

export const FIELD_DESC: Record<string, string> = {
  protein: 'protein (g/100g, 0-100)',
  fat: 'fat (g/100g, 0-100)',
  carbs: 'carbs (g/100g, 0-100)',
  fiber: 'fiber (g/100g, 0-80)',
  sugar: 'sugar (g/100g, 0-100)',
  added_sugar: 'added_sugar (g/100g, 0-100)',
  natural_sugar: 'natural_sugar (g/100g, 0-100)',
  sodium: 'sodium (mg/100g, 0-50000)',
  calcium: 'calcium (mg/100g, 0-2000)',
  iron: 'iron (mg/100g, 0-100)',
  potassium: 'potassium (mg/100g, 0-10000)',
  cholesterol: 'cholesterol (mg/100g, 0-2000)',
  vitamin_a: 'vitamin_a (μg RAE/100g, 0-50000)',
  vitamin_c: 'vitamin_c (mg/100g, 0-2000)',
  vitamin_d: 'vitamin_d (μg/100g, 0-1000)',
  vitamin_e: 'vitamin_e (mg/100g, 0-500)',
  vitamin_b12: 'vitamin_b12 (μg/100g, 0-100)',
  folate: 'folate (μg DFE/100g, 0-5000)',
  zinc: 'zinc (mg/100g, 0-100)',
  magnesium: 'magnesium (mg/100g, 0-1000)',
  saturated_fat: 'saturated_fat (g/100g, 0-100)',
  trans_fat: 'trans_fat (g/100g, 0-10)',
  purine: 'purine (mg/100g, 0-2000)',
  phosphorus: 'phosphorus (mg/100g, 0-2000)',
  glycemic_index: 'glycemic_index 整数 0-100',
  glycemic_load: 'glycemic_load 0-50',
  fodmap_level: 'fodmap_level: low/medium/high',
  oxalate_level: 'oxalate_level: low/medium/high',
  processing_level: 'processing_level 整数 1-4 (1=自然,4=超加工)',
  sub_category: 'sub_category 英文编码如 lean_meat/whole_grain/leafy_green',
  food_group: 'food_group 英文编码如 meat/fish/grain/vegetable/fruit',
  cuisine: 'cuisine 英文编码如 chinese/western/japanese/korean',
  cooking_method:
    'cooking_method: raw/boiled/steamed/fried/roasted/grilled/stewed',
  meal_types: 'meal_types 数组，选自 breakfast/lunch/dinner/snack',
  allergens:
    'allergens 数组，选自 gluten/dairy/nuts/soy/egg/shellfish/fish/wheat',
  tags: 'tags 数组，选自 high_protein/low_fat/low_carb/high_fiber/low_calorie/low_sodium/vegan/vegetarian/gluten_free',
  common_portions: 'common_portions JSON数组，如 [{"name":"1碗","grams":200}]',
  quality_score: 'quality_score 0-10综合品质',
  satiety_score: 'satiety_score 0-10饱腹感',
  nutrient_density: 'nutrient_density 0-100营养密度',
  commonality_score: 'commonality_score 0-100大众化程度',
  standard_serving_desc: 'standard_serving_desc 标准份量描述如"1碗(200g)"',
  main_ingredient: 'main_ingredient 主要原料如 rice/chicken',
  flavor_profile:
    'flavor_profile JSON如 {"sweet":3,"salty":5,"sour":1,"spicy":0,"bitter":1}',
};

// ─── 低置信度阈值：低于此值强制进入 staging ───────────────────────────────

const CONFIDENCE_STAGING_THRESHOLD = 0.7;

// ─── AI 补全结果结构（主表）────────────────────────────────────────────────

export interface EnrichmentResult {
  [key: string]: any;
  confidence: number;
  reasoning?: string;
}

// ─── 缺失字段统计 ─────────────────────────────────────────────────────────

export interface MissingFieldStats {
  total: number;
  fields: Record<EnrichableField, number>;
  translationsMissing: number;
  regionalMissing: number;
}

// ─── 单个补全任务 ─────────────────────────────────────────────────────────

export interface EnrichmentJobData {
  foodId: string;
  fields?: EnrichableField[];
  target?: EnrichmentTarget;
  /** 是否 staging 模式（先暂存，不直接落库）*/
  staged?: boolean;
  /** 目标语言（translations 补全时使用）*/
  locale?: string;
  /** 目标地区（regional 补全时使用）*/
  region?: string;
  /** V7.9: 分阶段补全模式，指定阶段编号 1-4 */
  stages?: number[];
}

// ─── Staging 记录（从 food_change_logs 读取）──────────────────────────────

export interface StagedEnrichment {
  id: string;
  foodId: string;
  foodName?: string;
  action: string;
  changes: Record<string, any>;
  reason: string | null;
  operator: string | null;
  version: number;
  createdAt: Date;
}

@Injectable()
export class FoodEnrichmentService {
  private readonly logger = new Logger(FoodEnrichmentService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly maxRetries = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    });
  }

  // ─── V7.9: 分阶段补全（核心新增）────────────────────────────────────────

  /**
   * 分阶段补全单个食物：依次执行 4 个阶段
   * 每阶段独立 Prompt → 独立验证 → 独立入库
   * 前阶段补全结果作为后阶段上下文
   */
  async enrichFoodByStage(
    foodId: string,
    targetStages?: number[],
  ): Promise<MultiStageEnrichmentResult | null> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置');
      return null;
    }

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) {
      this.logger.warn(`食物 ${foodId} 不存在`);
      return null;
    }

    const stages = targetStages
      ? ENRICHMENT_STAGES.filter((s) => targetStages.includes(s.stage))
      : ENRICHMENT_STAGES;

    const stageResults: StageEnrichmentResult[] = [];
    // 累积已补全数据，供后续阶段作为上下文
    const accumulatedData: Record<string, any> = {};
    let totalEnriched = 0;
    let totalFailed = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const stage of stages) {
      const jsonArrayFields = [
        'meal_types',
        'allergens',
        'tags',
        'common_portions',
      ];

      // 过滤出该阶段实际缺失的字段
      const missingFields = stage.fields.filter((field) => {
        // 先检查累积数据中是否已有
        if (
          accumulatedData[field] !== undefined &&
          accumulatedData[field] !== null
        )
          return false;
        const value = (food as any)[field];
        if (value === null || value === undefined) return true;
        if (
          jsonArrayFields.includes(field) &&
          Array.isArray(value) &&
          value.length === 0
        )
          return true;
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
      let result = await this.callAIForStage(
        food.name,
        prompt,
        missingFields,
        stage,
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

  // ─── V7.9: 分阶段 Prompt 构造器 ───────────────────────────────────────

  private buildStagePrompt(
    food: any,
    missingFields: EnrichableField[],
    stage: EnrichmentStage,
    accumulatedData: Record<string, any>,
  ): string {
    // 构造已知数据上下文（原始数据 + 前阶段已补全数据）
    const knownParts = [
      `名称: ${food.name}`,
      food.aliases ? `别名: ${food.aliases}` : null,
      `分类: ${food.category}`,
      food.sub_category || accumulatedData.sub_category
        ? `二级分类: ${food.sub_category || accumulatedData.sub_category}`
        : null,
      food.food_group || accumulatedData.food_group
        ? `食物组: ${food.food_group || accumulatedData.food_group}`
        : null,
    ];

    // 添加营养素上下文（原始+累积）
    const nutrientContext: [string, string, string][] = [
      ['calories', '热量', 'kcal/100g'],
      ['protein', '蛋白质', 'g/100g'],
      ['fat', '脂肪', 'g/100g'],
      ['carbs', '碳水化合物', 'g/100g'],
      ['fiber', '膳食纤维', 'g/100g'],
      ['sugar', '糖', 'g/100g'],
      ['sodium', '钠', 'mg/100g'],
      ['calcium', '钙', 'mg/100g'],
      ['iron', '铁', 'mg/100g'],
      ['potassium', '钾', 'mg/100g'],
    ];

    for (const [field, label, unit] of nutrientContext) {
      const value = accumulatedData[field] ?? (food as any)[field];
      if (value != null) {
        knownParts.push(`${label}: ${value} ${unit}`);
      }
    }

    // 其他已知属性
    if (food.cuisine || accumulatedData.cuisine)
      knownParts.push(`菜系: ${food.cuisine || accumulatedData.cuisine}`);
    if (food.cooking_method || accumulatedData.cooking_method)
      knownParts.push(
        `烹饪方式: ${food.cooking_method || accumulatedData.cooking_method}`,
      );
    if (food.is_processed != null)
      knownParts.push(`是否加工食品: ${food.is_processed}`);
    if (food.food_form) knownParts.push(`食物形态: ${food.food_form}`);

    const ctx = knownParts.filter(Boolean).join('\n');

    // 构造字段描述（阶段专用，更精简）
    const fieldsList = missingFields
      .map((f) => `- ${FIELD_DESC[f] || f}`)
      .join('\n');

    return `已知食物数据：
${ctx}

本次需要估算【${stage.name}】相关的 ${missingFields.length} 个字段：
${fieldsList}

要求：
1. 数值基于每100g计算
2. 无法确定的字段返回 null
3. 只返回请求的字段，不要多余字段

返回JSON：
{
  ${missingFields.map((f) => `"${f}": <value or null>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<简短说明本次估算依据>"
}`;
  }

  // ─── V7.9: 分阶段 AI 调用（使用阶段专属 max_tokens）─────────────────

  private async callAIForStage(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    stage: EnrichmentStage,
  ): Promise<EnrichmentResult | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `你是权威食品营养数据库专家。当前任务：补全食物的【${stage.name}】数据。严格按JSON格式返回，数值基于每100g计算。只返回请求的字段。`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: stage.maxTokens,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const raw = JSON.parse(content) as Record<string, any>;
        const validated = this.validateAndClean(raw, requestedFields, 'foods');
        if (validated) return validated;

        this.logger.warn(
          `[阶段${stage.stage}] 第${attempt}次验证失败: "${foodName}"`,
        );
      } catch (e) {
        this.logger.warn(
          `[阶段${stage.stage}] 第${attempt}次调用失败: "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries)
          await this.sleep(this.exponentialBackoff(attempt));
      }
    }

    this.logger.error(`[阶段${stage.stage}] AI 全部失败: "${foodName}"`);
    return null;
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
      (f) => NUTRIENT_RANGES[f] !== undefined,
    );
    if (numericFields.length === 0) return null;

    // 第一优先级：同 category + sub_category
    let source = `${food.category}/${food.sub_category}`;
    let avgResult = await this.getCategoryAverage(
      numericFields,
      food.category,
      food.sub_category,
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
      .map((f) => `ROUND(AVG("${f}")::numeric, 2) AS "${f}"`)
      .join(', ');
    const notNullParts = validFields
      .map((f) => `"${f}" IS NOT NULL`)
      .join(' AND ');

    const result = subCategory
      ? await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} FROM foods WHERE category = ${category} AND sub_category = ${subCategory} AND ${Prisma.raw(notNullParts)}`,
        )
      : await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} FROM foods WHERE category = ${category} AND ${Prisma.raw(notNullParts)}`,
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
  private validateCrossNutrient(food: any, result: EnrichmentResult): void {
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
      food.primary_source === 'usda' ||
      food.primary_source === 'cn_food_composition';

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

  // ─── V7.9: 数据完整度评分 ─────────────────────────────────────────────

  /**
   * 计算单个食物的数据完整度评分
   * 加权计算：核心营养素(0.40) + 微量营养素(0.25) + 健康属性(0.20) + 使用属性(0.15)
   */
  computeCompletenessScore(food: any): CompletenessScore {
    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const jsonObjectFields = ['flavor_profile'];

    const isFieldFilled = (field: string): boolean => {
      const value = food[field];
      if (value === null || value === undefined) return false;
      if (jsonArrayFields.includes(field))
        return Array.isArray(value) && value.length > 0;
      if (jsonObjectFields.includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      return true;
    };

    const computeGroupScore = (fields: string[]): number => {
      if (fields.length === 0) return 0;
      const filled = fields.filter(isFieldFilled).length;
      return filled / fields.length;
    };

    const coreFields = ENRICHMENT_STAGES[0].fields;
    const microFields = ENRICHMENT_STAGES[1].fields;
    const healthFields = ENRICHMENT_STAGES[2].fields;
    const usageFields = ENRICHMENT_STAGES[3].fields;

    const coreNutrients = computeGroupScore(coreFields as unknown as string[]);
    const microNutrients = computeGroupScore(
      microFields as unknown as string[],
    );
    const healthAttributes = computeGroupScore(
      healthFields as unknown as string[],
    );
    const usageAttributes = computeGroupScore(
      usageFields as unknown as string[],
    );

    const score = Math.round(
      (coreNutrients * 0.4 +
        microNutrients * 0.25 +
        healthAttributes * 0.2 +
        usageAttributes * 0.15) *
        100,
    );

    // 找出缺失的关键字段（核心营养素中缺失的）
    const missingCritical = (coreFields as unknown as string[]).filter(
      (f) => !isFieldFilled(f),
    );

    return {
      score,
      coreNutrients: Math.round(coreNutrients * 100),
      microNutrients: Math.round(microNutrients * 100),
      healthAttributes: Math.round(healthAttributes * 100),
      usageAttributes: Math.round(usageAttributes * 100),
      missingCritical,
    };
  }

  // ─── V7.9: 补全进度统计 ───────────────────────────────────────────────

  /**
   * 获取全库补全进度统计
   */
  async getEnrichmentProgress(): Promise<EnrichmentProgress> {
    const totalFoods = await this.prisma.foods.count();
    if (totalFoods === 0) {
      return {
        totalFoods: 0,
        fullyEnriched: 0,
        partiallyEnriched: 0,
        notEnriched: 0,
        avgCompleteness: 0,
        stagesCoverage: ENRICHMENT_STAGES.map((s) => ({
          stage: s.stage,
          name: s.name,
          coverageRate: 0,
        })),
      };
    }

    // V8.0: 按阶段计算覆盖率（字段名来自 ENRICHMENT_STAGES 常量白名单，Prisma.raw 安全构建）
    const stagesCoverage: EnrichmentProgress['stagesCoverage'] = [];
    for (const stage of ENRICHMENT_STAGES) {
      const jsonArrayFields = [
        'meal_types',
        'allergens',
        'tags',
        'common_portions',
      ];
      const conditions = stage.fields.map((f) =>
        jsonArrayFields.includes(f)
          ? `("${f}" IS NOT NULL AND "${f}"::text != '[]')`
          : `"${f}" IS NOT NULL`,
      );
      const allFilledCondition = conditions.join(' AND ');
      const countResult = await this.prisma.$queryRaw<[{ count: string }]>(
        Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE ${Prisma.raw(allFilledCondition)}`,
      );
      const count = parseInt(countResult[0]?.count ?? '0', 10);
      stagesCoverage.push({
        stage: stage.stage,
        name: stage.name,
        coverageRate: Math.round((count / totalFoods) * 100),
      });
    }

    // V8.0: 计算整体完整度分布（字段名来自常量白名单）
    const coreFields = ENRICHMENT_STAGES[0].fields;
    const coreConditions = coreFields
      .map((f) => `CASE WHEN "${f}" IS NOT NULL THEN 1 ELSE 0 END`)
      .join(' + ');
    const coreTotal = coreFields.length;

    const distResult = await this.prisma.$queryRaw<
      Array<{ completeness: string; count: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN (${Prisma.raw(coreConditions)})::float / ${coreTotal} >= 0.8 THEN 'full'
          WHEN (${Prisma.raw(coreConditions)})::float / ${coreTotal} >= 0.4 THEN 'partial'
          ELSE 'none'
        END AS completeness,
        COUNT(*)::text AS count
      FROM foods GROUP BY 1`,
    );

    let fullyEnriched = 0;
    let partiallyEnriched = 0;
    let notEnriched = 0;
    for (const row of distResult) {
      const c = parseInt(row.count, 10);
      if (row.completeness === 'full') fullyEnriched = c;
      else if (row.completeness === 'partial') partiallyEnriched = c;
      else notEnriched = c;
    }

    return {
      totalFoods,
      fullyEnriched,
      partiallyEnriched,
      notEnriched,
      avgCompleteness:
        stagesCoverage.length > 0
          ? Math.round(
              stagesCoverage.reduce((s, c) => s + c.coverageRate, 0) /
                stagesCoverage.length,
            )
          : 0,
      stagesCoverage,
    };
  }

  // ─── 扫描缺失字段统计 ──────────────────────────────────────────────────

  // ─── 扫描缺失字段统计（V7.9 优化：单次 SQL 聚合）───────────────────────

  async scanMissingFields(): Promise<MissingFieldStats> {
    const total = await this.prisma.foods.count();

    // V8.0: 字段名来自 ENRICHABLE_FIELDS 常量白名单，使用 Prisma.raw 安全构建
    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const selectParts = ENRICHABLE_FIELDS.map((field) => {
      if (jsonArrayFields.includes(field)) {
        return `COUNT(*) FILTER (WHERE "${field}" IS NULL OR "${field}"::text = '[]')::text AS "${field}"`;
      }
      return `COUNT(*) FILTER (WHERE "${field}" IS NULL)::text AS "${field}"`;
    });

    const result = await this.prisma.$queryRaw<Record<string, string>[]>(
      Prisma.sql`SELECT ${Prisma.raw(selectParts.join(', '))} FROM foods`,
    );

    const fieldCounts: Record<string, number> = {};
    if (result[0]) {
      for (const field of ENRICHABLE_FIELDS) {
        fieldCounts[field] = parseInt(result[0][field] ?? '0', 10);
      }
    }

    // 翻译缺失：没有任何翻译记录的食物数
    const translationsResult = await this.prisma.$queryRaw<[{ count: string }]>(
      Prisma.sql`SELECT COUNT(*)::text AS count FROM foods f
       WHERE NOT EXISTS (SELECT 1 FROM food_translations ft WHERE ft.food_id = f.id)`,
    );
    const translationsMissing = parseInt(
      translationsResult[0]?.count ?? '0',
      10,
    );

    // 地区信息缺失：没有任何 regional_info 的食物数
    const regionalResult = await this.prisma.$queryRaw<[{ count: string }]>(
      Prisma.sql`SELECT COUNT(*)::text AS count FROM foods f
       WHERE NOT EXISTS (SELECT 1 FROM food_regional_info fri WHERE fri.food_id = f.id)`,
    );
    const regionalMissing = parseInt(regionalResult[0]?.count ?? '0', 10);

    return {
      total,
      fields: fieldCounts as Record<EnrichableField, number>,
      translationsMissing,
      regionalMissing,
    };
  }

  // ─── 查询需要补全的食物列表 ────────────────────────────────────────────

  async getFoodsNeedingEnrichment(
    fields: EnrichableField[],
    limit = 50,
    offset = 0,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    if (fields.length === 0) return [];

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    // V8.0: 字段名来自 ENRICHABLE_FIELDS/阶段字段白名单，使用 Prisma.raw 安全构建
    const nullConditions = fields
      .map((f) =>
        jsonArrayFields.includes(f)
          ? `("${f}" IS NULL OR "${f}"::text = '[]')`
          : `"${f}" IS NULL`,
      )
      .join(' OR ');

    const rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT id, name FROM foods WHERE ${Prisma.raw(nullConditions)} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      missingFields: fields,
    }));
  }

  // ─── 核心：AI 补全单个食物（主表字段）────────────────────────────────

  async enrichFood(foodId: string): Promise<EnrichmentResult | null> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured');
      return null;
    }

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) {
      this.logger.warn(`Food ${foodId} not found`);
      return null;
    }

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const missingFields = ENRICHABLE_FIELDS.filter((field) => {
      const value = (food as any)[field];
      if (value === null || value === undefined) return true;
      if (
        jsonArrayFields.includes(field) &&
        Array.isArray(value) &&
        value.length === 0
      )
        return true;
      return false;
    });

    if (missingFields.length === 0) return null;

    this.logger.log(
      `Enriching "${food.name}": missing ${missingFields.join(', ')}`,
    );

    const prompt = this.buildEnrichmentPrompt(food, missingFields);
    return this.callAI(food.name, prompt, missingFields, 'foods');
  }

  // ─── 翻译补全（food_translations 表）─────────────────────────────────

  async enrichTranslation(
    foodId: string,
    locale: string,
  ): Promise<Record<string, any> | null> {
    if (!this.apiKey) return null;

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) return null;

    // 检查是否已存在该语言翻译
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale },
    });

    const missingTransFields: string[] = [];
    if (!existing) {
      missingTransFields.push('name', 'aliases', 'description', 'serving_desc');
    } else {
      if (!existing.name) missingTransFields.push('name');
      if (!existing.aliases) missingTransFields.push('aliases');
      if (!existing.description) missingTransFields.push('description');
      if (!existing.serving_desc) missingTransFields.push('serving_desc');
    }

    if (missingTransFields.length === 0) return null;

    const localeNames: Record<string, string> = {
      'zh-CN': '简体中文',
      'zh-TW': '繁体中文',
      'en-US': '英语',
      'ja-JP': '日语',
      'ko-KR': '韩语',
    };

    const prompt = `食物信息（中文）：
名称: ${food.name}
别名: ${food.aliases ?? '无'}
分类: ${food.category}
标准份量: ${food.standard_serving_desc ?? `${food.standard_serving_g}g`}

请将以下字段翻译成${localeNames[locale] ?? locale}（locale: ${locale}）：
${missingTransFields.map((f) => `- ${f}`).join('\n')}

返回 JSON：
{
  ${missingTransFields.map((f) => `"${f}": "<${localeNames[locale] ?? locale}内容>"`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<说明>"
}`;

    return this.callAI(
      food.name,
      prompt,
      missingTransFields as any,
      'translations',
    );
  }

  // ─── 地区信息补全（food_regional_info 表）────────────────────────────

  async enrichRegional(
    foodId: string,
    region: string,
  ): Promise<Record<string, any> | null> {
    if (!this.apiKey) return null;

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) return null;

    const existing = await this.prisma.food_regional_info.findFirst({
      where: { food_id: foodId, region },
    });

    const missingFields: string[] = [];
    if (!existing) {
      missingFields.push(
        'local_popularity',
        'local_price_range',
        'availability',
      );
    } else {
      if (!existing.local_price_range) missingFields.push('local_price_range');
      if (!existing.availability) missingFields.push('availability');
    }

    if (missingFields.length === 0) return null;

    const prompt = `食物名称: ${food.name}，地区: ${region}

请估算以下地区属性：
- local_popularity: 0-100，当地受欢迎程度
- local_price_range: cheap/medium/expensive/premium
- availability: common/seasonal/specialty/imported

返回 JSON：
{
  ${missingFields.map((f) => `"${f}": <value>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<说明>"
}`;

    return this.callAI(food.name, prompt, missingFields as any, 'regional');
  }

  // ─── 写入主表（直接模式）──────────────────────────────────────────────

  async applyEnrichment(
    foodId: string,
    result: EnrichmentResult,
    operator = 'ai_enrichment',
  ): Promise<{ updated: EnrichableField[]; skipped: EnrichableField[] }> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const updates: Record<string, any> = {};
    const updated: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const field of ENRICHABLE_FIELDS) {
      const aiValue = result[field];
      if (aiValue === undefined || aiValue === null) continue;

      const existing = (food as any)[field];
      if (existing !== null && existing !== undefined) {
        if (
          jsonArrayFields.includes(field) &&
          Array.isArray(existing) &&
          existing.length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (!jsonArrayFields.includes(field)) {
          skipped.push(field);
          continue;
        }
      }

      updates[field] = aiValue;
      updated.push(field);
    }

    if (Object.keys(updates).length === 0) return { updated: [], skipped };

    // V8.0: 使用 Prisma 交互式事务保证 foods.update + changelog.create 原子性
    const newVersion = (food.data_version || 1) + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.foods.update({
        where: { id: foodId },
        data: {
          ...updates,
          confidence: Math.min(
            food.confidence?.toNumber() ?? 1,
            result.confidence,
          ) as any,
          data_version: newVersion,
        },
      });

      await tx.food_change_logs.create({
        data: {
          food_id: foodId,
          version: newVersion,
          action: 'ai_enrichment',
          changes: {
            enrichedFields: updated,
            confidence: result.confidence,
            values: updates,
            reasoning: result.reasoning ?? null,
          },
          reason: `AI 自动补全 ${updated.length} 个字段`,
          operator,
        },
      });
    });

    this.logger.log(
      `Applied enrichment "${food.name}": [${updated.join(', ')}]`,
    );
    return { updated, skipped };
  }

  // ─── 写入翻译关联表（直接模式）────────────────────────────────────────

  async applyTranslationEnrichment(
    foodId: string,
    locale: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale },
    });

    const { confidence, reasoning, ...fields } = result;
    const updates: Record<string, any> = {};

    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) continue;
      if (existing && (existing as any)[k]) continue; // 不覆盖已有
      updates[k] = v;
    }

    if (Object.keys(updates).length === 0)
      return { action: 'updated', fields: [] };

    // V8.0: 使用 Prisma 交互式事务保证翻译写入 + changelog 原子性
    let resultAction: 'created' | 'updated' = existing ? 'updated' : 'created';
    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.food_translations.create({
          data: { food_id: foodId, locale, ...(updates as any) },
        });
      } else {
        await tx.food_translations.update({
          where: { id: existing.id },
          data: updates as any,
        });
      }

      const food = await tx.foods.findUnique({ where: { id: foodId } });
      if (food) {
        await tx.food_change_logs.create({
          data: {
            food_id: foodId,
            version: food.data_version ?? 1,
            action: 'ai_enrichment',
            changes: {
              target: 'food_translations',
              locale,
              fields: Object.keys(updates),
              values: updates,
              confidence,
              reasoning: reasoning ?? null,
            },
            reason: `AI 补全 ${locale} 翻译`,
            operator,
          },
        });
      }
    });

    return {
      action: resultAction,
      fields: Object.keys(updates),
    };
  }

  // ─── 写入地区信息关联表（直接模式）───────────────────────────────────

  async applyRegionalEnrichment(
    foodId: string,
    region: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    const existing = await this.prisma.food_regional_info.findFirst({
      where: { food_id: foodId, region },
    });

    const { confidence, reasoning, ...fields } = result;
    const updates: Record<string, any> = {};

    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) continue;
      if (
        existing &&
        (existing as any)[k] !== null &&
        (existing as any)[k] !== undefined
      )
        continue;
      updates[k] = v;
    }

    if (Object.keys(updates).length === 0)
      return { action: 'updated', fields: [] };

    // V8.0: 使用 Prisma 交互式事务保证地区信息写入 + changelog 原子性
    let resultAction: 'created' | 'updated' = existing ? 'updated' : 'created';
    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.food_regional_info.create({
          data: { food_id: foodId, region, ...(updates as any) },
        });
      } else {
        await tx.food_regional_info.update({
          where: { id: existing.id },
          data: updates as any,
        });
      }

      const food = await tx.foods.findUnique({ where: { id: foodId } });
      if (food) {
        await tx.food_change_logs.create({
          data: {
            food_id: foodId,
            version: food.data_version ?? 1,
            action: 'ai_enrichment',
            changes: {
              target: 'food_regional_info',
              region,
              fields: Object.keys(updates),
              values: updates,
              confidence,
              reasoning: reasoning ?? null,
            },
            reason: `AI 补全 ${region} 地区信息`,
            operator,
          },
        });
      }
    });

    return {
      action: resultAction,
      fields: Object.keys(updates),
    };
  }

  // ─── Staging 模式：AI 结果写入 change_logs 待审核 ─────────────────────

  async stageEnrichment(
    foodId: string,
    result: EnrichmentResult,
    target: EnrichmentTarget = 'foods',
    locale?: string,
    region?: string,
    operator = 'ai_enrichment',
  ): Promise<string> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const log = await this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version: food.data_version ?? 1,
        action: 'ai_enrichment_staged',
        changes: {
          target,
          locale: locale ?? null,
          region: region ?? null,
          proposedValues: result,
          confidence: result.confidence,
          reasoning: result.reasoning ?? null,
        },
        reason: `AI 暂存补全（${target}${locale ? '/' + locale : ''}${region ? '/' + region : ''}），待人工审核`,
        operator,
      },
    });

    this.logger.log(
      `Staged enrichment for "${food.name}" (${target}), logId=${log.id}, confidence=${result.confidence}`,
    );
    return log.id;
  }

  // ─── 查询 Staged 记录 ──────────────────────────────────────────────────

  async getStagedEnrichments(params: {
    page?: number;
    pageSize?: number;
    foodId?: string;
    target?: EnrichmentTarget;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page = 1, pageSize = 20, foodId, target } = params;
    const skip = (page - 1) * pageSize;

    const where: any = { action: 'ai_enrichment_staged' };
    if (foodId) where.food_id = foodId;
    if (target) where.changes = { path: ['target'], equals: target };

    const [rawList, total] = await Promise.all([
      this.prisma.food_change_logs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.food_change_logs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.food_id,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.created_at,
    }));

    return { list, total, page, pageSize };
  }

  // ─── V8.0: 暂存预览（对比当前值与AI建议值）──────────────────────────

  /**
   * 获取单条暂存记录的预览数据
   * 包含：当前食物值、AI建议值、字段差异对比、同类均值参考
   */
  async getEnrichmentPreview(logId: string): Promise<{
    food: {
      id: string;
      name: string;
      name_zh: string | null;
      category: string | null;
      sub_category: string | null;
    };
    staged: {
      logId: string;
      changes: Record<string, any>;
      confidence: number;
      target: string;
      stage: number | null;
      createdAt: Date;
    };
    diff: Array<{
      field: string;
      label: string;
      currentValue: any;
      suggestedValue: any;
      unit: string;
      validRange: { min: number; max: number } | null;
    }>;
    categoryAverage: Record<string, number> | null;
  }> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const food = await this.prisma.foods.findUnique({
      where: { id: log.food_id },
    });
    if (!food) throw new Error(`Food ${log.food_id} not found`);

    const changes = log.changes as Record<string, any>;
    const proposedValues = changes.proposedValues ?? {};
    const target = changes.target ?? 'foods';
    const stage = changes.stage ?? null;

    // 构建字段差异对比
    const diff: Array<{
      field: string;
      label: string;
      currentValue: any;
      suggestedValue: any;
      unit: string;
      validRange: { min: number; max: number } | null;
    }> = [];

    for (const [field, suggestedValue] of Object.entries(proposedValues)) {
      if (field === 'confidence' || field === 'reasoning') continue;
      const currentValue = (food as any)[field] ?? null;
      diff.push({
        field,
        label: ENRICHMENT_FIELD_LABELS[field] ?? field,
        currentValue,
        suggestedValue,
        unit: ENRICHMENT_FIELD_UNITS[field] ?? '',
        validRange: NUTRIENT_RANGES[field] ?? null,
      });
    }

    // 获取同类均值参考
    const numericFields = diff
      .filter((d) => NUTRIENT_RANGES[d.field])
      .map((d) => d.field);
    let categoryAverage: Record<string, number> | null = null;
    if (numericFields.length > 0 && food.category) {
      categoryAverage = await this.getCategoryAverage(
        numericFields,
        food.category,
        food.sub_category ?? null,
      );
    }

    return {
      food: {
        id: food.id,
        name: food.name,
        name_zh: food.name ?? null,
        category: food.category ?? null,
        sub_category: food.sub_category ?? null,
      },
      staged: {
        logId: log.id,
        changes: proposedValues,
        confidence: changes.confidence ?? 0,
        target,
        stage,
        createdAt: log.created_at,
      },
      diff,
      categoryAverage,
    };
  }

  /**
   * V8.0 P3-A: 批量暂存预览
   * 一次性获取多条暂存记录的预览数据，用于批量审核前的对比查看
   * 内部复用 getEnrichmentPreview，逐条获取并聚合结果
   *
   * @param logIds 暂存记录 ID 数组（最多50条，防止性能问题）
   */
  async getBatchEnrichmentPreview(logIds: string[]): Promise<{
    results: Array<{
      logId: string;
      success: boolean;
      data?: Awaited<ReturnType<typeof this.getEnrichmentPreview>>;
      error?: string;
    }>;
    summary: {
      total: number;
      success: number;
      failed: number;
      avgConfidence: number;
    };
  }> {
    // 限制批量数量，防止性能问题
    const MAX_BATCH_SIZE = 50;
    const ids = logIds.slice(0, MAX_BATCH_SIZE);

    const results = await Promise.allSettled(
      ids.map(async (logId) => {
        const data = await this.getEnrichmentPreview(logId);
        return { logId, success: true as const, data };
      }),
    );

    const items = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        logId: ids[i],
        success: false as const,
        error: (r.reason as Error).message,
      };
    });

    const successItems = items.filter((it) => it.success && it.data);
    const confidences = successItems.map(
      (it) => (it as any).data.staged.confidence as number,
    );
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

    return {
      results: items,
      summary: {
        total: ids.length,
        success: successItems.length,
        failed: ids.length - successItems.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
      },
    };
  }

  // ─── 审核通过：将 staged 结果实际入库 ────────────────────────────────

  async approveStaged(
    logId: string,
    operator = 'admin',
  ): Promise<{ applied: boolean; detail: string }> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const changes = log.changes as Record<string, any>;
    const target: EnrichmentTarget = changes.target ?? 'foods';
    const proposed: EnrichmentResult = changes.proposedValues ?? {};

    let detail = '';

    if (target === 'foods') {
      const { updated, skipped } = await this.applyEnrichment(
        log.food_id,
        proposed,
        operator,
      );
      detail = `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`;
    } else if (target === 'translations' && changes.locale) {
      const res = await this.applyTranslationEnrichment(
        log.food_id,
        changes.locale,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    } else if (target === 'regional' && changes.region) {
      const res = await this.applyRegionalEnrichment(
        log.food_id,
        changes.region,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    }

    // 将 staged log 标记为已审批
    await this.prisma.food_change_logs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_approved',
        reason: `人工审核通过: ${detail}`,
        operator,
      },
    });

    return { applied: true, detail };
  }

  // ─── 审核拒绝 ─────────────────────────────────────────────────────────

  async rejectStaged(
    logId: string,
    reason: string,
    operator = 'admin',
  ): Promise<void> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    await this.prisma.food_change_logs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_rejected',
        reason: `人工拒绝: ${reason}`,
        operator,
      },
    });
  }

  // ─── 批量审核通过 ─────────────────────────────────────────────────────

  async batchApproveStaged(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.approveStaged(logId, operator);
        success++;
      } catch (e) {
        failed++;
        errors.push(`${logId}: ${(e as Error).message}`);
      }
    }

    return { success, failed, errors };
  }

  // ─── 补全历史（审计日志）──────────────────────────────────────────────

  async getEnrichmentHistory(params: {
    foodId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { foodId, action, page = 1, pageSize = 20 } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {
      action: {
        in: action
          ? [action]
          : [
              'ai_enrichment',
              'ai_enrichment_staged',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
            ],
      },
    };
    if (foodId) where.food_id = foodId;

    const [rawList, total] = await Promise.all([
      this.prisma.food_change_logs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.food_change_logs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.food_id,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.created_at,
    }));

    return { list, total, page, pageSize };
  }

  // ─── 辅助：统一调用 AI ────────────────────────────────────────────────

  private async callAI(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): Promise<EnrichmentResult | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是权威食品营养数据库专家。根据食物名称和已有数据，推算缺失字段。严格按JSON格式返回，数值基于每100g计算，禁止自由文本。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 1200,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const raw = JSON.parse(content) as Record<string, any>;
        const validated = this.validateAndClean(raw, requestedFields, target);
        if (validated) return validated;

        this.logger.warn(
          `Attempt ${attempt} validation failed for "${foodName}"`,
        );
      } catch (e) {
        this.logger.warn(
          `Attempt ${attempt} failed for "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries)
          await this.sleep(this.exponentialBackoff(attempt));
      }
    }

    this.logger.error(`All AI attempts failed for "${foodName}"`);
    return null;
  }

  // ─── 构造主表 Prompt ──────────────────────────────────────────────────

  private buildEnrichmentPrompt(
    food: any,
    missingFields: EnrichableField[],
  ): string {
    const ctx = [
      `名称: ${food.name}`,
      food.aliases ? `别名: ${food.aliases}` : null,
      `分类: ${food.category}`,
      food.sub_category ? `二级分类: ${food.sub_category}` : null,
      food.food_group ? `食物组: ${food.food_group}` : null,
      food.calories != null ? `热量: ${food.calories} kcal/100g` : null,
      food.protein != null ? `蛋白质: ${food.protein} g/100g` : null,
      food.fat != null ? `脂肪: ${food.fat} g/100g` : null,
      food.carbs != null ? `碳水: ${food.carbs} g/100g` : null,
      food.fiber != null ? `膳食纤维: ${food.fiber} g/100g` : null,
      food.sodium != null ? `钠: ${food.sodium} mg/100g` : null,
      food.cuisine ? `菜系: ${food.cuisine}` : null,
      food.cooking_method ? `烹饪方式: ${food.cooking_method}` : null,
      food.is_processed ? `是否加工食品: ${food.is_processed}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const fieldsList = missingFields
      .map((f) => `- ${FIELD_DESC[f] || f}`)
      .join('\n');

    return `已知食物数据：\n${ctx}\n\n请估算以下缺失字段：\n${fieldsList}\n\n返回JSON（只含请求字段，无法确定返回null）：
{
  ${missingFields.map((f) => `"${f}": <value or null>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<简短说明>"
}`;
  }

  // ─── 验证和清理 AI 结果 ───────────────────────────────────────────────

  private validateAndClean(
    raw: Record<string, any>,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): EnrichmentResult | null {
    if (!raw || typeof raw !== 'object') return null;

    const result: EnrichmentResult = {
      confidence:
        typeof raw.confidence === 'number'
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    };

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const jsonObjectFields = ['flavor_profile'];
    const stringFields = [
      'sub_category',
      'food_group',
      'cuisine',
      'cooking_method',
      'fodmap_level',
      'oxalate_level',
      'standard_serving_desc',
      'main_ingredient',
      // translation fields
      'name',
      'aliases',
      'description',
      'serving_desc',
      // regional fields
      'local_price_range',
      'availability',
    ];

    for (const field of requestedFields) {
      const value = raw[field];
      if (value === null || value === undefined) {
        result[field] = null;
        continue;
      }

      if (jsonArrayFields.includes(field)) {
        result[field] = Array.isArray(value) ? value : null;
        continue;
      }

      if (jsonObjectFields.includes(field)) {
        result[field] =
          typeof value === 'object' && !Array.isArray(value) ? value : null;
        continue;
      }

      if (stringFields.includes(field)) {
        result[field] =
          typeof value === 'string' && value.trim() ? value.trim() : null;
        continue;
      }

      // 数值
      const numValue =
        typeof value === 'string' ? parseFloat(value) : Number(value);
      if (isNaN(numValue)) {
        result[field] = null;
        continue;
      }

      const range = NUTRIENT_RANGES[field];
      if (range && (numValue < range.min || numValue > range.max)) {
        this.logger.warn(
          `"${field}" value ${numValue} out of range [${range.min},${range.max}]`,
        );
        result[field] = null;
        continue;
      }

      result[field] = numValue;
    }

    return result;
  }

  // ─── 判断是否应该 staging（低置信度自动转暂存）───────────────────────

  shouldStage(result: EnrichmentResult, forceStagedMode: boolean): boolean {
    return forceStagedMode || result.confidence < CONFIDENCE_STAGING_THRESHOLD;
  }

  // ─── V7.9 Phase 2: 同类食物一致性校验（IQR 离群检测）─────────────────

  /**
   * 对指定食物的数值型字段进行同类一致性校验
   * 使用 IQR（四分位距）方法检测离群值：低于 Q1-1.5*IQR 或高于 Q3+1.5*IQR
   * @returns 离群字段及其偏差详情
   */
  async validateCategoryConsistency(foodId: string): Promise<{
    foodId: string;
    foodName: string;
    category: string;
    outliers: Array<{
      field: string;
      value: number;
      q1: number;
      q3: number;
      iqr: number;
      lowerBound: number;
      upperBound: number;
      severity: 'warning' | 'critical';
    }>;
    peerCount: number;
  } | null> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food || !food.category) return null;

    // 查询同类食物数量
    const countResult = await this.prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count FROM foods WHERE category = $1 AND id != $2`,
      food.category,
      foodId,
    );
    const peerCount = parseInt(countResult[0]?.count ?? '0', 10);
    if (peerCount < 5) return null; // 同类样本不足，无法做有效 IQR

    // 对所有数值型营养素字段执行 IQR 检测
    const numericFields = Object.keys(NUTRIENT_RANGES).filter(
      (f) => (food as any)[f] != null,
    );
    if (numericFields.length === 0)
      return {
        foodId,
        foodName: food.name,
        category: food.category,
        outliers: [],
        peerCount,
      };

    // 批量查询各字段的 Q1, Q3
    const selectParts = numericFields
      .map(
        (f) =>
          `PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${f}) AS "${f}_q1", ` +
          `PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${f}) AS "${f}_q3"`,
      )
      .join(', ');

    const whereClause = numericFields
      .map((f) => `${f} IS NOT NULL`)
      .join(' OR ');

    const iqrResult = await this.prisma.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT ${selectParts} FROM foods WHERE category = $1 AND id != $2 AND (${whereClause})`,
      food.category,
      foodId,
    );

    if (!iqrResult[0]) {
      return {
        foodId,
        foodName: food.name,
        category: food.category,
        outliers: [],
        peerCount,
      };
    }

    const outliers: Array<{
      field: string;
      value: number;
      q1: number;
      q3: number;
      iqr: number;
      lowerBound: number;
      upperBound: number;
      severity: 'warning' | 'critical';
    }> = [];

    for (const field of numericFields) {
      const value = parseFloat((food as any)[field]);
      const q1 = parseFloat(iqrResult[0][`${field}_q1`]);
      const q3 = parseFloat(iqrResult[0][`${field}_q3`]);

      if (isNaN(q1) || isNaN(q3)) continue;

      const iqr = q3 - q1;
      if (iqr === 0) continue; // 数据分布太集中，无法判断

      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      if (value < lowerBound || value > upperBound) {
        // 超出 3*IQR 为严重离群
        const criticalLower = q1 - 3 * iqr;
        const criticalUpper = q3 + 3 * iqr;
        const severity =
          value < criticalLower || value > criticalUpper
            ? 'critical'
            : 'warning';

        outliers.push({
          field,
          value,
          q1: Math.round(q1 * 100) / 100,
          q3: Math.round(q3 * 100) / 100,
          iqr: Math.round(iqr * 100) / 100,
          lowerBound: Math.round(lowerBound * 100) / 100,
          upperBound: Math.round(upperBound * 100) / 100,
          severity,
        });
      }
    }

    return {
      foodId,
      foodName: food.name,
      category: food.category,
      outliers,
      peerCount,
    };
  }

  // ─── V7.9 Phase 2: 补全结果统计 ──────────────────────────────────────

  /**
   * 获取 AI 补全操作的统计数据
   * 包含成功/失败/暂存/已审核的数量
   */
  async getEnrichmentStatistics(): Promise<{
    total: number;
    directApplied: number;
    staged: number;
    approved: number;
    rejected: number;
    /** 按日统计（最近 30 天） */
    dailyStats: Array<{
      date: string;
      count: number;
      action: string;
    }>;
  }> {
    const actions = [
      'ai_enrichment',
      'ai_enrichment_staged',
      'ai_enrichment_approved',
      'ai_enrichment_rejected',
    ];

    // V8.0: 使用参数化查询替代 action 字符串拼接
    const countResult = await this.prisma.$queryRaw<
      Array<{ action: string; count: string }>
    >(
      Prisma.sql`SELECT action, COUNT(*)::text AS count
       FROM food_change_logs
       WHERE action = ANY(${actions})
       GROUP BY action`,
    );

    let directApplied = 0;
    let staged = 0;
    let approved = 0;
    let rejected = 0;

    for (const row of countResult) {
      const c = parseInt(row.count, 10);
      if (row.action === 'ai_enrichment') directApplied = c;
      else if (row.action === 'ai_enrichment_staged') staged = c;
      else if (row.action === 'ai_enrichment_approved') approved = c;
      else if (row.action === 'ai_enrichment_rejected') rejected = c;
    }

    // V8.0: 按日统计（最近 30 天）— 参数化查询
    const dailyResult = await this.prisma.$queryRaw<
      Array<{ date: string; count: string; action: string }>
    >(
      Prisma.sql`SELECT
         TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
         action,
         COUNT(*)::text AS count
       FROM food_change_logs
       WHERE action = ANY(${actions})
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC, 2`,
    );

    const dailyStats = dailyResult.map((row) => ({
      date: row.date,
      count: parseInt(row.count, 10),
      action: row.action,
    }));

    return {
      total: directApplied + staged + approved + rejected,
      directApplied,
      staged,
      approved,
      rejected,
      dailyStats,
    };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * V8.0: 指数退避 + 随机抖动，替代线性退避
   * attempt 1 → ~2s, attempt 2 → ~4s, attempt 3 → ~8s，上限15秒
   */
  private exponentialBackoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
  }
}
