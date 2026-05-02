/**
 * ImageFoodAnalysisService.applyLibraryMatch 回归测试
 *
 * 数据契约：传入的 food 已是 per-serving；match 来自 food_library 是 per-100g。
 * 因此 confidence < 0.8 时用库值覆盖必须乘 ratio = grams/100 缩放，
 * 否则会把 per-100g 数值直接覆盖到 per-serving 字段，造成低估（grams>100 时）。
 */
import { ImageFoodAnalysisService } from '../src/modules/food/app/services/image-food-analysis.service';
import type { AnalyzedFoodItem } from '../src/modules/decision/types/analysis-result.types';

const proto = ImageFoodAnalysisService.prototype as any;

// 提供一个最小 logger 桩，避免 Logger 调用爆炸（applyLibraryMatch 末尾会 logger.debug）
const stub = { logger: { debug: () => {} } };

const apply = (food: AnalyzedFoodItem, match: any): void =>
  proto.applyLibraryMatch.call(stub, food, match);

describe('ImageFoodAnalysisService.applyLibraryMatch', () => {
  it('confidence<0.8 时把库 per-100g 值按 ratio 缩放成 per-serving', () => {
    const food: AnalyzedFoodItem = {
      name: '红烧肉',
      confidence: 0.6,
      estimatedWeightGrams: 200,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
    } as any;

    const match = {
      id: 'lib-1',
      calories: 400, // per-100g
      protein: 12,
      fat: 36,
      carbs: 5,
      fiber: 0.5,
      sodium: 800,
    };

    apply(food, match);

    // ratio = 200/100 = 2
    expect(food.foodLibraryId).toBe('lib-1');
    expect(food.calories).toBe(800);
    expect(food.protein).toBe(24);
    expect(food.fat).toBe(72);
    expect(food.carbs).toBe(10);
    expect(food.fiber).toBe(1);
    expect(food.sodium).toBe(1600);
  });

  it('grams=50 时按 ratio=0.5 缩小', () => {
    const food: AnalyzedFoodItem = {
      name: '小份',
      confidence: 0.5,
      estimatedWeightGrams: 50,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
    } as any;

    apply(food, { id: 'x', calories: 200, protein: 10, fat: 5, carbs: 20 });

    expect(food.calories).toBe(100);
    expect(food.protein).toBe(5);
    expect(food.fat).toBe(2.5);
    expect(food.carbs).toBe(10);
  });

  it('confidence>=0.8 时不覆盖营养字段（保留 AI 原值），仅写 foodLibraryId 与 enrich 字段', () => {
    const food: AnalyzedFoodItem = {
      name: '高置信',
      confidence: 0.9,
      estimatedWeightGrams: 200,
      calories: 999,
      protein: 88,
      fat: 7,
      carbs: 6,
    } as any;

    apply(food, {
      id: 'lib-2',
      calories: 100,
      protein: 1,
      fat: 1,
      carbs: 1,
      qualityScore: 7.5,
      satietyScore: 6,
    });

    expect(food.foodLibraryId).toBe('lib-2');
    expect(food.calories).toBe(999); // 未被覆盖
    expect(food.protein).toBe(88);
    expect(food.qualityScore).toBe(7.5);
    expect(food.satietyScore).toBe(6);
  });

  it('estimatedWeightGrams 缺失时退化到 standardServingG，再退到 100', () => {
    const food: AnalyzedFoodItem = {
      name: 'fallback',
      confidence: 0.5,
      standardServingG: 150,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
    } as any;

    apply(food, { id: 'x', calories: 200 });

    // 150/100 = 1.5
    expect(food.calories).toBe(300);
  });

  it('库值字段缺失时不覆盖（保持 food 原值）', () => {
    const food: AnalyzedFoodItem = {
      name: 'partial',
      confidence: 0.5,
      estimatedWeightGrams: 100,
      calories: 0,
      protein: 22,
      fat: 0,
      carbs: 0,
    } as any;

    apply(food, { id: 'x', calories: 250 }); // 仅有 calories

    expect(food.calories).toBe(250);
    expect(food.protein).toBe(22); // 未被改写
  });
});
