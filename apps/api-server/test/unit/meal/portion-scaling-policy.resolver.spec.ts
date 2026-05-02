/**
 * V8.5: PortionScalingPolicyResolver 单元测试
 *
 * 测试 AI 饮食健康建议 App — EatCheck
 * 份量缩放策略推断规则
 */
import { PortionScalingPolicyResolver } from '../../../src/modules/diet/app/recommendation/meal/portion-scaling-policy.resolver';
import { PortionScalingMode } from '../../../src/modules/diet/app/recommendation/meal/portion-scaling-policy.types';
import type { FoodLibrary } from '../../../src/modules/food/food.types';

function makeFood(overrides: Partial<FoodLibrary> = {}): FoodLibrary {
  return {
    id: 'food-001',
    code: 'TEST_001',
    name: '测试食物',
    status: 'active',
    category: 'grain',
    calories: 116,
    protein: 2.6,
    fat: 0.3,
    carbs: 25.9,
    fiber: 0.3,
    isProcessed: false,
    isFried: false,
    processingLevel: 0,
    commonalityScore: 80,
    confidence: 1,
    dataVersion: 1,
    isVerified: true,
    searchWeight: 100,
    popularity: 50,
    commonPortions: [],
    mealTypes: [],
    tags: [],
    allergens: [],
    compatibility: {},
    standardServingG: 100,
    primarySource: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FoodLibrary;
}

function resolveMode(food: FoodLibrary): PortionScalingMode {
  const resolver = new PortionScalingPolicyResolver();
  return resolver.resolve(food).mode;
}

describe('PortionScalingPolicyResolver', () => {
  let resolver: PortionScalingPolicyResolver;

  beforeEach(() => {
    resolver = new PortionScalingPolicyResolver();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景1: 鸡蛋 — 应被推断为 scalable（ingredient），因为鸡蛋在 portionGuide 中
  //         的 commonPortions 包含 '个/只'，会被 commonPortions 规则捕获为 FIXED_UNIT
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景1: 鸡蛋 (egg)', () => {
    it('鸡蛋有"个"单位 → fixed_unit', () => {
      const egg = makeFood({
        id: 'egg-001',
        name: '鸡蛋（煮）',
        code: 'CN_EGG_BOILED',
        category: 'egg',
        foodForm: 'ingredient',
        standardServingG: 50,
        commonPortions: [
          { name: '1个（小）', grams: 45 },
          { name: '1个（中）', grams: 55 },
          { name: '1个（大）', grams: 65 },
          { name: '2个', grams: 110 },
        ],
        calories: 155,
      });
      const policy = resolver.resolve(egg);
      expect(policy.mode).toBe(PortionScalingMode.FIXED_UNIT);
      expect(policy.minRatio).toBe(1);
      expect(policy.maxRatio).toBe(1);
      expect(policy.ratioStep).toBe(1);
    });

    it('鸡蛋没有明确固定单位 → scallable（ingredient dedup）', () => {
      const egg = makeFood({
        id: 'egg-002',
        name: '炒鸡蛋',
        code: 'CN_EGG_SCRAMBLED',
        category: 'egg',
        foodForm: 'dish',
        standardServingG: 100,
        commonPortions: [
          { name: '1份', grams: 100 },
          { name: '半份', grams: 50 },
        ],
        calories: 196,
      });
      const policy = resolver.resolve(egg);
      // '份' 单独不足以判定 fixed_unit，需要至少2个固定单位名
      // dish → limited_scalable
      expect(policy.mode).toBe(PortionScalingMode.LIMITED_SCALABLE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景2: 瓶装饮料 — fixed_unit
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景2: 瓶装饮料 (bottled drink)', () => {
    it('beverage category → fixed_unit', () => {
      const drink = makeFood({
        id: 'drink-001',
        name: '无糖绿茶',
        code: 'CN_GREEN_TEA_BOTTLE',
        category: 'beverage',
        standardServingG: 500,
        calories: 0,
        commonPortions: [],
      });
      const policy = resolver.resolve(drink);
      expect(policy.mode).toBe(PortionScalingMode.FIXED_UNIT);
      expect(policy.ratioStep).toBe(1);
    });

    it('瓶装饮料 commonPortions 含"瓶" → fixed_unit', () => {
      const drink = makeFood({
        id: 'drink-002',
        name: '农夫山泉',
        code: 'CN_WATER_BOTTLE',
        category: 'beverage',
        standardServingG: 550,
        calories: 0,
        commonPortions: [
          { name: '1瓶', grams: 550 },
          { name: '半瓶', grams: 275 },
        ],
      });
      const policy = resolver.resolve(drink);
      expect(policy.mode).toBe(PortionScalingMode.FIXED_UNIT);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景3: 套餐 — not_scalable
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景3: 套餐 (combo meal)', () => {
    it('dishType=combo_meal → not_scalable', () => {
      const combo = makeFood({
        id: 'combo-001',
        name: '经典汉堡套餐',
        code: 'CN_BURGER_COMBO',
        category: 'composite',
        foodForm: 'dish',
        dishType: 'combo_meal',
        standardServingG: 450,
        calories: 850,
        commonPortions: [],
      });
      const policy = resolver.resolve(combo);
      expect(policy.mode).toBe(PortionScalingMode.NOT_SCALABLE);
      expect(policy.minRatio).toBe(1);
      expect(policy.maxRatio).toBe(1);
    });

    it('tags 含 combo/set_meal → not_scalable', () => {
      const bento = makeFood({
        id: 'bento-001',
        name: '日式便当',
        code: 'JP_BENTO',
        category: 'composite',
        foodForm: 'dish',
        tags: ['便当', 'lunch_box'],
        standardServingG: 500,
        calories: 650,
        commonPortions: [],
      });
      const policy = resolver.resolve(bento);
      expect(policy.mode).toBe(PortionScalingMode.NOT_SCALABLE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景4: 米饭 — scalable
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景4: 米饭 (rice)', () => {
    it('ingredient + grain → scalable', () => {
      const rice = makeFood({
        id: 'rice-001',
        name: '白米饭',
        code: 'CN_RICE_COOKED',
        category: 'grain',
        foodForm: 'ingredient',
        standardServingG: 150,
        calories: 116,
        commonPortions: [
          { name: '半碗', grams: 100 },
          { name: '1碗', grams: 200 },
          { name: '大盘', grams: 300 },
        ],
      });
      const policy = resolver.resolve(rice);
      expect(policy.mode).toBe(PortionScalingMode.SCALABLE);
      expect(policy.minRatio).toBe(0.5);
      expect(policy.maxRatio).toBe(2.0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景5: 炒菜/主菜 — limited_scalable
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景5: 炒菜/主菜 (main dish)', () => {
    it('dish foodForm → limited_scalable', () => {
      const dish = makeFood({
        id: 'dish-001',
        name: '宫保鸡丁',
        code: 'CN_GONGBAO_CHICKEN',
        category: 'meat',
        foodForm: 'dish',
        dishType: 'main_dish',
        standardServingG: 200,
        calories: 280,
        commonPortions: [
          { name: '小份', grams: 150 },
          { name: '中份', grams: 250 },
          { name: '大份', grams: 350 },
        ],
      });
      const policy = resolver.resolve(dish);
      expect(policy.mode).toBe(PortionScalingMode.LIMITED_SCALABLE);
      expect(policy.minRatio).toBe(0.75);
      expect(policy.maxRatio).toBe(1.25);
    });

    it('soup dish → limited_scalable', () => {
      const soup = makeFood({
        id: 'soup-001',
        name: '番茄蛋花汤',
        code: 'CN_TOMATO_EGG_SOUP',
        category: 'composite',
        foodForm: 'dish',
        dishType: 'soup',
        standardServingG: 250,
        calories: 80,
        commonPortions: [],
      });
      const policy = resolver.resolve(soup);
      expect(policy.mode).toBe(PortionScalingMode.LIMITED_SCALABLE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景6: 调味品 — condiment_or_micro
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景6: 调味品 (condiment)', () => {
    it('category=condiment → condiment_or_micro', () => {
      const oil = makeFood({
        id: 'oil-001',
        name: '橄榄油',
        code: 'CN_OLIVE_OIL',
        category: 'condiment',
        standardServingG: 10,
        calories: 884,
      });
      const policy = resolver.resolve(oil);
      expect(policy.mode).toBe(PortionScalingMode.CONDIMENT_OR_MICRO);
      expect(policy.isCoreMealRole).toBe(false);
      expect(policy.isPrimaryRecommendation).toBe(false);
    });

    it('subCategory=oil → condiment_or_micro', () => {
      const oil = makeFood({
        id: 'oil-002',
        name: '椰子油',
        code: 'CN_COCONUT_OIL',
        category: 'fat',
        subCategory: 'oil',
        standardServingG: 10,
        calories: 862,
      });
      const policy = resolver.resolve(oil);
      expect(policy.mode).toBe(PortionScalingMode.CONDIMENT_OR_MICRO);
    });

    it('tags 含 condiment/sauce → condiment_or_micro', () => {
      const sauce = makeFood({
        id: 'sauce-001',
        name: '酱油',
        code: 'CN_SOY_SAUCE',
        category: 'condiment',
        tags: ['调味料'],
        standardServingG: 10,
        calories: 53,
      });
      const policy = resolver.resolve(sauce);
      expect(policy.mode).toBe(PortionScalingMode.CONDIMENT_OR_MICRO);
    });

    it('调味品 maxRatio 不超过 condimentMaxG / standardServingG', () => {
      const oil = makeFood({
        id: 'oil-001',
        name: '橄榄油',
        code: 'CN_OLIVE_OIL',
        category: 'condiment',
        standardServingG: 10,
        calories: 884,
      });
      const policy = resolver.resolve(oil);
      // condimentMaxG=20, standardServingG=10 → maxRatio=2.0
      expect(policy.maxRatio).toBe(2.0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景7: 一餐食物过多 + 策略组合
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景7: 多食物组合策略', () => {
    it('不同食物类型得到不同策略', () => {
      const foods = [
        makeFood({
          id: 'r', name: '米饭', code: 'r',
          category: 'grain', foodForm: 'ingredient',
          standardServingG: 150, calories: 116,
        }),
        makeFood({
          id: 'c', name: '宫保鸡丁', code: 'c',
          category: 'meat', foodForm: 'dish',
          dishType: 'main_dish',
          standardServingG: 200, calories: 280,
        }),
        makeFood({
          id: 'e', name: '鸡蛋', code: 'e',
          category: 'egg', foodForm: 'ingredient',
          standardServingG: 50, calories: 155,
          commonPortions: [
            { name: '1个（中）', grams: 55 },
            { name: '2个', grams: 110 },
          ],
        }),
        makeFood({
          id: 'b', name: '零度可乐', code: 'b',
          category: 'beverage', standardServingG: 330, calories: 0,
        }),
        makeFood({
          id: 'o', name: '橄榄油', code: 'o',
          category: 'condiment', standardServingG: 10, calories: 884,
        }),
      ];

      const map = resolver.resolveAll(foods);
      expect(map.get('r')?.mode).toBe(PortionScalingMode.SCALABLE);
      expect(map.get('c')?.mode).toBe(PortionScalingMode.LIMITED_SCALABLE);
      expect(map.get('e')?.mode).toBe(PortionScalingMode.FIXED_UNIT);
      expect(map.get('b')?.mode).toBe(PortionScalingMode.FIXED_UNIT);
      expect(map.get('o')?.mode).toBe(PortionScalingMode.CONDIMENT_OR_MICRO);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景8: 包装零食 — fixed_unit
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景8: 包装零食 (packaged snack)', () => {
    it('category=snack → fixed_unit', () => {
      const snack = makeFood({
        id: 'snack-001',
        name: '薯片',
        code: 'CN_CHIPS',
        category: 'snack',
        standardServingG: 75,
        calories: 536,
      });
      const policy = resolver.resolve(snack);
      expect(policy.mode).toBe(PortionScalingMode.FIXED_UNIT);
    });

    it('tags 含 packaged → fixed_unit', () => {
      const food = makeFood({
        id: 'pack-001',
        name: '蛋白棒',
        code: 'CN_PROTEIN_BAR',
        category: 'snack',
        tags: ['包装', 'packaged'],
        standardServingG: 60,
        calories: 400,
      });
      const policy = resolver.resolve(food);
      expect(policy.mode).toBe(PortionScalingMode.FIXED_UNIT);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 场景9: 半成品 — limited_scalable
  // ═════════════════════════════════════════════════════════════════════════

  describe('场景9: 半成品 (semi_prepared)', () => {
    it('semi_prepared → limited_scalable', () => {
      const food = makeFood({
        id: 'sp-001',
        name: '速冻饺子',
        code: 'CN_FROZEN_DUMPLING',
        category: 'grain',
        foodForm: 'semi_prepared',
        standardServingG: 200,
        calories: 350,
      });
      const policy = resolver.resolve(food);
      expect(policy.mode).toBe(PortionScalingMode.LIMITED_SCALABLE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 兜底逻辑
  // ═════════════════════════════════════════════════════════════════════════

  describe('兜底逻辑 (fallback)', () => {
    it('无任何匹配规则 → scalable', () => {
      const unknown = makeFood({
        id: 'unk-001',
        name: '未知食物',
        code: 'XX_UNKNOWN',
        category: 'other',
        calories: 100,
      });
      const policy = resolver.resolve(unknown);
      expect(policy.mode).toBe(PortionScalingMode.SCALABLE);
    });
  });
});
