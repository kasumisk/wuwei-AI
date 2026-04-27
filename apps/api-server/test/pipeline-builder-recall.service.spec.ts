/**
 * V8.0 P3-02: PipelineBuilderService.recallCandidates 单元测试
 *
 * 验证召回阶段的各类过滤逻辑：
 * 1. 角色类别过滤
 * 2. usedNames 去重
 * 3. mealType 过滤
 * 4. excludeTags 过滤
 * 5. 过敏原过滤
 * 6. 短期画像拒绝过滤
 * 7. 分析画像风险食物过滤
 * 8. ensureMinCandidates 兜底逻辑
 * 9. 烹饪技能过滤
 */

import { PipelineBuilderService } from '../src/modules/diet/app/recommendation/pipeline/pipeline-builder.service';
import {
  createMockFoodLibrary,
  createMockScoringConfigService,
} from './helpers/mock-factories';
import type { FoodLibrary } from '../src/modules/food/food.types';
import type { PipelineContext } from '../src/modules/diet/app/recommendation/types/recommendation.types';

// ─── 构造 PipelineBuilderService（注入全 mock 依赖） ───

function createService(): PipelineBuilderService {
  const mockFoodScorer = {
    scoreFood: jest.fn().mockReturnValue(0.8),
    scoreFoodDetailed: jest.fn(),
    scoreFoodsWithServing: jest.fn().mockReturnValue([]),
  };
  const mockMealAssembler = { assemble: jest.fn().mockReturnValue([]) };
  const mockHealthModifier = {
    evaluate: jest.fn().mockReturnValue({
      finalMultiplier: 1.0,
      modifiers: [],
      isVetoed: false,
    }),
    hashContext: jest.fn(),
    preloadL1: jest.fn(),
  };
  const mockNutritionTarget = { calculate: jest.fn().mockReturnValue({}) };
  const mockSemanticRecall = { recall: jest.fn().mockResolvedValue([]) };
  const mockRecallMerger = { merge: jest.fn().mockReturnValue([]) };
  const mockRealisticFilter = {
    filter: jest
      .fn()
      .mockImplementation((candidates: FoodLibrary[]) => candidates),
    adjustForScene: jest.fn().mockReturnValue(null),
    scoreFood: jest.fn(),
  };
  const mockLifestyleAdapter = { adapt: jest.fn().mockReturnValue(null) };
  const mockScoringConfig = createMockScoringConfigService();
  const mockCfRecall = { recall: jest.fn().mockResolvedValue([]) };
  const mockMealCompositionScorer = { score: jest.fn().mockReturnValue(0) };
  const mockStrategyAutoTuner = { tune: jest.fn() };
  const mockPreferenceProfile = {
    sampleBeta: jest.fn().mockReturnValue(0.5),
    getSignal: jest.fn().mockReturnValue(null),
  };
  const mockScoringChain = {
    registerFactors: jest.fn(),
    getFactors: jest.fn().mockReturnValue([]),
    executeChain: jest.fn().mockReturnValue([]),
    scoreFood: jest
      .fn()
      .mockReturnValue({ finalScore: 0.8, adjustments: [], baseScore: 0.8 }),
  };

  return new PipelineBuilderService(
    mockFoodScorer as any,
    mockMealAssembler as any,
    mockHealthModifier as any,
    mockNutritionTarget as any,
    mockSemanticRecall as any,
    mockRecallMerger as any,
    mockRealisticFilter as any,
    mockLifestyleAdapter as any,
    mockScoringConfig as any,
    mockCfRecall as any,
    mockMealCompositionScorer as any,
    mockStrategyAutoTuner as any,
    mockPreferenceProfile as any,
    mockScoringChain as any,
  );
}

// ─── 辅助：构建最小 PipelineContext ───

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    allFoods: [],
    mealType: 'lunch',
    goalType: 'fat_loss',
    target: { calories: 500, protein: 30, fat: 15, carbs: 60 },
    constraints: { excludeTags: [], maxCalories: 700, minProtein: 20 } as any,
    usedNames: new Set<string>(),
    picks: [],
    ...overrides,
  } as PipelineContext;
}

function makeFood(overrides?: Partial<FoodLibrary>): FoodLibrary {
  return createMockFoodLibrary({
    id: 'f-' + Math.random().toString(36).slice(2),
    mealTypes: ['lunch', 'dinner'],
    tags: [],
    allergens: [],
    category: 'protein',
    status: 'active',
    commonalityScore: 60,
    ...overrides,
  });
}

// ─── Test Suite ───

describe('PipelineBuilderService.recallCandidates', () => {
  let service: PipelineBuilderService;

  beforeEach(() => {
    service = createService();
  });

  // ════════════════════════════════════════════════════════════
  // 1. 角色类别过滤
  // ════════════════════════════════════════════════════════════

  describe('角色类别过滤', () => {
    it('should only return foods matching role categories (protein role)', async () => {
      const proteinFood = makeFood({ category: 'protein' });
      const grainFood = makeFood({ category: 'grain' });
      const veggieFood = makeFood({ category: 'veggie' });

      const ctx = makeCtx({ allFoods: [proteinFood, grainFood, veggieFood] });
      const result = await service.recallCandidates(ctx, 'protein');

      const ids = result.map((f) => f.id);
      expect(ids).toContain(proteinFood.id);
      expect(ids).not.toContain(grainFood.id);
      expect(ids).not.toContain(veggieFood.id);
    });

    it('should return grain + composite for carb role', async () => {
      const grainFood = makeFood({ category: 'grain' });
      const compositeFood = makeFood({ category: 'composite' });
      const proteinFood = makeFood({ category: 'protein' });

      const ctx = makeCtx({
        allFoods: [grainFood, compositeFood, proteinFood],
      });
      const result = await service.recallCandidates(ctx, 'carb');

      const ids = result.map((f) => f.id);
      expect(ids).toContain(grainFood.id);
      expect(ids).toContain(compositeFood.id);
      expect(ids).not.toContain(proteinFood.id);
    });

    it('should fallback to allFoods when no foods match role category', async () => {
      const grainFood = makeFood({ category: 'grain' });
      const ctx = makeCtx({ allFoods: [grainFood] });

      const result = await service.recallCandidates(ctx, 'protein');

      // protein role needs protein/dairy; grain → 0 filtered candidates
      // → fallback: candidates.length === 0 → return all ctx.allFoods (excl. usedNames)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(grainFood.id);
    });

    it('should respect MealPolicy roleCategories override', async () => {
      const veggieFood = makeFood({ category: 'veggie' });
      const proteinFood = makeFood({ category: 'protein' });

      const ctx = makeCtx({
        allFoods: [veggieFood, proteinFood],
        resolvedStrategy: {
          strategyId: 's1',
          strategyName: 'test',
          sources: [],
          resolvedAt: Date.now(),
          config: {
            meal: {
              // 覆盖 protein 角色 → 只取 veggie
              roleCategories: { protein: ['veggie'] },
            },
          },
        },
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.id)).toContain(veggieFood.id);
      expect(result.map((f) => f.id)).not.toContain(proteinFood.id);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. usedNames 去重
  // ════════════════════════════════════════════════════════════

  describe('usedNames 去重', () => {
    it('should exclude foods whose name is in usedNames', async () => {
      const food1 = makeFood({ name: '鸡胸肉', category: 'protein' });
      const food2 = makeFood({ name: '三文鱼', category: 'protein' });

      const ctx = makeCtx({
        allFoods: [food1, food2],
        usedNames: new Set(['鸡胸肉']),
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.name)).not.toContain('鸡胸肉');
      expect(result.map((f) => f.name)).toContain('三文鱼');
    });

    it('should return all when usedNames is empty', async () => {
      const food1 = makeFood({ name: '鸡胸肉', category: 'protein' });
      const food2 = makeFood({ name: '三文鱼', category: 'protein' });

      const ctx = makeCtx({ allFoods: [food1, food2] });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toHaveLength(2);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. mealType 过滤
  // ════════════════════════════════════════════════════════════

  describe('mealType 过滤', () => {
    it('should exclude foods not suitable for current meal type', async () => {
      const breakfastOnly = makeFood({
        category: 'protein',
        mealTypes: ['breakfast'],
      });
      const allMeals = makeFood({
        category: 'protein',
        mealTypes: ['breakfast', 'lunch', 'dinner'],
      });
      const anyMeal = makeFood({ category: 'protein', mealTypes: [] }); // 空 = 不限

      const ctx = makeCtx({
        allFoods: [breakfastOnly, allMeals, anyMeal],
        mealType: 'lunch',
      });
      const result = await service.recallCandidates(ctx, 'protein');

      const ids = result.map((f) => f.id);
      expect(ids).not.toContain(breakfastOnly.id);
      expect(ids).toContain(allMeals.id);
      expect(ids).toContain(anyMeal.id);
    });

    it('should include food with empty mealTypes (no restriction)', async () => {
      const food = makeFood({ category: 'protein', mealTypes: [] });
      const ctx = makeCtx({ allFoods: [food], mealType: 'dinner' });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. excludeTags 过滤
  // ════════════════════════════════════════════════════════════

  describe('excludeTags 过滤', () => {
    it('should exclude foods tagged with excludeTags', async () => {
      const friedFood = makeFood({
        category: 'protein',
        tags: ['fried', 'high_fat'],
      });
      const cleanFood = makeFood({ category: 'protein', tags: ['grilled'] });

      const ctx = makeCtx({
        allFoods: [friedFood, cleanFood],
        constraints: {
          excludeTags: ['fried'],
          maxCalories: 700,
          minProtein: 20,
        } as any,
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.id)).not.toContain(friedFood.id);
      expect(result.map((f) => f.id)).toContain(cleanFood.id);
    });

    it('should include all foods when excludeTags is empty', async () => {
      const food = makeFood({ category: 'protein', tags: ['fried'] });
      const ctx = makeCtx({
        allFoods: [food],
        constraints: {
          excludeTags: [],
          maxCalories: 700,
          minProtein: 20,
        } as any,
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. 过敏原过滤
  // ════════════════════════════════════════════════════════════

  describe('过敏原过滤', () => {
    it('should exclude foods containing user allergens', async () => {
      const dairyFood = makeFood({ category: 'protein', allergens: ['dairy'] });
      const safeFood = makeFood({ category: 'protein', allergens: [] });

      const ctx = makeCtx({
        allFoods: [dairyFood, safeFood],
        userProfile: { allergens: ['dairy'] },
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.id)).not.toContain(dairyFood.id);
      expect(result.map((f) => f.id)).toContain(safeFood.id);
    });

    it('should not filter when user has no allergens', async () => {
      const dairyFood = makeFood({ category: 'protein', allergens: ['dairy'] });
      const ctx = makeCtx({
        allFoods: [dairyFood],
        userProfile: { allergens: [] },
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. 短期画像 — 频繁拒绝过滤
  // ════════════════════════════════════════════════════════════

  describe('短期画像拒绝过滤', () => {
    it('should exclude frequently rejected foods (count >= threshold)', async () => {
      const rejectedFood = makeFood({ name: '炸鸡', category: 'protein' });
      const normalFood = makeFood({ name: '三文鱼', category: 'protein' });

      const ctx = makeCtx({
        allFoods: [rejectedFood, normalFood],
        shortTermProfile: { rejectedFoods: { 炸鸡: 2 } } as any,
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.name)).not.toContain('炸鸡');
      expect(result.map((f) => f.name)).toContain('三文鱼');
    });

    it('should keep food rejected fewer times than threshold', async () => {
      const food = makeFood({ name: '炸鸡', category: 'protein' });

      const ctx = makeCtx({
        allFoods: [food],
        shortTermProfile: { rejectedFoods: { 炸鸡: 1 } } as any, // count=1 < threshold=2
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.name)).toContain('炸鸡');
    });

    it('should respect custom shortTermRejectThreshold from strategy', async () => {
      const food = makeFood({ name: '炸鸡', category: 'protein' });

      // 阈值调为 3，拒绝次数为 2 → 不应过滤
      const ctx = makeCtx({
        allFoods: [food],
        shortTermProfile: { rejectedFoods: { 炸鸡: 2 } } as any,
        resolvedStrategy: {
          strategyId: 's1',
          strategyName: 't',
          sources: [],
          resolvedAt: Date.now(),
          config: { recall: { shortTermRejectThreshold: 3 } },
        },
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.name)).toContain('炸鸡');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. 分析画像风险食物过滤
  // ════════════════════════════════════════════════════════════

  describe('分析画像风险食物过滤', () => {
    it('should exclude foods in analysisProfile.recentRiskFoods', async () => {
      const riskFood = makeFood({ name: '高糖饮料', category: 'protein' });
      const safeFood = makeFood({ name: '鸡胸肉', category: 'protein' });

      const ctx = makeCtx({
        allFoods: [riskFood, safeFood],
        analysisProfile: { recentRiskFoods: ['高糖饮料'] } as any,
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result.map((f) => f.name)).not.toContain('高糖饮料');
      expect(result.map((f) => f.name)).toContain('鸡胸肉');
    });

    it('should not filter when recentRiskFoods is empty', async () => {
      const food = makeFood({ name: '鸡胸肉', category: 'protein' });
      const ctx = makeCtx({
        allFoods: [food],
        analysisProfile: { recentRiskFoods: [] } as any,
      });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 8. ensureMinCandidates 兜底逻辑
  // ════════════════════════════════════════════════════════════

  describe('ensureMinCandidates 兜底', () => {
    it('should fall back to role category pool when filtered result is below minCount', async () => {
      // 3 个 protein 食物，其中 2 个被过敏原过滤掉，只剩 1 个 < 3(min)
      // 兜底应从 allFoods 中取回 protein 类别的食物
      const food1 = makeFood({
        name: '牛奶',
        category: 'protein',
        allergens: ['dairy'],
      });
      const food2 = makeFood({
        name: '奶酪',
        category: 'protein',
        allergens: ['dairy'],
      });
      const food3 = makeFood({
        name: '鸡胸肉',
        category: 'protein',
        allergens: [],
      });
      const food4 = makeFood({
        name: '三文鱼',
        category: 'protein',
        allergens: [],
      });
      const food5 = makeFood({
        name: '豆腐',
        category: 'protein',
        allergens: [],
      });

      const ctx = makeCtx({
        allFoods: [food1, food2, food3, food4, food5],
        userProfile: { allergens: ['dairy'] },
      });

      const result = await service.recallCandidates(ctx, 'protein');

      // 3 个无过敏原的食物都应该被保留
      expect(result.length).toBeGreaterThanOrEqual(3);
      // 过敏原食物不在结果中（初始过滤已经排除）
      expect(result.map((f) => f.name)).not.toContain('牛奶');
      expect(result.map((f) => f.name)).not.toContain('奶酪');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 9. 空候选列表
  // ════════════════════════════════════════════════════════════

  describe('空食物池', () => {
    it('should return empty array when allFoods is empty', async () => {
      const ctx = makeCtx({ allFoods: [] });
      const result = await service.recallCandidates(ctx, 'protein');

      expect(result).toEqual([]);
    });
  });
});
