/**
 * V8.5: PortionScalingService
 *
 * 基于 PortionScalingPolicy 的份量缩放实现。
 * 替代原有 MealAssemblerService.adjustPortions 中的统一全局缩放逻辑。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { ScoredFood } from '../types/recommendation.types';
import {
  PortionScalingMode,
  type PortionScalingPolicy,
  type PortionAdjustedResult,
} from './portion-scaling-policy.types';
import { PortionScalingPolicyResolver } from './portion-scaling-policy.resolver';

/**
 * 根据缩放策略 + 比例，从 commonPortions 中匹配最接近的份量描述。
 * V8.5 改进：不同模式使用不同描述策略。
 */
function resolveAdjustedServingDesc(
  standardG: number,
  standardServingDesc: string | undefined,
  commonPortions: Array<{ name: string; grams: number }>,
  policy: PortionScalingPolicy,
  ratio: number,
): string | undefined {
  if (Math.abs(ratio - 1) < 0.01) {
    return undefined; // 未缩放，使用默认描述
  }

  const adjustedG = Math.round(standardG * ratio);

  if (commonPortions.length > 0) {
    let best: { name: string; grams: number } | null = null;
    let bestDiff = Infinity;
    for (const p of commonPortions) {
      const diff = Math.abs(p.grams - adjustedG);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    if (best && bestDiff <= 15) {
      return best.name;
    }
  }

  const rawLocale = ClsServiceManager.getClsService()?.get('locale');
  const locale = typeof rawLocale === 'string' ? rawLocale : undefined;
  if (/^en(?:[-_]|$)/i.test(locale || '')) {
    return `~${adjustedG}g`;
  }
  if (/^ja(?:[-_]|$)/i.test(locale || '')) {
    return `約${adjustedG}g`;
  }

  return `约${adjustedG}g`;
}

/**
 * 计算可感知的缩放倍数描述
 */
function scalingSuffix(policy: PortionScalingPolicy, ratio: number): string {
  if (ratio >= 1.25) return '（大份）';
  if (ratio <= 0.75) return '（小份）';
  if (ratio <= 0.55) return '（半份）';
  return '';
}

@Injectable()
export class PortionScalingService {
  private readonly logger = new Logger(PortionScalingService.name);

  constructor(
    private readonly policyResolver: PortionScalingPolicyResolver,
  ) {}

  /**
   * 按策略缩放单个食物
   *
   * @param food       原始 ScoredFood
   * @param policy     该食物的缩放策略
   * @param targetRatio 目标缩放比例（由外部策略计算得出）
   * @returns 缩放后的结果
   */
  applyToFood(
    food: ScoredFood,
    policy: PortionScalingPolicy,
    targetRatio: number,
  ): PortionAdjustedResult {
    const standardG =
      food.food.standardServingG ||
      food.food.portionGuide?.standardServingG ||
      100;

    // 根据策略模式计算实际缩放比
    let actualRatio: number;
    let wasClamped = false;

    switch (policy.mode) {
      case PortionScalingMode.SCALABLE:
        actualRatio = this.clampRatio(
          targetRatio,
          policy,
          standardG,
        );
        wasClamped = actualRatio !== targetRatio;
        actualRatio = this.quantizeRatio(actualRatio, policy);
        break;

      case PortionScalingMode.LIMITED_SCALABLE:
        actualRatio = this.clampRatio(
          targetRatio,
          policy,
          standardG,
        );
        wasClamped = actualRatio !== targetRatio;
        // limited_scalable 用 0.25 步进后钳制
        actualRatio = this.quantizeRatio(actualRatio, policy);
        break;

      case PortionScalingMode.FIXED_UNIT:
        // 不允许缩放 — 保持 1x
        actualRatio = 1;
        wasClamped = targetRatio !== 1;
        break;

      case PortionScalingMode.NOT_SCALABLE:
        // 完全不可缩放
        actualRatio = 1;
        wasClamped = targetRatio !== 1;
        break;

      case PortionScalingMode.CONDIMENT_OR_MICRO:
        // 可小克重缩放但严格上限
        actualRatio = Math.min(
          targetRatio,
          policy.maxRatio,
        );
        actualRatio = Math.max(actualRatio, policy.minRatio);
        wasClamped = actualRatio !== targetRatio;
        actualRatio = this.quantizeRatio(actualRatio, policy);
        break;

      default:
        actualRatio = targetRatio;
    }

    // 计算缩放后的营养值
    const ratio = actualRatio;
    const servingCalories = Math.round((food.servingCalories || 0) * ratio);
    const servingProtein = Math.round((food.servingProtein || 0) * ratio);
    const servingFat = Math.round((food.servingFat || 0) * ratio);
    const servingCarbs = Math.round((food.servingCarbs || 0) * ratio);
    const servingFiber = Math.round((food.servingFiber || 0) * ratio);

    // 生成缩放说明
    let scalingNote: string | undefined;
    const adjustedDesc = resolveAdjustedServingDesc(
      standardG,
      food.food.standardServingDesc ||
        food.food.portionGuide?.standardServingDesc ||
        undefined,
      food.food.commonPortions ||
        food.food.portionGuide?.commonPortions ||
        [],
      policy,
      ratio,
    );

    if (wasClamped) {
      scalingNote =
        policy.mode === PortionScalingMode.FIXED_UNIT ||
        policy.mode === PortionScalingMode.NOT_SCALABLE
          ? '保持完整份量，未缩放'
          : `份量已调至合理范围${scalingSuffix(policy, ratio)}`;
    } else if (ratio !== 1) {
      scalingNote = `已调整至${adjustedDesc || `约${Math.round(standardG * ratio)}g`}${scalingSuffix(policy, ratio)}`;
    }

    return {
      food: {
        ...food.food,
        ...(adjustedDesc !== undefined
          ? { displayServingDesc: adjustedDesc } as any
          : {}),
      },
      ratio,
      servingCalories,
      servingProtein,
      servingFat,
      servingCarbs,
      servingFiber,
      wasClamped,
      scalingNote,
    };
  }

  /**
   * 按策略批量缩放
   *
   * 核心流程：
   * 1. 按策略分类食物（scalable / limited_scalable 参与缩放，fixed/not 保持 1x）
   * 2. 计算可缩放食物的总热量 + 固定食物的总热量
   * 3. 在可缩放食物间分配剩余热量预算
   * 4. 传递优先级：scalable > limited_scalable > fixed/not（后者不缩放）
   */
  applyBatch(
    picks: ScoredFood[],
    policies: Map<string, PortionScalingPolicy>,
    budget: number,
    portionTendency?: string | null,
  ): { adjusted: PortionAdjustedResult[]; totalCal: number } {
    if (picks.length === 0) return { adjusted: [], totalCal: 0 };

    // 分组
    const scalable: { food: ScoredFood; policy: PortionScalingPolicy }[] = [];
    const limited: { food: ScoredFood; policy: PortionScalingPolicy }[] = [];
    const fixed: { food: ScoredFood; policy: PortionScalingPolicy }[] = [];
    const notScalable: { food: ScoredFood; policy: PortionScalingPolicy }[] = [];
    const condiments: { food: ScoredFood; policy: PortionScalingPolicy }[] = [];

    for (const pick of picks) {
      const policy =
        policies.get(pick.food.id) ??
        this.policyResolver.resolve(pick.food);

      switch (policy.mode) {
        case PortionScalingMode.SCALABLE:
          scalable.push({ food: pick, policy });
          break;
        case PortionScalingMode.LIMITED_SCALABLE:
          limited.push({ food: pick, policy });
          break;
        case PortionScalingMode.FIXED_UNIT:
          fixed.push({ food: pick, policy });
          break;
        case PortionScalingMode.NOT_SCALABLE:
          notScalable.push({ food: pick, policy });
          break;
        case PortionScalingMode.CONDIMENT_OR_MICRO:
          condiments.push({ food: pick, policy });
          break;
      }
    }

    // 固定食物的热量（不参与缩放）
    const fixedCal = [...fixed, ...notScalable].reduce(
      (s, g) => s + (g.food.servingCalories || 0),
      0,
    );

    // 调味品热量
    const condimentCal = condiments.reduce(
      (s, g) => s + (g.food.servingCalories || 0),
      0,
    );

    // 剩余预算分配给可缩放食物
    const remainingBudget = Math.max(0, budget - fixedCal - condimentCal);

    // 可缩放食物的原始热量
    const allScalable = [...scalable, ...limited];
    const scalableTotalCal = allScalable.reduce(
      (s, g) => s + (g.food.servingCalories || 0),
      0,
    );

    // 用户倾向微调
    let tendencyFactor = 1.0;
    if (portionTendency === 'small') tendencyFactor = 0.9;
    else if (portionTendency === 'large') tendencyFactor = 1.1;

    const results: PortionAdjustedResult[] = [];

    // 固定食物：保持 1x
    for (const g of fixed) {
      results.push({
        food: g.food.food,
        ratio: 1,
        servingCalories: g.food.servingCalories || 0,
        servingProtein: g.food.servingProtein || 0,
        servingFat: g.food.servingFat || 0,
        servingCarbs: g.food.servingCarbs || 0,
        servingFiber: g.food.servingFiber || 0,
        wasClamped: false,
        scalingNote: '固定单位，保持完整份量',
      });
    }

    for (const g of notScalable) {
      results.push({
        food: g.food.food,
        ratio: 1,
        servingCalories: g.food.servingCalories || 0,
        servingProtein: g.food.servingProtein || 0,
        servingFat: g.food.servingFat || 0,
        servingCarbs: g.food.servingCarbs || 0,
        servingFiber: g.food.servingFiber || 0,
        wasClamped: false,
        scalingNote: '套餐/标准餐品，保持完整份量',
      });
    }

    // 调味品：小范围调整
    for (const g of condiments) {
      const targetRatio = scalableTotalCal > 0
        ? (remainingBudget / scalableTotalCal) * tendencyFactor
        : 1;
      results.push(this.applyToFood(g.food, g.policy, targetRatio));
    }

    // scalable 食物：优先缩放
    if (scalable.length > 0 && scalableTotalCal > 0) {
      let globalRatio =
        (remainingBudget / scalableTotalCal) * tendencyFactor;

      // A 轮：先对 scalable 做缩放
      for (const g of scalable) {
        const r = this.applyToFood(g.food, g.policy, globalRatio);
        results.push(r);
      }

      // B 轮：limited_scalable 小范围调整
      for (const g of limited) {
        const adjusted = this.applyToFood(g.food, g.policy, globalRatio);
        results.push(adjusted);
      }
    } else if (allScalable.length > 0 && scalableTotalCal > 0) {
      // 只有 limited，无 scalable
      const globalRatio =
        (remainingBudget / scalableTotalCal) * tendencyFactor;

      for (const g of allScalable) {
        results.push(this.applyToFood(g.food, g.policy, globalRatio));
      }
    } else {
      // 只有 fixed/not → 保持原始值
    }

    const totalCal = results.reduce(
      (s, r) => s + r.servingCalories,
      0,
    );

    return { adjusted: results, totalCal };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 辅助方法
  // ═════════════════════════════════════════════════════════════════════════

  private clampRatio(
    ratio: number,
    policy: PortionScalingPolicy,
    standardG: number,
  ): number {
    return Math.max(
      policy.minRatio,
      Math.min(policy.maxRatio, ratio),
    );
  }

  private quantizeRatio(
    ratio: number,
    policy: PortionScalingPolicy,
  ): number {
    if (policy.ratioStep <= 0) return ratio;
    const step = policy.ratioStep;
    const q = Math.round(ratio / step) * step;
    return Math.max(policy.minRatio, Math.min(policy.maxRatio, q));
  }
}
