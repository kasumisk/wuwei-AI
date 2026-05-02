/**
 * 管线级集成测试 — 四大宏量对齐度端到端验收
 *
 * 落地《推荐引擎营养目标偏差分析.md》P0-1 ~ P1-3 全部修复，
 * 用真实管线（非 mock）串联以下核心环节，针对文档案例做端到端复测：
 *
 *   候选池 → multiObjectiveOptimize(含 macroFit 维度, P0-4)
 *         → 贪心装配
 *         → optimizeDailyPlan(maxIterations=24, minScoreRatio=0.75, P1-1)
 *         → validateMacroAlignment(四维度 ≤15%)
 *
 * 验收基准（文档案例 · fat_loss 场景）：
 *   目标 1500 kcal / 144g 蛋白 / 37g 脂肪 / 148g 碳水
 *   修复前偏差：蛋白 -37%、脂肪 +73%（红区）
 *   修复后要求：四维度全部落在 yellow 或 green 区（即 ≤15%）
 */

import type { FoodLibrary } from '../../src/modules/food/food.types';
import type {
  ScoredFood,
  MealTarget,
} from '../../src/modules/diet/app/recommendation/types/recommendation.types';
import {
  multiObjectiveOptimize,
  extractRankedFoods,
} from '../../src/modules/diet/app/recommendation/optimization/multi-objective-optimizer';
import {
  optimizeDailyPlan,
  type MealSlot,
} from '../../src/modules/diet/app/recommendation/optimization/global-optimizer';
import { validateMacroAlignment } from '../../src/modules/diet/app/recommendation/validators/macro-alignment.validator';
import { MEAL_RATIOS } from '../../src/modules/diet/app/recommendation/types/scoring.types';

// ═════════════════════════════════════════════════════════
// 1. 食物池构造 — 覆盖蛋白/主食/蔬菜/脂肪/水果五大类
// ═════════════════════════════════════════════════════════

/**
 * 构造 FoodLibrary。营养值为"每 100g"基准，standardServingG 决定单份量。
 */
function buildFood(
  id: string,
  name: string,
  category: string,
  per100: { cal: number; p: number; f: number; c: number; fiber?: number },
  serving: number,
  mealTypes: string[] = ['breakfast', 'lunch', 'dinner', 'snack'],
  extras?: Partial<FoodLibrary>,
): FoodLibrary {
  return {
    id,
    code: id.toUpperCase(),
    name,
    category,
    calories: per100.cal,
    protein: per100.p,
    fat: per100.f,
    carbs: per100.c,
    fiber: per100.fiber ?? 0,
    glycemicLoad: 0,
    processingLevel: 1,
    isProcessed: false,
    isFried: false,
    allergens: [],
    tags: [],
    mealTypes,
    mainIngredient: id,
    compatibility: {},
    commonPortions: [],
    standardServingG: serving,
    status: 'active',
    primarySource: 'official',
    dataVersion: 1,
    confidence: 0.9,
    isVerified: true,
    searchWeight: 100,
    popularity: 80,
    commonalityScore: 70,
    availableChannels: ['home_cook'],
    cookingMethods: ['steam'],
    cuisine: '中餐',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extras,
  } as FoodLibrary;
}

function toScored(food: FoodLibrary, score = 0.8): ScoredFood {
  const ratio = food.standardServingG / 100;
  return {
    food,
    score,
    servingCalories: Math.round(food.calories * ratio),
    servingProtein: Math.round((food.protein ?? 0) * ratio * 10) / 10,
    servingFat: Math.round((food.fat ?? 0) * ratio * 10) / 10,
    servingCarbs: Math.round((food.carbs ?? 0) * ratio * 10) / 10,
    servingFiber: Math.round((food.fiber ?? 0) * ratio * 10) / 10,
    servingGL: 0,
  };
}

/**
 * 构造 40 个覆盖四大宏量维度的食物池。
 * 份量设置为中等水平（单份贡献 50~250 kcal），避免单品过度主导。
 */
function buildFoodPool(): ScoredFood[] {
  const foods: FoodLibrary[] = [
    // ─── 高蛋白主食类（单品 20-35g 蛋白）───
    buildFood(
      'chicken_breast',
      '鸡胸肉',
      'protein',
      { cal: 165, p: 31, f: 3.6, c: 0 },
      120,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'egg_whole',
      '鸡蛋',
      'protein',
      { cal: 155, p: 13, f: 11, c: 1.1 },
      100,
      ['breakfast', 'lunch', 'snack'],
    ),
    buildFood(
      'salmon',
      '三文鱼',
      'protein',
      { cal: 208, p: 20, f: 13, c: 0 },
      100,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'beef_lean',
      '瘦牛肉',
      'protein',
      { cal: 217, p: 26, f: 12, c: 0 },
      100,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'shrimp',
      '虾',
      'protein',
      { cal: 99, p: 24, f: 0.3, c: 0.2 },
      100,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'tofu_firm',
      '老豆腐',
      'protein',
      { cal: 144, p: 16, f: 8, c: 3 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'yogurt_greek',
      '希腊酸奶',
      'protein',
      { cal: 97, p: 10, f: 5, c: 4 },
      150,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'milk_skim',
      '脱脂牛奶',
      'protein',
      { cal: 34, p: 3.4, f: 0.1, c: 5 },
      250,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'pork_loin',
      '猪里脊',
      'protein',
      { cal: 143, p: 22, f: 5, c: 0 },
      120,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'tilapia',
      '龙利鱼',
      'protein',
      { cal: 96, p: 20, f: 1.7, c: 0 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'tuna_can',
      '金枪鱼罐头',
      'protein',
      { cal: 116, p: 26, f: 1, c: 0 },
      100,
      ['lunch', 'snack'],
    ),
    buildFood(
      'egg_white',
      '蛋白',
      'protein',
      { cal: 52, p: 11, f: 0.2, c: 0.7 },
      120,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'whey_protein',
      '乳清蛋白粉',
      'protein',
      { cal: 400, p: 80, f: 5, c: 8 },
      30,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'cottage_cheese',
      '乳清干酪',
      'protein',
      { cal: 98, p: 11, f: 4.3, c: 3.4 },
      150,
      ['breakfast', 'snack'],
    ),

    // ─── 主食/碳水类 ───
    buildFood(
      'brown_rice',
      '糙米饭',
      'grain',
      { cal: 112, p: 2.6, f: 0.9, c: 23, fiber: 1.8 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'oats',
      '燕麦',
      'grain',
      { cal: 389, p: 17, f: 7, c: 66, fiber: 10 },
      40,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'whole_wheat_bread',
      '全麦面包',
      'grain',
      { cal: 247, p: 13, f: 3.4, c: 41, fiber: 7 },
      60,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'sweet_potato',
      '红薯',
      'grain',
      { cal: 86, p: 1.6, f: 0.1, c: 20, fiber: 3 },
      200,
      ['lunch', 'dinner', 'breakfast'],
    ),
    buildFood(
      'corn',
      '玉米',
      'grain',
      { cal: 86, p: 3.3, f: 1.2, c: 19, fiber: 2.4 },
      150,
      ['lunch', 'dinner', 'breakfast'],
    ),
    buildFood(
      'pasta_whole',
      '全麦意面',
      'grain',
      { cal: 124, p: 5, f: 1.1, c: 25, fiber: 3.2 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'quinoa',
      '藜麦',
      'grain',
      { cal: 120, p: 4.4, f: 1.9, c: 21, fiber: 2.8 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'potato',
      '土豆',
      'grain',
      { cal: 77, p: 2, f: 0.1, c: 17, fiber: 2.2 },
      200,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'congee_mix',
      '杂粮粥',
      'grain',
      { cal: 71, p: 2.5, f: 0.5, c: 14, fiber: 1.5 },
      250,
      ['breakfast'],
    ),

    // ─── 蔬菜类（低卡高纤维）───
    buildFood(
      'broccoli',
      '西兰花',
      'vegetable',
      { cal: 34, p: 2.8, f: 0.4, c: 7, fiber: 2.6 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'spinach',
      '菠菜',
      'vegetable',
      { cal: 23, p: 2.9, f: 0.4, c: 3.6, fiber: 2.2 },
      200,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'tomato',
      '番茄',
      'vegetable',
      { cal: 18, p: 0.9, f: 0.2, c: 3.9, fiber: 1.2 },
      150,
      ['breakfast', 'lunch', 'dinner'],
    ),
    buildFood(
      'cucumber',
      '黄瓜',
      'vegetable',
      { cal: 16, p: 0.7, f: 0.1, c: 3.6, fiber: 0.5 },
      150,
      ['lunch', 'dinner', 'snack'],
    ),
    buildFood(
      'carrot',
      '胡萝卜',
      'vegetable',
      { cal: 41, p: 0.9, f: 0.2, c: 10, fiber: 2.8 },
      100,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'asparagus',
      '芦笋',
      'vegetable',
      { cal: 20, p: 2.2, f: 0.1, c: 3.9, fiber: 2.1 },
      150,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'bell_pepper',
      '彩椒',
      'vegetable',
      { cal: 31, p: 1, f: 0.3, c: 6, fiber: 2.1 },
      150,
      ['lunch', 'dinner'],
    ),

    // ─── 脂肪/坚果类（控制份量避免过量）───
    buildFood(
      'avocado',
      '牛油果',
      'fat',
      { cal: 160, p: 2, f: 15, c: 9, fiber: 7 },
      50,
      ['breakfast', 'lunch', 'snack'],
    ),
    buildFood(
      'almond',
      '杏仁',
      'fat',
      { cal: 579, p: 21, f: 50, c: 22, fiber: 12 },
      15,
      ['snack', 'breakfast'],
    ),
    buildFood(
      'peanut_butter',
      '花生酱',
      'fat',
      { cal: 588, p: 25, f: 50, c: 20, fiber: 6 },
      15,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'olive_oil',
      '橄榄油',
      'fat',
      { cal: 884, p: 0, f: 100, c: 0 },
      5,
      ['lunch', 'dinner'],
    ),
    buildFood(
      'walnut',
      '核桃',
      'fat',
      { cal: 654, p: 15, f: 65, c: 14, fiber: 6.7 },
      15,
      ['snack', 'breakfast'],
    ),

    // ─── 水果类（补碳水 + 纤维 + 微量元素）───
    buildFood(
      'blueberry',
      '蓝莓',
      'fruit',
      { cal: 57, p: 0.7, f: 0.3, c: 14, fiber: 2.4 },
      100,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'strawberry',
      '草莓',
      'fruit',
      { cal: 32, p: 0.7, f: 0.3, c: 7.7, fiber: 2 },
      150,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'orange',
      '橙子',
      'fruit',
      { cal: 47, p: 0.9, f: 0.1, c: 12, fiber: 2.4 },
      200,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'banana',
      '香蕉',
      'fruit',
      { cal: 89, p: 1.1, f: 0.3, c: 23, fiber: 2.6 },
      120,
      ['breakfast', 'snack'],
    ),
    buildFood(
      'apple',
      '苹果',
      'fruit',
      { cal: 52, p: 0.3, f: 0.2, c: 14, fiber: 2.4 },
      180,
      ['breakfast', 'snack'],
    ),
  ];
  return foods.map((f) => toScored(f, 0.7 + Math.random() * 0.3));
}

// ═════════════════════════════════════════════════════════
// 2. 贪心装配（模拟 MealAssembler 的最小行为）
// ═════════════════════════════════════════════════════════

/**
 * 从 ranked 中贪心取 3-4 份食物，累计 calories 落入 mealTarget 的 ±20% 区间。
 * 真实 MealAssembler 逻辑更复杂（含角色/多样性/菜谱），但本测试关心
 * 的是"multiObjectiveOptimize 排序是否把四大宏量契合度高的食物推到前面"，
 * 因此最小贪心即可暴露上游排序质量。
 */
function greedyAssemble(
  ranked: ScoredFood[],
  mealTarget: MealTarget,
): ScoredFood[] {
  const picks: ScoredFood[] = [];
  let cal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  const maxPicks = 5;
  const calHardCap = mealTarget.calories * 1.2;

  for (const sf of ranked) {
    if (picks.length >= maxPicks) break;
    // 超过硬上限则跳过
    if (cal + sf.servingCalories > calHardCap) continue;
    // 若加入后每个维度都没有"超出目标 1.5×"的跳跃，则接受
    const afterFat = fat + sf.servingFat;
    const afterCarbs = carbs + sf.servingCarbs;
    if (afterFat > mealTarget.fat * 1.6) continue;
    if (afterCarbs > mealTarget.carbs * 1.6) continue;

    picks.push(sf);
    cal += sf.servingCalories;
    protein += sf.servingProtein;
    fat += sf.servingFat;
    carbs += sf.servingCarbs;

    // 达标即停
    if (cal >= mealTarget.calories * 0.85 && picks.length >= 3) break;
  }

  // 若 calories 仍不足，松开脂肪/碳水上限再补一个蛋白或主食
  if (cal < mealTarget.calories * 0.75) {
    for (const sf of ranked) {
      if (picks.includes(sf)) continue;
      if (picks.length >= maxPicks) break;
      if (cal + sf.servingCalories > calHardCap) continue;
      picks.push(sf);
      cal += sf.servingCalories;
      if (cal >= mealTarget.calories * 0.9) break;
    }
  }

  return picks;
}

// ═════════════════════════════════════════════════════════
// 3. 集成测试主体
// ═════════════════════════════════════════════════════════

describe('推荐管线 — 四大宏量对齐度端到端集成', () => {
  const dailyTarget: MealTarget = {
    calories: 1500,
    protein: 144,
    fat: 37,
    carbs: 148,
    fiber: 25,
    glycemicLoad: 80,
  };
  const goalType = 'fat_loss';
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

  function runPipeline(): {
    slots: MealSlot[];
    actual: { calories: number; protein: number; fat: number; carbs: number };
    deviationBefore: number;
    deviationAfter: number;
    swapCount: number;
  } {
    const pool = buildFoodPool();
    const ratios = MEAL_RATIOS[goalType];

    const slots: MealSlot[] = mealTypes.map((mt) => {
      const mealRatio = ratios[mt] ?? 0.25;
      const mealTarget: MealTarget = {
        calories: Math.round(dailyTarget.calories * mealRatio),
        protein: Math.round(dailyTarget.protein * mealRatio),
        fat: Math.round(dailyTarget.fat * mealRatio),
        carbs: Math.round(dailyTarget.carbs * mealRatio),
      };
      // 粗过滤：只取 mealTypes 允许的食物
      const candidates = pool.filter((sf) =>
        (sf.food.mealTypes as string[]).includes(mt),
      );
      // 真实 multiObjectiveOptimize —— P0-4 macroFit 维度激活
      const result = multiObjectiveOptimize(
        candidates,
        {},
        undefined,
        dailyTarget,
        mt,
        goalType,
      );
      const ranked = extractRankedFoods(result);
      const picks = greedyAssemble(ranked, mealTarget);
      return {
        mealType: mt,
        picks,
        candidates: ranked.slice(0, 20),
        target: mealTarget,
      };
    });

    // 真实 optimizeDailyPlan（P1-1 默认参数 maxIterations=24, minScoreRatio=0.75）
    const optResult = optimizeDailyPlan(slots, dailyTarget);

    const actual = optResult.meals.reduce(
      (acc, slot) => {
        for (const p of slot.picks) {
          acc.calories += p.servingCalories;
          acc.protein += p.servingProtein;
          acc.fat += p.servingFat;
          acc.carbs += p.servingCarbs;
        }
        return acc;
      },
      { calories: 0, protein: 0, fat: 0, carbs: 0 },
    );

    return {
      slots: optResult.meals,
      actual,
      deviationBefore: optResult.deviationBefore,
      deviationAfter: optResult.deviationAfter,
      swapCount: optResult.swapCount,
    };
  }

  it('四大宏量全部落入 yellow 或 green 区（偏差 ≤ 15%）', () => {
    const { actual } = runPipeline();
    const report = validateMacroAlignment(actual, dailyTarget);

    // 打印便于排障
    // eslint-disable-next-line no-console
    console.log(
      '[macro-alignment] actual=',
      actual,
      '\n  report.zone=',
      report.zone,
      '\n  dimensions=',
      report.dimensions.map(
        (d) => `${d.dimension}:${(d.deviation * 100).toFixed(1)}%(${d.zone})`,
      ),
    );

    expect(report.zone).not.toBe('red');
    for (const d of report.dimensions) {
      expect(Math.abs(d.deviation)).toBeLessThanOrEqual(0.15);
    }
  });

  it('GlobalOptimizer 使整体偏差非递增（deviationAfter ≤ deviationBefore）', () => {
    const { deviationBefore, deviationAfter } = runPipeline();
    expect(deviationAfter).toBeLessThanOrEqual(deviationBefore + 1e-9);
  });

  it('calories 维度偏差 ≤ 10%（相对宽松维度下限）', () => {
    const { actual } = runPipeline();
    const report = validateMacroAlignment(actual, dailyTarget);
    const cal = report.dimensions.find((d) => d.dimension === 'calories')!;
    expect(Math.abs(cal.deviation)).toBeLessThanOrEqual(0.1);
  });

  it('protein 维度未出现严重欠量（≥ 目标的 85%）', () => {
    // 修复前该维度 -37%（红区）；修复后应 ≥ 85% 目标
    const { actual } = runPipeline();
    expect(actual.protein).toBeGreaterThanOrEqual(dailyTarget.protein * 0.85);
  });

  it('fat 维度未出现严重超量（≤ 目标的 115%）', () => {
    // 修复前该维度 +73%（红区）；修复后应 ≤ 115% 目标
    const { actual } = runPipeline();
    expect(actual.fat).toBeLessThanOrEqual(dailyTarget.fat * 1.15);
  });
});
