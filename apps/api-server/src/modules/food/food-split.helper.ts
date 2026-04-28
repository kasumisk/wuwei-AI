/**
 * food-split.helper.ts
 *
 * ARB-2026-04: Food 上帝表拆分 — 中心化 upsert helper
 *
 * 所有写入 Food 主表的地方（create / update / enrichment）
 * 调用此文件的函数将对应字段同步写入 4 张拆分表：
 *   - food_nutrition_details   (微量营养 + 精细脂肪酸/糖/纤维)
 *   - food_health_assessments  (健康评估)
 *   - food_taxonomies          (分类/标签/兼容性)
 *   - food_portion_guides      (份量/烹饪/操作)
 *
 * 设计原则：
 *   1. 所有函数幂等（upsert），可随时重跑
 *   2. 调用方只需传 foodId + Prisma data payload，本 helper 自动分类
 *   3. 主表字段保留（向后兼容），本 helper 专注拆分表写入
 */

import { PrismaClient } from '@prisma/client';

// ─── 字段分组（与 schema 拆分表对应）────────────────────────────────────────

/** 属于 food_nutrition_details 的 camelCase 字段名 */
export const NUTRITION_DETAIL_FIELDS = new Set([
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminB6',
  'vitaminB12',
  'folate',
  'zinc',
  'magnesium',
  'phosphorus',
  'purine',
  'cholesterol',
  'saturatedFat',
  'transFat',
  'omega3',
  'omega6',
  'addedSugar',
  'naturalSugar',
  'solubleFiber',
  'insolubleFiber',
]);

/** 属于 food_health_assessments 的 camelCase 字段名 */
export const HEALTH_ASSESSMENT_FIELDS = new Set([
  'glycemicIndex',
  'glycemicLoad',
  'isProcessed',
  'isFried',
  'processingLevel',
  'fodmapLevel',
  'oxalateLevel',
  'qualityScore',
  'satietyScore',
  'nutrientDensity',
]);

/** 属于 food_taxonomies 的 camelCase 字段名 */
export const TAXONOMY_FIELDS = new Set([
  'mealTypes',
  'tags',
  'allergens',
  'compatibility',
  'availableChannels',
  'flavorProfile',
  'textureTags',
  'cuisine',
  'dishType',
]);

/** 属于 food_portion_guides 的 camelCase 字段名 */
export const PORTION_GUIDE_FIELDS = new Set([
  'standardServingG',
  'standardServingDesc',
  'commonPortions',
  'cookingMethods',
  'requiredEquipment',
  'prepTimeMinutes',
  'cookTimeMinutes',
  'skillRequired',
  'servingTemperature',
  'estimatedCostLevel',
  'shelfLifeDays',
  'waterContentPercent',
]);

// ─── Prisma transaction type ─────────────────────────────────────────────────
// 兼容 PrismaClient 和 $transaction 内部的 tx 对象
type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── 核心 upsert 函数 ────────────────────────────────────────────────────────

/**
 * 从一个 Prisma food data payload 中提取属于特定拆分表的字段
 */
function pickFields(
  data: Record<string, any>,
  fieldSet: Set<string>,
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => fieldSet.has(k)),
  );
}

/**
 * 将 food data payload 同步 upsert 到 4 张拆分表
 *
 * 使用方法：
 *   await upsertFoodSplitTables(tx, foodId, data);
 *
 * @param prismaOrTx  PrismaClient 或 $transaction 内的 tx
 * @param foodId      foods.id
 * @param data        写入 foods 主表的同一个 camelCase data 对象（原样传入，自动分类）
 */
export async function upsertFoodSplitTables(
  prismaOrTx: PrismaTx,
  foodId: string,
  data: Record<string, any>,
): Promise<void> {
  const nutritionData = pickFields(data, NUTRITION_DETAIL_FIELDS);
  const healthData = pickFields(data, HEALTH_ASSESSMENT_FIELDS);
  const taxonomyData = pickFields(data, TAXONOMY_FIELDS);
  const portionData = pickFields(data, PORTION_GUIDE_FIELDS);

  const ops: Promise<any>[] = [];

  if (Object.keys(nutritionData).length > 0) {
    ops.push(
      prismaOrTx.foodNutritionDetail.upsert({
        where: { foodId },
        create: { foodId, ...nutritionData },
        update: nutritionData,
      }),
    );
  }

  if (Object.keys(healthData).length > 0) {
    ops.push(
      prismaOrTx.foodHealthAssessment.upsert({
        where: { foodId },
        create: { foodId, ...healthData },
        update: healthData,
      }),
    );
  }

  if (Object.keys(taxonomyData).length > 0) {
    ops.push(
      prismaOrTx.foodTaxonomy.upsert({
        where: { foodId },
        create: { foodId, ...taxonomyData },
        update: taxonomyData,
      }),
    );
  }

  if (Object.keys(portionData).length > 0) {
    ops.push(
      prismaOrTx.foodPortionGuide.upsert({
        where: { foodId },
        create: { foodId, ...portionData },
        update: portionData,
      }),
    );
  }

  if (ops.length > 0) {
    await Promise.all(ops);
  }
}

// ─── include helper（读取时用）────────────────────────────────────────────────

/**
 * 标准的 Food include 对象——在 findUnique/findMany 时使用
 * 以便读取路径可以通过 food.nutritionDetail / food.healthAssessment 等访问拆分表
 *
 * 用法：
 *   prisma.food.findUnique({ where: { id }, include: FOOD_SPLIT_INCLUDE })
 */
export const FOOD_SPLIT_INCLUDE = {
  nutritionDetail: true,
  healthAssessment: true,
  taxonomy: true,
  portionGuide: true,
} as const;
