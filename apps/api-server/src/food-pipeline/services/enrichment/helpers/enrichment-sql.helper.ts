/**
 * SQL 辅助函数：拆分表字段引用 / JOIN / 条件构造
 *
 * 拆分自 food-enrichment.service.ts（步骤 2）。
 * 这些函数是纯函数（不依赖 this），抽出后 service 通过 import 调用。
 */

import {
  NUTRITION_DETAIL_FIELDS,
  HEALTH_ASSESSMENT_FIELDS,
  TAXONOMY_FIELDS,
  PORTION_GUIDE_FIELDS,
} from '../../../../modules/food/food-split.helper';
import { snakeToCamel } from '../constants/enrichable-fields';
import {
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
} from '../constants/enrichable-fields';

/**
 * 给定 snake_case 或 camelCase 字段名，返回对应拆分表的列引用
 * 例: "added_sugar" → 'nd."added_sugar"'
 *     "mealTypes"   → 'tx."meal_types"'
 *
 * 若字段不属于任何拆分表，返回 foods 主表引用。
 */
export function getFieldSqlRef(field: string): string {
  // field 可能是 snake_case，也可能是 camelCase
  const column = field.includes('_')
    ? field
    : field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

  const camelField = snakeToCamel(column);

  if (NUTRITION_DETAIL_FIELDS.has(camelField)) return `nd."${column}"`;
  if (HEALTH_ASSESSMENT_FIELDS.has(camelField)) return `ha."${column}"`;
  if (TAXONOMY_FIELDS.has(camelField)) return `tx."${column}"`;
  if (PORTION_GUIDE_FIELDS.has(camelField)) return `pg."${column}"`;
  return `foods."${column}"`;
}

/**
 * 返回带 4 张拆分表 LEFT JOIN 的 FROM 子句（不含 SELECT / WHERE）
 */
export function getFoodSplitFromSql(): string {
  return `FROM foods
      LEFT JOIN food_nutrition_details nd ON nd.food_id = foods.id
      LEFT JOIN food_health_assessments ha ON ha.food_id = foods.id
      LEFT JOIN food_taxonomies tx ON tx.food_id = foods.id
      LEFT JOIN food_portion_guides pg ON pg.food_id = foods.id`;
}

/**
 * 构造"字段缺失"的 SQL 条件（IS NULL / 空数组 / 空对象）
 */
export function buildMissingFieldSqlCondition(field: string): string {
  const ref = getFieldSqlRef(field);

  if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field)) {
    return `(${ref} IS NULL OR ${ref}::text IN ('[]', '{}'))`;
  }
  if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field)) {
    return `(${ref} IS NULL OR ${ref}::text = '{}')`;
  }
  return `${ref} IS NULL`;
}

/**
 * 构造"字段已存在"的 SQL 条件（NOT NULL / 非空数组 / 非空对象）
 */
export function buildPresentFieldSqlCondition(field: string): string {
  const ref = getFieldSqlRef(field);

  if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field)) {
    return `(${ref} IS NOT NULL AND ${ref}::text NOT IN ('[]', '{}'))`;
  }
  if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field)) {
    return `(${ref} IS NOT NULL AND ${ref}::text != '{}')`;
  }
  return `${ref} IS NOT NULL`;
}

/**
 * 构造 SELECT 列表中的单列片段，带别名
 */
export function getFieldSelectSql(field: string, alias = field): string {
  return `${getFieldSqlRef(field)} AS "${alias}"`;
}
