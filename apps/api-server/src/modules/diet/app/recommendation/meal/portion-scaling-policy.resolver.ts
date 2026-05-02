/**
 * V8.5: PortionScalingPolicyResolver
 *
 * 基于食物现有字段（foodForm / dishType / category / availableChannels / tags / commonPortions）
 * 自动推断份量缩放策略，无需新增数据库字段。
 *
 * 推断优先级（从高到低）：
 *   1. dishType: combo_meal/set_meal → not_scalable
 *   2. commonPortions 含固定单位名 → fixed_unit
 *   3. foodForm + category 组合判断
 *   4. 兜底: scalable
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FoodLibrary } from '../../../../food/food.types';
import {
  PortionScalingMode,
  PortionScalingPolicy,
  DEFAULT_POLICY_INFERENCE_CONFIG,
  type PolicyInferenceConfig,
} from './portion-scaling-policy.types';

@Injectable()
export class PortionScalingPolicyResolver {
  private readonly logger = new Logger(PortionScalingPolicyResolver.name);
  private config: PolicyInferenceConfig = {
    ...DEFAULT_POLICY_INFERENCE_CONFIG,
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 公共 API
  // ═════════════════════════════════════════════════════════════════════════

  /** 允许业务方覆盖默认推断配置 */
  configure(config: Partial<PolicyInferenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 批量解析食物策略缓存
   *
   * 在推荐管道入口处一次性计算所有 allFoods 的策略并缓存，
   * 避免每个食物在 adjustPortions 中重复推断。
   */
  resolveAll(foods: FoodLibrary[]): Map<string, PortionScalingPolicy> {
    const map = new Map<string, PortionScalingPolicy>();
    for (const food of foods) {
      map.set(food.id, this.resolve(food));
    }
    return map;
  }

  /**
   * 为单个食物解析份量缩放策略
   */
  resolve(food: FoodLibrary): PortionScalingPolicy {
    // 1. dishType 判断（最高优先级 — 明确套餐类型不可缩放）
    const dishTypeResult = this.resolveFromDishType(food);
    if (dishTypeResult) return dishTypeResult;

    // 2. commonPortions 含固定单位名 → fixed_unit
    const portionResult = this.resolveFromCommonPortions(food);
    if (portionResult) return portionResult;

    // 3. category 判断（调味品、饮品等）
    const categoryResult = this.resolveFromCategory(food);
    if (categoryResult) return categoryResult;

    // 4. tags 辅助判断（套餐/调味/包装 — 必须在 foodForm 之前，
    //    因为 combo/set_meal 标签与 foodForm=dish 冲突）
    const tagResult = this.resolveFromTags(food);
    if (tagResult) return tagResult;

    // 5. foodForm 组合判断
    const formResult = this.resolveFromFoodForm(food);
    if (formResult) return formResult;

    // 6. availableChannels
    const channelResult = this.resolveFromChannels(food);
    if (channelResult) return channelResult;

    // 7. 兜底 scalable
    return this.buildScalablePolicy(food, ['default']);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层1: dishType 判断
  // ═════════════════════════════════════════════════════════════════════════

  private resolveFromDishType(food: FoodLibrary): PortionScalingPolicy | null {
    const dt = (food.dishType || food.taxonomy?.dishType || '').toLowerCase();
    if (!dt) return null;

    if (dt === 'combo_meal' || dt === 'set_meal') {
      return {
        mode: PortionScalingMode.NOT_SCALABLE,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [`dishType=${dt}`],
        isCoreMealRole: true,
        unitType: 'serving',
        isPrimaryRecommendation: true,
      };
    }

    if (dt === 'soup' || dt === 'salad' || dt === 'main_dish' || dt === 'bread' || dt === 'pastry') {
      return null; // 走后续 rules，不在此处决策
    }

    if (dt === 'snack' || dt === 'drink') {
      return null; // 走 category / commonPortions
    }

    if (dt === 'sauce') {
      return {
        mode: PortionScalingMode.CONDIMENT_OR_MICRO,
        minRatio: 0.2,
        maxRatio: this.config.condimentMaxGrams /
          (Math.max(food.standardServingG || 100, 1)),
        ratioStep: 0.25,
        inferredFrom: [`dishType=sauce`],
        isCoreMealRole: false,
        unitType: 'gram',
        isPrimaryRecommendation: false,
      };
    }

    if (dt === 'dessert') {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [`dishType=dessert`],
        isCoreMealRole: false,
        unitType: 'serving',
        isPrimaryRecommendation: true,
      };
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层2: commonPortions 含固定单位
  // ═════════════════════════════════════════════════════════════════════════

  private FIXED_UNIT_NAMES = new Set([
    'piece', 'pieces', '个', '颗', '只', '条', '片',
    'cup', 'cups', '杯', '罐',
    'bottle', 'bottles', '瓶', '盒', '桶',
    'pack', 'package', '袋', '包',
    'can', 'cans', '听',
    'serving', '份',
    'bar', '根',
    'egg', 'eggs', '鸡蛋',
  ]);

  /** ingredient 类食物中常见的"按个/只/颗"单位名 — 单证据即可判定 FIXED_UNIT */
  private STRONG_SINGLE_UNIT = new Set([
    '个', '颗', '只', '条', '片', '根',
    'piece', 'pieces', 'pieces',
  ]);

  private resolveFromCommonPortions(
    food: FoodLibrary,
  ): PortionScalingPolicy | null {
    const portions =
      food.commonPortions ||
      food.portionGuide?.commonPortions ||
      [];
    if (!portions.length) return null;

    const fixedUnitHits: string[] = [];
    const isIngredient = (food.foodForm || '').toLowerCase() === 'ingredient';

    for (const p of portions) {
      const name = (p.name || '').toLowerCase();
      for (const un of this.FIXED_UNIT_NAMES) {
        if (name.includes(un)) {
          if (!fixedUnitHits.includes(un)) fixedUnitHits.push(un);
        }
      }
    }

    // 至少2个独立证据才判定为 FIXED_UNIT
    // （单一 "份" 字可能泛用，组合证据更可靠）
    // 但 ingredient + 常见"个/只/颗"单位 → 单证据即可
    if (fixedUnitHits.length >= 2) {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [
          `commonPortions: [${fixedUnitHits.slice(0, 3).join(', ')}]`,
        ],
        isCoreMealRole: true,
        unitType: this.inferUnitType(fixedUnitHits),
        isPrimaryRecommendation: true,
      };
    }

    // ingredient + 单项强单位（个/只/颗/条/片/根）→ FIXED_UNIT
    // 例如: 鸡蛋的 '1个（中）', 黄瓜的 '1根'
    if (
      isIngredient &&
      fixedUnitHits.length >= 1 &&
      fixedUnitHits.some((h) => this.STRONG_SINGLE_UNIT.has(h))
    ) {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [
          `commonPortions: [${fixedUnitHits[0]}] (strong single unit on ingredient)`,
        ],
        isCoreMealRole: true,
        unitType: 'piece',
        isPrimaryRecommendation: true,
      };
    }

    // 单证据但明确是包装/瓶装/盒装 → fixed_unit
    if (
      fixedUnitHits.length === 1 &&
      ['bottle', 'bottles', '瓶', '盒', 'pack', 'package', '袋', '罐', '桶'].some(
        (u) => fixedUnitHits.includes(u),
      )
    ) {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [
          `commonPortions: [${fixedUnitHits[0]}] (single strong fixed-unit)`,
        ],
        isCoreMealRole: false,
        unitType: 'bottle',
        isPrimaryRecommendation: true,
      };
    }

    return null;
  }

  private inferUnitType(hits: string[]): PortionScalingPolicy['unitType'] {
    const grainLike = new Set(['个', '颗', '只', '条', '片', '根', 'piece', 'pieces']);
    const bottleLike = new Set(['瓶', '盒', '罐', '桶', 'bottle', 'bottles']);
    const packLike = new Set(['袋', '包', 'pack', 'package']);
    const cupLike = new Set(['杯', 'cup', 'cups']);

    if (hits.some((h) => grainLike.has(h))) return 'piece';
    if (hits.some((h) => bottleLike.has(h))) return 'bottle';
    if (hits.some((h) => packLike.has(h))) return 'pack';
    if (hits.some((h) => cupLike.has(h))) return 'cup';
    return 'piece';
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层3: category 判断
  // ═════════════════════════════════════════════════════════════════════════

  private resolveFromCategory(
    food: FoodLibrary,
  ): PortionScalingPolicy | null {
    const cat = (food.category || '').toLowerCase();
    const sub = (food.subCategory || '').toLowerCase();

    // 调味品
    if (cat === 'condiment' || cat === 'sauce' || cat === 'oil' ||
        sub === 'oil' || sub === 'sauce' || sub === 'dressing') {
      return {
        mode: PortionScalingMode.CONDIMENT_OR_MICRO,
        minRatio: 0.2,
        maxRatio: this.config.condimentMaxGrams /
          (Math.max(food.standardServingG || 100, 1)),
        ratioStep: 0.25,
        inferredFrom: [`category=${cat}`, ...(sub ? [`subCategory=${sub}`] : [])],
        isCoreMealRole: false,
        unitType: 'gram',
        isPrimaryRecommendation: false,
      };
    }

    // 饮品
    if (cat === 'beverage' || cat === 'drink') {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [`category=${cat}`],
        isCoreMealRole: false,
        unitType: 'bottle',
        isPrimaryRecommendation: true,
      };
    }

    // 包装零食
    if (cat === 'snack' || sub === 'packaged_snack') {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: [`category=${cat}`],
        isCoreMealRole: false,
        unitType: 'pack',
        isPrimaryRecommendation: true,
      };
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层4: foodForm 组合判断
  // ═════════════════════════════════════════════════════════════════════════

  private resolveFromFoodForm(
    food: FoodLibrary,
  ): PortionScalingPolicy | null {
    const form = (food.foodForm || '').toLowerCase();
    if (!form) return null;

    if (form === 'ingredient') {
      return this.buildScalablePolicy(food, ['foodForm=ingredient']);
    }

    if (form === 'dish') {
      const dt = (food.dishType || food.taxonomy?.dishType || '').toLowerCase();
      if (dt === 'soup' || dt === 'salad') {
        return this.buildLimitedScalablePolicy(food, [
          `foodForm=dish`,
          `dishType=${dt}`,
        ]);
      }
      return this.buildLimitedScalablePolicy(food, ['foodForm=dish']);
    }

    if (form === 'semi_prepared' || form === 'semi-prepared') {
      // 半成品：包装食品偏固定，散装偏 scalable
      const cat = (food.category || '').toLowerCase();
      if (cat === 'snack' || cat === 'beverage' || cat === 'condiment') {
        return null; // 走后续 rules
      }
      return {
        mode: PortionScalingMode.LIMITED_SCALABLE,
        minRatio: this.config.limitedScalableMinRatio,
        maxRatio: this.config.limitedScalableMaxRatio,
        ratioStep: 0.25,
        inferredFrom: ['foodForm=semi_prepared'],
        isCoreMealRole: true,
        unitType: 'serving',
        isPrimaryRecommendation: true,
      };
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层5: tags 辅助
  // ═════════════════════════════════════════════════════════════════════════

  private CONDIMENT_TAGS = new Set([
    'condiment', 'sauce', 'dressing', 'oil',
    'seasoning', 'spice', '调味料', '调味品',
    '酱', '油',
  ]);

  private COMBO_TAGS = new Set([
    'combo', 'set_meal', 'meal_set', '套餐',
    'bento', 'lunch_box', '便当',
  ]);

  private PACKAGED_TAGS = new Set([
    'packaged', 'pack', 'bottled', 'canned', '包装',
    '袋装', '瓶装', '罐装',
  ]);

  private resolveFromTags(food: FoodLibrary): PortionScalingPolicy | null {
    const tags = (food.tags || []).map((t) => t.toLowerCase());

    // 套餐标签
    if (tags.some((t) => this.COMBO_TAGS.has(t))) {
      return {
        mode: PortionScalingMode.NOT_SCALABLE,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: ['tags:combo/set_meal'],
        isCoreMealRole: true,
        unitType: 'serving',
        isPrimaryRecommendation: true,
      };
    }

    // 调味品标签
    if (tags.some((t) => this.CONDIMENT_TAGS.has(t))) {
      return {
        mode: PortionScalingMode.CONDIMENT_OR_MICRO,
        minRatio: 0.2,
        maxRatio: this.config.condimentMaxGrams /
          (Math.max(food.standardServingG || 100, 1)),
        ratioStep: 0.25,
        inferredFrom: ['tags:condiment/sauce'],
        isCoreMealRole: false,
        unitType: 'gram',
        isPrimaryRecommendation: false,
      };
    }

    // 包装食品标签
    if (tags.some((t) => this.PACKAGED_TAGS.has(t))) {
      return {
        mode: PortionScalingMode.FIXED_UNIT,
        minRatio: 1,
        maxRatio: 1,
        ratioStep: 1,
        inferredFrom: ['tags:packaged'],
        isCoreMealRole: true,
        unitType: 'pack',
        isPrimaryRecommendation: true,
      };
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 规则层6: availableChannels
  // ═════════════════════════════════════════════════════════════════════════

  private EXTERNAL_CHANNELS = new Set([
    'restaurant', 'delivery', 'takeout', 'fast_food', 'convenience',
  ]);

  private resolveFromChannels(
    food: FoodLibrary,
  ): PortionScalingPolicy | null {
    const channels =
      food.availableChannels ||
      food.taxonomy?.availableChannels ||
      [];
    if (!channels.length) return null;

    const externalOnly = channels.every((ch) =>
      this.EXTERNAL_CHANNELS.has(ch),
    );
    if (externalOnly && channels.length > 0 && channels.length <= 3) {
      // 只在餐厅/外卖渠道可获取 → 更偏向固定份
      return this.buildLimitedScalablePolicy(food, [
        `channels_only_${channels.join('+')}`,
      ]);
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 策略构建辅助方法
  // ═════════════════════════════════════════════════════════════════════════

  private buildScalablePolicy(
    food: FoodLibrary,
    inferredFrom: string[],
  ): PortionScalingPolicy {
    const stdG = Math.max(
      food.standardServingG ||
        food.portionGuide?.standardServingG ||
        100,
      1,
    );

    return {
      mode: PortionScalingMode.SCALABLE,
      minRatio: this.config.scalableMinRatio,
      maxRatio: this.config.scalableMaxRatio,
      ratioStep: 0.25,
      inferredFrom,
      isCoreMealRole: this.isStapleCategory(food),
      unitType: 'gram',
      isPrimaryRecommendation: true,
    };
  }

  private buildLimitedScalablePolicy(
    food: FoodLibrary,
    inferredFrom: string[],
  ): PortionScalingPolicy {
    return {
      mode: PortionScalingMode.LIMITED_SCALABLE,
      minRatio: this.config.limitedScalableMinRatio,
      maxRatio: this.config.limitedScalableMaxRatio,
      ratioStep: 0.25,
      inferredFrom,
      isCoreMealRole: true,
      unitType: 'serving',
      isPrimaryRecommendation: true,
    };
  }

  /**
   * 判断食物是否为主食/蛋白/蔬菜等核心角色
   */
  private isStapleCategory(food: FoodLibrary): boolean {
    const core = new Set([
      'grain', 'meat', 'seafood', 'egg', 'vegetable',
      'fruit', 'dairy', 'legume', 'staple',
    ]);
    return core.has((food.category || '').toLowerCase());
  }
}
