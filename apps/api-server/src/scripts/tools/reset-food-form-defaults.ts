/**
 * V8.8 数据修复脚本：基于现有字段规则推断并回填 food_form
 *
 * 背景：
 *   seed-foods.ts 历史使用 `foodForm: food.foodForm ?? 'ingredient'` 写入默认值，
 *   导致水果、饮品、调味料、乳制品、零食等大量食物被错标为 'ingredient'。
 *   本脚本不依赖 AI，直接用确定性规则从已有字段推断正确的 food_form。
 *
 * 推断规则（优先级由高到低）：
 *   R1  dishType 有值                          → dish
 *   R2  category 在 {汤类,快餐}                → dish
 *   R3  category 在 {水果,饮品,乳制品,调味料,零食} → dish（直接食用）
 *   R4  cookingMethods 非空                    → dish（已有烹饪方式=成品）
 *   R5  processingLevel >= 3                   → dish（加工/超加工=成品）
 *   R6  isProcessed = true                     → dish
 *   R7  名称含烹饪动词（炒/烤/蒸/煮/炸/拌...） → dish
 *   R8  category=主食 且名称含成品词（饭/粥/面/饼/包/卷...） → semi_prepared
 *   R9  兜底                                   → ingredient
 *
 * 用法：
 *   # 试运行（只统计不写库）
 *   npx ts-node -r tsconfig-paths/register src/scripts/tools/reset-food-form-defaults.ts
 *
 *   # 实际修改
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register src/scripts/tools/reset-food-form-defaults.ts
 *
 * 安全：
 *   - 只修改 food_form 字段（以及 provenance 中对应的来源标记）
 *   - 不修改营养素、评分、其他元数据
 *   - 幂等：重复运行不产生副作用（相同输入产生相同输出）
 *   - 只处理 provenance 中 food_form 非 'manual'/'ai_enrichment' 来源的食物
 *     （即尊重人工录入和已被 AI 正确补全的记录）
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';

type FoodForm = 'ingredient' | 'dish' | 'semi_prepared';

/** 直接食用型分类（不需要烹饪，直接吃就是成品） */
const READY_TO_EAT_CATEGORIES = new Set([
  '水果',
  'fruit',
  '饮品',
  'beverage',
  '乳制品',
  'dairy',
  '调味料',
  'condiment',
  '零食',
  'snack',
]);

/** 明确是成品餐食的分类（注意：composite 是混合/杂项分类，包含坚果/药食材等原料，不在此列） */
const DISH_CATEGORIES = new Set([
  '汤类',
  'composite_soup',
  '快餐',
  'fast_food',
]);

/** 烹饪动词正则：包含这些词的食物名称通常是成品 */
const COOKING_VERB_RE =
  /炒|烤|蒸|煮|炸|拌|烧|炖|煎|卤|烩|熏|酱|焖|涮|爆|扒|溜|氽|汆/;

/** 主食成品词：主食中含这些词的是半成品（已烹饪但作为主食搭配） */
const STAPLE_COOKED_RE =
  /饭|粥|面|饼|包|卷|糕|粉|线|条|馒|花卷|烧卖|粽|包子|馄饨|饺|煎饼|油条|烧饼|馕|贝果/;

/**
 * 根据食物现有字段推断 food_form
 * 与推荐引擎的语义对齐：
 *   ingredient = 原材料，需要烹饪才能食用（生鸡胸肉、生蔬菜）
 *   dish       = 成品，可直接食用（炒菜、汤、快餐、水果、饮品）
 *   semi_prepared = 半成品，需简单搭配/加热（白米饭、馒头、面条）
 */
function inferFoodForm(food: {
  name: string;
  category: string;
  dishType?: string | null;
  cookingMethods?: string[] | null;
  processingLevel?: number | null;
  isProcessed?: boolean | null;
}): { form: FoodForm; rule: string } {
  // R1: dishType 有值 → 成品（dishType 只存在于已烹饪的成品食物）
  if (food.dishType) {
    return { form: 'dish', rule: 'R1:dishType' };
  }

  // R2: 成品餐食分类
  if (DISH_CATEGORIES.has(food.category)) {
    return { form: 'dish', rule: 'R2:category=dish' };
  }

  // R3: 直接食用型分类（水果/饮品/乳制品/调味料/零食）
  if (READY_TO_EAT_CATEGORIES.has(food.category)) {
    return { form: 'dish', rule: 'R3:category=ready_to_eat' };
  }

  // R4: 有烹饪方式记录 → 成品
  if (food.cookingMethods && food.cookingMethods.length > 0) {
    return { form: 'dish', rule: 'R4:cookingMethods' };
  }

  // R5: 加工程度 >= 3（加工食品/超加工）
  if (food.processingLevel != null && food.processingLevel >= 3) {
    return {
      form: 'dish',
      rule: 'R5:processingLevel>=' + food.processingLevel,
    };
  }

  // R6: isProcessed 标记
  if (food.isProcessed === true) {
    return { form: 'dish', rule: 'R6:isProcessed' };
  }

  // R7: 名称含烹饪动词
  if (COOKING_VERB_RE.test(food.name)) {
    return { form: 'dish', rule: 'R7:cookingVerb' };
  }

  // R8: 主食分类 + 成品词 → 半成品（米饭/馒头/面条等属于半成品主食）
  if (
    (food.category === '主食' || food.category === 'grain') &&
    STAPLE_COOKED_RE.test(food.name)
  ) {
    return { form: 'semi_prepared', rule: 'R8:staple_cooked' };
  }

  // R9: 兜底 → 原材料
  return { form: 'ingredient', rule: 'R9:fallback' };
}

async function main() {
  console.log('\n=== V8.8 food_form 规则推断修复脚本 ===');
  console.log(
    `模式: ${DRY_RUN ? '试运行（DRY RUN，不修改数据）' : '实际修改'}`,
  );
  console.log(`开始时间: ${new Date().toISOString()}\n`);

  // 1. 全库 food_form 当前分布
  const before = await prisma.$queryRaw<
    { food_form: string | null; cnt: bigint }[]
  >(
    Prisma.sql`SELECT food_form, COUNT(*) AS cnt FROM foods GROUP BY food_form ORDER BY cnt DESC`,
  );
  console.log('修复前 food_form 分布：');
  for (const row of before) {
    console.log(`  ${row.food_form ?? 'NULL'}: ${Number(row.cnt)}`);
  }

  // 2. 查询需要修复的食物
  //    条件：food_form 非 manual/ai_enrichment 来源（即未被人工或 AI 正确设置过）
  const candidates = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      category: string;
      food_form: string | null;
      dish_type: string | null;
      cooking_methods: string[];
      processing_level: number;
      is_processed: boolean;
      enrichment_status: string | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        id, name, category, food_form, dish_type,
        cooking_methods, processing_level, is_processed,
        enrichment_status
      FROM foods
      WHERE
        NOT EXISTS (
          SELECT 1
          FROM food_field_provenance p
          WHERE p.food_id = foods.id
            AND p.field_name = 'food_form'
            AND p.status = 'success'
            AND p.source IN ('manual', 'ai_enrichment', 'ai_enrichment_staged')
        )
      ORDER BY category, name
    `,
  );

  console.log(`\n待处理食物：${candidates.length} 条`);

  if (candidates.length === 0) {
    console.log('✅ 没有需要修复的数据，退出。');
    return;
  }

  // 3. 对每条食物推断 food_form
  const results: Array<{
    id: string;
    name: string;
    category: string;
    oldForm: string | null;
    newForm: FoodForm;
    rule: string;
    changed: boolean;
  }> = [];

  for (const food of candidates) {
    const { form, rule } = inferFoodForm({
      name: food.name,
      category: food.category,
      dishType: food.dish_type,
      cookingMethods: food.cooking_methods,
      processingLevel: food.processing_level,
      isProcessed: food.is_processed,
    });
    results.push({
      id: food.id,
      name: food.name,
      category: food.category,
      oldForm: food.food_form,
      newForm: form,
      rule,
      changed: food.food_form !== form,
    });
  }

  // 4. 统计推断结果
  const changed = results.filter((r) => r.changed);
  const unchanged = results.filter((r) => !r.changed);
  const ruleStats: Record<string, number> = {};
  const formStats: Record<string, number> = {};
  for (const r of results) {
    ruleStats[r.rule] = (ruleStats[r.rule] || 0) + 1;
    formStats[r.newForm] = (formStats[r.newForm] || 0) + 1;
  }

  console.log(`\n推断结果：`);
  console.log(`  需要更新: ${changed.length} 条`);
  console.log(`  已经正确: ${unchanged.length} 条`);
  console.log(`\n推断后 food_form 分布（待处理的 ${candidates.length} 条）：`);
  for (const [form, cnt] of Object.entries(formStats).sort()) {
    console.log(`  ${form}: ${cnt}`);
  }
  console.log(`\n命中规则分布：`);
  for (const [rule, cnt] of Object.entries(ruleStats).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${rule}: ${cnt}`);
  }

  console.log(`\n变更样本（前 30 条）：`);
  for (const r of changed.slice(0, 30)) {
    console.log(
      `  [${r.category}] ${r.name}: ${r.oldForm ?? 'NULL'} → ${r.newForm}  (${r.rule})`,
    );
  }
  if (changed.length > 30) {
    console.log(`  ... 以及另外 ${changed.length - 30} 条`);
  }

  if (DRY_RUN) {
    console.log('\n⚠️  试运行模式，不修改数据。');
    console.log('   运行 DRY_RUN=false ... 以实际修改。');
    return;
  }

  // 5. 批量写入
  console.log('\n开始写入...');
  let fixed = 0;
  let errors = 0;

  for (const r of changed) {
    try {
      await prisma.food.update({
        where: { id: r.id },
        data: {
          foodForm: r.newForm,
          updatedAt: new Date(),
        },
      });
      await prisma.foodFieldProvenance.upsert({
        where: {
          foodId_fieldName_source: {
            foodId: r.id,
            fieldName: 'food_form',
            source: 'rule_inferred',
          },
        },
        update: {
          status: 'success',
          confidence: 1,
          failureReason: null,
          rawValue: r.newForm,
          updatedAt: new Date(),
        },
        create: {
          foodId: r.id,
          fieldName: 'food_form',
          source: 'rule_inferred',
          status: 'success',
          confidence: 1,
          rawValue: r.newForm,
        },
      });
      fixed++;
    } catch (e: any) {
      console.error(`  ❌ [${r.id}] ${r.name}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n✅ 写入完成：${fixed} 条成功，${errors} 条失败`);

  // 6. 修复后统计
  const after = await prisma.$queryRaw<
    { food_form: string | null; cnt: bigint }[]
  >(
    Prisma.sql`SELECT food_form, COUNT(*) AS cnt FROM foods GROUP BY food_form ORDER BY cnt DESC`,
  );
  console.log('\n修复后 food_form 分布（全库）：');
  for (const row of after) {
    console.log(`  ${row.food_form ?? 'NULL'}: ${Number(row.cnt)}`);
  }

  console.log(`\n结束时间: ${new Date().toISOString()}`);
  console.log(
    '数据已修复，food_field_provenance.food_form 标记为 "rule_inferred"，后续 AI 补全不会覆盖此来源。',
  );
}

main()
  .catch((e) => {
    console.error('脚本执行失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
