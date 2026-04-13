/**
 * V8.0 Food Enrichment Service
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
 *  6. 分阶段补全（5阶段）：核心营养素 → 微量营养素 → 健康属性 → 使用属性 → 扩展属性
 *  7. 每阶段独立 Prompt、独立验证、独立入库，前阶段结果作为后阶段上下文
 *  8. Fallback 降级机制：AI 失败时使用同类食物均值 / 规则推断
 *  9. 交叉验证增强：宏量营养素一致性自动修正
 * 10. 数据完整度评分：per food 加权计算
 * 11. scanMissingFields 单次 SQL 聚合优化
 *
 * ── V8.0 新增能力 ──
 * 12. 补全字段扩展至 64 个（新增 6 个 V7.9 营养素 + 14 个 V7.1/7.3/7.4 属性字段）
 * 13. 第 5 阶段"扩展属性"补全（烹饪细节、可获得性、搭配关系等）
 * 14. 补全元数据持久化：field_sources / field_confidence / data_completeness / enrichment_status
 * 15. 单条立即补全 API：enrichFoodNow
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
  // V8.0: V7.9 新增营养素
  'vitamin_b6',
  'omega3',
  'omega6',
  'soluble_fiber',
  'insoluble_fiber',
  'water_content_percent',
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
  // V8.0: V7.1/7.3/7.4 新增属性字段
  'ingredient_list',
  'cooking_methods',
  'texture_tags',
  'dish_type',
  'prep_time_minutes',
  'cook_time_minutes',
  'skill_required',
  'estimated_cost_level',
  'shelf_life_days',
  'serving_temperature',
  'dish_priority',
  'acquisition_difficulty',
  'compatibility',
  'available_channels',
  // V8.2: 新增可补全字段
  'food_form',
  'required_equipment',
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

// 关联表补全目标
export type EnrichmentTarget = 'foods' | 'translations' | 'regional';

// ─── V7.9: 分阶段补全定义 ─────────────────────────────────────────────────

/**
 * 5 阶段补全分组：每阶段独立 Prompt、独立验证、独立入库
 * 前阶段补全结果作为后阶段的输入上下文，逐步提高数据精度
 */
export interface EnrichmentStage {
  /** 阶段编号 1-5 */
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
      'vitamin_b6',
      'folate',
      'zinc',
      'magnesium',
      'saturated_fat',
      'trans_fat',
      'purine',
      'phosphorus',
      'added_sugar',
      'natural_sugar',
      'omega3',
      'omega6',
      'soluble_fiber',
      'insoluble_fiber',
      'water_content_percent',
    ],
    maxTokens: 1600,
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
  {
    stage: 5,
    name: '扩展属性',
    fields: [
      'ingredient_list',
      'cooking_methods',
      'texture_tags',
      'dish_type',
      'prep_time_minutes',
      'cook_time_minutes',
      'skill_required',
      'estimated_cost_level',
      'shelf_life_days',
      'serving_temperature',
      'dish_priority',
      'acquisition_difficulty',
      'compatibility',
      'available_channels',
      // V8.2: 新增
      'food_form',
      'required_equipment',
    ],
    maxTokens: 1000,
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
  /** 核心营养素完整度 (权重 0.35) */
  coreNutrients: number;
  /** 微量营养素完整度 (权重 0.25) */
  microNutrients: number;
  /** 健康属性完整度 (权重 0.15) */
  healthAttributes: number;
  /** 使用属性完整度 (权重 0.15) */
  usageAttributes: number;
  /** 扩展属性完整度 (权重 0.10) */
  extendedAttributes: number;
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
  /** V8.3: 按 enrichment_status 分布 */
  byStatus?: Record<string, number>;
}

// ─── 营养素合理范围（per 100g）────────────────────────────────────────────

// V8.0: 共享字段类型分类（避免各方法重复定义）
export const JSON_ARRAY_FIELDS = [
  'meal_types',
  'allergens',
  'tags',
  'common_portions',
  'ingredient_list',
  'cooking_methods',
  'texture_tags',
  'available_channels',
  // V8.2: 新增
  'required_equipment',
] as const;

export const JSON_OBJECT_FIELDS = ['flavor_profile', 'compatibility'] as const;

export const ENRICHABLE_STRING_FIELDS = [
  'sub_category',
  'food_group',
  'cuisine',
  'cooking_method',
  'fodmap_level',
  'oxalate_level',
  'standard_serving_desc',
  'main_ingredient',
  'dish_type',
  'skill_required',
  'serving_temperature',
  // V8.2: 新增
  'food_form',
] as const;

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
  // V8.0: V7.9 新增营养素范围
  vitamin_b6: { min: 0, max: 50 },
  omega3: { min: 0, max: 30000 },
  omega6: { min: 0, max: 50000 },
  soluble_fiber: { min: 0, max: 40 },
  insoluble_fiber: { min: 0, max: 60 },
  water_content_percent: { min: 0, max: 100 },
  // 属性评分
  glycemic_index: { min: 0, max: 100 },
  glycemic_load: { min: 0, max: 50 },
  quality_score: { min: 0, max: 10 },
  satiety_score: { min: 0, max: 10 },
  nutrient_density: { min: 0, max: 100 },
  commonality_score: { min: 0, max: 100 },
  processing_level: { min: 1, max: 4 },
  // V8.0: 扩展属性数值范围
  prep_time_minutes: { min: 0, max: 480 },
  cook_time_minutes: { min: 0, max: 720 },
  estimated_cost_level: { min: 1, max: 5 },
  shelf_life_days: { min: 0, max: 3650 },
  dish_priority: { min: 0, max: 100 },
  acquisition_difficulty: { min: 1, max: 5 },
};

// ─── 字段描述映射（用于 Prompt 构造）─────────────────────────────────────

export const FIELD_DESC: Record<string, string> = {
  // ─── Stage 1: 核心营养素 (number) ───────────────────────────────────
  protein: '[number] protein (g/100g, 0-100)',
  fat: '[number] fat (g/100g, 0-100)',
  carbs: '[number] carbs (g/100g, 0-100)',
  fiber: '[number] fiber (g/100g, 0-80)',
  sugar: '[number] sugar (g/100g, 0-100)',
  added_sugar: '[number] added_sugar (g/100g, 0-100)',
  natural_sugar: '[number] natural_sugar (g/100g, 0-100)',
  sodium: '[number] sodium (mg/100g, 0-50000)',
  // ─── Stage 2: 微量营养素 (number) ───────────────────────────────────
  calcium: '[number] calcium (mg/100g, 0-2000)',
  iron: '[number] iron (mg/100g, 0-100)',
  potassium: '[number] potassium (mg/100g, 0-10000)',
  cholesterol: '[number] cholesterol (mg/100g, 0-2000)',
  vitamin_a: '[number] vitamin_a (μg RAE/100g, 0-50000)',
  vitamin_c: '[number] vitamin_c (mg/100g, 0-2000)',
  vitamin_d: '[number] vitamin_d (μg/100g, 0-1000)',
  vitamin_e: '[number] vitamin_e (mg/100g, 0-500)',
  vitamin_b12: '[number] vitamin_b12 (μg/100g, 0-100)',
  folate: '[number] folate (μg DFE/100g, 0-5000)',
  zinc: '[number] zinc (mg/100g, 0-100)',
  magnesium: '[number] magnesium (mg/100g, 0-1000)',
  saturated_fat: '[number] saturated_fat (g/100g, 0-100)',
  trans_fat: '[number] trans_fat (g/100g, 0-10)',
  purine: '[number] purine (mg/100g, 0-2000)',
  phosphorus: '[number] phosphorus (mg/100g, 0-2000)',
  vitamin_b6: '[number] vitamin_b6 (mg/100g, 0-50)',
  omega3: '[number] omega3 Omega-3脂肪酸 (mg/100g, 0-30000, EPA+DHA+ALA总量)',
  omega6: '[number] omega6 Omega-6脂肪酸 (mg/100g, 0-50000, 亚油酸为主)',
  soluble_fiber: '[number] soluble_fiber 可溶性膳食纤维 (g/100g, 0-40)',
  insoluble_fiber: '[number] insoluble_fiber 不可溶性膳食纤维 (g/100g, 0-60)',
  water_content_percent:
    '[number] water_content_percent 水分含量百分比 (0-100)',
  // ─── Stage 3: 健康属性 ──────────────────────────────────────────────
  glycemic_index: '[number] glycemic_index 整数 0-100',
  glycemic_load: '[number] glycemic_load 0-50',
  fodmap_level: '[string] fodmap_level: low/medium/high',
  oxalate_level: '[string] oxalate_level: low/medium/high',
  processing_level: '[number] processing_level 整数 1-4 (1=自然,4=超加工)',
  // ─── Stage 4: 使用属性 ──────────────────────────────────────────────
  sub_category:
    '[string] sub_category 英文编码如 lean_meat/whole_grain/leafy_green',
  food_group: '[string] food_group 英文编码如 meat/fish/grain/vegetable/fruit',
  cuisine: '[string] cuisine 英文编码如 chinese/western/japanese/korean',
  cooking_method:
    '[string] cooking_method: raw/boiled/steamed/fried/roasted/grilled/stewed',
  meal_types: '[string[]] meal_types 数组，选自 breakfast/lunch/dinner/snack',
  allergens:
    '[string[]] allergens 数组，选自 gluten/dairy/nuts/soy/egg/shellfish/fish/wheat',
  tags: '[string[]] tags 数组，选自 high_protein/low_fat/low_carb/high_fiber/low_calorie/low_sodium/vegan/vegetarian/gluten_free',
  common_portions:
    '[object[]] common_portions JSON数组，如 [{"name":"1碗","grams":200}]',
  quality_score: '[number] quality_score 0-10综合品质',
  satiety_score: '[number] satiety_score 0-10饱腹感',
  nutrient_density: '[number] nutrient_density 0-100营养密度',
  commonality_score: '[number] commonality_score 0-100大众化程度',
  standard_serving_desc:
    '[string] standard_serving_desc 标准份量描述如"1碗(200g)"',
  main_ingredient: '[string] main_ingredient 主要原料如 rice/chicken',
  flavor_profile:
    '[object] flavor_profile JSON如 {"sweet":3,"salty":5,"sour":1,"spicy":0,"bitter":1}',
  // ─── Stage 5: 扩展属性 ──────────────────────────────────────────────
  ingredient_list:
    '[string[]] ingredient_list 完整食材清单数组，如 ["chicken","peanut","chili"]',
  cooking_methods:
    '[string[]] cooking_methods 多种烹饪方式数组，如 ["stir_fry","deep_fry"]',
  texture_tags:
    '[string[]] texture_tags 口感标签数组，如 ["crispy","tender","juicy"]',
  dish_type:
    '[string] dish_type 成品类型: dish/soup/drink/dessert/snack/staple/salad/sauce',
  prep_time_minutes: '[number] prep_time_minutes 备料时间(分钟, 0-480)',
  cook_time_minutes: '[number] cook_time_minutes 烹饪时间(分钟, 0-720)',
  skill_required:
    '[string] skill_required 烹饪技能要求: beginner/medium/advanced/expert (最长10字符)',
  estimated_cost_level:
    '[number] estimated_cost_level 预估成本 1-5 (1=极低,5=极高)',
  shelf_life_days: '[number] shelf_life_days 保质期天数(0-3650)',
  serving_temperature:
    '[string] serving_temperature 建议食用温度: hot/warm/cold/room_temp',
  dish_priority:
    '[number] dish_priority 成品菜推荐优先级 0-100 (仅dish/semi_prepared有值)',
  acquisition_difficulty:
    '[number] acquisition_difficulty 可获得性难度 1-5 (1=随处可得,5=稀有)',
  compatibility:
    '[object] compatibility JSON对象，描述搭配关系如 {"good":["rice","soup"],"avoid":["milk"]}',
  available_channels:
    '[string[]] available_channels 可获取渠道数组，如 ["supermarket","wet_market","online"]',
  // V8.2: 新增字段描述
  food_form:
    '[string] food_form 食物形态: ingredient/dish/semi_prepared (ingredient=原材料,dish=成品菜,semi_prepared=半成品)',
  required_equipment:
    '[string[]] required_equipment 所需设备数组，如 ["oven","wok","microwave","steamer","air_fryer","none"]',
};

// ─── 低置信度阈值：低于此值强制进入 staging ───────────────────────────────

const CONFIDENCE_STAGING_THRESHOLD = 0.7;

// ─── AI 补全结果结构（主表）────────────────────────────────────────────────

export interface EnrichmentResult {
  [key: string]: any;
  confidence: number;
  reasoning?: string;
  /** V8.0: AI 返回的字段级置信度 */
  field_confidence?: Record<string, number>;
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
  /** V7.9: 分阶段补全模式，指定阶段编号 1-5 */
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
  /** V8.3: 食物当前值（仅 proposedValues 涉及的字段），方便前端 diff */
  currentValues?: Record<string, any>;
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
        const value = (food as any)[field];
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
        if (field === 'processing_level' || field === 'commonality_score') {
          const sources = (food.field_sources as Record<string, string>) || {};
          if (!sources[field]) return true; // 无来源记录 → 还是默认值，视为缺失
        }
        // V8.2: available_channels — 检查是否是 schema 默认值（未被定制）
        if (field === 'available_channels') {
          const sources = (food.field_sources as Record<string, string>) || {};
          if (!sources[field]) return true;
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
          const retryResult = await this.callAIForStage(
            food.name,
            retryPrompt,
            failedFields,
            stage,
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

    // V8.2: 动态传递前序阶段所有已补全数据（不再仅限硬编码10个营养素字段）
    // 按阶段顺序遍历，将所有已累积的数据作为上下文传递
    const CONTEXT_LABELS: Record<string, [string, string?]> = {
      // Stage 1 核心营养素
      calories: ['热量', 'kcal/100g'],
      protein: ['蛋白质', 'g/100g'],
      fat: ['脂肪', 'g/100g'],
      carbs: ['碳水化合物', 'g/100g'],
      fiber: ['膳食纤维', 'g/100g'],
      sugar: ['糖', 'g/100g'],
      sodium: ['钠', 'mg/100g'],
      // Stage 2 微量营养素
      calcium: ['钙', 'mg/100g'],
      iron: ['铁', 'mg/100g'],
      potassium: ['钾', 'mg/100g'],
      cholesterol: ['胆固醇', 'mg/100g'],
      vitamin_a: ['维生素A', 'μg/100g'],
      vitamin_c: ['维生素C', 'mg/100g'],
      vitamin_d: ['维生素D', 'μg/100g'],
      vitamin_e: ['维生素E', 'mg/100g'],
      vitamin_b12: ['维生素B12', 'μg/100g'],
      vitamin_b6: ['维生素B6', 'mg/100g'],
      folate: ['叶酸', 'μg/100g'],
      zinc: ['锌', 'mg/100g'],
      magnesium: ['镁', 'mg/100g'],
      saturated_fat: ['饱和脂肪', 'g/100g'],
      trans_fat: ['反式脂肪', 'g/100g'],
      purine: ['嘌呤', 'mg/100g'],
      phosphorus: ['磷', 'mg/100g'],
      added_sugar: ['添加糖', 'g/100g'],
      natural_sugar: ['天然糖', 'g/100g'],
      omega3: ['Omega-3', 'mg/100g'],
      omega6: ['Omega-6', 'mg/100g'],
      soluble_fiber: ['可溶性纤维', 'g/100g'],
      insoluble_fiber: ['不可溶性纤维', 'g/100g'],
      water_content_percent: ['水分', '%'],
      // Stage 3 健康属性
      glycemic_index: ['血糖指数'],
      glycemic_load: ['血糖负荷'],
      fodmap_level: ['FODMAP等级'],
      oxalate_level: ['草酸等级'],
      processing_level: ['加工程度'],
      // Stage 3 补全后可作为 Stage 4/5 上下文
      allergens: ['过敏原'],
      tags: ['饮食标签'],
      // Stage 4 使用属性
      cuisine: ['菜系'],
      cooking_method: ['烹饪方式'],
      meal_types: ['适合餐次'],
      dish_type: ['菜品类型'],
      main_ingredient: ['主要原料'],
      food_form: ['食物形态'],
      // Stage 4 补全后可作为 Stage 5 上下文
      quality_score: ['综合品质分'],
      satiety_score: ['饱腹感'],
      nutrient_density: ['营养密度'],
      commonality_score: ['大众化程度'],
      standard_serving_desc: ['标准份量描述'],
      flavor_profile: ['风味特征'],
      // V8.2 新增（Stage 5）
      required_equipment: ['所需设备'],
    };

    // 遍历所有前序阶段累积的数据
    for (const [field, labelInfo] of Object.entries(CONTEXT_LABELS)) {
      // 跳过已在 knownParts 初始化中处理的字段
      if (['sub_category', 'food_group'].includes(field)) continue;

      const value = accumulatedData[field] ?? (food as any)[field];
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
    if (food.is_processed != null)
      knownParts.push(`是否加工食品: ${food.is_processed}`);

    const ctx = knownParts.filter(Boolean).join('\n');

    // 构造字段描述（阶段专用）
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
4. 对每个字段单独评估置信度，在 "field_confidence" 中返回（0.0-1.0）
5. confidence 为整体置信度（0.0-1.0），若低于0.5请在 reasoning 中逐一标注不确定的字段及原因
6. reasoning 请说明数据来源依据，例如：参考《中国食物成分表》、USDA数据库、类似食物推算、烹饪经验推测等；若为推测值请明确标注

返回JSON：
{
  ${missingFields.map((f) => `"${f}": <value or null>`).join(',\n  ')},
  "confidence": <0.0-1.0 整体置信度>,
  "field_confidence": {
    ${missingFields.map((f) => `"${f}": <0.0-1.0>`).join(',\n    ')}
  },
  "reasoning": "<说明数据来源依据（如参考标准、类似食物推算等），低置信度字段需逐一标注>"
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

  // ─── V8.0: 单条立即补全 ──────────────────────────────────────────────

  /**
   * 单条食物立即补全（同步执行，不走队列）
   * 支持指定阶段和字段，补全后自动更新 field_sources/field_confidence/data_completeness
   *
   * @param foodId 食物 ID
   * @param options.stages 指定阶段编号 1-5，默认自动检测需要补全的阶段
   * @param options.fields 指定要补全的字段（可选，默认补全所有缺失字段）
   * @param options.staged 是否暂存模式，默认 false
   * @returns 补全结果
   */
  async enrichFoodNow(
    foodId: string,
    options: {
      stages?: number[];
      fields?: EnrichableField[];
      staged?: boolean;
    } = {},
  ): Promise<{
    success: boolean;
    foodId: string;
    foodName: string;
    stageResults: StageEnrichmentResult[];
    totalEnriched: number;
    totalFailed: number;
    completeness: CompletenessScore;
    enrichmentStatus: string;
  }> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) {
      throw new Error(`食物 ${foodId} 不存在`);
    }

    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置，无法执行 AI 补全');
    }

    this.logger.log(`[enrichFoodNow] 开始补全 "${food.name}" (${foodId})`);

    // 确定需要补全的阶段
    let targetStages = options.stages;
    if (!targetStages || targetStages.length === 0) {
      // 自动检测：找出有缺失字段的阶段
      targetStages = ENRICHMENT_STAGES.filter((stage) => {
        // V8.1: 如果指定了 fields，只关注包含这些字段的阶段
        const stageFields = options.fields
          ? stage.fields.filter((f) => (options.fields as string[]).includes(f))
          : stage.fields;
        if (stageFields.length === 0) return false;

        return stageFields.some((field) => {
          const value = (food as any)[field];
          if (value === null || value === undefined) return true;
          if (
            (JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
            Array.isArray(value) &&
            value.length === 0
          )
            return true;
          return false;
        });
      }).map((s) => s.stage);
    }

    if (targetStages.length === 0) {
      // 已完整，无需补全
      const completeness = this.computeCompletenessScore(food);
      return {
        success: true,
        foodId,
        foodName: food.name,
        stageResults: [],
        totalEnriched: 0,
        totalFailed: 0,
        completeness,
        enrichmentStatus: 'completed',
      };
    }

    // 执行分阶段补全
    const multiResult = await this.enrichFoodByStage(
      foodId,
      targetStages,
      options.fields, // V8.1: 传递字段级过滤
    );
    if (!multiResult) {
      const completeness = this.computeCompletenessScore(food);
      return {
        success: false,
        foodId,
        foodName: food.name,
        stageResults: [],
        totalEnriched: 0,
        totalFailed: 0,
        completeness,
        enrichmentStatus: (food.enrichment_status as string) || 'failed',
      };
    }

    // 处理每个阶段的结果
    const staged = options.staged ?? false;
    let totalEnriched = 0;
    let totalFailed = 0;

    for (const sr of multiResult.stages) {
      if (!sr.result) {
        totalFailed += sr.failedFields.length;
        continue;
      }

      const shouldStage =
        staged || sr.result.confidence < CONFIDENCE_STAGING_THRESHOLD;

      if (shouldStage) {
        // 暂存模式：写入 change_logs 待审核
        await this.stageEnrichment(
          foodId,
          sr.result,
          'foods',
          undefined,
          undefined,
          'ai_enrichment_now',
        );
        totalEnriched += sr.enrichedFields.length;
      } else {
        // 直接入库
        const applied = await this.applyEnrichment(
          foodId,
          sr.result,
          'ai_enrichment_now',
        );
        totalEnriched += applied.updated.length;
        totalFailed += sr.failedFields.length;
      }
    }

    // 重新获取食物以计算最终完整度
    const updatedFood = await this.prisma.foods.findUnique({
      where: { id: foodId },
    });
    const completeness = this.computeCompletenessScore(updatedFood || food);

    // V8.3: enrichment_status 判定增加 'failed' 分支
    let enrichmentStatus: string;
    if (totalEnriched === 0 && totalFailed > 0) {
      // 全部阶段均失败
      enrichmentStatus = 'failed';
    } else if (staged) {
      // staged 模式下不按 completeness 判定，使用 'staged'
      enrichmentStatus = 'staged';
    } else {
      enrichmentStatus =
        completeness.score >= 80
          ? 'completed'
          : completeness.score >= 30
            ? 'partial'
            : 'pending';
    }

    // 更新状态
    // V8.2: staged 模式下数据未真正入库，仅标记 enrichment_status 为 staged，
    // 不更新 data_completeness（需审核通过后才更新）
    // V8.3: 全部失败时写入 'failed'，非staged非失败时由 applyEnrichment 已更新
    if (staged || (totalEnriched === 0 && totalFailed > 0)) {
      await this.prisma.foods.update({
        where: { id: foodId },
        data: {
          enrichment_status: enrichmentStatus,
          last_enriched_at: new Date(),
        },
      });
    }

    // V8.1: 持久化失败字段到 failed_fields + 更新 field_sources
    const allFailedFields = multiResult.stages.flatMap((sr) => sr.failedFields);
    if (allFailedFields.length > 0) {
      await this.persistFailedFields(
        foodId,
        allFailedFields,
        multiResult.stages,
      );
    }

    this.logger.log(
      `[enrichFoodNow] "${food.name}" 补全完成: ${totalEnriched} 字段成功, ${totalFailed} 字段失败, 完整度 ${completeness.score}%`,
    );

    return {
      success: true,
      foodId,
      foodName: food.name,
      stageResults: multiResult.stages,
      totalEnriched,
      totalFailed,
      completeness,
      enrichmentStatus,
    };
  }

  // ─── V8.3: 标记食物补全失败 ─────────────────────────────────────────────

  /**
   * 将食物的 enrichment_status 标记为 'failed'
   * 由 Processor onFailed 在最终失败时调用
   */
  async markEnrichmentFailed(foodId: string, errorMsg?: string): Promise<void> {
    await this.prisma.foods.update({
      where: { id: foodId },
      data: {
        enrichment_status: 'failed',
        last_enriched_at: new Date(),
      },
    });
    this.logger.warn(
      `[markEnrichmentFailed] foodId=${foodId}, error=${errorMsg ?? 'unknown'}`,
    );
  }

  // ─── V8.3: 查询失败/被拒绝的食物列表 ─────────────────────────────────

  /**
   * 获取 enrichment_status 为 failed 或 rejected 的食物列表
   * 供 retry-failed 端点从数据库重新入队
   */
  async getFailedFoods(
    limit: number,
    foodId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const where: any = {
      enrichment_status: { in: ['failed', 'rejected'] },
    };
    if (foodId) where.id = foodId;

    return this.prisma.foods.findMany({
      where,
      select: { id: true, name: true },
      take: limit,
    });
  }

  /**
   * 重置食物的 enrichment_status 为 pending（用于重新入队前）
   */
  async resetEnrichmentStatus(foodId: string): Promise<void> {
    await this.prisma.foods.update({
      where: { id: foodId },
      data: { enrichment_status: 'pending' },
    });
  }

  // ─── V8.3: 批量重算完整度 ──────────────────────────────────────────────

  /**
   * 批量重新计算所有食物的 data_completeness 和 enrichment_status
   * 用于修复历史数据不一致（如食物已有字段但 data_completeness 仍为0或NULL）
   *
   * 分批处理（每批200条）避免内存溢出，返回处理统计
   */
  async recalculateCompleteness(batchSize = 200): Promise<{
    total: number;
    updated: number;
    errors: number;
    statusChanges: Record<string, number>;
  }> {
    const total = await this.prisma.foods.count();
    let updated = 0;
    let errors = 0;
    const statusChanges: Record<string, number> = {};
    let cursor: string | undefined;

    this.logger.log(
      `[recalculateCompleteness] 开始批量重算，共 ${total} 条食物`,
    );

    while (true) {
      const foods = await this.prisma.foods.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (foods.length === 0) break;
      cursor = foods[foods.length - 1].id;

      for (const food of foods) {
        try {
          const completeness = this.computeCompletenessScore(food);
          const oldStatus = (food.enrichment_status as string) || 'pending';

          // 仅对非 staged/rejected/failed 的食物重新判定状态
          // staged/rejected/failed 是由审核流程或失败逻辑设置的，不应被覆盖
          let newStatus = oldStatus;
          if (!['staged', 'rejected', 'failed'].includes(oldStatus)) {
            newStatus =
              completeness.score >= 80
                ? 'completed'
                : completeness.score >= 30
                  ? 'partial'
                  : 'pending';
          }

          const oldCompleteness = (food.data_completeness as number) ?? 0;

          // 仅在值有变化时才更新，减少写入
          if (
            oldCompleteness !== completeness.score ||
            oldStatus !== newStatus
          ) {
            await this.prisma.foods.update({
              where: { id: food.id },
              data: {
                data_completeness: completeness.score,
                enrichment_status: newStatus,
              },
            });
            updated++;

            if (oldStatus !== newStatus) {
              const changeKey = `${oldStatus}→${newStatus}`;
              statusChanges[changeKey] = (statusChanges[changeKey] || 0) + 1;
            }
          }
        } catch (e) {
          errors++;
          this.logger.error(
            `[recalculateCompleteness] foodId=${food.id}: ${(e as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `[recalculateCompleteness] 完成：total=${total}, updated=${updated}, errors=${errors}`,
    );

    return { total, updated, errors, statusChanges };
  }

  // ─── V8.1: 单食物完整度查询（封装正确性修复）───────────────────────────

  /**
   * 查询单个食物的完整度评分
   * 修复原 controller 中直接访问 prisma 的封装泄漏问题
   */
  async getCompletenessById(foodId: string): Promise<
    | ({
        foodId: string;
        foodName: string;
      } & CompletenessScore)
    | null
  > {
    const food = await this.prisma.foods.findUnique({
      where: { id: foodId },
    });
    if (!food) return null;

    const score = this.computeCompletenessScore(food);
    return {
      foodId: food.id,
      foodName: food.name,
      ...score,
    };
  }

  // ─── V8.1: 失败字段持久化 ──────────────────────────────────────────────

  /**
   * 将补全失败的字段记录到 foods.failed_fields（JSONB）和 field_sources
   * failed_fields 格式: { "field_name": { "lastAttempt": "ISO date", "attempts": N, "reason": "..." }, ... }
   * field_sources 中失败字段标记为 "ai_enrichment_failed"
   */
  private async persistFailedFields(
    foodId: string,
    failedFields: string[],
    stageResults: StageEnrichmentResult[],
  ): Promise<void> {
    if (failedFields.length === 0) return;

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) return;

    const existingFailed = (food.failed_fields as Record<string, any>) || {};
    const existingSources =
      (food.field_sources as Record<string, string>) || {};

    const updatedFailed = { ...existingFailed };
    const updatedSources = { ...existingSources };

    for (const field of failedFields) {
      const prev = updatedFailed[field];
      const attempts = (prev?.attempts ?? 0) + 1;
      // V8.2: 更精细的失败原因分类
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
        // AI 成功返回了结果，但该字段为 null（含重试后仍为null）
        reason = 'AI无法估算（返回null）';
        reasonCode = 'ai_returned_null';
      } else {
        reason = '未知原因';
        reasonCode = 'unknown';
      }

      updatedFailed[field] = {
        lastAttempt: new Date().toISOString(),
        firstAttempt: prev?.firstAttempt ?? new Date().toISOString(),
        attempts,
        reason,
        reasonCode,
        stage: stageResult?.stage ?? null,
        stageName: stageResult?.stageName ?? null,
      };
      updatedSources[field] = 'ai_enrichment_failed';
    }

    await this.prisma.foods.update({
      where: { id: foodId },
      data: {
        failed_fields: updatedFailed,
        field_sources: updatedSources,
      },
    });

    this.logger.log(
      `Persisted ${failedFields.length} failed fields for food ${foodId}: [${failedFields.join(', ')}]`,
    );
  }

  // ─── V7.9: 数据完整度评分 ─────────────────────────────────────────────

  /**
   * 计算单个食物的数据完整度评分
   * 加权计算：核心营养素(0.35) + 微量营养素(0.25) + 健康属性(0.15) + 使用属性(0.15) + 扩展属性(0.10)
   */
  computeCompletenessScore(food: any): CompletenessScore {
    // V8.2: field_sources 用于判断默认值字段是否被真正补全
    const fieldSources: Record<string, string> =
      (food.field_sources as Record<string, string>) || {};

    const isFieldFilled = (field: string): boolean => {
      const value = food[field];
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      // V8.2: 默认值字段 — 无 field_sources 记录则视为未真正填充
      if (field === 'processing_level' || field === 'commonality_score') {
        return !!fieldSources[field];
      }
      if (field === 'available_channels') {
        return !!fieldSources[field];
      }
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
    const extendedFields = ENRICHMENT_STAGES[4].fields;

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
    const extendedAttributes = computeGroupScore(
      extendedFields as unknown as string[],
    );

    const score = Math.round(
      (coreNutrients * 0.35 +
        microNutrients * 0.25 +
        healthAttributes * 0.15 +
        usageAttributes * 0.15 +
        extendedAttributes * 0.1) *
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
      extendedAttributes: Math.round(extendedAttributes * 100),
      missingCritical,
    };
  }

  // ─── V8.2: 历史统计（基于数据库，不受队列裁剪影响）──────────────────────

  /**
   * 从 foods 表聚合历史补全统计，不依赖 BullMQ 队列快照
   * 解决 removeOnComplete/removeOnFail 导致的计数不准确问题
   */
  async getEnrichmentHistoricalStats(): Promise<{
    total: number;
    enriched: number;
    pending: number;
    failed: number;
    staged: number;
    rejected: number;
    avgCompleteness: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS cnt FROM foods GROUP BY 1`,
    );

    const statusMap: Record<string, number> = {};
    for (const r of rows) {
      statusMap[r.status] = parseInt(r.cnt, 10);
    }

    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    // V8.3: 修复状态键 — 使用 foods.enrichment_status 实际值
    // 实际值: 'pending' | 'staged' | 'completed' | 'partial' | 'failed' | 'rejected'
    const enriched =
      (statusMap['completed'] ?? 0) + (statusMap['partial'] ?? 0);
    const pending = statusMap['pending'] ?? 0;
    const failed = statusMap['failed'] ?? 0;
    const staged = statusMap['staged'] ?? 0;
    const rejected = statusMap['rejected'] ?? 0;

    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      Prisma.sql`SELECT COALESCE(AVG(COALESCE(data_completeness, 0)), 0)::text AS avg FROM foods`,
    );
    const avgCompleteness = parseFloat(
      parseFloat(avgRow[0]?.avg ?? '0').toFixed(1),
    );

    return {
      total,
      enriched,
      pending,
      failed,
      staged,
      rejected,
      avgCompleteness,
    };
  }

  // ─── V7.9: 补全进度统计（V8.2: 修复完整度计算口径）───────────────────────

  /**
   * 获取全库补全进度统计
   * V8.2: 修复 — fullyEnriched/partiallyEnriched/notEnriched 改用 data_completeness 列
   *        修复 — avgCompleteness 改用 AVG(data_completeness) 而非阶段覆盖率均值
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
      const conditions = stage.fields.map((f) =>
        (JSON_ARRAY_FIELDS as readonly string[]).includes(f)
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

    // V8.2: 使用 data_completeness 列计算完整度分布（与 getTaskOverview/getCompletenessDistribution 统一口径）
    const distResult = await this.prisma.$queryRaw<
      Array<{ completeness: string; count: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) >= 80 THEN 'full'
          WHEN COALESCE(data_completeness, 0) >= 40 THEN 'partial'
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

    // V8.2: avgCompleteness 使用 AVG(data_completeness) 而非阶段覆盖率均值
    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      Prisma.sql`SELECT COALESCE(AVG(COALESCE(data_completeness, 0)), 0)::text AS avg FROM foods`,
    );
    const avgCompleteness = Math.round(parseFloat(avgRow[0]?.avg ?? '0'));

    // V8.3: 按 enrichment_status 分布（与 getEnrichmentHistoricalStats 一致）
    const statusRows = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS cnt FROM foods GROUP BY 1`,
    );
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) {
      byStatus[r.status] = parseInt(r.cnt, 10);
    }

    return {
      totalFoods,
      fullyEnriched,
      partiallyEnriched,
      notEnriched,
      avgCompleteness,
      stagesCoverage,
      byStatus,
    };
  }

  // ─── V8.0: 全库完整度分布统计 ──────────────────────────────────────────

  /**
   * 按完整度区间（0-20/20-40/40-60/60-80/80-100）统计食物数量
   * 使用持久化的 data_completeness 字段（0-100），NULL 视为 0
   */
  async getCompletenessDistribution(): Promise<{
    total: number;
    distribution: { range: string; min: number; max: number; count: number }[];
    avgCompleteness: number;
  }> {
    const total = await this.prisma.foods.count();
    if (total === 0) {
      return {
        total: 0,
        distribution: [
          { range: '0-20', min: 0, max: 20, count: 0 },
          { range: '20-40', min: 20, max: 40, count: 0 },
          { range: '40-60', min: 40, max: 60, count: 0 },
          { range: '60-80', min: 60, max: 80, count: 0 },
          { range: '80-100', min: 80, max: 100, count: 0 },
        ],
        avgCompleteness: 0,
      };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) < 20 THEN '0-20'
          WHEN COALESCE(data_completeness, 0) < 40 THEN '20-40'
          WHEN COALESCE(data_completeness, 0) < 60 THEN '40-60'
          WHEN COALESCE(data_completeness, 0) < 80 THEN '60-80'
          ELSE '80-100'
        END AS bucket,
        COUNT(*)::text AS cnt
      FROM foods
      GROUP BY 1
      ORDER BY 1`,
    );

    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      Prisma.sql`SELECT COALESCE(AVG(COALESCE(data_completeness, 0)), 0)::text AS avg FROM foods`,
    );

    const bucketMap: Record<string, number> = {};
    for (const r of rows) {
      bucketMap[r.bucket] = parseInt(r.cnt, 10);
    }

    const ranges = [
      { range: '0-20', min: 0, max: 20 },
      { range: '20-40', min: 20, max: 40 },
      { range: '40-60', min: 40, max: 60 },
      { range: '60-80', min: 60, max: 80 },
      { range: '80-100', min: 80, max: 100 },
    ];

    return {
      total,
      distribution: ranges.map((r) => ({
        ...r,
        count: bucketMap[r.range] ?? 0,
      })),
      avgCompleteness: parseFloat(parseFloat(avgRow[0]?.avg ?? '0').toFixed(1)),
    };
  }

  // ─── 扫描缺失字段统计 ──────────────────────────────────────────────────

  // ─── 扫描缺失字段统计（V7.9 优化：单次 SQL 聚合）───────────────────────

  async scanMissingFields(): Promise<MissingFieldStats> {
    const total = await this.prisma.foods.count();

    // V8.0: 字段名来自 ENRICHABLE_FIELDS 常量白名单，使用 Prisma.raw 安全构建
    const selectParts = ENRICHABLE_FIELDS.map((field) => {
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field)) {
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
    /** V8.0: 仅选取完整度 <= maxCompleteness 的食物 */
    maxCompleteness?: number,
    /** V8.1: 按分类筛选 */
    category?: string,
    /** V8.1: 按数据来源筛选 */
    primarySource?: string,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    if (fields.length === 0) return [];

    // V8.0: 字段名来自 ENRICHABLE_FIELDS/阶段字段白名单，使用 Prisma.raw 安全构建
    const nullConditions = fields
      .map((f) =>
        (JSON_ARRAY_FIELDS as readonly string[]).includes(f)
          ? `("${f}" IS NULL OR "${f}"::text = '[]')`
          : `"${f}" IS NULL`,
      )
      .join(' OR ');

    // V8.0: 可选完整度上限筛选
    const completenessCondition =
      maxCompleteness !== undefined && maxCompleteness !== null
        ? ` AND (data_completeness IS NULL OR data_completeness <= ${Number(maxCompleteness)})`
        : '';

    // V8.2: 同时选取请求字段的实际值，用于计算 per-food 真正缺失字段
    const fieldSelectParts = fields.map((f) => `"${f}"`).join(', ');

    const rows = await this.prisma.$queryRaw<Record<string, any>[]>(
      Prisma.sql`SELECT id, name, ${Prisma.raw(fieldSelectParts)} FROM foods WHERE (${Prisma.raw(nullConditions)})${Prisma.raw(completenessCondition)}${category ? Prisma.sql` AND category = ${category}` : Prisma.empty}${primarySource ? Prisma.sql` AND primary_source = ${primarySource}` : Prisma.empty} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    );

    // V8.2: 计算每个食物实际缺失的字段（而非返回全部请求字段）
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      missingFields: fields.filter((f) => {
        const value = row[f];
        if (value === null || value === undefined) return true;
        if (
          (JSON_ARRAY_FIELDS as readonly string[]).includes(f) &&
          Array.isArray(value) &&
          value.length === 0
        )
          return true;
        return false;
      }),
    }));
  }

  // ─── V8.1: 查询需要关联表补全的食物（参数化查询，修复SQL注入）──────────

  /**
   * 查询缺少翻译或地区信息的食物列表
   * 使用 Prisma 参数化查询，消除原 controller 中的 SQL 注入风险
   */
  async getFoodsNeedingRelatedEnrichment(
    target: 'translations' | 'regional',
    limit: number,
    offset: number,
    locale?: string,
    region?: string,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    let rows: { id: string; name: string }[];

    if (target === 'translations') {
      if (locale) {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id AND ft.locale = ${locale}
          ) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id
          ) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        );
      }
    } else {
      if (region) {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id AND fri.region = ${region}
          ) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id
          ) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        );
      }
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      missingFields: [],
    }));
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

    const updates: Record<string, any> = {};
    const updated: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const field of ENRICHABLE_FIELDS) {
      const aiValue = result[field];
      if (aiValue === undefined || aiValue === null) continue;

      const existing = (food as any)[field];
      if (existing !== null && existing !== undefined) {
        if (
          (JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
          Array.isArray(existing) &&
          existing.length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (
          (JSON_OBJECT_FIELDS as readonly string[]).includes(field) &&
          typeof existing === 'object' &&
          Object.keys(existing).length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (
          !(JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
          !(JSON_OBJECT_FIELDS as readonly string[]).includes(field)
        ) {
          skipped.push(field);
          continue;
        }
      }

      updates[field] = aiValue;
      updated.push(field);
    }

    if (Object.keys(updates).length === 0) return { updated: [], skipped };

    // V8.0: 合并 field_sources 和 field_confidence 元数据
    // 优先使用 AI 返回的字段级置信度，回退到整体 confidence
    const existingSources =
      (food.field_sources as Record<string, string>) || {};
    const existingConfidence =
      (food.field_confidence as Record<string, number>) || {};
    const newSources = { ...existingSources };
    const newConfidence = { ...existingConfidence };
    const aiFieldConf = result.field_confidence ?? {};
    for (const field of updated) {
      newSources[field] = operator;
      newConfidence[field] = aiFieldConf[field] ?? result.confidence;
    }

    // V8.0: 使用 Prisma 交互式事务保证 foods.update + changelog.create 原子性
    const newVersion = (food.data_version || 1) + 1;

    // 预计算补全后的完整度（在事务内更新到 data_completeness）
    const mergedFood = { ...food, ...updates };
    const completeness = this.computeCompletenessScore(mergedFood);
    const enrichmentStatus =
      completeness.score >= 80
        ? 'completed'
        : completeness.score >= 30
          ? 'partial'
          : 'pending';

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
          // V8.0: 更新补全元数据
          field_sources: newSources,
          field_confidence: newConfidence,
          data_completeness: completeness.score,
          enrichment_status: enrichmentStatus,
          last_enriched_at: new Date(),
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
      `Applied enrichment "${food.name}": [${updated.join(', ')}] completeness=${completeness.score}%`,
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

    // V8.3: 批量获取关联食物的当前值，用于 diff 对比
    const foodIds = [...new Set(rawList.map((log) => log.food_id))];
    const foods =
      foodIds.length > 0
        ? await this.prisma.foods.findMany({
            where: { id: { in: foodIds } },
          })
        : [];
    const foodMap = new Map(foods.map((f) => [f.id, f]));

    const list: StagedEnrichment[] = rawList.map((log) => {
      const changes = log.changes as Record<string, any>;
      const proposed = changes?.proposedValues ?? {};
      const food = foodMap.get(log.food_id);

      // 提取 proposedValues 中的字段对应的食物当前值
      let currentValues: Record<string, any> | undefined;
      if (food && typeof proposed === 'object') {
        currentValues = {};
        for (const key of Object.keys(proposed)) {
          if (
            key === 'confidence' ||
            key === 'reasoning' ||
            key === 'field_confidence'
          )
            continue;
          currentValues[key] = (food as any)[key] ?? null;
        }
      }

      return {
        id: log.id,
        foodId: log.food_id,
        foodName: (log as any).foods?.name ?? undefined,
        action: log.action,
        changes,
        reason: log.reason,
        operator: log.operator,
        version: log.version,
        createdAt: log.created_at,
        currentValues,
      };
    });

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
      include: {
        food_translations: {
          where: { locale: 'zh-CN' },
          take: 1,
          select: { name: true },
        },
      },
    });
    if (!food) throw new Error(`Food ${log.food_id} not found`);

    // V8.1: 修复 name_zh 取值 — 应取 food_translations 的中文翻译名，而非 food.name
    const nameZh = (food as any).food_translations?.[0]?.name ?? null;

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
      /** V8.1: 该字段是新增（当前值为null）还是修改（当前值有值） */
      isNew: boolean;
      /** V8.1: 当前值与建议值是否不同（对于非null当前值） */
      isModified: boolean;
      /** V8.1: 该字段的AI置信度级别 */
      confidenceLevel: 'high' | 'medium' | 'low';
      /** V8.1: 该字段的AI原始置信度分数 */
      fieldConfidence: number;
    }> = [];

    // V8.1: 提取字段级置信度
    const fieldConfidenceMap: Record<string, number> =
      proposedValues.field_confidence ?? {};
    const overallConfidence: number = changes.confidence ?? 0;

    for (const [field, suggestedValue] of Object.entries(proposedValues)) {
      if (
        field === 'confidence' ||
        field === 'reasoning' ||
        field === 'field_confidence'
      )
        continue;
      const currentValue = (food as any)[field] ?? null;
      const isNew = currentValue === null || currentValue === undefined;
      const isModified = !isNew && currentValue !== suggestedValue;
      const fc = fieldConfidenceMap[field] ?? overallConfidence;
      const confidenceLevel: 'high' | 'medium' | 'low' =
        fc >= 0.8 ? 'high' : fc >= 0.5 ? 'medium' : 'low';

      diff.push({
        field,
        label: ENRICHMENT_FIELD_LABELS[field] ?? field,
        currentValue,
        suggestedValue,
        unit: ENRICHMENT_FIELD_UNITS[field] ?? '',
        validRange: NUTRIENT_RANGES[field] ?? null,
        isNew,
        isModified,
        confidenceLevel,
        fieldConfidence: Math.round(fc * 100) / 100,
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
        name_zh: nameZh,
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
    /** V8.0: 可选，只入库指定的字段（字段级选择性入库） */
    selectedFields?: string[],
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

    // V8.0: 如果指定了 selectedFields，只保留选中的字段
    let filteredProposed = proposed;
    if (selectedFields && selectedFields.length > 0 && target === 'foods') {
      const filteredData: EnrichmentResult = {
        confidence: proposed.confidence,
        reasoning: proposed.reasoning,
        field_confidence: proposed.field_confidence,
      };
      for (const field of selectedFields) {
        if (proposed[field] !== undefined) {
          filteredData[field] = proposed[field];
        }
      }
      filteredProposed = filteredData;
    }

    let detail = '';

    if (target === 'foods') {
      const { updated, skipped } = await this.applyEnrichment(
        log.food_id,
        filteredProposed,
        operator,
      );
      detail = `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`;
      if (selectedFields) {
        detail += `, selectedFields=[${selectedFields.join(',')}]`;
      }
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

    // V8.1: 更新 foods 表的审核者追踪字段
    // V8.2: 审核通过后重新计算并更新 data_completeness 和 enrichment_status
    if (target === 'foods') {
      const updatedFood = await this.prisma.foods.findUnique({
        where: { id: log.food_id },
      });
      if (updatedFood) {
        const completeness = this.computeCompletenessScore(updatedFood);
        const enrichmentStatus =
          completeness.score >= 80
            ? 'completed'
            : completeness.score >= 30
              ? 'partial'
              : 'pending';
        await this.prisma.foods.update({
          where: { id: log.food_id },
          data: {
            reviewed_by: operator,
            reviewed_at: new Date(),
            data_completeness: completeness.score,
            enrichment_status: enrichmentStatus,
          },
        });
      }
    }

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

    // V8.3: 更新 foods.enrichment_status 为 'rejected'
    // 修复：拒绝前状态为 'staged'，拒绝后应标记为 'rejected' 以便统计和重新补全
    await this.prisma.foods.update({
      where: { id: log.food_id },
      data: { enrichment_status: 'rejected' },
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

  // ─── V8.2: 批量审核拒绝 ───────────────────────────────────────────────

  async batchRejectStaged(
    logIds: string[],
    reason: string,
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.rejectStaged(logId, reason, operator);
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
              'ai_enrichment_rollback',
              'ai_enrichment_rolled_back',
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

  // ─── V8.0: 回退补全（重置已补全字段为 null，使食物可重新补全）─────────

  /**
   * 回退单条补全记录：
   * 1. 根据 change_log 中记录的 enrichedFields 列表，把对应字段重置为 null
   * 2. 清理 field_sources / field_confidence 中对应条目
   * 3. 重算 data_completeness / enrichment_status
   * 4. 写入一条 ai_enrichment_rollback 日志
   * 5. 将原 change_log 标记为 ai_enrichment_rolled_back
   */
  async rollbackEnrichment(
    logId: string,
    operator = 'admin',
  ): Promise<{ rolledBack: boolean; detail: string }> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`日志 ${logId} 不存在`);

    // 仅允许回退"已入库"和"已审核通过"的记录
    if (
      log.action !== 'ai_enrichment' &&
      log.action !== 'ai_enrichment_approved'
    ) {
      throw new Error(
        `日志 ${logId} 的操作类型为 ${log.action}，无法回退（仅支持 ai_enrichment / ai_enrichment_approved）`,
      );
    }

    const changes = log.changes as Record<string, any>;
    // 从 change_log 中提取当时补全的字段列表
    const enrichedFields: string[] = changes.enrichedFields ?? [];
    if (enrichedFields.length === 0) {
      // 如果是 approved 记录，可能字段在 proposedValues 里
      const proposed = changes.proposedValues ?? {};
      const { confidence, reasoning, field_confidence, ...fields } = proposed;
      enrichedFields.push(
        ...Object.keys(fields).filter((k) => fields[k] != null),
      );
    }

    if (enrichedFields.length === 0) {
      return { rolledBack: false, detail: '该记录无可回退的字段' };
    }

    const food = await this.prisma.foods.findUnique({
      where: { id: log.food_id },
    });
    if (!food) throw new Error(`食物 ${log.food_id} 不存在`);

    // 构建回退 updates：将补全的字段设为 null
    const rollbackUpdates: Record<string, any> = {};
    for (const field of enrichedFields) {
      rollbackUpdates[field] = null;
    }

    // 清理 field_sources / field_confidence 中的对应条目
    const existingSources =
      (food.field_sources as Record<string, string>) || {};
    const existingConfidence =
      (food.field_confidence as Record<string, number>) || {};
    const newSources = { ...existingSources };
    const newConfidence = { ...existingConfidence };
    for (const field of enrichedFields) {
      delete newSources[field];
      delete newConfidence[field];
    }

    // 重算完整度
    const mergedFood = { ...food, ...rollbackUpdates };
    const completeness = this.computeCompletenessScore(mergedFood);
    const enrichmentStatus =
      completeness.score >= 80
        ? 'completed'
        : completeness.score >= 30
          ? 'partial'
          : 'pending';

    const newVersion = (food.data_version || 1) + 1;

    await this.prisma.$transaction(async (tx) => {
      // 重置字段值
      await tx.foods.update({
        where: { id: log.food_id },
        data: {
          ...rollbackUpdates,
          data_version: newVersion,
          field_sources: newSources,
          field_confidence: newConfidence,
          data_completeness: completeness.score,
          enrichment_status: enrichmentStatus,
          last_enriched_at: food.last_enriched_at, // 保持不变
        },
      });

      // 写入回退日志
      await tx.food_change_logs.create({
        data: {
          food_id: log.food_id,
          version: newVersion,
          action: 'ai_enrichment_rollback',
          changes: {
            rolledBackFields: enrichedFields,
            originalLogId: logId,
            originalAction: log.action,
            previousValues: changes.values ?? null,
          },
          reason: `回退 AI 补全：清除 ${enrichedFields.length} 个字段，使食物可重新补全`,
          operator,
        },
      });

      // 将原日志标记为已回退
      await tx.food_change_logs.update({
        where: { id: logId },
        data: {
          action: 'ai_enrichment_rolled_back',
          reason: `${log.reason ?? ''} [已回退 by ${operator}]`,
        },
      });
    });

    const detail = `已回退 ${enrichedFields.length} 个字段: [${enrichedFields.join(', ')}]，完整度 ${completeness.score}%`;
    this.logger.log(
      `Rollback enrichment "${food.name}" logId=${logId}: ${detail}`,
    );

    return { rolledBack: true, detail };
  }

  /**
   * 批量回退补全记录
   */
  async batchRollbackEnrichment(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.rollbackEnrichment(logId, operator);
        success++;
      } catch (e) {
        failed++;
        errors.push(`${logId}: ${(e as Error).message}`);
      }
    }

    return { success, failed, errors };
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

    // V8.0: 提取字段级置信度
    if (
      raw.field_confidence &&
      typeof raw.field_confidence === 'object' &&
      !Array.isArray(raw.field_confidence)
    ) {
      const parsedFieldConf: Record<string, number> = {};
      for (const field of requestedFields) {
        const val = raw.field_confidence[field];
        if (typeof val === 'number' && val >= 0 && val <= 1) {
          parsedFieldConf[field] = Math.round(val * 100) / 100;
        }
      }
      if (Object.keys(parsedFieldConf).length > 0) {
        result.field_confidence = parsedFieldConf;
      }
    }

    const stringFields = [
      ...(ENRICHABLE_STRING_FIELDS as unknown as string[]),
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

      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field)) {
        result[field] = Array.isArray(value) ? value : null;
        continue;
      }

      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field)) {
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
   * 获取 AI 补全操作的运维统计数据
   * 包含成功/暂存/已审核/拒绝的数量、审核通过率、平均置信度、按日趋势
   */
  async getEnrichmentStatistics(): Promise<{
    total: number;
    directApplied: number;
    staged: number;
    approved: number;
    rejected: number;
    /** 审核通过率（仅计算已审核的暂存记录） */
    approvalRate: number;
    /** 已入库补全的平均置信度 */
    avgConfidence: number;
    /** 按日统计（最近 30 天） */
    dailyStats: Array<{
      date: string;
      count: number;
      action: string;
    }>;
    /** V8.1: 按阶段的填充覆盖率统计 */
    stageStats: Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
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

    // 审核通过率：已通过 / (已通过 + 已拒绝)
    const reviewedTotal = approved + rejected;
    const approvalRate =
      reviewedTotal > 0
        ? Math.round((approved / reviewedTotal) * 10000) / 100
        : 0;

    // V8.0: 平均置信度 — 从已入库的 change_logs 中提取
    const avgConfResult = await this.prisma.$queryRaw<
      Array<{ avg_conf: string | null }>
    >(
      Prisma.sql`SELECT AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment', 'ai_enrichment_approved')
         AND changes->>'confidence' IS NOT NULL`,
    );
    const avgConfidence = avgConfResult[0]?.avg_conf
      ? Math.round(parseFloat(avgConfResult[0].avg_conf) * 100) / 100
      : 0;

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
      approvalRate,
      avgConfidence,
      dailyStats,
      // V8.1: 阶段级补全统计（从已完成的 enrichFoodNow change_logs 中提取）
      stageStats: await this.getStageStats(),
    };
  }

  /**
   * V8.1: 获取按阶段的补全成功率统计
   * 基于全库食物数据，统计每个阶段字段的填充覆盖率
   */
  private async getStageStats(): Promise<
    Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
    }>
  > {
    const totalFoods = await this.prisma.foods.count();
    if (totalFoods === 0) {
      return ENRICHMENT_STAGES.map((stage) => ({
        stage: stage.stage,
        stageName: stage.name,
        totalFields: stage.fields.length,
        avgSuccessRate: 0,
      }));
    }

    const result: Array<{
      stage: number;
      stageName: string;
      totalFields: number;
      avgSuccessRate: number;
    }> = [];

    for (const stage of ENRICHMENT_STAGES) {
      // 计算该阶段每个字段的非 NULL 比例，取平均
      const conditions = stage.fields.map((f) =>
        (JSON_ARRAY_FIELDS as readonly string[]).includes(f)
          ? `AVG(CASE WHEN "${f}" IS NOT NULL AND "${f}"::text != '[]' THEN 1.0 ELSE 0.0 END)`
          : `AVG(CASE WHEN "${f}" IS NOT NULL THEN 1.0 ELSE 0.0 END)`,
      );
      const avgExpr = `(${conditions.join(' + ')}) / ${stage.fields.length}`;

      const row = await this.prisma.$queryRaw<[{ rate: string }]>(
        Prisma.sql`SELECT (${Prisma.raw(avgExpr)})::text AS rate FROM foods`,
      );

      const avgSuccessRate = row[0]?.rate
        ? Math.round(parseFloat(row[0].rate) * 10000) / 100
        : 0;

      result.push({
        stage: stage.stage,
        stageName: stage.name,
        totalFields: stage.fields.length,
        avgSuccessRate,
      });
    }

    return result;
  }

  // ─── V8.1: 全局任务总览 ──────────────────────────────────────────────

  /**
   * 获取全局补全任务视图：队列状态 + 暂存审核状态 + 完整度概览 + 失败字段 Top10
   * 用于后台 Dashboard 一屏掌握全局数据补全态势
   */
  async getTaskOverview(): Promise<{
    /** 暂存审核待处理数 */
    pendingReview: number;
    /** 全库食物总数 */
    totalFoods: number;
    /** 完整度分布 */
    completenessDistribution: {
      high: number; // >=80
      medium: number; // 40-79
      low: number; // <40
    };
    /** 补全状态分布 */
    enrichmentStatusDistribution: Record<string, number>;
    /** 失败字段 Top10（按 failed_fields 中出现频次降序） */
    topFailedFields: Array<{ field: string; count: number }>;
    /** 最近 7 天补全趋势 */
    recentTrend: Array<{ date: string; enriched: number; failed: number }>;
  }> {
    // 1. 暂存审核待处理数
    const pendingReview = await this.prisma.food_change_logs.count({
      where: { action: 'ai_enrichment_staged' },
    });

    // 2. 全库食物总数
    const totalFoods = await this.prisma.foods.count();

    // 3. 完整度分布
    const compDist = await this.prisma.$queryRaw<
      Array<{ bucket: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) >= 80 THEN 'high'
          WHEN COALESCE(data_completeness, 0) >= 40 THEN 'medium'
          ELSE 'low'
        END AS bucket,
        COUNT(*)::text AS cnt
      FROM foods GROUP BY 1`,
    );

    const completenessDistribution = { high: 0, medium: 0, low: 0 };
    for (const row of compDist) {
      const c = parseInt(row.cnt, 10);
      if (row.bucket === 'high') completenessDistribution.high = c;
      else if (row.bucket === 'medium') completenessDistribution.medium = c;
      else completenessDistribution.low = c;
    }

    // 4. 补全状态分布
    const statusDist = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'none') AS status, COUNT(*)::text AS cnt
       FROM foods GROUP BY 1`,
    );

    const enrichmentStatusDistribution: Record<string, number> = {};
    for (const row of statusDist) {
      enrichmentStatusDistribution[row.status] = parseInt(row.cnt, 10);
    }

    // 5. 失败字段 Top10（从 failed_fields JSONB 中提取 key 并计数）
    const topFailedResult = await this.prisma.$queryRaw<
      Array<{ field: string; cnt: string }>
    >(
      Prisma.sql`SELECT key AS field, COUNT(*)::text AS cnt
       FROM foods, jsonb_object_keys(COALESCE(failed_fields, '{}'::jsonb)) AS key
       GROUP BY key
       ORDER BY COUNT(*) DESC
       LIMIT 10`,
    );

    const topFailedFields = topFailedResult.map((row) => ({
      field: row.field,
      count: parseInt(row.cnt, 10),
    }));

    // 6. 最近 7 天补全趋势
    const trendResult = await this.prisma.$queryRaw<
      Array<{ date: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        CASE
          WHEN action IN ('ai_enrichment', 'ai_enrichment_approved', 'ai_enrichment_now') THEN 'enriched'
          ELSE 'failed'
        END AS action,
        COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment', 'ai_enrichment_approved', 'ai_enrichment_now', 'ai_enrichment_rejected')
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC`,
    );

    const trendMap: Record<string, { enriched: number; failed: number }> = {};
    for (const row of trendResult) {
      if (!trendMap[row.date]) trendMap[row.date] = { enriched: 0, failed: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'enriched') trendMap[row.date].enriched = c;
      else trendMap[row.date].failed = c;
    }

    const recentTrend = Object.entries(trendMap).map(([date, v]) => ({
      date,
      ...v,
    }));

    return {
      pendingReview,
      totalFoods,
      completenessDistribution,
      enrichmentStatusDistribution,
      topFailedFields,
      recentTrend,
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
