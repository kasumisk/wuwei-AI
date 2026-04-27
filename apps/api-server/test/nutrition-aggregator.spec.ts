/**
 * V6.x 数据契约：AnalyzedFoodItem 上的营养字段已是 per-serving 实际摄入。
 * aggregateNutrition 必须只做"逐项求和"，不再按 estimatedWeightGrams 二次缩放。
 */
import {
  aggregateNutrition,
  computeAvgConfidence,
} from '../src/modules/decision/analyze/nutrition-aggregator';
import type { AnalyzedFoodItem } from '../src/modules/decision/types/analysis-result.types';

const f = (overrides: Partial<AnalyzedFoodItem>): AnalyzedFoodItem =>
  ({
    name: overrides.name ?? 'x',
    confidence: overrides.confidence ?? 0.8,
    calories: overrides.calories ?? 0,
    ...overrides,
  }) as AnalyzedFoodItem;

describe('aggregateNutrition (per-serving 直接求和)', () => {
  it('单食物时 totals 等于该食物的 per-serving 值，与 estimatedWeightGrams 无关', () => {
    // 关键回归：之前会按 grams/100 二次缩放，这里 grams=350 会把 calories 放大成 3.5×
    const food = f({
      name: '猪脚饭',
      estimatedWeightGrams: 350,
      calories: 600, // 已是 per-serving 真值
      protein: 30,
      fat: 25,
      carbs: 65,
      sodium: 1200,
      fiber: 4,
    });

    const t = aggregateNutrition([food]);

    expect(t.calories).toBe(600);
    expect(t.protein).toBe(30);
    expect(t.fat).toBe(25);
    expect(t.carbs).toBe(65);
    expect(t.sodium).toBe(1200);
    expect(t.fiber).toBe(4);
  });

  it('多食物时严格满足 Σ foods[i].x === totals.x（前端编辑保存依赖此契约）', () => {
    const foods = [
      f({
        calories: 600,
        protein: 30,
        fat: 25,
        carbs: 65,
        sodium: 1200,
        fiber: 4,
      }),
      f({
        calories: 150,
        protein: 5,
        fat: 3,
        carbs: 25,
        sodium: 200,
        fiber: 2,
      }),
      f({
        calories: 80,
        protein: 2,
        fat: 0.5,
        carbs: 18,
        sodium: 30,
        fiber: 3,
      }),
    ];

    const t = aggregateNutrition(foods);

    expect(t.calories).toBe(830);
    expect(t.protein).toBe(37);
    expect(t.fat).toBeCloseTo(28.5, 5);
    expect(t.carbs).toBe(108);
    expect(t.sodium).toBe(1430);
    expect(t.fiber).toBe(9);
  });

  it('全部 sodium 为 null/undefined 时 totals.sodium === undefined', () => {
    const foods = [f({ calories: 100 }), f({ calories: 50 })];
    const t = aggregateNutrition(foods);
    expect(t.sodium).toBeUndefined();
    expect(t.fiber).toBeUndefined();
    expect(t.calories).toBe(150);
  });

  it('部分 sodium 缺失时 totals.sodium 仅累加非空项', () => {
    const foods = [f({ calories: 100, sodium: 500 }), f({ calories: 50 })];
    const t = aggregateNutrition(foods);
    expect(t.sodium).toBe(500);
  });

  it('回归：grams≠100 时不应再放大（旧 bug：grams=350 会把 calories=600 放大到 2100）', () => {
    const food = f({
      estimatedWeightGrams: 350,
      calories: 600,
    });
    const t = aggregateNutrition([food]);
    expect(t.calories).toBe(600); // 不是 2100
  });

  it('回归：grams=50 时不应再缩小（旧 bug：grams=50 会把 calories=200 缩成 100）', () => {
    const food = f({
      estimatedWeightGrams: 50,
      calories: 200,
    });
    const t = aggregateNutrition([food]);
    expect(t.calories).toBe(200); // 不是 100
  });

  it('saturatedFat / addedSugar 累加保留 1 位小数', () => {
    const foods = [
      f({ calories: 100, saturatedFat: 2.3, addedSugar: 5.7 }),
      f({ calories: 100, saturatedFat: 1.4, addedSugar: 0.3 }),
    ];
    const t = aggregateNutrition(foods);
    expect(t.saturatedFat).toBe(3.7);
    expect(t.addedSugar).toBe(6);
  });

  it('空食物列表返回零值 totals', () => {
    const t = aggregateNutrition([]);
    expect(t.calories).toBe(0);
    expect(t.protein).toBe(0);
    expect(t.fat).toBe(0);
    expect(t.carbs).toBe(0);
    expect(t.fiber).toBeUndefined();
    expect(t.sodium).toBeUndefined();
  });
});

describe('computeAvgConfidence', () => {
  it('空列表返回 0.5', () => {
    expect(computeAvgConfidence([])).toBe(0.5);
  });

  it('计算平均置信度', () => {
    const foods = [
      f({ confidence: 0.6 }),
      f({ confidence: 0.8 }),
      f({ confidence: 1.0 }),
    ];
    expect(computeAvgConfidence(foods)).toBeCloseTo(0.8, 5);
  });
});
