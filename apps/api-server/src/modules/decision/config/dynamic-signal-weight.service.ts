/**
 * V3.1 Phase 1 — 动态信号权重调整服务
 *
 * 基于用户当天 macroSlotStatus + goalType，对静态信号优先级矩阵
 * 进行运行时倍率调整，返回调整后的权重 map。
 *
 * 设计原则:
 * - 纯函数，无 IO，无副作用，可独立测试
 * - 不替换 signal-priority.config.ts，而是在其基础上叠加倍率
 * - 输入: 基础权重 map + macroSlotStatus + goalType
 * - 输出: 调整后的权重 map（同 key，新数值）
 */

import { Injectable } from '@nestjs/common';
import { MacroSlotStatus } from '../types/analysis-result.types';
import { SignalPriorityMap } from './signal-priority.config';

/** 调整规则定义 */
interface WeightRule {
  /** 触发条件函数 */
  condition: (slot: MacroSlotStatus, goalType: string) => boolean;
  /** 需要调整的信号 key */
  signal: string;
  /** 倍率（乘以当前权重） */
  multiplier: number;
}

/**
 * 权重调整规则集（按优先级从高到低排列）
 * 多条规则可叠加（均会被执行），最终权重 = base × m1 × m2 × ...
 */
const WEIGHT_RULES: WeightRule[] = [
  // 蛋白质缺口且目标是增肌：protein_gap 叠乘 1.68（1.4 × 1.2）
  {
    condition: (slot, goal) =>
      slot.protein === 'deficit' && goal === 'muscle_gain',
    signal: 'protein_gap',
    multiplier: 1.4,
  },
  {
    condition: (slot, goal) =>
      slot.protein === 'deficit' && goal === 'muscle_gain',
    signal: 'protein_gap',
    multiplier: 1.2,
  },
  // 蛋白质缺口（通用）：protein_gap × 1.4
  {
    condition: (slot, goal) =>
      slot.protein === 'deficit' && goal !== 'muscle_gain',
    signal: 'protein_gap',
    multiplier: 1.4,
  },
  // 热量超标：over_limit × 1.3
  {
    condition: (slot) => slot.calories === 'excess',
    signal: 'over_limit',
    multiplier: 1.3,
  },
  // 脂肪超标：fat_excess × 1.2
  {
    condition: (slot) => slot.fat === 'excess',
    signal: 'fat_excess',
    multiplier: 1.2,
  },
  // 碳水超标：carb_excess × 1.15
  {
    condition: (slot) => slot.carbs === 'excess',
    signal: 'carb_excess',
    multiplier: 1.15,
  },
  // 热量严重不足（用于增肌/维持）：under_target × 1.2
  {
    condition: (slot, goal) =>
      slot.calories === 'deficit' &&
      (goal === 'muscle_gain' || goal === 'maintenance'),
    signal: 'under_target',
    multiplier: 1.2,
  },
];

@Injectable()
export class DynamicSignalWeightService {
  /**
   * 根据实时宏量状态调整信号优先级权重
   *
   * @param baseWeights - 来自 signal-priority.config.ts 的静态权重 map
   * @param macroSlotStatus - V3.0 计算出的四维宏量槽位状态
   * @param goalType - 用户目标类型
   * @returns 调整后的权重 map（不修改原始对象）
   */
  adjustWeights(
    baseWeights: SignalPriorityMap,
    macroSlotStatus: MacroSlotStatus | undefined,
    goalType: string,
  ): SignalPriorityMap {
    if (!macroSlotStatus) {
      return baseWeights;
    }

    // 浅拷贝，不修改原始权重
    const adjusted: SignalPriorityMap = { ...baseWeights };

    for (const rule of WEIGHT_RULES) {
      if (rule.condition(macroSlotStatus, goalType)) {
        const current = adjusted[rule.signal];
        if (current != null) {
          adjusted[rule.signal] = Math.round(current * rule.multiplier);
        }
      }
    }

    return adjusted;
  }
}
