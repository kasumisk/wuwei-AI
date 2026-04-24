/**
 * P0-4: 验证 multi-objective-optimizer 的 macroFit 维度在有 dailyTarget/mealType/goalType
 * 时能主导排序，使更贴近"餐级四宏量目标"的食物胜出。
 */
import { multiObjectiveOptimize } from '../src/modules/diet/app/recommendation/optimization/multi-objective-optimizer';
import { ScoredFood } from '../src/modules/diet/app/recommendation/types/recommendation.types';
import { MultiObjectiveConfig } from '../src/modules/strategy/strategy.types';

// Minimal FoodLibrary stub — 只用于通过类型，实际测试不依赖字段
function makeFood(id: string): any {
  return {
    id,
    name: id,
    category: 'protein',
    flavorProfile: null,
    estimatedCostLevel: 3,
    prepTimeMinutes: 10,
    cookTimeMinutes: 10,
    skillRequired: 'easy',
    processingLevel: 2,
  };
}

function makeSF(
  id: string,
  n: {
    cal: number;
    protein: number;
    fat: number;
    carbs: number;
    score?: number;
  },
): ScoredFood {
  return {
    food: makeFood(id),
    score: n.score ?? 50,
    servingCalories: n.cal,
    servingProtein: n.protein,
    servingFat: n.fat,
    servingCarbs: n.carbs,
    servingFiber: 2,
    servingGL: 10,
  };
}

describe('multiObjectiveOptimize — P0-4 macroFit 维度', () => {
  // 分析文档案例: fat_loss 1500kcal/144g/37g/148g
  // lunch ratio = 0.35 → 餐级目标: 525kcal/50.4g/13g/51.8g
  const DAILY_TARGET = { calories: 1500, protein: 144, fat: 37, carbs: 148 };

  const CONFIG: MultiObjectiveConfig = {
    enabled: true,
    preferences: {
      // 放大 macroFit 权重让该维度的影响更容易观察
      macroFit: 0.7,
      health: 0.1,
      taste: 0.1,
      cost: 0.05,
      convenience: 0.05,
    },
  };

  it('贴近餐级目标的食物应排在"高脂爆量"食物前面', () => {
    // goodFit: 接近餐级目标 525/50/13/52 → macroFit 高
    const goodFit = makeSF('good', {
      cal: 500,
      protein: 48,
      fat: 12,
      carbs: 50,
      score: 50,
    });
    // fatBomb: 高脂爆量（热量接近目标但脂肪接近 4×餐级目标） → macroFit 低
    const fatBomb = makeSF('fatBomb', {
      cal: 520,
      protein: 15,
      fat: 45, // 餐级 fat 目标 13g，这里 3.5×
      carbs: 10,
      score: 50, // 相同基础分，靠 macroFit 拉开
    });

    const result = multiObjectiveOptimize(
      [goodFit, fatBomb],
      CONFIG,
      undefined,
      DAILY_TARGET,
      'lunch',
      'fat_loss',
    );

    expect(result.ranked[0].scoredFood.food.id).toBe('good');
    expect(result.ranked[1].scoredFood.food.id).toBe('fatBomb');

    // macroFit 分应：good > fatBomb
    const goodMF = result.ranked.find(
      (r) => r.scoredFood.food.id === 'good',
    )!.objectives.macroFit;
    const bombMF = result.ranked.find(
      (r) => r.scoredFood.food.id === 'fatBomb',
    )!.objectives.macroFit;
    expect(goodMF).toBeGreaterThan(bombMF);
  });

  it('缺少 dailyTarget/mealType/goalType 时 macroFit 退化为中性 0.5，行为回退到原 4 维', () => {
    const a = makeSF('a', { cal: 500, protein: 48, fat: 12, carbs: 50 });
    const b = makeSF('b', { cal: 520, protein: 15, fat: 45, carbs: 10 });

    const result = multiObjectiveOptimize([a, b], CONFIG);
    result.ranked.forEach((r) => {
      expect(r.objectives.macroFit).toBe(0.5);
    });
  });

  it('objectives 应包含 5 个维度（含新增的 macroFit）', () => {
    const x = makeSF('x', { cal: 500, protein: 48, fat: 12, carbs: 50 });
    const result = multiObjectiveOptimize(
      [x],
      CONFIG,
      undefined,
      DAILY_TARGET,
      'lunch',
      'fat_loss',
    );
    const keys = Object.keys(result.ranked[0].objectives).sort();
    expect(keys).toEqual(
      ['convenience', 'cost', 'health', 'macroFit', 'taste'].sort(),
    );
  });

  it('未知 goalType 时回退到 health ratios 并仍能计算 macroFit', () => {
    const x = makeSF('x', { cal: 500, protein: 48, fat: 12, carbs: 50 });
    const result = multiObjectiveOptimize(
      [x],
      CONFIG,
      undefined,
      DAILY_TARGET,
      'lunch',
      'nonexistent_goal',
    );
    // 只要没抛且不是中性 0.5，说明进入了 deriveMealTarget 的 health fallback 分支
    expect(result.ranked).toHaveLength(1);
    expect(typeof result.ranked[0].objectives.macroFit).toBe('number');
  });

  it('未知 mealType 导致 ratio=0 时 macroFit 降级为中性 0.5', () => {
    const x = makeSF('x', { cal: 500, protein: 48, fat: 12, carbs: 50 });
    const result = multiObjectiveOptimize(
      [x],
      CONFIG,
      undefined,
      DAILY_TARGET,
      'midnight_snack', // 不在 MEAL_RATIOS 里
      'fat_loss',
    );
    expect(result.ranked[0].objectives.macroFit).toBe(0.5);
  });
});
