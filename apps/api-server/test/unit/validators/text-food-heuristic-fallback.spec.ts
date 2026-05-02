/**
 * 启发式兜底（buildHeuristicFallbackFood）回归测试
 *
 * 关键回归：
 *  - "猪脚饭" 应被 inferCategoryByKeywords 归为 composite（之前误归 protein 导致 100g/165kcal 严重低估）
 *  - composite 默认份量 = 350g
 *  - 兜底营养字段应已是 per-serving（即按 ratio = grams/100 缩放后的实际摄入）
 */
import { TextFoodAnalysisService } from '../../../src/modules/food/app/services/text-food-analysis.service';

// 通过 prototype 调用纯方法，避开 NestJS DI 构造
const proto = TextFoodAnalysisService.prototype as any;

const callInferCategory = (name: string): string =>
  proto.inferCategoryByKeywords.call({}, name);

const callBuildFallback = (name: string, quantity?: string) =>
  proto.buildHeuristicFallbackFood.call(
    {
      // 这些方法内部只调用同对象上的其它 private 方法，转发即可
      inferCategoryByKeywords: proto.inferCategoryByKeywords,
      resolveServingGrams: proto.resolveServingGrams,
      estimateSodiumByKeywords: proto.estimateSodiumByKeywords,
    },
    name,
    quantity,
  );

describe('inferCategoryByKeywords - 复合主食必须早于单一蛋白/谷物匹配', () => {
  it('猪脚饭 → composite（不是 protein）', () => {
    expect(callInferCategory('猪脚饭')).toBe('composite');
  });

  it('黄焖鸡米饭 → composite', () => {
    expect(callInferCategory('黄焖鸡米饭')).toBe('composite');
  });

  it('鱼香肉丝盖饭 → composite', () => {
    expect(callInferCategory('鱼香肉丝盖饭')).toBe('composite');
  });

  it('牛肉炒饭 → composite', () => {
    expect(callInferCategory('牛肉炒饭')).toBe('composite');
  });

  it('卤肉饭 → composite', () => {
    expect(callInferCategory('卤肉饭')).toBe('composite');
  });

  it('牛肉面 → composite', () => {
    expect(callInferCategory('牛肉面')).toBe('composite');
  });

  it('麻辣烫 → composite', () => {
    expect(callInferCategory('麻辣烫')).toBe('composite');
  });

  it('鸡胸肉 → protein（单一蛋白不变）', () => {
    expect(callInferCategory('鸡胸肉')).toBe('protein');
  });

  it('白米饭 → composite（以"饭"结尾）', () => {
    // 注：单字"饭"也走 composite 分支，符合一份饭的实际份量
    expect(callInferCategory('白米饭')).toBe('composite');
  });
});

describe('buildHeuristicFallbackFood - per-serving 输出契约', () => {
  it('"猪脚饭" 无份量描述时使用 composite 默认 350g 份量，能量按 ratio=3.5 缩放', () => {
    const food = callBuildFallback('猪脚饭');
    expect(food.category).toBe('composite');
    expect(food.estimatedWeightGrams).toBe(350);
    // composite 默认营养档：复合主食每 100g 约 ~180kcal 量级，350g ratio=3.5
    // 不写死具体值（避免随营养档微调而脆裂），只断言已被按 ratio 缩放（>= 100g 档的 2 倍以上）
    expect(food.calories).toBeGreaterThan(400);
    expect(food.protein).toBeGreaterThan(0);
    expect(food.carbs).toBeGreaterThan(0);
    expect(food.estimated).toBe(true);
  });

  it('显式给出 "200g" 时使用 200g 份量（不再回落到类别默认）', () => {
    const food = callBuildFallback('猪脚饭', '200g');
    expect(food.estimatedWeightGrams).toBe(200);
  });

  it('回归：旧 bug — 若误归 protein 会用 100g/165kcal，新代码应远高于此', () => {
    const food = callBuildFallback('猪脚饭');
    expect(food.estimatedWeightGrams).not.toBe(100);
    expect(food.calories).toBeGreaterThan(165);
  });
});
