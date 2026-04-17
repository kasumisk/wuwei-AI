/**
 * V6.5 Phase 2C — 整餐组合评分器
 *
 * V6.7 Phase 2-C 升级：
 * - 新增第 5 维：质感多样性（textureDiversity）
 * - 营养拮抗对：钙+草酸、铁+钙、锌+植酸同餐扣分
 * - 权重 5 维化，从 ScoringConfigSnapshot 读取（可运行时调整）
 *
 * 职责：
 * - 在单品评分（food-scorer）之后、最终输出之前，对已组装的整餐进行组合级评分
 * - 评估维度：食材多样性、烹饪方式多样性、口味和谐度、营养互补性、质感多样性
 * - 输出整餐组合评分（MealCompositionScore），供 Rerank 和前端展示使用
 *
 * 使用场景：
 *   MealAssembler 组装完整餐后 → 调用 scoreMealComposition() 获取组合评分
 */
import { t } from '../utils/i18n-messages';
import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import { COOKING_TEXTURE_MAP } from '../../../../food/cooking-method.constants';
import {
  ScoredFood,
  ScoringConfigSnapshot,
  DailyPlanState,
} from '../types/recommendation.types';
import { DailyPlanContextService } from '../context/daily-plan-context.service';

// ─── 类型定义 ───

/** 整餐组合评分结果 */
export interface MealCompositionScore {
  /** 食材重复度（0-100，100=完全不重复） */
  ingredientDiversity: number;
  /** 烹饪方式多样性（0-100，100=每道菜不同烹饪方式） */
  cookingMethodDiversity: number;
  /**
   * V6.7 Phase 1-D: 口味和谐度（0-100）
   * 替代原 flavorBalance（方差模型，高方差=好，逻辑反转）
   * 新模型：覆盖度（3-4种口味轴最佳）- 极端度惩罚 - 冲突惩罚
   */
  flavorHarmony: number;
  /** 营养互补性（0-100，100=互补营养素对完美覆盖，含拮抗对扣分） */
  nutritionComplementarity: number;
  /** V6.7 Phase 2-C: 质感多样性（0-100，基于烹饪方式和标签推断食物质感） */
  textureDiversity: number;
  /** 整体组合评分（加权） */
  overall: number;
}

/** V6.7 Phase 2-C: 默认 5 维权重 */
const DEFAULT_COMPOSITION_WEIGHTS = {
  ingredientDiversity: 0.25,
  cookingMethodDiversity: 0.15,
  flavorHarmony: 0.2,
  nutritionComplementarity: 0.2,
  textureDiversity: 0.2,
} as const;

/** 互补营养素对 — 同时包含两者时吸收/效果增强 */
const COMPLEMENTARY_PAIRS: ReadonlyArray<{
  a: keyof FoodLibrary;
  b: keyof FoodLibrary;
  bonus: number;
  label: string;
}> = [
  {
    a: 'iron',
    b: 'vitaminC',
    bonus: 15,
    label: t('composition.pair.ironVitC'),
  },
  {
    a: 'calcium',
    b: 'vitaminD',
    bonus: 15,
    label: t('composition.pair.calciumVitD'),
  },
  { a: 'fat', b: 'vitaminA', bonus: 10, label: t('composition.pair.fatVitA') },
  {
    a: 'protein',
    b: 'vitaminB12',
    bonus: 10,
    label: t('composition.pair.proteinB12'),
  },
];

/**
 * V6.7 Phase 2-C: 营养拮抗对
 * 同餐同时含两种营养素时吸收效果降低
 */
const ANTAGONISTIC_PAIRS: ReadonlyArray<{
  a: string;
  b: string;
  penalty: number;
  label: string;
}> = [
  {
    a: 'calcium',
    b: 'oxalate',
    penalty: -15,
    label: t('composition.pair.calciumOxalate'),
  },
  {
    a: 'iron',
    b: 'calcium',
    penalty: -10,
    label: t('composition.pair.ironCalcium'),
  },
  {
    a: 'zinc',
    b: 'phytate',
    penalty: -8,
    label: t('composition.pair.zincPhytate'),
  },
];

/**
 * V6.7 Phase 2-C: 质感映射 — 引用自 cooking-method.constants
 * 基于 cookingMethods 推断食物质感
 */
const TEXTURE_MAP = COOKING_TEXTURE_MAP;

/** 口味六轴 */
const FLAVOR_AXES = [
  'sweet',
  'sour',
  'salty',
  'bitter',
  'umami',
  'spicy',
] as const;

/**
 * 判定食物是否在某营养素/特征上"丰富"
 * 用于拮抗对检测
 */
const RICH_THRESHOLDS: Record<string, (food: FoodLibrary) => boolean> = {
  calcium: (f) => (Number(f.calcium) || 0) > 100,
  iron: (f) => (Number(f.iron) || 0) > 3,
  zinc: (f) => (Number(f.zinc) || 0) > 3,
  oxalate: (f) =>
    f.oxalateLevel === 'high' ||
    (f.tags?.some((t) => ['spinach', 'beet', 'rhubarb'].includes(t)) ?? false),
  phytate: (f) =>
    f.tags?.some((t) =>
      ['whole_grain', 'legume', 'bean', 'high_fiber'].includes(t),
    ) ?? false,
};

@Injectable()
export class MealCompositionScorer {
  constructor(
    /** V6.9 Phase 2-A: 跨餐多样性服务 */
    private readonly dailyPlanContext: DailyPlanContextService,
  ) {}

  /**
   * 对已选定的整餐组合进行组合级评分
   *
   * V6.7: 新增 config 参数支持运行时权重调整
   * V6.9: 新增 dailyPlanState 参数支持跨餐多样性惩罚
   *
   * @param selectedFoods 已通过 MealAssembler 选定的食物列表
   * @param config 可选评分参数快照（权重从 compositionWeights 读取）
   * @param dailyPlanState 可选日计划状态（跨餐多样性惩罚）
   * @returns MealCompositionScore
   */
  scoreMealComposition(
    selectedFoods: ScoredFood[],
    config?: ScoringConfigSnapshot | null,
    dailyPlanState?: DailyPlanState | null,
  ): MealCompositionScore {
    if (selectedFoods.length === 0) {
      return {
        ingredientDiversity: 100,
        cookingMethodDiversity: 100,
        flavorHarmony: 80,
        nutritionComplementarity: 0,
        textureDiversity: 50,
        overall: 50,
      };
    }

    const ingredientDiversity = this.calcIngredientDiversity(selectedFoods);
    const cookingMethodDiversity =
      this.calcCookingMethodDiversity(selectedFoods);
    const flavorHarmony = this.calcFlavorHarmony(selectedFoods);
    const nutritionComplementarity =
      this.calcNutritionComplementarity(selectedFoods);
    const textureDiversity = this.calcTextureDiversity(selectedFoods);

    // V6.7: 权重从 config 读取，缺失时使用默认值
    const weights = config?.compositionWeights ?? DEFAULT_COMPOSITION_WEIGHTS;

    let overall = Math.round(
      ingredientDiversity * weights.ingredientDiversity +
        cookingMethodDiversity * weights.cookingMethodDiversity +
        flavorHarmony * weights.flavorHarmony +
        nutritionComplementarity * weights.nutritionComplementarity +
        textureDiversity * weights.textureDiversity,
    );

    // V6.9 Phase 2-A: 跨餐多样性惩罚（若提供了日计划状态）
    if (dailyPlanState) {
      let totalPenalty = 0;
      for (const sf of selectedFoods) {
        const penalty = Math.min(
          0,
          this.dailyPlanContext.calcDiversityAdjustment(
            sf.food,
            dailyPlanState,
            config,
          ),
        );
        if (penalty < 0) {
          totalPenalty += penalty * 100; // 折算到 0-100 分数空间
        }
      }
      if (totalPenalty < 0) {
        overall = Math.max(0, Math.round(overall + totalPenalty));
      }
    }

    return {
      ingredientDiversity,
      cookingMethodDiversity,
      flavorHarmony,
      nutritionComplementarity,
      textureDiversity,
      overall,
    };
  }

  /**
   * 食材重复度检测
   * 提取每道菜的主要食材（mainIngredient），检测重叠比例
   * 100 = 完全不重复，0 = 全部相同
   */
  private calcIngredientDiversity(foods: ScoredFood[]): number {
    const allIngredients = foods
      .map((f) => f.food.mainIngredient?.toLowerCase())
      .filter(Boolean) as string[];

    if (allIngredients.length <= 1) return 100;

    const uniqueCount = new Set(allIngredients).size;
    return Math.round((uniqueCount / allIngredients.length) * 100);
  }

  /**
   * 烹饪方式多样性
   * 100 = 每道菜不同方式，0 = 全部相同
   */
  private calcCookingMethodDiversity(foods: ScoredFood[]): number {
    const methods = foods
      .flatMap((f) => f.food.cookingMethods?.map((m) => m.toLowerCase()) ?? [])
      .filter(Boolean) as string[];

    if (methods.length <= 1) return 100;

    const uniqueCount = new Set(methods).size;
    return Math.round((uniqueCount / methods.length) * 100);
  }

  /**
   * V6.7 Phase 1-D: 口味和谐度（替代原 calcFlavorBalance）
   *
   * 原逻辑（V6.6）：方差越大 → 口味越分散 → 分越高
   *   问题：极甜+极辣的组合方差大、得高分，但实际上这种搭配很差
   *
   * 新逻辑（V6.7）：口味和谐模型
   *   1. 覆盖度：好的餐食应覆盖 3-4 种口味轴（不是越多越好，也不是太少）
   *   2. 极端度惩罚：任何轴 max > 4 (满分5) 扣分
   *   3. 冲突检测：同时高甜+高辣、同时高酸+高苦 额外扣分
   *
   * 单品时默认 80 分。
   */
  private calcFlavorHarmony(foods: ScoredFood[]): number {
    const profiles = foods
      .map((f) => f.food.flavorProfile)
      .filter(Boolean) as NonNullable<FoodLibrary['flavorProfile']>[];

    if (profiles.length < 2) return 80;

    // 收集每个口味轴的所有值
    const mealProfile = new Map<string, number[]>();
    for (const axis of FLAVOR_AXES) {
      mealProfile.set(axis, []);
    }
    for (const profile of profiles) {
      for (const axis of FLAVOR_AXES) {
        const value =
          (profile as Record<string, number | undefined>)[axis] ?? 0;
        mealProfile.get(axis)!.push(value);
      }
    }

    // 1. 覆盖度：有几种口味轴有 >0 值（最佳：3-4种有值）
    const coveredAxes = FLAVOR_AXES.filter((axis) =>
      mealProfile.get(axis)!.some((v) => v > 0),
    ).length;
    const coverageScore =
      coveredAxes >= 4
        ? 100
        : coveredAxes === 3
          ? 85
          : coveredAxes === 2
            ? 60
            : coveredAxes === 1
              ? 40
              : 20;

    // 2. 极端度惩罚：任何轴 max > 4 扣分
    let extremePenalty = 0;
    for (const axis of FLAVOR_AXES) {
      const values = mealProfile.get(axis)!;
      const maxVal = Math.max(...values, 0);
      if (maxVal > 4) extremePenalty += 15; // 极端口味扣15分
      if (maxVal > 3 && axis === 'spicy') {
        // 多道辣菜额外惩罚
        const spicyCount = values.filter((v) => v > 3).length;
        if (spicyCount > 1) extremePenalty += 10;
      }
    }

    // 3. 冲突检测：同时高甜+高辣、同时高酸+高苦 扣分
    const sweetMax = Math.max(...(mealProfile.get('sweet') ?? [0]));
    const spicyMax = Math.max(...(mealProfile.get('spicy') ?? [0]));
    const sourMax = Math.max(...(mealProfile.get('sour') ?? [0]));
    const bitterMax = Math.max(...(mealProfile.get('bitter') ?? [0]));

    if (sweetMax > 3 && spicyMax > 3) extremePenalty += 20;
    if (sourMax > 3 && bitterMax > 3) extremePenalty += 15;

    return Math.max(0, coverageScore - extremePenalty);
  }

  /**
   * V6.7 Phase 2-C: 营养互补性 + 拮抗对
   *
   * 正向互补对（铁+维C 等）得分，负向拮抗对（钙+草酸 等）扣分。
   * 基础分 50，互补加分，拮抗减分，最终 clamp 到 [0, 100]。
   */
  private calcNutritionComplementarity(foods: ScoredFood[]): number {
    if (foods.length < 2) return 0;

    let score = 0;

    // 正向互补对
    for (const pair of COMPLEMENTARY_PAIRS) {
      const hasA = foods.some((f) => {
        const val = f.food[pair.a];
        return typeof val === 'number' && val > 0;
      });
      const hasB = foods.some((f) => {
        const val = f.food[pair.b];
        return typeof val === 'number' && val > 0;
      });
      if (hasA && hasB) score += pair.bonus;
    }

    // V6.7 Phase 2-C: 负向拮抗对
    for (const pair of ANTAGONISTIC_PAIRS) {
      const checkA = RICH_THRESHOLDS[pair.a];
      const checkB = RICH_THRESHOLDS[pair.b];
      if (!checkA || !checkB) continue;

      const hasA = foods.some((f) => checkA(f.food));
      const hasB = foods.some((f) => checkB(f.food));
      if (hasA && hasB) score += pair.penalty; // penalty 是负数
    }

    // 基础分 50 + 互补/拮抗调整，clamp 到 [0, 100]
    return Math.max(0, Math.min(100, 50 + score));
  }

  /**
   * V6.7 Phase 2-C: 质感多样性
   *
   * 基于 cookingMethods 和 tags 推断每道菜的质感（crispy/soft/tender/crunchy/chewy/liquid），
   * 质感种类越多 → 分越高（用餐体验更丰富）
   *
   * 评分：1 种 = 30, 2 种 = 60, 3 种 = 85, 4+ 种 = 100
   * 无法推断 = 50 分（unknown 不惩罚也不奖励）
   */
  private calcTextureDiversity(foods: ScoredFood[]): number {
    const textures = new Set<string>();

    for (const { food } of foods) {
      // 从 cookingMethods 推断质感（所有方式都参与）
      for (const m of food.cookingMethods ?? []) {
        const texture = TEXTURE_MAP[m.toLowerCase()];
        if (texture) {
          textures.add(texture);
        }
      }

      // 额外：特定 tags 覆写质感
      if (food.tags?.includes('soup') || food.tags?.includes('congee')) {
        textures.add('liquid');
      }
      if (food.tags?.includes('salad') || food.tags?.includes('raw')) {
        textures.add('crunchy');
      }
    }

    if (textures.size >= 4) return 100;
    if (textures.size === 3) return 85;
    if (textures.size === 2) return 60;
    if (textures.size === 1) return 30; // 全部同一质感
    return 50; // unknown — 无 cookingMethods 数据
  }
}
