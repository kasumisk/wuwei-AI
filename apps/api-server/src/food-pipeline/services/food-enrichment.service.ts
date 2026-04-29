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
import { FoodProvenanceRepository } from '../../modules/food/repositories';
import {
  ENRICHMENT_FIELD_LABELS,
  ENRICHMENT_FIELD_UNITS,
} from '../../modules/food/food.types';
import {
  COOKING_METHODS_FIELD_DESC,
  ALL_COOKING_METHODS,
} from '../../modules/food/cooking-method.constants';
import { upsertFoodSplitTables } from '../../modules/food/food-split.helper';
import {
  HEALTH_ASSESSMENT_FIELDS,
  NUTRITION_DETAIL_FIELDS,
  PORTION_GUIDE_FIELDS,
  TAXONOMY_FIELDS,
} from '../../modules/food/food-split.helper';

// ─── 可补全字段定义（foods 主表）───────────────────────────────────────────

/**
 * snake_case → camelCase（用于 ENRICHABLE_FIELDS 到 Prisma 模型字段名的转换）
 * Prisma schema 使用 camelCase 字段 + @map("snake_case") DB 列名
 * 示例: glycemic_index → glycemicIndex, food_form → foodForm
 */
export const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** camelCase → snake_case（用于在 accumulatedData 中查找已累积的补全数据） */
export const camelToSnake = (s: string): string =>
  s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

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
  'popularity',
  // 描述
  'standard_serving_desc',
  'main_ingredient',
  'flavor_profile',
  // V8.4: aliases 加入可补全字段（已扩大 DB 列 VARCHAR 至 1000）
  'aliases',
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
    // V8.4: food_form 移至 Stage1 — 食物形态是基础属性，应在第一阶段确定
    fields: [
      'protein',
      'fat',
      'carbs',
      'fiber',
      'sugar',
      'sodium',
      'food_form',
    ],
    maxTokens: 600, // FIX: 从450提升至600，避免JSON截断
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
    maxTokens: 1800, // FIX: 从1600提升至1800，为24个字段提供更充足的空间
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
    maxTokens: 650, // FIX: 从500提升至650，tags数组可能较长
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
      'cooking_methods',
      'sub_category',
      'food_group',
      'main_ingredient',
      'standard_serving_desc',
      'quality_score',
      'satiety_score',
      'nutrient_density',
      'commonality_score',
      'popularity',
      // V8.4: aliases 在使用属性阶段补全，已有足够食物上下文
      'aliases',
    ],
    maxTokens: 1000, // FIX: 从900提升至1000，common_portions和flavor_profile是JSON对象
    supportsFallback: false,
  },
  {
    stage: 5,
    name: '扩展属性',
    fields: [
      'ingredient_list',
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
      // V8.2: 新增（food_form 已移至 Stage1）
      'required_equipment',
    ],
    maxTokens: 1100, // FIX: 从1000提升至1100，ingredient_list和compatibility是JSON
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

/**
 * V8.8: AI 可纠正字段白名单
 *
 * 这些字段即使数据库已有值，AI 也可以覆盖。
 * 适用于"种子/导入时写了默认值，但真实值需要 AI 判断"的字段。
 *
 * 当前仅包含 food_form：
 *   - 种子脚本历史上用 `?? 'ingredient'` 写入默认值，导致大量食物
 *     被错误标记为 ingredient，AI 补全因字段非 NULL 而跳过
 *   - food_form 是分类字段，AI 基于食物名称/描述可以给出更准确的判断
 *   - 不包含营养素数字字段：数字已有值通常来自权威来源，不应被 AI 覆盖
 */
export const AI_OVERRIDABLE_FIELDS: ReadonlyArray<string> = [
  'food_form',
  'is_processed',
  'is_fried',
  'acquisition_difficulty',
  'available_channels',
  'standard_serving_g',
  'commonality_score',
  'popularity',
  'common_portions',
  'processing_level',
  'aliases',
  'ingredient_list',
] as const;

/** V2.1: 完整度门槛常量 — 统一所有写入逻辑与进度展示SQL */
export const COMPLETENESS_PARTIAL_THRESHOLD = 30;
export const COMPLETENESS_COMPLETE_THRESHOLD = 80;

export const NUTRIENT_RANGES: Record<string, { min: number; max: number }> = {
  protein: { min: 0, max: 100 },
  fat: { min: 0, max: 100 },
  carbs: { min: 0, max: 100 },
  fiber: { min: 0, max: 80 },
  sugar: { min: 0, max: 100 },
  addedSugar: { min: 0, max: 100 },
  naturalSugar: { min: 0, max: 100 },
  sodium: { min: 0, max: 50000 },
  calcium: { min: 0, max: 2000 },
  iron: { min: 0, max: 100 },
  potassium: { min: 0, max: 10000 },
  cholesterol: { min: 0, max: 2000 },
  vitaminA: { min: 0, max: 50000 },
  vitaminC: { min: 0, max: 2000 },
  vitaminD: { min: 0, max: 1000 },
  vitaminE: { min: 0, max: 500 },
  vitaminB12: { min: 0, max: 100 },
  folate: { min: 0, max: 5000 },
  zinc: { min: 0, max: 100 },
  magnesium: { min: 0, max: 1000 },
  saturatedFat: { min: 0, max: 100 },
  transFat: { min: 0, max: 10 },
  purine: { min: 0, max: 2000 },
  phosphorus: { min: 0, max: 2000 },
  // V8.0: V7.9 新增营养素范围
  vitaminB6: { min: 0, max: 50 },
  omega3: { min: 0, max: 30000 },
  omega6: { min: 0, max: 50000 },
  solubleFiber: { min: 0, max: 40 },
  insolubleFiber: { min: 0, max: 60 },
  waterContentPercent: { min: 0, max: 100 },
  // 属性评分
  glycemicIndex: { min: 0, max: 100 },
  glycemicLoad: { min: 0, max: 50 },
  qualityScore: { min: 0, max: 10 },
  satietyScore: { min: 0, max: 10 },
  nutrientDensity: { min: 0, max: 100 },
  commonalityScore: { min: 0, max: 100 },
  popularity: { min: 0, max: 100 },
  processingLevel: { min: 1, max: 4 },
  // V8.0: 扩展属性数值范围
  prepTimeMinutes: { min: 0, max: 480 },
  cookTimeMinutes: { min: 0, max: 720 },
  estimatedCostLevel: { min: 1, max: 5 },
  shelfLifeDays: { min: 0, max: 3650 },
  dishPriority: { min: 0, max: 100 },
  acquisitionDifficulty: { min: 1, max: 5 },
};

// ─── 字段描述映射（用于 Prompt 构造）─────────────────────────────────────

export const FIELD_DESC: Record<string, string> = {
  // ─── Stage 1: 核心营养素 (number, per 100g edible portion) ──────────
  // 数据来源优先级：USDA FoodData Central SR Legacy → Foundation Foods → FAO/INFOODS → EUROFIR
  protein:
    '[number] protein g/100g (0-100). Total nitrogen × conversion factor (6.25 general, 5.7 wheat, 6.38 dairy). ' +
    'Per 100g edible portion. USDA range ref: beef ~26g, chicken breast ~31g, cooked rice ~2.7g, apple ~0.3g.',
  fat:
    '[number] fat g/100g (0-100). Total lipids (ether extract method). Per 100g edible portion. ' +
    'USDA range ref: butter ~81g, salmon ~13g, whole milk ~3.7g, banana ~0.3g.',
  carbs:
    '[number] carbs g/100g (0-100). Total available carbohydrates by difference (100 - protein - fat - fiber - moisture - ash). ' +
    'Per 100g edible portion. USDA range ref: white rice cooked ~28g, bread ~49g, orange ~12g.',
  fiber:
    '[number] fiber g/100g (0-80). Total dietary fiber (AOAC method). Per 100g edible portion. ' +
    'USDA range ref: oat bran ~15g, lentils cooked ~8g, apple ~2.4g, white rice cooked ~0.4g.',
  sugar:
    '[number] sugar g/100g (0-100). Total sugars (sum of free mono- and disaccharides, natural + added). Per 100g. ' +
    'USDA range ref: honey ~82g, dates ~63g, apple ~10g, plain yogurt ~5g.',
  addedSugar:
    '[number] added_sugar g/100g (0-100). Sugars added during processing or preparation (sucrose, HFCS, etc.). ' +
    '0 for whole unprocessed foods. Relevant for packaged/processed foods.',
  naturalSugar:
    '[number] natural_sugar g/100g (0-100). Inherent sugars present in unprocessed food (fructose in fruit, lactose in dairy). ' +
    'For whole foods, natural_sugar ≈ total sugar. For processed foods, natural_sugar = total_sugar − added_sugar.',
  sodium:
    '[number] sodium mg/100g (0-50000). Total sodium from all sources (intrinsic + added salt/additives). ' +
    'USDA range ref: table salt ~38758mg, soy sauce ~5493mg, canned soup ~430mg, fresh chicken ~74mg, fresh apple ~1mg.',
  // ─── Stage 1: 食物形态 ───────────────────────────────────────────────
  // V8.4: food_form 移至 Stage1，是基础属性，决定后续阶段上下文
  foodForm:
    '[string] food_form: "ingredient" | "dish" | "semi_prepared". ' +
    '"ingredient" = raw or minimally processed single-ingredient food, sold/used as a culinary building block ' +
    '(e.g. chicken breast, brown rice, apple, olive oil, cheddar cheese, dried lentils). ' +
    '"dish" = ready-to-eat or ready-to-serve composed meal or recipe, typically multi-ingredient ' +
    '(e.g. fried rice, beef stew, Caesar salad, pizza, ramen, scrambled eggs). ' +
    '"semi_prepared" = partially processed, requires further cooking/assembly before eating ' +
    '(e.g. dumpling wrappers, marinated raw meat, par-cooked pasta, instant noodle block, bread dough). ' +
    'Decision rule: classify as the food is COMMONLY SOLD/SERVED to consumers, not the theoretical raw state.',
  // ─── Stage 2: 微量营养素 (number, per 100g) ─────────────────────────
  // 数据来源：USDA FoodData Central → EUROFIR → FAO/INFOODS 区域表（亚洲/拉丁/非洲食物）
  calcium:
    '[number] calcium mg/100g (0-2000). Total calcium. ' +
    'USDA ref: parmesan ~1184mg, plain yogurt ~110mg, spinach cooked ~136mg, whole milk ~113mg, cooked chicken ~11mg.',
  iron:
    '[number] iron mg/100g (0-100). Total iron (heme + non-heme). ' +
    'USDA ref: chicken liver ~9mg, lentils cooked ~3.3mg, beef ~2.6mg, spinach raw ~2.7mg, white rice cooked ~0.2mg.',
  potassium:
    '[number] potassium mg/100g (0-10000). Total potassium. ' +
    'USDA ref: dried apricot ~1160mg, banana ~358mg, potato baked ~535mg, whole milk ~132mg.',
  cholesterol:
    '[number] cholesterol mg/100g (0-2000). Dietary cholesterol. ' +
    '0 for all plant foods. USDA ref: egg yolk ~1085mg, whole egg ~373mg, shrimp ~189mg, chicken breast ~85mg.',
  vitaminA:
    '[number] vitamin_a μg RAE/100g (0-50000). Retinol Activity Equivalents. ' +
    'RAE: retinol 1:1; β-carotene dietary 12:1; other provitamin-A 24:1. ' +
    'USDA ref: beef liver ~9442μg RAE, carrot raw ~835μg RAE, sweet potato baked ~961μg RAE, whole milk ~46μg RAE.',
  vitaminC:
    '[number] vitamin_c mg/100g (0-2000). Ascorbic acid (L-ascorbic acid). ' +
    'USDA ref: red bell pepper ~128mg, kiwi ~93mg, orange ~53mg, broccoli ~89mg, potato ~20mg. 0 for meat/fish.',
  vitaminD:
    '[number] vitamin_d μg/100g (0-1000). Total vitamin D (D2 ergocalciferol + D3 cholecalciferol). ' +
    'USDA ref: salmon ~11μg, canned tuna ~4.5μg, egg yolk ~2.2μg, fortified milk ~1μg. Near 0 for plant foods unless fortified.',
  vitaminE:
    '[number] vitamin_e mg/100g (0-500). Alpha-tocopherol equivalents (α-TE). ' +
    'USDA ref: wheat germ oil ~149mg, sunflower seeds ~35mg, almonds ~26mg, olive oil ~14mg, spinach ~2mg.',
  vitaminB12:
    '[number] vitamin_b12 μg/100g (0-100). Cobalamin (all forms). ' +
    '0 for all plant foods (unless fortified). USDA ref: clams ~98μg, beef liver ~83μg, salmon ~3.2μg, whole milk ~0.45μg.',
  folate:
    '[number] folate μg DFE/100g (0-5000). Dietary Folate Equivalents. ' +
    'DFE: food folate 1:1; synthetic folic acid ×1.7. ' +
    'USDA ref: chicken liver ~578μg DFE, lentils cooked ~181μg DFE, spinach raw ~194μg DFE, orange ~30μg DFE.',
  zinc:
    '[number] zinc mg/100g (0-100). Total zinc. ' +
    'USDA ref: oysters ~39mg, beef ~4.8mg, pumpkin seeds ~7.8mg, chickpeas cooked ~1.5mg, white rice cooked ~0.5mg.',
  magnesium:
    '[number] magnesium mg/100g (0-1000). Total magnesium. ' +
    'USDA ref: pumpkin seeds ~592mg, dark chocolate ~228mg, almonds ~270mg, spinach cooked ~87mg, banana ~27mg.',
  saturatedFat:
    '[number] saturated_fat g/100g (0-100). Total saturated fatty acids. ' +
    'USDA ref: butter ~51g, coconut oil ~87g, cheddar ~21g, beef ~7g, chicken breast ~0.9g, olive oil ~14g.',
  transFat:
    '[number] trans_fat g/100g (0-10). Total trans-fatty acids (industrial + ruminant). ' +
    'Industrial trans fat ≈0 in whole/unprocessed foods. Ruminant sources (butter ~3g, beef ~1g) have small amounts. ' +
    'Near 0 for plant foods. Partially hydrogenated oils may be 2-10g.',
  purine:
    '[number] purine mg/100g (0-2000). Total purines expressed as uric acid precursors. ' +
    'Ref: Kaneko et al. (2014) or ADA purine guidelines. ' +
    'High: organ meats >300mg, sardines ~345mg; Moderate: beef/pork ~100-200mg; Low: dairy/eggs/vegetables <50mg.',
  phosphorus:
    '[number] phosphorus mg/100g (0-2000). Total phosphorus. ' +
    'USDA ref: pumpkin seeds ~1174mg, parmesan ~694mg, salmon ~371mg, whole milk ~84mg, apple ~11mg.',
  vitaminB6:
    '[number] vitamin_b6 mg/100g (0-50). Pyridoxine and related forms. ' +
    'USDA ref: pistachio ~1.7mg, tuna ~0.9mg, potato baked ~0.6mg, banana ~0.37mg, whole milk ~0.04mg.',
  omega3:
    '[number] omega3 mg/100g (0-30000). Total Omega-3 fatty acids: ALA (α-linolenic) + EPA + DHA. ' +
    'Plant foods: ALA dominates (flaxseed ~22800mg, walnut ~9080mg). ' +
    'Fatty fish: EPA+DHA dominate (salmon ~2260mg, mackerel ~5134mg). Near 0 for most plant foods/grains.',
  omega6:
    '[number] omega6 mg/100g (0-50000). Total Omega-6 fatty acids (primarily linoleic acid LA). ' +
    'USDA ref: safflower oil ~74500mg, sunflower oil ~65700mg, corn oil ~53500mg, chicken ~1690mg, olive oil ~9763mg.',
  solubleFiber:
    '[number] soluble_fiber g/100g (0-40). Soluble dietary fiber (pectin, beta-glucan, inulin, psyllium). ' +
    'USDA ref: psyllium ~71g, oat bran ~6.5g, apple ~0.9g, lentils cooked ~1g. Typically 25-50% of total fiber.',
  insolubleFiber:
    '[number] insoluble_fiber g/100g (0-60). Insoluble dietary fiber (cellulose, hemicellulose, lignin). ' +
    'Typically 50-75% of total fiber. Wheat bran ~42g, kidney beans cooked ~5.5g, carrot raw ~1.6g.',
  waterContentPercent:
    '[number] water_content_percent % (0-100). Moisture content (weight loss on drying). ' +
    'USDA ref: cucumber ~95%, apple ~86%, cooked rice ~68%, bread ~37%, cheddar ~37%, dried pasta ~10%, crackers ~4%.',
  // ─── Stage 3: 健康属性 ──────────────────────────────────────────────
  // GI/GL: University of Sydney International GI Database (glycemicindex.com)
  // FODMAP: Monash University Low FODMAP App (monashfodmap.com)
  // NOVA: Monteiro et al., Public Health Nutrition (2019)
  glycemicIndex:
    '[number] glycemic_index integer 0-100. Reference food = glucose (GI=100) or white bread (GI=70). ' +
    'Authoritative source: International GI Database, University of Sydney. ' +
    'Low GI <55: most non-starchy vegetables, legumes, most fruits; Medium GI 55-69: oats, sweet potato; ' +
    'High GI ≥70: white bread ~75, white rice ~73, watermelon ~76. ' +
    'GI applies only to carbohydrate-containing foods; for pure protein/fat foods (meat, eggs, oils), use 0.',
  glycemicLoad:
    '[number] glycemic_load 0-50. GL = (GI × available carbohydrate g per 100g serving) / 100. ' +
    'Report per 100g basis. Low GL <10, Medium 10-19, High ≥20. ' +
    'Example: white rice GI=73, carbs=28g → GL = 73×28/100 = 20.4.',
  fodmapLevel:
    '[string] fodmap_level: "low" | "medium" | "high". ' +
    'Authority: Monash University Low FODMAP Diet App and published research. ' +
    'Low: most proteins, hard cheeses, blueberries, carrots, rice, oats (standard serve). ' +
    'Medium: avocado, sweet potato, canned legumes (rinsed). ' +
    'High: wheat, onion, garlic, apples, cow milk (lactose), legumes (unrinsed), stone fruit.',
  oxalateLevel:
    '[string] oxalate_level: "low" | "medium" | "high". ' +
    'Thresholds per 100g: low <10mg, medium 10-50mg, high >50mg. ' +
    'Reference: Harvard/MGH oxalate food lists. ' +
    'High: spinach ~750mg, rhubarb ~860mg, beets ~152mg. Medium: sweet potato ~28mg. Low: eggs, meat, dairy.',
  processingLevel:
    '[number] processing_level integer 1-4. NOVA classification (Monteiro et al., 2019): ' +
    '1=unprocessed or minimally processed (whole fruits, vegetables, fresh meat, eggs, plain milk, dried legumes). ' +
    '2=processed culinary ingredient (vegetable oils, butter, flour, salt, sugar, honey — used to prepare dishes). ' +
    '3=processed food (canned vegetables/fish, salted nuts, smoked meats, artisan cheese, freshly baked bread). ' +
    '4=ultra-processed (soft drinks, packaged snacks, instant noodles, reconstituted meat products, flavored yogurt).',
  // ─── Stage 3: allergens & tags (also in Stage 3) ────────────────────
  allergens:
    '[string[]] allergens array. Use FDA "Big-9" international standard allergens only: ' +
    'gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame. ' +
    'Empty array [] if food contains none. Do NOT add non-standard allergens. ' +
    'Cross-contamination risk does NOT qualify — only allergens present as ingredients.',
  tags:
    '[string[]] tags Applicable diet/nutrition tags. Choose ONLY from: ' +
    'high_protein(>20g/100g)/low_fat(<3g/100g)/low_carb(<10g/100g)/high_fiber(>5g/100g)/' +
    'low_calorie(<120kcal/100g)/low_sodium(<120mg/100g)/low_sugar(<5g/100g)/' +
    'vegan/vegetarian/gluten_free/dairy_free/keto/paleo/whole_food. ' +
    "Apply only tags that are objectively supported by the food's nutritional data.",
  // ─── Stage 4: 使用属性 ──────────────────────────────────────────────
  subCategory:
    '[string] sub_category Lowercase English code describing the specific food sub-type. ' +
    'Examples: lean_meat/fatty_meat/organ_meat/whole_grain/refined_grain/leafy_green/cruciferous/' +
    'root_vegetable/allium/citrus_fruit/tropical_fruit/berry/stone_fruit/legume/' +
    'dairy_product/hard_cheese/soft_cheese/nut/seed/cold_pressed_oil/refined_oil/' +
    'fermented_food/processed_meat/baked_good/sweet_snack/savory_snack.',
  foodGroup:
    '[string] food_group Lowercase English code for the primary food group. ' +
    'Values: meat/poultry/fish/seafood/egg/dairy/grain/legume/vegetable/fruit/nut/seed/fat/oil/' +
    'sweetener/beverage/herb/spice/condiment/processed.',
  cuisine:
    '[string] cuisine Primary cultural cuisine of origin. Lowercase English code. ' +
    'Values: chinese/japanese/korean/indian/thai/vietnamese/malay/filipino/middle_eastern/' +
    'italian/french/spanish/greek/mediterranean/american/mexican/latin_american/' +
    'british/german/eastern_european/african/international. ' +
    'Use "international" for globally ubiquitous staple foods (rice, bread, eggs, apple).',
  mealTypes:
    '[string[]] meal_types Applicable meal occasions. Values: breakfast/lunch/dinner/snack/brunch/dessert/appetizer. ' +
    'Most main dishes apply to lunch+dinner. Breakfast foods include cereals, eggs, toast. Return 1-4 values.',
  commonPortions:
    '[object[]] common_portions JSON array of 2-4 typical serving sizes. Format: [{"name":"<description>","grams":<number>}]. ' +
    'Use standard international measurements (e.g. "1 cup", "1 tbsp", "1 slice", "1 medium piece"). ' +
    'Reference USDA FNDDS standard portion sizes where available. ' +
    'Example: [{"name":"1 cup cooked","grams":186},{"name":"1/2 cup cooked","grams":93}].',
  qualityScore:
    '[number] quality_score 0-10. Overall nutritional quality score. ' +
    'Consider: nutrient density (vitamins/minerals per calorie), NOVA processing level (lower = better), ' +
    'fiber content, presence of harmful components (trans fat, excess sodium), alignment with WHO dietary guidelines. ' +
    'Ref: whole vegetables/fruits/legumes ≈8-10; lean meats ≈6-8; processed snacks ≈1-3.',
  satietyScore:
    '[number] satiety_score 0-10. Satiety/fullness score. ' +
    'Based on Holt et al. (1995) satiety index research. Key drivers: protein content, fiber content, food volume/water content, texture. ' +
    'High: potatoes ~8, lean meat ~7, legumes ~7; Medium: whole grain bread ~5, cheese ~5; Low: croissant ~2, candy ~1.',
  nutrientDensity:
    '[number] nutrient_density 0-100. Micronutrient density relative to calorie content. ' +
    'Based on ANDI (Aggregate Nutrient Density Index) or similar methodology. ' +
    'High: leafy greens ~900-1000 normalized to 0-100; Low: refined sugar/oils ≈1-5.',
  commonalityScore:
    '[number] commonality_score 0-100. Global availability and consumption frequency. ' +
    '100=universally consumed daily staple (rice, bread, salt). 80=very common in most cultures (chicken, tomato, apple). ' +
    '50=regionally common. 20=specialty ingredient. 5=rare/niche food.',
  popularity:
    '[number] popularity 0-100. Estimated consumer popularity / demand for this food. ' +
    'Reflects how often people actively seek out, order, or purchase this food item. ' +
    '100=globally iconic, extremely in-demand (pizza, sushi, fried chicken). ' +
    '80=widely popular in its region or cuisine (pad thai, tacos, dim sum). ' +
    '60=moderately popular, regularly consumed. ' +
    '40=niche or traditional food with limited mainstream appeal. ' +
    '20=rarely sought, mostly consumed out of necessity or cultural habit. ' +
    '0=near-unknown or historical/extinct food. ' +
    'Distinct from commonality_score (availability) — a food can be widely available but unpopular, or rare but highly coveted.',
  standardServingDesc:
    '[string] standard_serving_desc Human-readable standard serving size. ' +
    'Format: "<quantity> <unit> (<grams>g)". Use USDA FNDDS or national dietary guideline serving sizes. ' +
    'Examples: "1 cup cooked (186g)", "1 medium apple (182g)", "3 oz cooked (85g)", "1 slice (28g)".',
  mainIngredient:
    '[string] main_ingredient Single primary ingredient in lowercase English. ' +
    'For single-ingredient foods, use the food itself (e.g. "chicken", "rice", "apple"). ' +
    'For composed dishes, use the predominant protein or starch (e.g. "beef" for beef stew, "pasta" for spaghetti).',
  flavorProfile:
    '[object] flavor_profile Flavor intensity scores 0-5 for each dimension. ' +
    'Format: {"sweet":<0-5>,"salty":<0-5>,"sour":<0-5>,"spicy":<0-5>,"bitter":<0-5>,"umami":<0-5>}. ' +
    'All 6 keys are required. 0=absent, 1=very mild, 2=mild, 3=moderate, 4=strong, 5=dominant. ' +
    'Example for soy sauce: {"sweet":1,"salty":5,"sour":0,"spicy":0,"bitter":1,"umami":4}.',
  // ─── Stage 4: aliases ───────────────────────────────────────────────
  aliases:
    '[string] aliases Comma-separated alternative names for this food. Critical for search discoverability. ' +
    'Include ALL of the following where applicable: ' +
    '(1) English synonyms and spelling variants (e.g. "aubergine" for "eggplant"). ' +
    '(2) Regional/local names in their native script for widely recognized foods (e.g. "茄子" for eggplant, "なす"). ' +
    '(3) Common brand-generic names and abbreviated forms. ' +
    '(4) Scientific or formal names if commonly known (e.g. "Solanum melongena"). ' +
    '(5) Common cooking/menu names (e.g. "melanzane" for eggplant in Italian cuisine). ' +
    'Target 3-8 aliases. Keep total under 500 characters. ' +
    'Example for "白米饭": "steamed white rice, cooked rice, plain rice, boiled rice, 米飯, ご飯, 쌀밥". ' +
    'Example for "Greek yogurt": "strained yogurt, labneh, 希腊酸奶, 水切りヨーグルト, skyr (Icelandic variant)".',
  // ─── Stage 5: 扩展属性 ──────────────────────────────────────────────
  ingredientList:
    '[string[]] ingredient_list Complete list of ingredients in English, ordered by weight (largest first). ' +
    'Use standard food ingredient names (e.g. "chicken breast", "garlic", "extra virgin olive oil", "sea salt"). ' +
    'For single-ingredient whole foods, return array with one element: ["apple"] or ["chicken breast"]. ' +
    'For composed dishes, list all recognizable ingredients. Do not list sub-ingredients of processed components.',
  cookingMethods: COOKING_METHODS_FIELD_DESC,
  textureTags:
    '[string[]] texture_tags Applicable texture descriptors. Return 1-5 most relevant. ' +
    'Values: crispy/crunchy/tender/soft/chewy/creamy/smooth/fluffy/dense/flaky/gelatinous/fibrous/juicy/dry/sticky. ' +
    "Select based on the food's most common preparation state (cooked unless inherently raw).",
  dishType:
    '[string] dish_type Primary dish category for composed dishes. ' +
    'Values: "dish" | "soup" | "drink" | "dessert" | "snack" | "staple" | "salad" | "sauce" | "bread" | "pastry". ' +
    'For raw ingredients or single-ingredient foods, use the most appropriate category if consumed directly, or null if not applicable.',
  prepTimeMinutes:
    '[number] prep_time_minutes Active preparation time in minutes (0-480) before cooking begins. ' +
    'Includes: washing, cutting, marinating, measuring. Excludes: passive marinating/soaking time, cooking time. ' +
    'Ref: simple salads ~5min, whole roast chicken ~15min, complex pastry ~60min. For raw single ingredients: 0-5.',
  cookTimeMinutes:
    '[number] cook_time_minutes Active cooking time in minutes (0-720). ' +
    'Time from heat-on to food ready. Stir-fry ~5min, steamed fish ~10min, roast chicken ~90min, beef stew ~120min. ' +
    'For raw uncooked foods (salad, sashimi): 0.',
  skillRequired:
    '[string] skill_required Culinary skill level required. ' +
    '"beginner" = no technique required (boiling pasta, scrambled eggs, simple salad). ' +
    '"intermediate" = basic technique (stir-fry, simple baking, pan-seared protein). ' +
    '"advanced" = multiple techniques, timing (French sauces, dim sum, soufflé). ' +
    '"expert" = professional-level precision (croissant lamination, molecular gastronomy, multi-day fermentation).',
  estimatedCostLevel:
    '[number] estimated_cost_level 1-5 relative cost index based on global average market price per 100g. ' +
    '1=very cheap staple (rice, flour, salt, lentils, cabbage). 2=affordable common food (eggs, chicken, pasta, banana). ' +
    '3=average cost (beef, cheese, berries, specialty vegetables). 4=premium (salmon, nuts, aged cheese, exotic fruit). ' +
    '5=luxury/rare (truffles, saffron, premium seafood, wagyu beef).',
  shelfLifeDays:
    '[number] shelf_life_days Typical shelf life in days under recommended storage conditions. ' +
    'Reference: FDA food safety guidelines / USDA storage recommendations. ' +
    'Fresh leafy greens: 3-7; fresh meat/fish: 1-3; whole fruit: 5-14; cooked leftovers: 3-5; ' +
    'whole grains/pasta: 730-1825; canned goods: 730-1825; honey: indefinite (use 3650).',
  servingTemperature:
    '[string] serving_temperature Typical serving temperature. ' +
    '"hot" = served >60°C (soups, stews, hot entrées). "warm" = 40-60°C (some sandwiches, warm salads). ' +
    '"room_temp" = 15-25°C (bread, fresh fruit, most raw foods). "cold" = 4-15°C (salads, chilled desserts, cold cuts). ' +
    '"frozen" = served/consumed frozen (ice cream, frozen desserts).',
  dishPriority:
    '[number] dish_priority 0-100. Priority weight for meal recommendation algorithms. ' +
    '0 for raw single ingredients (they are components, not recommended as standalone meals). ' +
    'Common dishes: 50-70. Popular/versatile dishes: 70-85. Signature/highly popular dishes: 85-100.',
  acquisitionDifficulty:
    '[number] acquisition_difficulty 1-5. Ease of obtaining this food globally. ' +
    '1=available in any supermarket worldwide (rice, chicken, apple, salt). ' +
    '2=available in most supermarkets in developed countries. ' +
    '3=requires specialty/ethnic grocery store. ' +
    '4=seasonal or limited regional availability. ' +
    '5=rare, highly imported, or requires special sourcing.',
  compatibility:
    '[object] compatibility Food pairing guide. ' +
    'Format: {"good":["<food1>","<food2>",...],"avoid":["<food3>",..."]}. ' +
    'Both arrays required (can be empty). "good": foods that enhance flavor, nutrition, or texture when paired. ' +
    '"avoid": foods that clash in flavor, create unhealthy nutritional combinations, or are culturally inappropriate pairings. ' +
    'Provide 2-5 items per array based on culinary tradition and food science.',
  availableChannels:
    '[string[]] available_channels Purchase/acquisition channels for this food. ' +
    'Values: supermarket/convenience_store/wet_market/farmers_market/online/specialty_store/restaurant/bakery/pharmacy. ' +
    'Return all applicable channels. Most common foods: ["supermarket","wet_market"]. ' +
    'Specialty items: ["specialty_store","online"]. Restaurant dishes: ["restaurant"].',
  requiredEquipment:
    '[string[]] required_equipment Kitchen equipment needed to prepare this food from its typical sold state. ' +
    'Values: oven/wok/steamer/blender/food_processor/microwave/grill/air_fryer/pressure_cooker/rice_cooker/knife/none. ' +
    'For raw ready-to-eat foods (fruit, raw vegetables): ["none"]. ' +
    'Include all equipment required for the primary preparation method.',
};

// ─── 低置信度阈值：低于此值强制进入 staging ───────────────────────────────

const CONFIDENCE_STAGING_THRESHOLD = 0.7;

// ─── AI 补全结果结构（主表）────────────────────────────────────────────────

export interface EnrichmentResult {
  [key: string]: any;
  confidence: number;
  reasoning?: string;
  /** V8.0: AI 返回的字段级置信度 */
  fieldConfidence?: Record<string, number>;
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
  /** 目标语言列表（translations 补全时使用）*/
  locales?: string[];
  /** 目标地区（regional 补全时使用）*/
  region?: string;
  /** V7.9: 分阶段补全模式，指定阶段编号 1-5 */
  stages?: number[];
  /**
   * V2.1: 补全模式
   *  - 'staged_flow'  （默认）走完整 5 阶段分阶段流程
   *  - 'direct_fields' 跳过阶段路由，直接对指定 fields 发起一次性 AI 补全并写入
   */
  mode?: 'staged_flow' | 'direct_fields';
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
  private readonly completenessSourceFields = new Set<string>([
    'processing_level',
    'commonality_score',
    'available_channels',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly provenanceRepo: FoodProvenanceRepository,
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

  private getFieldSqlRef(field: string): string {
    const camelField = snakeToCamel(field);
    const column = field;

    if (NUTRITION_DETAIL_FIELDS.has(camelField)) {
      return `nd."${column}"`;
    }
    if (HEALTH_ASSESSMENT_FIELDS.has(camelField)) {
      return `ha."${column}"`;
    }
    if (TAXONOMY_FIELDS.has(camelField)) {
      return `tx."${column}"`;
    }
    if (PORTION_GUIDE_FIELDS.has(camelField)) {
      return `pg."${column}"`;
    }
    return `foods."${column}"`;
  }

  private async getSuccessSourcePresence(
    foodId: string,
    fields: string[],
  ): Promise<Record<string, boolean>> {
    const trackedFields = fields.filter((field) =>
      this.completenessSourceFields.has(field),
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
    if (!this.apiKey) {
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
        if (this.completenessSourceFields.has(field)) {
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

  private buildStageSpecificRules(
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

  private buildStageSystemPrompt(stage: EnrichmentStage): string {
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

  // ─── V7.9: 分阶段 AI 调用（使用阶段专属 max_tokens）─────────────────

  private async callAIForStage(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    stage: EnrichmentStage,
  ): Promise<EnrichmentResult | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const stageSystemPrompt = this.buildStageSystemPrompt(stage);
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: stageSystemPrompt,
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

  // ─── V8.0: 单条立即补全 ──────────────────────────────────────────────

  /**
   * 单条食物立即补全（同步执行，不走队列）
   * 支持指定阶段和字段，补全后自动更新 provenance/data_completeness
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
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
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
          const value = (food as any)[snakeToCamel(field)];
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
      const completeness = this.computeCompletenessScore(
        food,
        await this.getSuccessSourcePresence(
          foodId,
          ENRICHMENT_STAGES.flatMap(
            (stage) => stage.fields as readonly string[],
          ),
        ),
      );
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
      const completeness = this.computeCompletenessScore(
        food,
        await this.getSuccessSourcePresence(
          foodId,
          ENRICHMENT_STAGES.flatMap(
            (stage) => stage.fields as readonly string[],
          ),
        ),
      );
      return {
        success: false,
        foodId,
        foodName: food.name,
        stageResults: [],
        totalEnriched: 0,
        totalFailed: 0,
        completeness,
        enrichmentStatus: food.enrichmentStatus || 'failed',
      };
    }

    // 处理每个阶段的结果
    const staged = options.staged ?? false;
    let totalFailed = 0;

    // V8.4: 将所有阶段结果合并为一个 EnrichmentResult，只写一条汇总 change_log
    // 策略：后阶段字段不覆盖前阶段已有值；置信度取 overallConfidence；fieldConfidence 合并
    const mergedFields: Record<string, any> = {};
    const mergedFieldConfidence: Record<string, number> = {};
    let anyStaged = false;

    for (const sr of multiResult.stages) {
      if (!sr.result) {
        totalFailed += sr.failedFields.length;
        continue;
      }
      // 低置信度阶段强制走 staged
      if (sr.result.confidence < CONFIDENCE_STAGING_THRESHOLD) {
        anyStaged = true;
      }
      // 合并字段（已有值不覆盖，保持先来先得）
      for (const [k, v] of Object.entries(sr.result)) {
        if (k === 'confidence' || k === 'reasoning' || k === 'fieldConfidence')
          continue;
        if (v !== null && v !== undefined && !(k in mergedFields)) {
          mergedFields[k] = v;
        }
      }
      // 合并字段级置信度
      const fc = sr.result.fieldConfidence ?? {};
      for (const [k, v] of Object.entries(fc)) {
        if (!(k in mergedFieldConfidence)) {
          mergedFieldConfidence[k] = v;
        }
      }
      totalFailed += sr.failedFields.length;
    }

    const mergedResult: EnrichmentResult = {
      ...mergedFields,
      confidence: multiResult.overallConfidence,
      reasoning:
        multiResult.stages
          .map((s) => s.result?.reasoning)
          .filter(Boolean)
          .join(' | ') || undefined,
      fieldConfidence:
        Object.keys(mergedFieldConfidence).length > 0
          ? mergedFieldConfidence
          : undefined,
    };

    const shouldStage = staged || anyStaged;
    let totalEnriched = 0;

    if (Object.keys(mergedFields).length > 0) {
      if (shouldStage) {
        // 暂存模式：合并后只写一条 staged 日志
        await this.stageEnrichment(
          foodId,
          mergedResult,
          'foods',
          undefined,
          undefined,
          'ai_enrichment_now',
        );
        totalEnriched = multiResult.stages.reduce(
          (sum, sr) => sum + sr.enrichedFields.length,
          0,
        );
      } else {
        // 直接入库：合并后只调一次 applyEnrichment，只写一条汇总 change_log
        const applied = await this.applyEnrichment(
          foodId,
          mergedResult,
          'ai_enrichment_now',
        );
        totalEnriched = applied.updated.length;
      }
    }

    // 重新获取食物以计算最终完整度
    const updatedFood = await this.prisma.food.findUnique({
      where: { id: foodId },
    });
    const completeness = this.computeCompletenessScore(
      updatedFood || food,
      await this.getSuccessSourcePresence(
        foodId,
        ENRICHMENT_STAGES.flatMap((stage) => stage.fields as readonly string[]),
      ),
    );

    // V8.3: enrichment_status 判定增加 'failed' 分支
    let enrichmentStatus: string;
    if (totalEnriched === 0 && totalFailed > 0) {
      // 全部阶段均失败
      enrichmentStatus = 'failed';
    } else if (shouldStage) {
      // staged 模式下不按 completeness 判定，使用 'staged'
      enrichmentStatus = 'staged';
    } else {
      enrichmentStatus =
        completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
          ? 'completed'
          : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
            ? 'partial'
            : 'pending';
    }

    // 更新状态
    // V8.2: staged 模式下数据未真正入库，仅标记 enrichment_status 为 staged，
    // 不更新 data_completeness（需审核通过后才更新）
    // V8.3: 全部失败时写入 'failed'，非staged非失败时由 applyEnrichment 已更新
    if (shouldStage || (totalEnriched === 0 && totalFailed > 0)) {
      await this.prisma.food.update({
        where: { id: foodId },
        data: {
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: new Date(),
        },
      });
    }

    // V8.2: 持久化失败字段到 food_field_provenance + 更新 field_sources
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

  // ─── V2.1: 直接字段补全（direct_fields 模式）─────────────────────────

  /**
   * 跳过 5 阶段流程，直接对指定 fields 发起一次性 AI 补全并写入。
   * 用于 re-enqueue 场景：字段已明确指定，无需走阶段路由。
   *
   * Prompt 质量与分阶段模式对齐：
   *  - System prompt 携带完整权威数据库声明 + direct_fields 专属角色说明
   *  - User prompt 携带食物所有已有字段值作为上下文 + FIELD_DESC 详细规范
   *  - 按字段类型（数值/字符串/数组/对象）注入专属约束规则
   *  - max_tokens 根据字段数量自适应
   *
   * @param foodId   食物 ID
   * @param fields   要补全的 snake_case 字段列表（来自 ENRICHABLE_FIELDS）
   * @param staged   是否暂存（默认 false：直接入库）
   * @param operator 操作人标识
   */
  async enrichFieldsDirect(
    foodId: string,
    fields: EnrichableField[],
    staged = false,
    operator = 'ai_enrichment_worker',
  ): Promise<{ updated: string[]; skipped: string[] } | null> {
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
      return null;
    }

    if (staged || this.shouldStage(result, staged)) {
      const logId = await this.stageEnrichment(
        foodId,
        result,
        'foods',
        undefined,
        undefined,
        operator,
      );
      this.logger.log(
        `enrichFieldsDirect Staged: foodId=${foodId}, logId=${logId}`,
      );
      return { updated: [], skipped: fields };
    }

    const applied = await this.applyEnrichment(foodId, result, operator);
    this.logger.log(
      `enrichFieldsDirect Applied: foodId=${foodId}, updated=[${applied.updated.join(',')}]`,
    );
    return applied;
  }

  /**
   * direct_fields 模式专属 System Prompt。
   * 与分阶段的 buildStageSystemPrompt 共享权威数据库声明，
   * 补充「跨字段类型一次性补全」专属指引。
   */
  private buildDirectFieldsSystemPrompt(): string {
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
  private buildDirectFieldsPrompt(
    food: any,
    fields: EnrichableField[],
  ): string {
    // ── 1. 构建食物已有数据上下文（与 buildStagePrompt 对齐）────────────
    const CTX_FIELDS: Array<[string, string, string?]> = [
      // [camelKey, 展示标签, 单位(可选)]
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
      if (targetSet.has(camel)) continue; // 目标字段不作为上下文
      const val = food[camel];
      if (val == null) continue;
      knownParts.push(unit ? `${label}: ${val} ${unit}` : `${label}: ${val}`);
    }
    // JSON 类型字段单独处理
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

    // ── 3. 字段类型专属规则────────────────────────────────────────────────
    const fieldSet = new Set<string>(fields);
    const typeRules: string[] = [];

    // 数值型：宏量营养素内部一致性
    const macros = ['protein', 'fat', 'carbs', 'fiber'] as const;
    const hasMacro = macros.some((m) => fieldSet.has(m));
    if (hasMacro) {
      typeRules.push(
        'Macronutrient closure: protein + fat + carbs + fiber + moisture ≈ 100g (±5g tolerance for ash/minor components)',
      );
    }
    // GI/GL 联动
    if (fieldSet.has('glycemic_index') || fieldSet.has('glycemic_load')) {
      typeRules.push(
        'GL = (GI × available carbohydrate g per 100g) / 100; ensure this is internally consistent',
      );
      typeRules.push(
        'GI=0 and GL=0 for pure protein/fat foods (meat, eggs, oils, most cheeses)',
      );
    }
    // 别名格式
    if (fieldSet.has('aliases')) {
      typeRules.push(
        'aliases: comma-separated plain string — NO JSON, NO brackets; MUST include ≥3 entries; include native-script names for non-English foods',
      );
    }
    // 数组字段：非空
    const arrayFields = fields.filter((f) =>
      (JSON_ARRAY_FIELDS as readonly string[]).includes(f),
    );
    if (arrayFields.length > 0) {
      typeRules.push(
        `Array fields (${arrayFields.join(', ')}): return non-empty arrays where any value applies; [] only if truly none apply`,
      );
    }
    // 对象字段：全键必填
    const objectFields = fields.filter((f) =>
      (JSON_OBJECT_FIELDS as readonly string[]).includes(f),
    );
    if (objectFields.length > 0) {
      typeRules.push(
        `Object fields (${objectFields.join(', ')}): ALL expected keys must be present; do not omit any key`,
      );
    }
    // 过敏原
    if (fieldSet.has('allergens')) {
      typeRules.push(
        'allergens: use FDA Big-9 standard only (gluten/dairy/egg/fish/shellfish/tree_nuts/peanuts/soy/sesame); cross-contamination does NOT qualify',
      );
    }
    // food_form
    if (fieldSet.has('food_form')) {
      typeRules.push(
        'food_form: classify as the food is COMMONLY SOLD/SERVED to consumers, not the raw ingredient state',
      );
    }

    const rulesSection =
      typeRules.length > 0
        ? `\nField-type constraints:\n${typeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '';

    // ── 4. JSON schema 输出格式──────────────────────────────────────────
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
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: maxTokens,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const raw = JSON.parse(content) as Record<string, any>;
        const validated = this.validateAndClean(raw, requestedFields, 'foods');
        if (validated) return validated;

        this.logger.warn(
          `[direct_fields] 第${attempt}次验证失败: "${foodName}"`,
        );
      } catch (e) {
        this.logger.warn(
          `[direct_fields] 第${attempt}次调用失败: "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries)
          await this.sleep(this.exponentialBackoff(attempt));
      }
    }

    this.logger.error(`[direct_fields] AI 全部失败: "${foodName}"`);
    return null;
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
      enrichmentStatus: { in: ['failed', 'rejected'] },
    };
    if (foodId) where.id = foodId;

    return this.prisma.food.findMany({
      where,
      select: { id: true, name: true },
      take: limit,
    });
  }

  /**
   * 重置食物的 enrichment_status 为 pending（用于重新入队前）
   */
  async resetEnrichmentStatus(foodId: string): Promise<void> {
    await this.prisma.food.update({
      where: { id: foodId },
      data: { enrichmentStatus: 'pending' },
    });
  }

  // ─── V8.9: 强制按指定字段重新入队 ─────────────────────────────────────────

  /**
   * 强制将指定字段入队重新补全（忽略字段是否为 NULL，全库或按分类筛选）
   *
   * 与 getFoodsNeedingEnrichment 不同：
   *   - 本方法不检查字段是否为 NULL，只要食物存在就入队
   *   - 支持 clearFields=true：入队前先将指定字段清空（允许 AI 重新补全）
   *   - 支持 category / primarySource 筛选缩小范围
   *
   * @param fields       必填：要重新补全的字段列表
   * @param options.limit          每次最多处理的食物数（默认全部，传 0 表示全部）
   * @param options.category       按食物分类筛选
   * @param options.primarySource  按数据来源筛选
   * @param options.clearFields    是否在入队前将指定字段清空（默认 false）
   * @param options.staged         是否使用 staging 模式
   */
  async getALLFoodsForReEnqueue(
    fields: EnrichableField[],
    options: {
      limit?: number;
      category?: string;
      primarySource?: string;
    } = {},
  ): Promise<{ id: string; name: string }[]> {
    const { limit, category, primarySource } = options;

    const where: any = {};
    if (category) where.category = category;
    if (primarySource) where.primarySource = primarySource;

    return this.prisma.food.findMany({
      where,
      select: { id: true, name: true },
      ...(limit && limit > 0 ? { take: limit } : {}),
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 批量清空指定字段（入队前调用，让 AI 可以重新补全）
   * 使用分批处理（每批 200 条）避免超时
   */
  async clearFieldsForFoods(
    foodIds: string[],
    fields: EnrichableField[],
  ): Promise<{ cleared: number }> {
    const validFields = (ENRICHABLE_FIELDS as readonly string[]).filter((f) =>
      (fields as string[]).includes(f),
    ) as EnrichableField[];

    if (validFields.length === 0) return { cleared: 0 };

    // String[] 类型字段（schema 中 @default([])，不可为 null）
    // 清空时必须使用 [] 而非 null，否则 Prisma 抛 "must not be null"
    const ARRAY_FIELDS_CAMEL = new Set([
      'tags',
      'ingredientList',
      'cookingMethods',
      'textureTags',
      'requiredEquipment',
    ]);

    // Int 非空字段（schema 无 `?`，不可设为 null，重置时用 0）
    const INT_NON_NULLABLE = new Set(['commonalityScore', 'popularity']);

    // Json 非空字段（schema 无 `?`，不可设为 null，清空时用空 JSON 默认值）
    const JSON_NON_NULLABLE: Record<string, unknown> = {
      mealTypes: [],
      compatibility: {},
      availableChannels: ['home_cook', 'restaurant', 'delivery', 'convenience'],
      commonPortions: [],
      flavorProfile: null, // flavorProfile 是 Json?（可空），null 合法
    };

    // 构建清空数据对象：String[] 字段用 []，非空 Int 用 0，非空 Json 字段用空默认值，其余用 null
    const clearData: Record<string, unknown> = {};
    for (const f of validFields) {
      const camelKey = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (ARRAY_FIELDS_CAMEL.has(camelKey)) {
        clearData[camelKey] = [];
      } else if (INT_NON_NULLABLE.has(camelKey)) {
        clearData[camelKey] = 0;
      } else if (camelKey in JSON_NON_NULLABLE) {
        clearData[camelKey] = JSON_NON_NULLABLE[camelKey];
      } else {
        clearData[camelKey] = null;
      }
    }

    const BATCH = 200;
    let cleared = 0;
    for (let i = 0; i < foodIds.length; i += BATCH) {
      const batch = foodIds.slice(i, i + BATCH);
      await this.prisma.food.updateMany({
        where: { id: { in: batch } },
        data: { ...clearData, enrichmentStatus: 'pending' },
      });
      cleared += batch.length;
    }

    await this.provenanceRepo.clearSuccessesForFields(foodIds, validFields);

    return { cleared };
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
    const total = await this.prisma.food.count();
    let updated = 0;
    let errors = 0;
    const statusChanges: Record<string, number> = {};
    let cursor: string | undefined;

    this.logger.log(
      `[recalculateCompleteness] 开始批量重算，共 ${total} 条食物`,
    );

    while (true) {
      const foods = await this.prisma.food.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (foods.length === 0) break;
      cursor = foods[foods.length - 1].id;

      for (const food of foods) {
        try {
          const completeness = this.computeCompletenessScore(
            food,
            await this.getSuccessSourcePresence(
              food.id,
              ENRICHMENT_STAGES.flatMap(
                (stage) => stage.fields as readonly string[],
              ),
            ),
          );
          const oldStatus = food.enrichmentStatus || 'pending';

          // 仅对非 staged/rejected/failed 的食物重新判定状态
          // staged/rejected/failed 是由审核流程或失败逻辑设置的，不应被覆盖
          let newStatus = oldStatus;
          if (!['staged', 'rejected', 'failed'].includes(oldStatus)) {
            newStatus =
              completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
                ? 'completed'
                : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
                  ? 'partial'
                  : 'pending';
          }

          const oldCompleteness = food.dataCompleteness ?? 0;

          // 仅在值有变化时才更新，减少写入
          if (
            oldCompleteness !== completeness.score ||
            oldStatus !== newStatus
          ) {
            await this.prisma.food.update({
              where: { id: food.id },
              data: {
                dataCompleteness: completeness.score,
                enrichmentStatus: newStatus,
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
    const food = await this.prisma.food.findUnique({
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

  // ─── V8.2: 失败字段持久化（迁移到 food_field_provenance 表） ──────────

  /**
   * 将补全失败的字段记录到 food_field_provenance 表（status='failed'）
   *
   * V8.2 重构：原 foods.failed_fields JSONB 列已删除，改用 food_field_provenance 关联表。
   * 失败信息以 source='ai_enrichment' + status='failed' 写入；attempts 通过查询既有行计算。
   */
  private async persistFailedFields(
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

  // ─── V7.9: 数据完整度评分 ─────────────────────────────────────────────

  /**
   * 计算单个食物的数据完整度评分
   * 加权计算：核心营养素(0.35) + 微量营养素(0.25) + 健康属性(0.15) + 使用属性(0.15) + 扩展属性(0.10)
   */
  computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean> = {},
  ): CompletenessScore {
    const isFieldFilled = (field: string): boolean => {
      // Prisma 返回的 food 对象使用 camelCase 字段名，ENRICHABLE_FIELDS 是 snake_case
      const value = food[snakeToCamel(field)];
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      // 默认值字段只有在 provenance success 存在时才视为真实补全
      if (this.completenessSourceFields.has(field)) {
        return Boolean(successSourcePresence[field]);
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
      // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值，
      // 排除 pending（completeness=0）食物拉低平均分
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
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
    const totalFoods = await this.prisma.food.count();
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
          ? `(${this.getFieldSqlRef(f)} IS NOT NULL AND ${this.getFieldSqlRef(f)}::text != '[]')`
          : `${this.getFieldSqlRef(f)} IS NOT NULL`,
      );
      const allFilledCondition = conditions.join(' AND ');
      const countResult = await this.prisma.$queryRaw<[{ count: string }]>(
        Prisma.sql`SELECT COUNT(*)::text AS count
                   FROM foods
                   LEFT JOIN food_nutrition_details nd ON nd.food_id = foods.id
                   LEFT JOIN food_health_assessments ha ON ha.food_id = foods.id
                   LEFT JOIN food_taxonomies tx ON tx.food_id = foods.id
                   LEFT JOIN food_portion_guides pg ON pg.food_id = foods.id
                   WHERE ${Prisma.raw(allFilledCondition)}`,
      );
      const count = parseInt(countResult[0]?.count ?? '0', 10);
      stagesCoverage.push({
        stage: stage.stage,
        name: stage.name,
        coverageRate: Math.round((count / totalFoods) * 100),
      });
    }

    // V8.2: 使用 data_completeness 列计算完整度分布（与 getTaskOverview/getCompletenessDistribution 统一口径）
    // V2.1: 门槛与 COMPLETENESS_PARTIAL/COMPLETE_THRESHOLD 常量一致（30/80）
    const distResult = await this.prisma.$queryRaw<
      Array<{ completeness: string; count: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) >= 80 THEN 'full'
          WHEN COALESCE(data_completeness, 0) >= 30 THEN 'partial'
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
    // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值
    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
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
    const total = await this.prisma.food.count();
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
      // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
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
    const total = await this.prisma.food.count();

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

    // 字段名来自 ENRICHABLE_FIELDS/阶段字段白名单，使用 Prisma.raw 安全构建。
    const nullConditions = fields
      .map((f) =>
        (JSON_ARRAY_FIELDS as readonly string[]).includes(f)
          ? `("${f}" IS NULL OR "${f}"::text = '[]')`
          : `"${f}" IS NULL`,
      )
      .join(' OR ');

    // 对允许 AI 覆盖的默认值字段，改用 provenance success 作为“是否真实补全”的依据。
    const overridableFields = fields.filter((f) =>
      AI_OVERRIDABLE_FIELDS.includes(f),
    );
    const overridableCondition =
      overridableFields.length > 0
        ? ' OR ' +
          overridableFields
            .map(
              (f) =>
                `("${f}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM food_field_provenance p WHERE p.food_id = foods.id AND p.field_name = '${f}' AND p.status = 'success' AND p.source IN ('ai_enrichment', 'ai_enrichment_now', 'ai_enrichment_worker', 'batch_enrichment', 'manual', 'rule_inferred')))`,
            )
            .join(' OR ')
        : '';

    // V8.0: 可选完整度上限筛选
    const completenessCondition =
      maxCompleteness !== undefined && maxCompleteness !== null
        ? ` AND (data_completeness IS NULL OR data_completeness <= ${Number(maxCompleteness)})`
        : '';

    // V8.7 FIX: 排除已完整补全（enriched/completed）、部分补全（partial）和待审核（staged）的食物，避免重复入队
    // 实际写入值: applyEnrichment 写 'completed'/'partial', enrichFoodNow staged 写 'staged'
    // 旧版部分食物可能残留 'enriched' 状态，一并排除
    const statusExcludeCondition = ` AND (enrichment_status IS NULL OR enrichment_status NOT IN ('enriched', 'completed', 'staged'))`;

    // V8.2: 同时选取请求字段的实际值，用于计算 per-food 真正缺失字段
    const fieldSelectParts = fields.map((f) => `"${f}"`).join(', ');

    // V8.8: 优先入队完全未补全（data_completeness IS NULL）的食物，其次按完整度升序
    //       同完整度时按 created_at ASC（最老的优先），确保没补全过的食物最先被处理
    //       overridableCondition 扩展了 WHERE 条件，使 food_form 有默认值的食物也能进入队列
    const rows = await this.prisma.$queryRaw<Record<string, any>[]>(
      Prisma.sql`SELECT id, name, ${Prisma.raw(fieldSelectParts)} FROM foods WHERE (${Prisma.raw(nullConditions + overridableCondition)})${Prisma.raw(completenessCondition)}${Prisma.raw(statusExcludeCondition)}${category ? Prisma.sql` AND category = ${category}` : Prisma.empty}${primarySource ? Prisma.sql` AND primary_source = ${primarySource}` : Prisma.empty} ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
    );

    // V8.2: 计算每个食物实际缺失的字段（而非返回全部请求字段）
    // V8.8: AI_OVERRIDABLE_FIELDS 中的字段，即使有值也视为"需要补全"（AI 可纠正）
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
        // V8.8: overridable 字段始终加入 missingFields，确保 AI 有机会纠正默认值
        if (AI_OVERRIDABLE_FIELDS.includes(f)) return true;
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
    locales?: string[],
    region?: string,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    let rows: { id: string; name: string }[];

    // V8.8: 优先未补全（data_completeness IS NULL）的食物，其次按完整度升序
    if (target === 'translations') {
      const targetLocales = (locales ?? []).filter(Boolean);
      if (targetLocales.length > 0) {
        const localeConditions = Prisma.join(
          targetLocales.map(
            (targetLocale) => Prisma.sql`NOT EXISTS (
              SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id AND ft.locale = ${targetLocale}
            )`,
          ),
          ' OR ',
        );
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE (${localeConditions})
          ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id
          ) ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      }
    } else {
      if (region) {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id AND fri.region = ${region}
          ) ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id
          ) ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
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

  async enrichTranslations(
    foodId: string,
    locales: string[],
  ): Promise<Record<string, Record<string, any>>> {
    if (!this.apiKey) return {};

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
      const missingTransFields: string[] = [];
      if (!existing) {
        missingTransFields.push(
          'name',
          'aliases',
          'description',
          'serving_desc',
        );
      } else {
        if (!existing.name) missingTransFields.push('name');
        if (!existing.aliases) missingTransFields.push('aliases');
        if (!existing.description) missingTransFields.push('description');
        if (!existing.servingDesc) missingTransFields.push('serving_desc');
      }

      if (missingTransFields.length > 0) {
        localeFieldMap.set(targetLocale, missingTransFields);
      }
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
标准份量: ${(food as any).portionGuide?.standardServingDesc ?? `${(food as any).portionGuide?.standardServingG ?? ''}g`}

要求：
1. name 使用目标地区最常见、最稳定、最适合普通用户理解的食品名称，优先常用名，不要机械直译。
2. 必须保持食品类别正确，不要把原材料翻成菜名，也不要把菜名翻成原材料。
3. aliases 只保留真实常见别名/异名/拼写变体，逗号分隔；不可靠时返回空字符串。
4. description 只写 1 句客观描述，简洁、非营销、非功效宣称。
5. 遇到地区差异时，按 locale 对应地区习惯翻译；不确定时采用保守、通用、可信的叫法。
6. 严格返回 JSON，不要输出任何额外文本。

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
      const cleaned = this.validateAndClean(
        {
          ...(translationMap[targetLocale] ?? {}),
          confidence,
          reasoning,
        },
        fields,
        'translations',
      );
      if (cleaned) {
        results[targetLocale] = cleaned;
      }
    }

    return results;
  }

  // ─── 地区信息补全（food_regional_info 表）────────────────────────────

  async enrichRegional(
    foodId: string,
    region: string,
  ): Promise<Record<string, any> | null> {
    if (!this.apiKey) return null;

    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) return null;

    const existing = await this.prisma.foodRegionalInfo.findFirst({
      where: { foodId: foodId, region },
    });

    const missingFields: string[] = [];
    if (!existing) {
      missingFields.push(
        'local_popularity',
        'local_price_range',
        'availability',
      );
    } else {
      if (!existing.localPriceRange) missingFields.push('local_price_range');
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
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const updates: Record<string, any> = {};
    const updated: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const field of ENRICHABLE_FIELDS) {
      const aiValue = result[field];
      if (aiValue === undefined || aiValue === null) continue;

      // Prisma schema 使用 camelCase 字段名（@map 到 snake_case DB 列），需转换查找
      const existing = (food as any)[snakeToCamel(field)];
      if (existing !== null && existing !== undefined) {
        // V8.8: AI_OVERRIDABLE_FIELDS 白名单字段即使已有值也允许 AI 覆盖
        // 用于修正种子/导入时写入的默认值（如 food_form 的 'ingredient' 默认值）
        if (AI_OVERRIDABLE_FIELDS.includes(field)) {
          // 直接落入下方赋值逻辑，不跳过
        } else if (
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

    const aiFieldConf = result.fieldConfidence ?? {};

    // V8.0: 使用 Prisma 交互式事务保证 foods.update + changelog.create 原子性
    const newVersion = (food.dataVersion || 1) + 1;

    // 预计算补全后的完整度（在事务内更新到 data_completeness）
    // 将 updates（snake_case key）转为 Prisma camelCase key，mergedFood 与 food 结构一致
    const prismaUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      prismaUpdates[snakeToCamel(k)] = v;
    }
    const mergedFood = { ...food, ...prismaUpdates };
    const successSourcePresence = {
      ...(await this.getSuccessSourcePresence(
        foodId,
        Object.keys(prismaUpdates),
      )),
      ...Object.fromEntries(updated.map((field) => [field, true])),
    };
    const completeness = this.computeCompletenessScore(
      mergedFood,
      successSourcePresence,
    );
    const enrichmentStatus =
      completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
        ? 'completed'
        : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
          ? 'partial'
          : 'pending';

    await this.prisma.$transaction(async (tx) => {
      await tx.food.update({
        where: { id: foodId },
        data: {
          ...prismaUpdates,
          confidence: Math.min(
            food.confidence?.toNumber() ?? 1,
            result.confidence,
          ) as any,
          dataVersion: newVersion,
          dataCompleteness: completeness.score,
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: new Date(),
        },
      });

      // ARB-2026-04: 同步写入拆分表
      await upsertFoodSplitTables(tx, foodId, prismaUpdates);

      await tx.foodChangeLogs.create({
        data: {
          foodId: foodId,
          version: newVersion,
          action: 'ai_enrichment',
          changes: {
            enrichedFields: updated,
            confidence: result.confidence,
            fieldConfidence: Object.fromEntries(
              updated.map((field) => [
                field,
                aiFieldConf[field] ?? result.confidence,
              ]),
            ),
            values: updates,
            reasoning: result.reasoning ?? null,
          },
          reason: `AI 自动补全 ${updated.length} 个字段`,
          operator,
        },
      });
    });

    for (const field of updated) {
      await this.provenanceRepo.recordSuccess({
        foodId,
        fieldName: field,
        source: operator,
        confidence: aiFieldConf[field] ?? result.confidence,
        rawValue: updates[field] as Prisma.InputJsonValue,
      });
      await this.provenanceRepo.clearFailuresForField(foodId, field);
    }

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
    const existing = await this.prisma.foodTranslations.findFirst({
      where: { foodId: foodId, locale },
    });

    const { confidence, reasoning, ...fields } = result;
    const updates: Record<string, any> = {};
    const translationFieldMap: Record<string, string> = {
      serving_desc: 'servingDesc',
    };

    for (const [k, v] of Object.entries(fields)) {
      const prismaField = translationFieldMap[k] ?? k;
      if (v === null || v === undefined) continue;
      if (existing && (existing as any)[prismaField]) continue; // 不覆盖已有
      updates[prismaField] = v;
    }

    if (Object.keys(updates).length === 0)
      return { action: 'updated', fields: [] };

    // V8.0: 使用 Prisma 交互式事务保证翻译写入 + changelog 原子性
    const resultAction: 'created' | 'updated' = existing
      ? 'updated'
      : 'created';
    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.foodTranslations.create({
          data: { foodId: foodId, locale, ...(updates as any) },
        });
      } else {
        await tx.foodTranslations.update({
          where: { id: existing.id },
          data: updates as any,
        });
      }

      const food = await tx.food.findUnique({ where: { id: foodId } });
      if (food) {
        await tx.foodChangeLogs.create({
          data: {
            foodId: foodId,
            version: food.dataVersion ?? 1,
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
    const existing = await this.prisma.foodRegionalInfo.findFirst({
      where: { foodId: foodId, region },
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
    const resultAction: 'created' | 'updated' = existing
      ? 'updated'
      : 'created';
    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.foodRegionalInfo.create({
          data: { foodId: foodId, region, ...(updates as any) },
        });
      } else {
        await tx.foodRegionalInfo.update({
          where: { id: existing.id },
          data: updates as any,
        });
      }

      const food = await tx.food.findUnique({ where: { id: foodId } });
      if (food) {
        await tx.foodChangeLogs.create({
          data: {
            foodId: foodId,
            version: food.dataVersion ?? 1,
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
    locales?: string[],
    region?: string,
    operator = 'ai_enrichment',
  ): Promise<string> {
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const normalizedLocales = [...new Set((locales ?? []).filter(Boolean))];
    const locale = normalizedLocales.length === 1 ? normalizedLocales[0] : null;

    const changesPayload = {
      target,
      locales: normalizedLocales.length > 0 ? normalizedLocales : null,
      region: region ?? null,
      proposedValues: result,
      confidence: result.confidence,
      reasoning: result.reasoning ?? null,
    };

    // V8.4: 防重 — 若该食物已存在未审核的 staged 记录，则覆盖而非新建
    // 避免重复入队时产生多条 ai_enrichment_staged 日志堆积在审核列表
    const andConditions: Prisma.FoodChangeLogsWhereInput[] = [
      { changes: { path: ['target'], equals: target } },
    ];
    if (normalizedLocales.length > 0) {
      andConditions.push({
        changes: { path: ['locales'], equals: normalizedLocales },
      });
    }
    if (region)
      andConditions.push({ changes: { path: ['region'], equals: region } });

    const existingStagedWhere: Prisma.FoodChangeLogsWhereInput = {
      foodId,
      action: 'ai_enrichment_staged',
      AND: andConditions,
    };

    const existingStaged = await this.prisma.foodChangeLogs.findFirst({
      where: existingStagedWhere,
      orderBy: { createdAt: 'desc' },
    });

    let logId: string;
    if (existingStaged) {
      // 已有未审核 staged 记录 → 覆盖更新（保留原 logId，更新补全内容）
      await this.prisma.foodChangeLogs.update({
        where: { id: existingStaged.id },
        data: {
          version: food.dataVersion ?? 1,
          changes: changesPayload,
          reason: `AI 暂存补全（${target}${normalizedLocales.length > 0 ? '/' + normalizedLocales.join(',') : ''}${region ? '/' + region : ''}），待人工审核`,
          operator,
          createdAt: new Date(), // 刷新时间戳，确保排序正确
        },
      });
      logId = existingStaged.id;
      this.logger.log(
        `Updated existing staged enrichment for "${food.name}" (${target}), logId=${logId}, confidence=${result.confidence}`,
      );
    } else {
      const log = await this.prisma.foodChangeLogs.create({
        data: {
          foodId: foodId,
          version: food.dataVersion ?? 1,
          action: 'ai_enrichment_staged',
          changes: changesPayload,
          reason: `AI 暂存补全（${target}${normalizedLocales.length > 0 ? '/' + normalizedLocales.join(',') : ''}${region ? '/' + region : ''}），待人工审核`,
          operator,
        },
      });
      logId = log.id;
      this.logger.log(
        `Staged enrichment for "${food.name}" (${target}), logId=${logId}, confidence=${result.confidence}`,
      );
    }

    return logId;
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
    if (foodId) where.foodId = foodId;
    if (target) where.changes = { path: ['target'], equals: target };

    const [rawList, total] = await Promise.all([
      this.prisma.foodChangeLogs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({ where }),
    ]);

    // V8.3: 批量获取关联食物的当前值，用于 diff 对比
    const foodIds = [...new Set(rawList.map((log) => log.foodId))];
    const foods =
      foodIds.length > 0
        ? await this.prisma.food.findMany({
            where: { id: { in: foodIds } },
          })
        : [];
    const foodMap = new Map(foods.map((f) => [f.id, f]));

    const list: StagedEnrichment[] = rawList.map((log) => {
      const changes = log.changes as Record<string, any>;
      const proposed = changes?.proposedValues ?? {};
      const food = foodMap.get(log.foodId);

      // 提取 proposedValues 中的字段对应的食物当前值
      // proposed 的 key 是 snake_case，Prisma food 对象是 camelCase，需要转换后再读取
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
          const camelKey = snakeToCamel(key);
          currentValues[key] = (food as any)[camelKey] ?? null;
        }
      }

      return {
        id: log.id,
        foodId: log.foodId,
        foodName: (log as any).foods?.name ?? undefined,
        action: log.action,
        changes,
        reason: log.reason,
        operator: log.operator,
        version: log.version,
        createdAt: log.createdAt,
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
      nameZh: string | null;
      category: string | null;
      subCategory: string | null;
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
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
      include: {
        foodTranslations: {
          where: { locale: 'zh-CN' },
          take: 1,
          select: { name: true },
        },
      },
    });
    if (!food) throw new Error(`Food ${log.foodId} not found`);

    // V8.1: 修复 name_zh 取值 — 应取 foodTranslations 的中文翻译名，而非 food.name
    const nameZh = (food as any).foodTranslations?.[0]?.name ?? null;

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
      proposedValues.fieldConfidence ?? {};
    const overallConfidence: number = changes.confidence ?? 0;

    for (const [field, suggestedValue] of Object.entries(proposedValues)) {
      if (
        field === 'confidence' ||
        field === 'reasoning' ||
        field === 'field_confidence'
      )
        continue;
      // field 是 snake_case（来自 AI 返回），转为 camelCase 查找标签/单位和 Prisma 对象
      const camelField = snakeToCamel(field);
      const currentValue = (food as any)[camelField] ?? null;
      const isNew = currentValue === null || currentValue === undefined;
      const isModified = !isNew && currentValue !== suggestedValue;
      const fc = fieldConfidenceMap[field] ?? overallConfidence;
      const confidenceLevel: 'high' | 'medium' | 'low' =
        fc >= 0.8 ? 'high' : fc >= 0.5 ? 'medium' : 'low';

      diff.push({
        field,
        label: ENRICHMENT_FIELD_LABELS[camelField] ?? field,
        currentValue,
        suggestedValue,
        unit: ENRICHMENT_FIELD_UNITS[camelField] ?? '',
        validRange: NUTRIENT_RANGES[camelField] ?? null,
        isNew,
        isModified,
        confidenceLevel,
        fieldConfidence: Math.round(fc * 100) / 100,
      });
    }

    // 获取同类均值参考
    const numericFields = diff
      .filter((d) => NUTRIENT_RANGES[snakeToCamel(d.field)])
      .map((d) => d.field);
    let categoryAverage: Record<string, number> | null = null;
    if (numericFields.length > 0 && food.category) {
      categoryAverage = await this.getCategoryAverage(
        numericFields,
        food.category,
        food.subCategory ?? null,
      );
    }

    return {
      food: {
        id: food.id,
        name: food.name,
        nameZh: nameZh,
        category: food.category ?? null,
        subCategory: food.subCategory ?? null,
      },
      staged: {
        logId: log.id,
        changes: proposedValues,
        confidence: changes.confidence ?? 0,
        target,
        stage,
        createdAt: log.createdAt,
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
    const log = await this.prisma.foodChangeLogs.findUnique({
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
        fieldConfidence: proposed.fieldConfidence,
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
        log.foodId,
        filteredProposed,
        operator,
      );
      detail = `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`;
      if (selectedFields) {
        detail += `, selectedFields=[${selectedFields.join(',')}]`;
      }
    } else if (target === 'translations') {
      const targetLocales = this.normalizeTranslationLocales(changes);
      if (targetLocales.length === 0) {
        throw new Error(`Staged log ${logId} missing translation locale`);
      }
      const appliedDetails: string[] = [];
      for (const locale of targetLocales) {
        const localeProposed = this.getTranslationProposedValues(
          changes,
          proposed,
          locale,
        );
        const res = await this.applyTranslationEnrichment(
          log.foodId,
          locale,
          localeProposed,
          operator,
        );
        appliedDetails.push(`${locale}:${res.action}[${res.fields.join(',')}]`);
      }
      detail = appliedDetails.join('; ');
    } else if (target === 'regional' && changes.region) {
      const res = await this.applyRegionalEnrichment(
        log.foodId,
        changes.region,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    }

    // 将 staged log 标记为已审批
    await this.prisma.foodChangeLogs.update({
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
      const updatedFood = await this.prisma.food.findUnique({
        where: { id: log.foodId },
      });
      if (updatedFood) {
        const completeness = this.computeCompletenessScore(
          updatedFood,
          await this.getSuccessSourcePresence(
            log.foodId,
            ENRICHMENT_STAGES.flatMap(
              (stage) => stage.fields as readonly string[],
            ),
          ),
        );
        const enrichmentStatus =
          completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
            ? 'completed'
            : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
              ? 'partial'
              : 'pending';

        await this.prisma.food.update({
          where: { id: log.foodId },
          data: {
            reviewedBy: operator,
            reviewedAt: new Date(),
            dataCompleteness: completeness.score,
            enrichmentStatus: enrichmentStatus,
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
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    await this.prisma.foodChangeLogs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_rejected',
        reason: `人工拒绝: ${reason}`,
        operator,
      },
    });

    // V8.3: 更新 foods.enrichment_status 为 'rejected'
    // 修复：拒绝前状态为 'staged'，拒绝后应标记为 'rejected' 以便统计和重新补全
    await this.prisma.food.update({
      where: { id: log.foodId },
      data: { enrichmentStatus: 'rejected' },
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
              // FIX: 历史记录不包含 staged（staged 在待审核 tab 展示），
              // 每个食物只展示最终结果记录，避免一食物多条（staged+approved）重复
              'ai_enrichment',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
              'ai_enrichment_rollback',
              'ai_enrichment_rolled_back',
            ],
      },
    };
    if (foodId) where.foodId = foodId;

    const [rawList, total] = await Promise.all([
      this.prisma.foodChangeLogs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.foodId,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.createdAt,
    }));

    return { list, total, page, pageSize };
  }

  // ─── V8.0: 回退补全（重置已补全字段为 null，使食物可重新补全）─────────

  /**
   * 回退单条补全记录：
   * 1. 根据 change_log 中记录的 enrichedFields 列表，把对应字段重置为 null
   * 2. 清理 provenance success 中对应条目
   * 3. 重算 data_completeness / enrichment_status
   * 4. 写入一条 ai_enrichment_rollback 日志
   * 5. 将原 change_log 标记为 ai_enrichment_rolled_back
   */
  async rollbackEnrichment(
    logId: string,
    operator = 'admin',
  ): Promise<{ rolledBack: boolean; detail: string }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
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
      const {
        confidence: _confidence,
        reasoning: _reasoning,
        fieldConfidence: _fieldConfidence,
        ...fields
      } = proposed;
      enrichedFields.push(
        ...Object.keys(fields).filter((k) => fields[k] != null),
      );
    }

    if (enrichedFields.length === 0) {
      return { rolledBack: false, detail: '该记录无可回退的字段' };
    }

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
    });
    if (!food) throw new Error(`食物 ${log.foodId} 不存在`);

    // 构建回退 updates：将补全的字段设为 null
    // enrichedFields 存储的是 snake_case 键，需转为 Prisma camelCase 键后才能写入
    const rollbackUpdates: Record<string, any> = {};
    const rollbackUpdatesCamel: Record<string, any> = {};
    for (const field of enrichedFields) {
      rollbackUpdates[field] = null; // snake_case，用于 mergedFood 完整度计算
      rollbackUpdatesCamel[snakeToCamel(field)] = null; // camelCase，用于 Prisma update
    }

    // 重算完整度（mergedFood 需用 camelCase 与 food 结构一致）
    const mergedFood = { ...food, ...rollbackUpdatesCamel };
    const existingSuccessMap = await this.getSuccessSourcePresence(
      log.foodId,
      enrichedFields,
    );
    for (const field of enrichedFields) {
      delete existingSuccessMap[field];
    }
    const completeness = this.computeCompletenessScore(
      mergedFood,
      existingSuccessMap,
    );
    const enrichmentStatus =
      completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
        ? 'completed'
        : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
          ? 'partial'
          : 'pending';

    const newVersion = (food.dataVersion || 1) + 1;

    await this.prisma.$transaction(async (tx) => {
      // 重置字段值（使用 camelCase 键）
      await tx.food.update({
        where: { id: log.foodId },
        data: {
          ...rollbackUpdatesCamel,
          dataVersion: newVersion,
          dataCompleteness: completeness.score,
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: food.lastEnrichedAt, // 保持不变
        },
      });

      // 将原日志标记为已回退（保留审计痕迹，不删除）
      await tx.foodChangeLogs.update({
        where: { id: logId },
        data: { action: 'ai_enrichment_rolled_back' },
      });

      // 写入回退操作的审计日志
      await tx.foodChangeLogs.create({
        data: {
          foodId: log.foodId,
          version: newVersion,
          action: 'ai_enrichment_rollback',
          changes: {
            rolledBackLogId: logId,
            rolledBackFields: enrichedFields,
            completenessAfter: completeness.score,
          },
          reason: `回退 ${enrichedFields.length} 个 AI 补全字段`,
          operator,
        },
      });
    });

    for (const field of enrichedFields) {
      await this.provenanceRepo.clearSuccessesForField(log.foodId, field);
      await this.provenanceRepo.clearFailuresForField(log.foodId, field);
    }

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
    const raw = await this.callAIRaw(foodName, prompt);
    if (!raw) return null;

    const validated = this.validateAndClean(raw, requestedFields, target);
    if (validated) return validated;

    this.logger.error(`All AI attempts failed for "${foodName}"`);
    return null;
  }

  private async callAIRaw(
    foodName: string,
    prompt: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
    },
  ): Promise<Record<string, any> | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                options?.systemPrompt ??
                '你是权威食品营养数据库专家。根据食物名称和已有数据，推算缺失字段。严格按JSON格式返回，数值基于每100g计算，禁止自由文本。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: options?.maxTokens ?? 1200,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        return JSON.parse(content) as Record<string, any>;
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

  private normalizeTranslationLocales(changes: Record<string, any>): string[] {
    const locales = Array.isArray(changes.locales)
      ? changes.locales.filter(
          (locale): locale is string =>
            typeof locale === 'string' && locale.length > 0,
        )
      : [];
    if (locales.length > 0) return [...new Set(locales)];
    return [];
  }

  private getTranslationProposedValues(
    changes: Record<string, any>,
    proposed: EnrichmentResult,
    locale: string,
  ): EnrichmentResult {
    const localized = changes.proposedValuesByLocale?.[locale];
    if (
      localized &&
      typeof localized === 'object' &&
      !Array.isArray(localized)
    ) {
      return localized as EnrichmentResult;
    }
    return proposed;
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

    // V8.4: 提取字段级置信度
    // Prompt 要求 AI 返回 "field_confidence"（snake_case），但早期代码用 camelCase 解析
    // 两种 key 都兼容，优先取 snake_case（Prompt 规范），回退 camelCase
    const rawFieldConf =
      (raw.field_confidence &&
      typeof raw.field_confidence === 'object' &&
      !Array.isArray(raw.field_confidence)
        ? raw.field_confidence
        : null) ??
      (raw.fieldConfidence &&
      typeof raw.fieldConfidence === 'object' &&
      !Array.isArray(raw.fieldConfidence)
        ? raw.fieldConfidence
        : null);

    if (rawFieldConf) {
      const parsedFieldConf: Record<string, number> = {};
      for (const field of requestedFields) {
        // requestedFields 是 snake_case；AI 可能用 snake_case 或 camelCase 返回
        const val = rawFieldConf[field] ?? rawFieldConf[snakeToCamel(field)];
        if (typeof val === 'number' && val >= 0 && val <= 1) {
          parsedFieldConf[field] = Math.round(val * 100) / 100;
        }
      }
      if (Object.keys(parsedFieldConf).length > 0) {
        result.fieldConfidence = parsedFieldConf;
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
        if (!Array.isArray(value)) {
          result[field] = null;
          continue;
        }
        // V8.5: validate cooking_methods values against the standard code set
        if (field === 'cooking_methods') {
          const validSet = new Set<string>(
            ALL_COOKING_METHODS as readonly string[],
          );
          const filtered = value.filter(
            (v: any) => typeof v === 'string' && validSet.has(v),
          );
          if (filtered.length === 0 && value.length > 0) {
            this.logger.warn(
              `"cooking_methods" AI returned non-standard values: [${value.join(', ')}], discarding`,
            );
          }
          result[field] = filtered.length > 0 ? filtered : null;
          continue;
        }
        result[field] = value;
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

      // V8.4: NUTRIENT_RANGES key 是 camelCase，requestedFields 是 snake_case
      // 同时尝试 snake_case 和 camelCase 两种 key，避免范围校验全部失效
      const range =
        NUTRIENT_RANGES[field] ?? NUTRIENT_RANGES[snakeToCamel(field)];
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
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
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
    // NUTRIENT_RANGES 键是 camelCase，Prisma 对象也是 camelCase，但 DB 列是 snake_case
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

    // 批量查询各字段的 Q1, Q3（SQL 使用 snake_case 列名，别名保留 camelCase 以便后续查找）
    const selectParts = numericFields
      .map((f) => {
        const col = camelToSnake(f);
        return (
          `PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "${col}") AS "${f}_q1", ` +
          `PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "${col}") AS "${f}_q3"`
        );
      })
      .join(', ');

    const whereClause = numericFields
      .map((f) => `"${camelToSnake(f)}" IS NOT NULL`)
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
    const totalFoods = await this.prisma.food.count();
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
          ? `AVG(CASE WHEN ${this.getFieldSqlRef(f)} IS NOT NULL AND ${this.getFieldSqlRef(f)}::text != '[]' THEN 1.0 ELSE 0.0 END)`
          : `AVG(CASE WHEN ${this.getFieldSqlRef(f)} IS NOT NULL THEN 1.0 ELSE 0.0 END)`,
      );
      const avgExpr = `(${conditions.join(' + ')}) / ${stage.fields.length}`;

      const row = await this.prisma.$queryRaw<[{ rate: string }]>(
        Prisma.sql`SELECT (${Prisma.raw(avgExpr)})::text AS rate
                   FROM foods
                   LEFT JOIN food_nutrition_details nd ON nd.food_id = foods.id
                   LEFT JOIN food_health_assessments ha ON ha.food_id = foods.id
                   LEFT JOIN food_taxonomies tx ON tx.food_id = foods.id
                   LEFT JOIN food_portion_guides pg ON pg.food_id = foods.id`,
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
    /** 失败字段 Top10（按 food_field_provenance.status='failed' 出现频次降序） */
    topFailedFields: Array<{ field: string; count: number }>;
    /** 最近 7 天补全趋势 */
    recentTrend: Array<{ date: string; enriched: number; failed: number }>;
  }> {
    // 1. 暂存审核待处理数
    const pendingReview = await this.prisma.foodChangeLogs.count({
      where: { action: 'ai_enrichment_staged' },
    });

    // 2. 全库食物总数
    const totalFoods = await this.prisma.food.count();

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

    // 5. 失败字段 Top10（V8.2: 从 food_field_provenance 表统计 status='failed'）
    const topFailedResult = await this.prisma.$queryRaw<
      Array<{ field: string; cnt: string }>
    >(
      Prisma.sql`SELECT field_name AS field, COUNT(DISTINCT food_id)::text AS cnt
       FROM food_field_provenance
       WHERE status = 'failed'
       GROUP BY field_name
       ORDER BY COUNT(DISTINCT food_id) DESC
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

  // ─── V8.4: 聚合轮询端点（一次请求返回全部实时状态）────────────────────

  /**
   * getDashboardPoll
   * 聚合返回：历史统计 + 进度分布 + 最近10条任务 + 最近10条 change_log
   * 前端只需轮询此一个接口即可实时看到数据流转，无需多次请求。
   * 不依赖 Redis（BullMQ 部分由调用方安全封装后传入）。
   */
  async getDashboardPoll(queueSnapshot: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }): Promise<{
    queue: typeof queueSnapshot;
    historical: Awaited<
      ReturnType<FoodEnrichmentService['getEnrichmentHistoricalStats']>
    >;
    recentLogs: Array<{
      id: string;
      foodId: string;
      foodName: string | undefined;
      action: string;
      enrichedFields: string[];
      confidence: number | null;
      createdAt: Date;
    }>;
    pendingReview: number;
    avgCompleteness: number;
    byStatus: Record<string, number>;
  }> {
    const [historical, recentRaw, pendingReview] = await Promise.all([
      this.getEnrichmentHistoricalStats(),
      this.prisma.foodChangeLogs.findMany({
        where: {
          action: {
            in: [
              'ai_enrichment',
              'ai_enrichment_staged',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({
        where: { action: 'ai_enrichment_staged' },
      }),
    ]);

    const recentLogs = recentRaw.map((log) => {
      const changes = log.changes as Record<string, any>;
      return {
        id: log.id,
        foodId: log.foodId,
        foodName: (log as any).foods?.name as string | undefined,
        action: log.action,
        enrichedFields: (changes.enrichedFields ?? []) as string[],
        confidence:
          changes.confidence != null ? Number(changes.confidence) : null,
        createdAt: log.createdAt,
      };
    });

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
      queue: queueSnapshot,
      historical,
      recentLogs,
      pendingReview,
      avgCompleteness: historical.avgCompleteness,
      byStatus,
    };
  }

  // ─── V8.4: 历史 change_log 字段级对比（已入库的 ai_enrichment 记录）────

  /**
   * getHistoryLogDiff
   * 对 action=ai_enrichment 的 change_log，返回"补全前 vs 补全后"字段级对比。
   * 补全前的值从 change_log.changes.values 读取，
   * 当前值从 foods 实时查询（可能已被后续补全覆盖，标注说明）。
   */
  async getHistoryLogDiff(logId: string): Promise<{
    logId: string;
    foodId: string;
    foodName: string;
    action: string;
    operator: string | null;
    createdAt: Date;
    confidence: number | null;
    diff: Array<{
      field: string;
      /** AI 补全写入的值（来自 change_log.changes.values） */
      enrichedValue: any;
      /** foods 表当前值（可能已被后续操作修改） */
      currentValue: any;
      /** 当前值与补全时写入值是否一致 */
      isCurrent: boolean;
      fieldConfidence: number | null;
    }>;
    enrichedFields: string[];
    reasoning: string | null;
  }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
      include: { foods: { select: { id: true, name: true } } },
    });
    if (!log) throw new Error(`日志 ${logId} 不存在`);
    if (!['ai_enrichment', 'ai_enrichment_approved'].includes(log.action)) {
      throw new Error(
        `日志 ${log.action} 类型不支持对比（仅支持 ai_enrichment / ai_enrichment_approved）`,
      );
    }

    const changes = log.changes as Record<string, any>;
    const enrichedFields: string[] = changes.enrichedFields ?? [];
    const values: Record<string, any> = changes.values ?? {};
    const fieldConf: Record<string, number> = changes.fieldConfidence ?? {};
    const reasoning: string | null = changes.reasoning ?? null;
    const confidence =
      changes.confidence != null ? Number(changes.confidence) : null;

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
    });

    const diff = enrichedFields.map((field) => {
      const enrichedValue = values[field] ?? null;
      const currentValue = food
        ? ((food as any)[snakeToCamel(field)] ?? null)
        : null;
      // 简单深比较（JSON序列化）
      const isCurrent =
        JSON.stringify(enrichedValue) === JSON.stringify(currentValue);
      return {
        field,
        enrichedValue,
        currentValue,
        isCurrent,
        fieldConfidence:
          fieldConf[field] != null ? Number(fieldConf[field]) : null,
      };
    });

    return {
      logId,
      foodId: log.foodId,
      foodName: (log as any).foods?.name ?? log.foodId,
      action: log.action,
      operator: log.operator,
      createdAt: log.createdAt,
      confidence,
      diff,
      enrichedFields,
      reasoning,
    };
  }

  // ─── V8.4: 审核统计报表（细粒度，独立于 getEnrichmentStatistics）────────

  /**
   * getReviewStats
   * 专注于"暂存审核"流程的细粒度报表：
   *   - 总待审核数、审核通过数、审核拒绝数、通过率、拒绝率
   *   - 已审核记录的平均置信度（按 approved / rejected 分组）
   *   - 置信度区间分布（0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0）
   *   - 按日趋势（最近 30 天，分 approved / rejected）
   *   - 未审核的暂存列表概要（最多 20 条，用于快速感知积压）
   */
  async getReviewStats(): Promise<{
    /** 当前待审核（staged）数量 */
    pendingReview: number;
    /** 历史已通过数 */
    approved: number;
    /** 历史已拒绝数 */
    rejected: number;
    /** 已审核总数 */
    reviewed: number;
    /** 通过率（%） */
    approvalRate: number;
    /** 拒绝率（%） */
    rejectionRate: number;
    /** 已审核记录的整体平均置信度 */
    avgConfidenceAll: number;
    /** 已通过记录的平均置信度 */
    avgConfidenceApproved: number;
    /** 已拒绝记录的平均置信度 */
    avgConfidenceRejected: number;
    /** 置信度区间分布（基于所有已审核记录）*/
    confidenceBuckets: Array<{
      bucket: string;
      approved: number;
      rejected: number;
    }>;
    /** 按日趋势（最近 30 天） */
    dailyTrend: Array<{
      date: string;
      approved: number;
      rejected: number;
    }>;
    /** 积压概要：最近入队但仍待审核的 staged 记录（最多 20 条） */
    pendingList: Array<{
      logId: string;
      foodId: string;
      foodName: string;
      enrichedFields: string[];
      confidence: number | null;
      createdAt: Date;
    }>;
  }> {
    // ── 1. 当前待审核数 ──────────────────────────────────────────────
    const pendingReview = await this.prisma.foodChangeLogs.count({
      where: { action: 'ai_enrichment_staged' },
    });

    // ── 2. 历史审核计数 ──────────────────────────────────────────────
    const countResult = await this.prisma.$queryRaw<
      Array<{ action: string; cnt: string }>
    >(
      Prisma.sql`SELECT action, COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
       GROUP BY action`,
    );

    let approved = 0;
    let rejected = 0;
    for (const row of countResult) {
      if (row.action === 'ai_enrichment_approved')
        approved = parseInt(row.cnt, 10);
      else if (row.action === 'ai_enrichment_rejected')
        rejected = parseInt(row.cnt, 10);
    }
    const reviewed = approved + rejected;
    const approvalRate =
      reviewed > 0 ? Math.round((approved / reviewed) * 10000) / 100 : 0;
    const rejectionRate =
      reviewed > 0 ? Math.round((rejected / reviewed) * 10000) / 100 : 0;

    // ── 3. 平均置信度（全部 / 分组）─────────────────────────────────
    const confResult = await this.prisma.$queryRaw<
      Array<{ action: string; avg_conf: string | null }>
    >(
      Prisma.sql`SELECT action, AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL
       GROUP BY action`,
    );

    let avgConfidenceApproved = 0;
    let avgConfidenceRejected = 0;
    for (const row of confResult) {
      const v = row.avg_conf
        ? Math.round(parseFloat(row.avg_conf) * 1000) / 1000
        : 0;
      if (row.action === 'ai_enrichment_approved') avgConfidenceApproved = v;
      else if (row.action === 'ai_enrichment_rejected')
        avgConfidenceRejected = v;
    }

    const allConfResult = await this.prisma.$queryRaw<
      Array<{ avg_conf: string | null }>
    >(
      Prisma.sql`SELECT AVG((changes->>'confidence')::numeric)::text AS avg_conf
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL`,
    );
    const avgConfidenceAll = allConfResult[0]?.avg_conf
      ? Math.round(parseFloat(allConfResult[0].avg_conf) * 1000) / 1000
      : 0;

    // ── 4. 置信度区间分布 ─────────────────────────────────────────────
    const bucketResult = await this.prisma.$queryRaw<
      Array<{ bucket: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
         CASE
           WHEN (changes->>'confidence')::numeric < 0.2 THEN '0.0-0.2'
           WHEN (changes->>'confidence')::numeric < 0.4 THEN '0.2-0.4'
           WHEN (changes->>'confidence')::numeric < 0.6 THEN '0.4-0.6'
           WHEN (changes->>'confidence')::numeric < 0.8 THEN '0.6-0.8'
           ELSE '0.8-1.0'
         END AS bucket,
         action,
         COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND changes->>'confidence' IS NOT NULL
       GROUP BY 1, 2
       ORDER BY 1`,
    );

    const bucketMap: Record<string, { approved: number; rejected: number }> = {
      '0.0-0.2': { approved: 0, rejected: 0 },
      '0.2-0.4': { approved: 0, rejected: 0 },
      '0.4-0.6': { approved: 0, rejected: 0 },
      '0.6-0.8': { approved: 0, rejected: 0 },
      '0.8-1.0': { approved: 0, rejected: 0 },
    };
    for (const row of bucketResult) {
      if (!bucketMap[row.bucket])
        bucketMap[row.bucket] = { approved: 0, rejected: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'ai_enrichment_approved')
        bucketMap[row.bucket].approved = c;
      else if (row.action === 'ai_enrichment_rejected')
        bucketMap[row.bucket].rejected = c;
    }
    const confidenceBuckets = Object.entries(bucketMap).map(([bucket, v]) => ({
      bucket,
      ...v,
    }));

    // ── 5. 按日趋势（最近 30 天）────────────────────────────────────
    const trendResult = await this.prisma.$queryRaw<
      Array<{ date: string; action: string; cnt: string }>
    >(
      Prisma.sql`SELECT
         TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
         action,
         COUNT(*)::text AS cnt
       FROM food_change_logs
       WHERE action IN ('ai_enrichment_approved', 'ai_enrichment_rejected')
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1, 2
       ORDER BY 1 DESC`,
    );

    const trendMap: Record<string, { approved: number; rejected: number }> = {};
    for (const row of trendResult) {
      if (!trendMap[row.date])
        trendMap[row.date] = { approved: 0, rejected: 0 };
      const c = parseInt(row.cnt, 10);
      if (row.action === 'ai_enrichment_approved')
        trendMap[row.date].approved = c;
      else trendMap[row.date].rejected = c;
    }
    const dailyTrend = Object.entries(trendMap).map(([date, v]) => ({
      date,
      ...v,
    }));

    // ── 6. 待审核积压概要（最近 20 条）────────────────────────────────
    const pendingRaw = await this.prisma.foodChangeLogs.findMany({
      where: { action: 'ai_enrichment_staged' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { foods: { select: { name: true } } },
    });

    const pendingList = pendingRaw.map((log) => {
      const changes = log.changes as Record<string, any>;
      return {
        logId: log.id,
        foodId: log.foodId,
        foodName: ((log as any).foods?.name ?? log.foodId) as string,
        enrichedFields: (changes.enrichedFields ?? []) as string[],
        confidence:
          changes.confidence != null ? Number(changes.confidence) : null,
        createdAt: log.createdAt,
      };
    });

    return {
      pendingReview,
      approved,
      rejected,
      reviewed,
      approvalRate,
      rejectionRate,
      avgConfidenceAll,
      avgConfidenceApproved,
      avgConfidenceRejected,
      confidenceBuckets,
      dailyTrend,
      pendingList,
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
