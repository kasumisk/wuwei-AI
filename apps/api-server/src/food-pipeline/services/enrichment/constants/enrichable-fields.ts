/**
 * 可补全字段定义与命名转换工具
 *
 * 拆分自 food-enrichment.service.ts（步骤 1）。
 * 集中管理：
 *  - snake_case ↔ camelCase 转换
 *  - ENRICHABLE_FIELDS（foods 主表 + 拆表的可补全字段总清单）
 *  - 字段类型分组（JSON 数组 / JSON 对象 / 字符串）
 *  - AI_OVERRIDABLE_FIELDS（即使已有值也可被 AI 覆盖的字段白名单）
 */

// ─── 命名转换 ─────────────────────────────────────────────────────────────

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

// ─── 可补全字段定义（foods 主表 + 拆表）───────────────────────────────────

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

// ─── 字段类型分组（共享，避免在各方法中重复定义）──────────────────────────

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
