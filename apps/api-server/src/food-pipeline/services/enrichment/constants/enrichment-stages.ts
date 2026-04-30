/**
 * 5 阶段补全定义与阶段结果类型
 *
 * 拆分自 food-enrichment.service.ts（步骤 1）。
 * 每阶段独立 Prompt、独立验证、独立入库；
 * 前阶段补全结果作为后阶段的输入上下文，逐步提高数据精度。
 */

import type { EnrichableField } from './enrichable-fields';
import type { EnrichmentResult } from './enrichment.types';

// ─── 分阶段补全定义 ───────────────────────────────────────────────────────

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

// ─── 分阶段补全结果 ───────────────────────────────────────────────────────

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
