/**
 * V6.5 Phase 1D: RealisticFilterService — 召回阶段现实性过滤
 *
 * 在 recallCandidates 之后、rankCandidates 之前应用现实性过滤，
 * 确保推荐的食物用户实际能获取、有能力制作、符合预算和时间约束。
 *
 * V7.1 Phase 2-E: 场景设备约束
 * - checkCookingEquipment() — 基于 KitchenProfile 过滤需要用户没有的设备的食物
 *
 * V7.2 P2-C: 现实策略可配置化
 * - filterByRealismLevel() — 基于 RealismLevel 预设驱动过滤
 * - adjustForUserPreference() 支持 'off' 级别
 *
 * V7.8 P2-A: food_form 感知过滤
 * - preferDishOverIngredient() — 当候选池中同一 mainIngredient 有 dish 版本时，
 *   对 ingredient 版本降权过滤，优先推荐成品菜而非原料
 *
 * 过滤规则（可通过 strategy.realism 配置开关）：
 * 1. commonality_score < threshold → 过滤（默认 threshold=20）
 * 1.5 V7.8: food_form 感知 — ingredient 有同类 dish 时过滤 ingredient
 * 2. estimated_cost_level > budget + 2 → 过滤
 * 3. 工作日午餐 + cook_time > cap → 过滤（自炊渠道）
 * 4. 渠道不匹配 → 已有逻辑，此处加强时间维度
 * 5. V7.1: 设备不匹配 → 需要的设备用户没有（仅 HOME_COOK）
 *
 * 兜底策略：过滤后至少保留 5 个候选，否则回退到原候选池。
 */

import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  PipelineContext,
  AcquisitionChannel,
  type RealismLevel,
  REALISM_PRESETS,
  type RealismPreset,
  SCENE_DEFAULT_REALISM,
} from '../types/recommendation.types';
import {
  RealismConfig,
  DEFAULT_REALISM,
} from '../../../../strategy/strategy.types';
import type { KitchenProfile } from '../../../../user/user.types';

/** 过滤后至少保留的候选数量 */
const MIN_CANDIDATES = 5;

/** V6.7 Phase 1-C: 技能级别映射（数值越大越难） */
const SKILL_LEVEL_MAP: Record<string, number> = {
  easy: 1,
  beginner: 1,
  medium: 2,
  intermediate: 2,
  hard: 3,
  advanced: 3,
};

/** 预算等级 → 最大允许的 estimatedCostLevel 映射 */
const BUDGET_COST_CAP: Record<string, number> = {
  low: 3,
  medium: 4,
  high: 5,
};

/** V7.1 P2-E: 设备→烹饪方式映射（与 SceneResolverService 保持一致） */
const EQUIPMENT_TO_METHODS: Record<string, string[]> = {
  oven: ['bake', 'roast'],
  microwave: ['microwave'],
  air_fryer: ['air_fry'],
  steamer: ['steam'],
  rice_cooker: ['rice_cook'],
};

/** V7.1 P2-E: KitchenProfile 字段→设备 key */
const KITCHEN_FIELDS: { field: keyof KitchenProfile; equipment: string }[] = [
  { field: 'hasOven', equipment: 'oven' },
  { field: 'hasMicrowave', equipment: 'microwave' },
  { field: 'hasAirFryer', equipment: 'air_fryer' },
  { field: 'hasSteamer', equipment: 'steamer' },
  { field: 'hasRiceCooker', equipment: 'rice_cooker' },
];

@Injectable()
export class RealisticFilterService {
  private readonly logger = new Logger(RealisticFilterService.name);

  /**
   * 在 recallCandidates 之后、rankCandidates 之前应用现实性过滤
   *
   * @param candidates     - 召回阶段的候选食物列表
   * @param context        - Pipeline 上下文（含用户画像、渠道、场景等）
   * @param realism        - 现实性配置（来自 strategy.realism，缺失时使用默认值）
   * @param kitchenProfile - V7.1 P2-E: 厨房设备画像（可选）
   * @returns 过滤后的候选食物列表
   */
  filterByRealism(
    candidates: FoodLibrary[],
    context: PipelineContext,
    realism?: RealismConfig,
    kitchenProfile?: KitchenProfile | null,
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

    // 1.5 V7.8 P2-A: food_form 感知过滤 — ingredient 有同类 dish 时过滤 ingredient
    filtered = this.preferDishOverIngredient(filtered);

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

    // 5. V6.7 Phase 1-C: 技能级别硬过滤（仅 HOME_COOK 渠道）
    if (context.channel === AcquisitionChannel.HOME_COOK) {
      const userSkill = context.userProfile?.cookingSkillLevel;
      if (userSkill) {
        const maxSkill = SKILL_LEVEL_MAP[userSkill] ?? 3;
        const skillFiltered = filtered.filter((f) => {
          const required = SKILL_LEVEL_MAP[f.skillRequired ?? 'easy'] ?? 1;
          return required <= maxSkill;
        });
        // 技能过滤也尊重 MIN_CANDIDATES 兜底
        if (skillFiltered.length >= MIN_CANDIDATES) {
          filtered = skillFiltered;
        }
      }
    }

    // 6. V7.1 Phase 2-E: 设备约束过滤（仅 HOME_COOK 渠道）
    if (kitchenProfile && context.channel === AcquisitionChannel.HOME_COOK) {
      const equipmentFiltered = this.checkCookingEquipment(
        filtered,
        kitchenProfile,
      );
      if (equipmentFiltered.length >= MIN_CANDIDATES) {
        filtered = equipmentFiltered;
      }
    }

    // 兜底：过滤后至少保留 MIN_CANDIDATES 个候选
    // V6.7 Phase 1-C: 修复 fallback bug — 原 Math.max(candidates.length, MIN_CANDIDATES) 永远 >= candidates.length
    if (filtered.length < MIN_CANDIDATES) {
      this.logger.warn(
        `Realism filter too aggressive: ${before} → ${filtered.length} candidates (below ${MIN_CANDIDATES}), falling back to top ${MIN_CANDIDATES} by commonality`,
      );
      return candidates
        .slice()
        .sort((a, b) => (b.commonalityScore ?? 50) - (a.commonalityScore ?? 50))
        .slice(0, MIN_CANDIDATES);
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
  //  V7.2 P2-C: 基于 RealismLevel 预设的过滤
  // ================================================================

  /**
   * V7.2: 基于 RealismLevel 预设驱动过滤
   *
   * 根据 RealismLevel 和 RealismPreset 配置执行过滤，
   * 替代手动传入 RealismConfig 的方式。
   *
   * 优先级链: 用户偏好 > PipelineContext.realismOverride > 场景默认 > 'normal'
   *
   * @param candidates     候选食物列表
   * @param context        管道上下文
   * @param levelOverride  外部指定的 RealismLevel（可选）
   * @param kitchenProfile 厨房设备画像（可选）
   * @returns 过滤后的候选列表
   */
  filterByRealismLevel(
    candidates: FoodLibrary[],
    context: PipelineContext,
    levelOverride?: RealismLevel,
    kitchenProfile?: KitchenProfile | null,
  ): FoodLibrary[] {
    // 确定最终的 RealismLevel
    const level = this.resolveRealismLevel(context, levelOverride);

    // 'off' 直接返回
    if (level === 'off') {
      this.logger.debug('Realism level=off, skipping all filters');
      return candidates;
    }

    const preset = REALISM_PRESETS[level];

    // 转换为 RealismConfig 格式，复用 filterByRealism
    const config: RealismConfig = {
      enabled: true,
      commonalityThreshold: preset.commonalityThreshold,
      budgetFilterEnabled: preset.budgetFilterEnabled,
      cookTimeCapEnabled: preset.cookTimeCap < Infinity,
      weekdayCookTimeCap: Math.min(preset.cookTimeCap, 45),
      weekendCookTimeCap: preset.cookTimeCap,
      executabilityWeightMultiplier: 1.0,
      canteenMode: preset.canteenFilterEnabled,
    };

    return this.filterByRealism(candidates, context, config, kitchenProfile);
  }

  /**
   * V7.2: 解析最终的 RealismLevel
   *
   * 优先级: levelOverride > ctx.realismOverride > 场景默认 > 'normal'
   */
  resolveRealismLevel(
    context: PipelineContext,
    levelOverride?: RealismLevel,
  ): RealismLevel {
    if (levelOverride) return levelOverride;

    // 从 ctx.realismOverride 获取（用户端实时覆盖）
    const ctxLevel = context.realismOverride?.level;
    if (ctxLevel) {
      // 兼容旧的 3 级 + 新的 'off'
      return ctxLevel as RealismLevel;
    }

    // 从场景推断
    const channel = context.channel ?? AcquisitionChannel.UNKNOWN;
    return SCENE_DEFAULT_REALISM[channel] ?? 'normal';
  }

  // ================================================================
  //  V7.8 P2-A: food_form 感知过滤
  // ================================================================

  /**
   * V7.8 P2-A: 当候选池中同一 mainIngredient 同时存在 dish 和 ingredient 版本时，
   * 过滤掉 ingredient 版本，优先推荐成品菜。
   *
   * 例如：候选池中同时有"鸡胸肉"(ingredient) 和"宫保鸡丁"(dish, mainIngredient=鸡肉)，
   * 用户更可能想吃成品菜而非生鸡胸肉，因此过滤掉 ingredient 版本。
   *
   * 规则：
   * - 只在同一 mainIngredient 下有 dish/semi_prepared 时才过滤对应 ingredient
   * - 没有 mainIngredient 的食物不受影响
   * - 没有 foodForm 标记的食物视为 ingredient（保守处理）
   * - 过滤后仍需满足 MIN_CANDIDATES 兜底
   *
   * @param candidates 当前候选列表（已通过 commonality 过滤）
   * @returns 过滤后的候选列表
   */
  private preferDishOverIngredient(candidates: FoodLibrary[]): FoodLibrary[] {
    // 收集所有有 dish/semi_prepared 形态的 mainIngredient
    const ingredientsWithDish = new Set<string>();
    for (const f of candidates) {
      if (
        f.mainIngredient &&
        (f.foodForm === 'dish' || f.foodForm === 'semi_prepared')
      ) {
        ingredientsWithDish.add(f.mainIngredient);
      }
    }

    if (ingredientsWithDish.size === 0) return candidates;

    const filtered = candidates.filter((f) => {
      // 保留所有 dish / semi_prepared
      if (f.foodForm === 'dish' || f.foodForm === 'semi_prepared') return true;
      // 保留没有 mainIngredient 的食物（无法判断归属）
      if (!f.mainIngredient) return true;
      // ingredient 形态：如果同 mainIngredient 有 dish 版本 → 过滤
      if (ingredientsWithDish.has(f.mainIngredient)) {
        return false;
      }
      return true;
    });

    // 兜底：过滤不能让候选池低于 MIN_CANDIDATES
    if (filtered.length < MIN_CANDIDATES) {
      this.logger.debug(
        `food_form filter too aggressive: ${candidates.length} → ${filtered.length}, skipping`,
      );
      return candidates;
    }

    if (filtered.length < candidates.length) {
      this.logger.debug(
        `food_form filter: ${candidates.length} → ${filtered.length} (removed ${candidates.length - filtered.length} ingredient duplicates)`,
      );
    }

    return filtered;
  }

  // ================================================================
  //  V7.1 Phase 2-E: 设备约束过滤
  // ================================================================

  /**
   * V7.1 P2-E: 根据 KitchenProfile 过滤需要用户没有的设备的食物
   *
   * 检查食物的 cookingMethod / cookingMethods / requiredEquipment：
   * - 如果食物的所有可行烹饪方式都需要用户没有的设备 → 过滤
   * - 如果食物有至少一种不需要特殊设备的烹饪方式 → 保留
   *
   * @param candidates     候选食物列表
   * @param kitchenProfile 用户厨房设备画像
   * @returns 过滤后的候选列表
   */
  private checkCookingEquipment(
    candidates: FoodLibrary[],
    kitchenProfile: KitchenProfile,
  ): FoodLibrary[] {
    // 先算出用户没有的设备对应的烹饪方式
    const unavailableMethods = new Set<string>();
    for (const { field, equipment } of KITCHEN_FIELDS) {
      if (!kitchenProfile[field]) {
        const methods = EQUIPMENT_TO_METHODS[equipment];
        if (methods) methods.forEach((m) => unavailableMethods.add(m));
      }
    }
    if (kitchenProfile.primaryStove === 'none') {
      ['stir_fry', 'pan_fry', 'deep_fry', 'wok'].forEach((m) =>
        unavailableMethods.add(m),
      );
    }

    if (unavailableMethods.size === 0) return candidates;

    return candidates.filter((food) => {
      // 优先检查 V7.1 新字段 requiredEquipment
      if (food.requiredEquipment && food.requiredEquipment.length > 0) {
        // 如果 requiredEquipment 中有 'none' → 不需要任何设备，保留
        if (food.requiredEquipment.includes('none')) return true;
        // 检查是否所有需要的设备用户都有
        const equipNeeded = food.requiredEquipment;
        for (const equip of equipNeeded) {
          const methods = EQUIPMENT_TO_METHODS[equip];
          if (methods && methods.some((m) => unavailableMethods.has(m))) {
            // 这个设备用户没有，但食物可能有其他烹饪方式
            // 如果有 cookingMethods，检查是否有可行的替代方式
            if (food.cookingMethods && food.cookingMethods.length > 0) {
              const hasAlternative = food.cookingMethods.some(
                (m) => !unavailableMethods.has(m),
              );
              return hasAlternative;
            }
            return false;
          }
        }
        return true;
      }

      // 检查 cookingMethods（V7.1）或 cookingMethod（legacy）
      const methods = food.cookingMethods?.length
        ? food.cookingMethods
        : food.cookingMethod
          ? [food.cookingMethod]
          : [];

      if (methods.length === 0) return true; // 无烹饪方式信息 → 保留

      // 至少有一种烹饪方式用户可以执行
      return methods.some((m) => !unavailableMethods.has(m));
    });
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
    const isDinner = mealType === 'dinner';
    const isSnack = mealType === 'snack';

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
    } else if (isWeekday && isDinner) {
      // V6.7 Phase 1-C: 工作日晚餐 — 比午餐稍宽松，但仍有时间限制
      config.enabled = config.enabled ?? true;
      config.cookTimeCapEnabled = config.cookTimeCapEnabled ?? true;
      config.weekdayCookTimeCap = Math.min(
        config.weekdayCookTimeCap ?? DEFAULT_REALISM.weekdayCookTimeCap,
        45,
      );
    } else if (isSnack) {
      // V6.7 Phase 1-C: 加餐 — 极短准备时间，高便捷性（不区分工作日/周末）
      config.enabled = config.enabled ?? true;
      config.cookTimeCapEnabled = config.cookTimeCapEnabled ?? true;
      config.weekdayCookTimeCap = Math.min(
        config.weekdayCookTimeCap ?? DEFAULT_REALISM.weekdayCookTimeCap,
        10,
      );
      config.commonalityThreshold = Math.max(
        config.commonalityThreshold ?? DEFAULT_REALISM.commonalityThreshold,
        55,
      );
    }
    // 周末（非加餐）不额外收紧，使用策略/偏好的原始配置

    return config;
  }

  // ================================================================
  //  V6.9 Phase 2-D: 用户端可配置的现实策略覆盖
  // ================================================================

  /**
   * 根据用户端实时指定的严格度覆盖 realism 配置。
   *
   * V7.2: 新增 'off' 级别 — 完全关闭现实性过滤。
   *
   * 四级覆盖：
   * - **strict**:  提高大众化阈值 ≥40、强制启用时间/预算过滤 → "今天想简单吃"
   * - **normal**:  不修改，使用策略/场景已有配置
   * - **relaxed**: 降低大众化阈值 ≤10、关闭时间/预算过滤   → "今天想挑战一下"
   * - **off**:     完全关闭现实性过滤                         → "不限制"
   *
   * 此方法应在 adjustForScene() 之后调用，优先级最高。
   *
   * @param base  - 经过场景调整后的 RealismConfig（可为 undefined）
   * @param level - 用户选择的严格度
   * @returns 覆盖后的 RealismConfig
   */
  adjustForUserPreference(
    base: RealismConfig | undefined,
    level: 'strict' | 'normal' | 'relaxed' | 'off',
  ): RealismConfig {
    const config = { ...(base ?? {}) };

    switch (level) {
      case 'strict':
        config.commonalityThreshold = Math.max(
          config.commonalityThreshold ?? 20,
          40,
        );
        config.cookTimeCapEnabled = true;
        config.budgetFilterEnabled = true;
        break;
      case 'relaxed':
        config.commonalityThreshold = Math.min(
          config.commonalityThreshold ?? 20,
          10,
        );
        config.cookTimeCapEnabled = false;
        config.budgetFilterEnabled = false;
        break;
      case 'off':
        config.enabled = false;
        break;
      case 'normal':
      default:
        // 不修改，保留已有配置
        break;
    }

    return config;
  }
}
