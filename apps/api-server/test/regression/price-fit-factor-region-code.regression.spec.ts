/**
 * BUG-008 回归测试：PriceFitFactor 必须把 ctx.regionCode 透传给注入的 getPriceInfo。
 *
 * 历史缺陷：apps/api-server/.../pipeline/pipeline-builder.service.ts 中构造
 * PriceFitFactor 的注入闭包写成 `(foodId) => seasonalityService.getPriceInfo(foodId)`，
 * 丢失了第二参 regionCode，导致 SeasonalityService.getInfo 频繁打出
 * 'called without regionCode' 警告并走 legacy fallback（4800 次/run）。
 *
 * 本测试锁定 PriceFitFactor 在 computeAdjustment 路径 A 时一定会传 regionCode，
 * 并校验当 ctx.regionCode 缺失时退化为 null（而非 undefined），
 * 防止 PriceFitFactor 构造端调用契约再次漂移。
 */

import { PriceFitFactor } from '../../src/modules/diet/app/recommendation/scoring-chain/factors/price-fit.factor';
import type { PipelineContext } from '../../src/modules/diet/app/recommendation/types/pipeline.types';
import type { FoodPriceInfo } from '../../src/modules/diet/app/recommendation/utils/seasonality.service';
import { createMockFoodLibrary } from '../helpers/mock-factories';

function makeCtxWithBudget(regionCode?: string | null): PipelineContext {
  return {
    allFoods: [],
    mealType: 'lunch',
    goalType: 'fat_loss',
    target: { calories: 600, protein: 40, fat: 20, carbs: 60 },
    constraints: {} as PipelineContext['constraints'],
    usedNames: new Set<string>(),
    picks: [],
    regionCode: regionCode ?? undefined,
    userProfile: {
      // 触发路径 A（精确预算）
      declared: {
        budgetPerMeal: 30,
        currencyCode: 'CNY',
      },
      budgetLevel: 'medium',
    } as unknown as PipelineContext['userProfile'],
  } as unknown as PipelineContext;
}

const PRICE_INFO: FoodPriceInfo = {
  priceMin: 20,
  priceMax: 25,
  currencyCode: 'CNY',
  priceUnit: 'per_serving',
};

describe('BUG-008 regression: PriceFitFactor 透传 regionCode', () => {
  it('调用 getPriceInfo 时必须传两个参数 (foodId, regionCode)', () => {
    const spy = jest.fn().mockReturnValue(PRICE_INFO);
    const factor = new PriceFitFactor(spy);

    const ctx = makeCtxWithBudget('CN');
    expect(factor.isApplicable(ctx)).toBe(true);
    factor.init(ctx);

    const food = createMockFoodLibrary({ id: 'food-CN-001' });
    factor.computeAdjustment(food, 0.8, ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('food-CN-001', 'CN');
  });

  it('regionCode 缺失时透传 null（不能透传 undefined，避免下游解构歧义）', () => {
    const spy = jest.fn().mockReturnValue(PRICE_INFO);
    const factor = new PriceFitFactor(spy);

    const ctx = makeCtxWithBudget(undefined);
    factor.init(ctx);

    factor.computeAdjustment(createMockFoodLibrary(), 0.8, ctx);

    expect(spy).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('不同 regionCode 产生不同的 getPriceInfo 调用（避免跨 region 缓存污染）', () => {
    const spy = jest.fn().mockReturnValue(PRICE_INFO);
    const factor = new PriceFitFactor(spy);

    const ctxCN = makeCtxWithBudget('CN');
    factor.init(ctxCN);
    factor.computeAdjustment(createMockFoodLibrary({ id: 'fid' }), 0.8, ctxCN);

    const ctxUS = makeCtxWithBudget('US');
    factor.init(ctxUS);
    factor.computeAdjustment(createMockFoodLibrary({ id: 'fid' }), 0.8, ctxUS);

    expect(spy).toHaveBeenNthCalledWith(1, 'fid', 'CN');
    expect(spy).toHaveBeenNthCalledWith(2, 'fid', 'US');
  });
});
