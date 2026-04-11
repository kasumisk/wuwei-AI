/**
 * V6.5 Phase 1D: RealisticFilterService — 召回阶段现实性过滤
 *
 * 在 recallCandidates 之后、rankCandidates 之前应用现实性过滤，
 * 确保推荐的食物用户实际能获取、有能力制作、符合预算和时间约束。
 *
 * 过滤规则（可通过 strategy.realism 配置开关）：
 * 1. commonality_score < threshold → 过滤（默认 threshold=20）
 * 2. estimated_cost_level > budget + 2 → 过滤
 * 3. 工作日午餐 + cook_time > cap → 过滤（自炊渠道）
 * 4. 渠道不匹配 → 已有逻辑，此处加强时间维度
 *
 * 兜底策略：过滤后至少保留 5 个候选，否则回退到原候选池。
 */

import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import { PipelineContext, AcquisitionChannel } from './recommendation.types';
import {
  RealismConfig,
  DEFAULT_REALISM,
} from '../../../strategy/strategy.types';

/** 过滤后至少保留的候选数量 */
const MIN_CANDIDATES = 5;

/** 预算等级 → 最大允许的 estimatedCostLevel 映射 */
const BUDGET_COST_CAP: Record<string, number> = {
  low: 3,
  medium: 4,
  high: 5,
};

@Injectable()
export class RealisticFilterService {
  private readonly logger = new Logger(RealisticFilterService.name);

  /**
   * 在 recallCandidates 之后、rankCandidates 之前应用现实性过滤
   *
   * @param candidates - 召回阶段的候选食物列表
   * @param context    - Pipeline 上下文（含用户画像、渠道、场景等）
   * @param realism    - 现实性配置（来自 strategy.realism，缺失时使用默认值）
   * @returns 过滤后的候选食物列表
   */
  filterByRealism(
    candidates: FoodLibrary[],
    context: PipelineContext,
    realism?: RealismConfig,
  ): FoodLibrary[] {
    const config = this.resolveConfig(realism);

    if (!config.enabled) {
      return candidates;
    }

    const before = candidates.length;
    let filtered = candidates;

    // 1. 大众化过滤：commonalityScore 低于阈值的食物被过滤
    if (config.commonalityThreshold > 0) {
      filtered = filtered.filter(
        (f) => (f.commonalityScore ?? 50) >= config.commonalityThreshold,
      );
    }

    // 2. 预算过滤：根据用户声明的预算等级限制高价食物
    if (config.budgetFilterEnabled) {
      const budgetLevel = context.userProfile?.budgetLevel;
      if (budgetLevel) {
        const maxCost = BUDGET_COST_CAP[budgetLevel] ?? 5;
        filtered = filtered.filter(
          (f) => (f.estimatedCostLevel ?? 2) <= maxCost,
        );
      }
    }

    // 3. 烹饪时间过滤：仅自炊渠道生效，CANTEEN 渠道跳过（无烹饪成本）
    if (
      config.cookTimeCapEnabled &&
      context.channel === AcquisitionChannel.HOME_COOK
    ) {
      const isWeekday = context.contextualProfile?.dayType === 'weekday';
      const cap = isWeekday
        ? config.weekdayCookTimeCap
        : config.weekendCookTimeCap;

      filtered = filtered.filter(
        (f) => !f.cookTimeMinutes || f.cookTimeMinutes <= cap,
      );
    }

    // 4. V6.6 Phase 2-D: 食堂模式 — 提高大众化阈值到 60，优先常见菜品
    if (config.canteenMode || context.channel === AcquisitionChannel.CANTEEN) {
      const canteenThreshold = Math.max(config.commonalityThreshold, 60);
      const canteenFiltered = filtered.filter(
        (f) => (f.commonalityScore ?? 50) >= canteenThreshold,
      );
      // 兜底：食堂模式过滤不能让候选池低于 MIN_CANDIDATES
      if (canteenFiltered.length >= MIN_CANDIDATES) {
        filtered = canteenFiltered;
      }
    }

    // 兜底：过滤后至少保留 MIN_CANDIDATES 个候选
    if (filtered.length < MIN_CANDIDATES) {
      this.logger.warn(
        `Realism filter too aggressive: ${before} → ${filtered.length} candidates (below ${MIN_CANDIDATES}), falling back to original pool`,
      );
      return candidates.slice(0, Math.max(candidates.length, MIN_CANDIDATES));
    }

    if (before !== filtered.length) {
      this.logger.debug(
        `Realism filter: ${before} → ${filtered.length} candidates`,
      );
    }

    return filtered;
  }

  /**
   * 合并用户配置与默认值，确保所有字段都有值
   */
  private resolveConfig(partial?: RealismConfig): Required<RealismConfig> {
    if (!partial) {
      return { ...DEFAULT_REALISM };
    }

    return {
      enabled: partial.enabled ?? DEFAULT_REALISM.enabled,
      commonalityThreshold:
        partial.commonalityThreshold ?? DEFAULT_REALISM.commonalityThreshold,
      budgetFilterEnabled:
        partial.budgetFilterEnabled ?? DEFAULT_REALISM.budgetFilterEnabled,
      cookTimeCapEnabled:
        partial.cookTimeCapEnabled ?? DEFAULT_REALISM.cookTimeCapEnabled,
      weekdayCookTimeCap:
        partial.weekdayCookTimeCap ?? DEFAULT_REALISM.weekdayCookTimeCap,
      weekendCookTimeCap:
        partial.weekendCookTimeCap ?? DEFAULT_REALISM.weekendCookTimeCap,
      executabilityWeightMultiplier:
        partial.executabilityWeightMultiplier ??
        DEFAULT_REALISM.executabilityWeightMultiplier,
      canteenMode: partial.canteenMode ?? DEFAULT_REALISM.canteenMode,
    };
  }

  // ================================================================
  //  V6.5 Phase 3G: 场景动态 realism 调整
  // ================================================================

  /**
   * 根据上下文场景（工作日/周末 × 餐次类型）动态调整 realism 配置
   *
   * 调整规则：
   * - **工作日午餐**：自动启用烹饪时间上限、提升大众化阈值、启用预算过滤
   *   用户工作日午餐时间有限，偏好快手、常见、价格合理的食物
   * - **工作日早餐**：启用烹饪时间上限（比午餐更紧）
   *   早餐时间更有限
   * - **周末晚餐**：放宽限制，允许更多探索
   *
   * 场景调整优先级低于用户手动设置的推荐偏好（Phase 3F），
   * 只在策略未显式配置时才生效（不覆盖已有的显式配置）。
   *
   * @param base       - 基础 realism 配置（已合并策略 + 用户偏好）
   * @param mealType   - 餐次类型
   * @param dayType    - 'weekday' | 'weekend' | undefined
   * @returns 调整后的 RealismConfig
   */
  adjustForScene(
    base: RealismConfig | undefined,
    mealType: string,
    dayType?: string,
  ): RealismConfig {
    const config = { ...(base ?? {}) };

    const isWeekday = dayType === 'weekday';
    const isLunch = mealType === 'lunch';
    const isBreakfast = mealType === 'breakfast';

    if (isWeekday && isLunch) {
      // 工作日午餐：最严格的现实性约束
      // 只在未显式设置时生效（?? 操作保留用户/策略已有配置）
      config.enabled = config.enabled ?? true;
      config.cookTimeCapEnabled = config.cookTimeCapEnabled ?? true;
      config.weekdayCookTimeCap = Math.min(
        config.weekdayCookTimeCap ?? DEFAULT_REALISM.weekdayCookTimeCap,
        45,
      );
      config.commonalityThreshold = Math.max(
        config.commonalityThreshold ?? DEFAULT_REALISM.commonalityThreshold,
        30,
      );
      config.budgetFilterEnabled = config.budgetFilterEnabled ?? true;
      config.executabilityWeightMultiplier = Math.max(
        config.executabilityWeightMultiplier ??
          DEFAULT_REALISM.executabilityWeightMultiplier,
        1.3,
      );
    } else if (isWeekday && isBreakfast) {
      // 工作日早餐：时间更紧，但不调大众化
      config.enabled = config.enabled ?? true;
      config.cookTimeCapEnabled = config.cookTimeCapEnabled ?? true;
      config.weekdayCookTimeCap = Math.min(
        config.weekdayCookTimeCap ?? DEFAULT_REALISM.weekdayCookTimeCap,
        20,
      );
    }
    // 周末不额外收紧，使用策略/偏好的原始配置

    return config;
  }
}
