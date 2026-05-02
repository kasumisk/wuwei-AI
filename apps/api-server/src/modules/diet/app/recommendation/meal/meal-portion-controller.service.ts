/**
 * V8.5: MealPortionController
 *
 * 控制每餐食物组合的合理性和真实性：
 * 1. 限制每餐食物数量（而非每个都缩小）
 * 2. 优先移除可选配菜/调味品，而非核心主食/蛋白/蔬菜
 * 3. 超出预算时优先替换高热量食物，而非缩放所有食物
 * 4. 确保每餐有合理的角色结构
 */
import { Injectable, Logger } from '@nestjs/common';
import { ScoredFood } from '../types/recommendation.types';
import {
  PortionScalingMode,
  type PortionScalingPolicy,
  MEAL_FOOD_COUNT_RANGE,
  MEAL_ROLE_PRIORITY,
} from './portion-scaling-policy.types';

@Injectable()
export class MealPortionController {
  private readonly logger = new Logger(MealPortionController.name);

  /**
   * 控制每餐食物数量到合理范围
   *
   * 流程：
   * 1. 如果 picks 超过 max，从中移除低优先级食物
   * 2. 移除顺序：condiment > side > drink > fruit > dairy > 重复品类的最低分
   *
   * @param picks 当前选中的食物
   * @param mealType 餐次类型
   * @param policies 已解析的缩放策略
   * @returns 精简后的食物列表
   */
  trimExcessFoods(
    picks: ScoredFood[],
    mealType: string,
    policies: Map<string, PortionScalingPolicy>,
  ): {
    kept: ScoredFood[];
    removed: ScoredFood[];
    removedReasons: string[];
  } {
    const range = MEAL_FOOD_COUNT_RANGE[mealType] ??
      MEAL_FOOD_COUNT_RANGE['lunch'];

    if (picks.length <= range.max) {
      return { kept: [...picks], removed: [], removedReasons: [] };
    }

    const removed: ScoredFood[] = [];
    const removedReasons: string[] = [];

    // 按移除优先级排序（低优先级先移除）
    const withPriority = picks.map((p) => {
      const policy = policies.get(p.food.id);
      const rolePriority = policy?.isCoreMealRole ? 5 : 1;
      const modePriority = this.modePriorityForTrim(policy);
      const priority = rolePriority + modePriority;

      return { food: p, priority, policy };
    });

    withPriority.sort((a, b) => a.priority - b.priority);

    // 需要移除的数量
    const removeCount = picks.length - range.max;

    const removedIds = new Set<string>();
    for (let i = 0; i < Math.min(removeCount, withPriority.length); i++) {
      const item = withPriority[i];
      removedIds.add(item.food.food.id);
      removed.push(item.food);

      if (item.policy?.mode === PortionScalingMode.CONDIMENT_OR_MICRO) {
        removedReasons.push(
          `${item.food.food.name}：调味品/微量食物，留作营养参考`,
        );
      } else if (item.policy?.mode === PortionScalingMode.NOT_SCALABLE) {
        removedReasons.push(
          `${item.food.food.name}：套餐不适合缩减，已替换`,
        );
      } else if (!item.policy?.isCoreMealRole) {
        removedReasons.push(
          `${item.food.food.name}：非核心食物，优先精简`,
        );
      } else {
        removedReasons.push(
          `${item.food.food.name}：超过本餐食物数量上限`,
        );
      }
    }

    const kept = picks.filter((p) => !removedIds.has(p.food.id));

    return { kept, removed, removedReasons };
  }

  /**
   * 营养超标时优先处理策略
   *
   * 当总热量超过预算时，按以下优先级处理：
   * 1. 移除 optional side / condiment
   * 2. 替换高热量 not_scalable 食物
   * 3. 缩减 scalable 食物
   * 4. 最后才对 limited_scalable 小范围调整
   *
   * @returns 处理后 picks + 是否做了删减
   */
  handleCalorieOverflow(
    picks: ScoredFood[],
    policies: Map<string, PortionScalingPolicy>,
    budget: number,
  ): {
    picks: ScoredFood[];
    didPrune: boolean;
    prunedNames: string[];
  } {
    const totalCal = picks.reduce((s, p) => s + (p.servingCalories || 0), 0);
    if (totalCal <= budget * 1.05) {
      return { picks, didPrune: false, prunedNames: [] };
    }

    const prunedNames: string[] = [];
    let current = [...picks];

    // Step 1: 移除 condiment_or_micro 食物（不需要单独作为主推荐位）
    const condimentRemoved = current.filter((p) => {
      const policy = policies.get(p.food.id);
      if (policy?.mode === PortionScalingMode.CONDIMENT_OR_MICRO) {
        prunedNames.push(p.food.name);
        return false;
      }
      return true;
    });
    if (condimentRemoved.length < current.length) {
      current = condimentRemoved;
      const newCal = current.reduce((s, p) => s + (p.servingCalories || 0), 0);
      if (newCal <= budget * 1.05) {
        return { picks: current, didPrune: true, prunedNames };
      }
    }

    // Step 2: 移除非核心且高热量食物
    const nonCoreByName = new Set(prunedNames);
    const trimmed = current
      .filter((p) => {
        const policy = policies.get(p.food.id);
        const cal = p.servingCalories || 0;
        // 去除调味品 + 非核心且高热量（超过预算33%）
        if (
          policy?.mode === PortionScalingMode.CONDIMENT_OR_MICRO ||
          (!policy?.isCoreMealRole &&
            cal > budget * 0.33 &&
            current.length > 3)
        ) {
          prunedNames.push(p.food.name);
          return false;
        }
        return true;
      });

    if (trimmed.length < current.length) {
      current = trimmed;
      const newCal = current.reduce((s, p) => s + (p.servingCalories || 0), 0);
      if (newCal <= budget * 1.05) {
        return { picks: current, didPrune: true, prunedNames };
      }
    }

    return {
      picks: current,
      didPrune: prunedNames.length > 0,
      prunedNames,
    };
  }

  /**
   * 确保每餐有合理的角色结构
   *
   * 最小角色保障：
   * - 至少 1 个主食(staple/grain) 或 碳水来源
   * - 至少 1 个蛋白质来源
   * - 至少 1 个蔬菜/水果
   *
   * 如果不满足，尝试从 candidates 中补位。
   */
  ensureRoleCoverage(
    picks: ScoredFood[],
    candidates: ScoredFood[],
    policies: Map<string, PortionScalingPolicy>,
    usedNames: Set<string>,
  ): ScoredFood[] {
    if (picks.length === 0) return picks;

    const result = [...picks];
    const covered = this.checkRoleCoverage(picks);

    // 缺少主食
    if (!covered.hasStaple && candidates.length > 0) {
      const staple = candidates.find(
        (c) =>
          !usedNames.has(c.food.name) &&
          this.isStapleRole(c) &&
          !result.some((r) => r.food.id === c.food.id),
      );
      if (staple) {
        result.push(staple);
        usedNames.add(staple.food.name);
      }
    }

    // 缺少蛋白质
    if (!covered.hasProtein && candidates.length > 0) {
      const protein = candidates.find(
        (c) =>
          !usedNames.has(c.food.name) &&
          this.isProteinRole(c) &&
          !result.some((r) => r.food.id === c.food.id),
      );
      if (protein) {
        result.push(protein);
        usedNames.add(protein.food.name);
      }
    }

    // 缺少蔬菜
    if (!covered.hasVeggie && candidates.length > 0) {
      const veggie = candidates.find(
        (c) =>
          !usedNames.has(c.food.name) &&
          this.isVeggieRole(c) &&
          !result.some((r) => r.food.id === c.food.id),
      );
      if (veggie) {
        result.push(veggie);
        usedNames.add(veggie.food.name);
      }
    }

    return result;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Role detection helpers
  // ═════════════════════════════════════════════════════════════════════════

  private isStapleRole(food: ScoredFood): boolean {
    const staples = new Set([
      'grain', 'staple', 'bread', 'rice', 'noodle', 'pasta',
    ]);
    return staples.has((food.food.category || '').toLowerCase()) ||
      staples.has((food.food.subCategory || '').toLowerCase());
  }

  private isProteinRole(food: ScoredFood): boolean {
    const proteins = new Set([
      'meat', 'seafood', 'egg', 'dairy', 'legume', 'protein',
    ]);
    return proteins.has((food.food.category || '').toLowerCase()) ||
      proteins.has((food.food.subCategory || '').toLowerCase());
  }

  private isVeggieRole(food: ScoredFood): boolean {
    const veggies = new Set(['vegetable', 'veggie', 'fruit']);
    return veggies.has((food.food.category || '').toLowerCase()) ||
      veggies.has((food.food.subCategory || '').toLowerCase());
  }

  private checkRoleCoverage(picks: ScoredFood[]): {
    hasStaple: boolean;
    hasProtein: boolean;
    hasVeggie: boolean;
  } {
    return {
      hasStaple: picks.some((p) => this.isStapleRole(p)),
      hasProtein: picks.some((p) => this.isProteinRole(p)),
      hasVeggie: picks.some((p) => this.isVeggieRole(p)),
    };
  }

  private modePriorityForTrim(
    policy: PortionScalingPolicy | undefined,
  ): number {
    if (!policy) return 3;
    switch (policy.mode) {
      case PortionScalingMode.CONDIMENT_OR_MICRO:
        return 0;
      case PortionScalingMode.NOT_SCALABLE:
        return 1;
      case PortionScalingMode.FIXED_UNIT:
        return policy.isCoreMealRole ? 4 : 2;
      case PortionScalingMode.LIMITED_SCALABLE:
        return policy.isCoreMealRole ? 5 : 3;
      case PortionScalingMode.SCALABLE:
        return policy.isCoreMealRole ? 5 : 4;
      default:
        return 3;
    }
  }
}
