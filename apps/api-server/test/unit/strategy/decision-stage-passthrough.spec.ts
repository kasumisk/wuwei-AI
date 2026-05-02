/**
 * DecisionStageService.toDecisionFoodItems 回归测试
 *
 * V6.x 契约：AnalyzedFoodItem 营养字段已是 per-serving，
 * toDecisionFoodItems 必须直接透传，不做任何重量缩放，仅：
 *  - 剥离 libraryMatch / normalizedName 等内部字段
 *  - 兜底 estimatedWeightGrams（standardServingG/100）
 *  - 归一化 purine 字段：number → purine, string → purineLevel
 */
import { DecisionStageService } from '../../../src/modules/decision/decision/decision-stage.service';
import type { AnalyzedFoodItem } from '../../../src/modules/decision/types/analysis-result.types';

const proto = DecisionStageService.prototype as any;

const transform = (foods: AnalyzedFoodItem[]) =>
  proto.toDecisionFoodItems.call({}, foods);

describe('DecisionStageService.toDecisionFoodItems', () => {
  it('per-serving 营养字段直接透传，不再按 estimatedWeightGrams 缩放', () => {
    const foods: AnalyzedFoodItem[] = [
      {
        name: '猪脚饭',
        confidence: 0.7,
        estimatedWeightGrams: 350,
        calories: 600,
        protein: 30,
        fat: 25,
        carbs: 65,
        sodium: 1200,
      } as any,
    ];

    const out = transform(foods);

    expect(out).toHaveLength(1);
    expect(out[0].calories).toBe(600); // 不是 600*3.5=2100
    expect(out[0].protein).toBe(30);
    expect(out[0].fat).toBe(25);
    expect(out[0].carbs).toBe(65);
    expect(out[0].sodium).toBe(1200);
    expect(out[0].estimatedWeightGrams).toBe(350);
  });

  it('剥离 libraryMatch / normalizedName 内部字段', () => {
    const foods = [
      {
        name: '鸡胸肉',
        confidence: 0.9,
        calories: 165,
        libraryMatch: { id: 'lib-1', sim_score: 0.95 },
        normalizedName: 'chicken_breast',
      } as any,
    ];

    const out = transform(foods);

    expect(out[0]).not.toHaveProperty('libraryMatch');
    expect(out[0]).not.toHaveProperty('normalizedName');
    expect(out[0].name).toBe('鸡胸肉');
    expect(out[0].calories).toBe(165);
  });

  it('estimatedWeightGrams 缺失时回退到 standardServingG，再回退 100', () => {
    const a = transform([
      {
        name: 'A',
        confidence: 0.5,
        calories: 10,
        standardServingG: 250,
      } as any,
    ])[0];
    const b = transform([
      { name: 'B', confidence: 0.5, calories: 10 } as any,
    ])[0];

    expect(a.estimatedWeightGrams).toBe(250);
    expect(b.estimatedWeightGrams).toBe(100);
  });

  it('purine 为 string 时归一化到 purineLevel；为 number 时保留为 purine', () => {
    const foods = [
      { name: 'A', confidence: 0.5, calories: 10, purine: 'high' } as any,
      { name: 'B', confidence: 0.5, calories: 10, purine: 230 } as any,
    ];

    const out = transform(foods);

    expect(out[0].purineLevel).toBe('high');
    expect(out[0].purine).toBeUndefined();
    expect(out[1].purine).toBe(230);
    expect(out[1].purineLevel).toBeUndefined();
  });

  it('空列表返回空数组', () => {
    expect(transform([])).toEqual([]);
  });
});
