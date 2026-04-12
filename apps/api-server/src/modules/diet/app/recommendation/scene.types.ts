/**
 * V7.5 P3-B: 场景 / 渠道 / 现实性相关类型
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - SceneType / SceneConstraints / SceneContext
 * - AcquisitionChannel / inferAcquisitionChannel
 * - AvailabilityScore / ChannelTimeAvailability
 * - RealismLevel / RealismPreset / REALISM_PRESETS / SCENE_DEFAULT_REALISM
 */

// ==================== V6.9 Phase 1-A: 场景化推荐 ====================

/**
 * V6.9 Phase 1-A: 场景类型枚举
 *
 * 12 种用餐场景，由 SceneResolver 根据 (渠道 × 餐次 × 行为学习) 推断。
 * 每种场景携带默认的时间/烹饪/标签约束（见 SceneConstraints）。
 */
export type SceneType =
  | 'quick_breakfast'
  | 'leisurely_brunch'
  | 'office_lunch'
  | 'home_cooking'
  | 'eating_out'
  | 'convenience_meal'
  | 'canteen_meal'
  | 'post_workout'
  | 'late_night_snack'
  | 'family_dinner'
  | 'meal_prep'
  | 'general';

/**
 * V6.9 Phase 1-A: 场景约束
 *
 * 每种 SceneType 对应一组默认约束（可被 ScoringConfigSnapshot 覆盖）。
 * 约束字段均为可选 — null 表示"不限制"。
 */
export interface SceneConstraints {
  /** 最大备料时间（分钟），null=不限 */
  maxPrepTime?: number | null;
  /** 最大烹饪时间（分钟），null=不限 */
  maxCookTime?: number | null;
  /** 偏好的烹饪方式 */
  preferredCookingMethods?: string[];
  /** 偏好的食物标签 */
  preferredTags?: string[];
  /** 排除的食物标签 */
  excludedTags?: string[];
  /** 份数（1=单人，3=家庭，5=批量备餐） */
  servingCount?: number;
  /** 是否要求便携（如带饭） */
  portable?: boolean;
}

/**
 * V6.9 Phase 1-A: 场景上下文
 *
 * SceneResolver.resolve() 的返回值。
 * 替代原有的 AcquisitionChannel 单一值，包含渠道+场景+置信度+约束。
 * 下游消费者：RealisticFilter、FoodScorer(executability)、ExplanationGenerator。
 */
export interface SceneContext {
  /** 获取渠道 */
  channel: AcquisitionChannel;
  /** 场景类型 */
  sceneType: SceneType;
  /** 现实性严格度 — strict: 严格过滤 / normal: 标准 / relaxed: 宽松 / off: 关闭 (V7.2) */
  realismLevel: RealismLevel;
  /** 推断置信度 [0,1]，<0.6 时应退化到 'general' */
  confidence: number;
  /** 推断来源 */
  source: 'user_explicit' | 'behavior_learned' | 'rule_inferred' | 'default';
  /** 该场景下的食物约束 */
  sceneConstraints: SceneConstraints;
}

// ==================== V6.9 Phase 1-C: 渠道可获得性 ====================

/**
 * V6.9 Phase 1-C: 渠道可获得性评分结果
 *
 * 由 AvailabilityScorerService 计算。
 * 替代静态 commonalityScore，提供渠道感知的可获得性。
 */
export interface AvailabilityScore {
  /** 在当前渠道下的可获得性 0-1（0=几乎买不到，1=随处可见） */
  channelAvailability: number;
  /** 综合可获得性（考虑渠道+季节+地区，Phase 3-E 扩展） */
  overallAvailability: number;
  /** 评分来源: food_data=食物有渠道标注, channel_default=渠道×品类矩阵, regional_enhanced=区域/季节增强, time_aware=时段感知, time_region_enhanced=时段+区域综合, fallback=兜底 */
  source:
    | 'food_data'
    | 'channel_default'
    | 'regional_enhanced'
    | 'time_aware'
    | 'time_region_enhanced'
    | 'fallback';
}

// ==================== V6.4 Phase 3.2: 食物获取渠道 ====================

/**
 * V6.4 Phase 3.2: 食物获取渠道枚举
 * 用于场景化推荐 — 根据用户当前场景过滤可获取的食物/菜谱
 */
export enum AcquisitionChannel {
  /** 在家烹饪 */
  HOME_COOK = 'home_cook',
  /** 餐厅堂食 */
  RESTAURANT = 'restaurant',
  /** 外卖配送 */
  DELIVERY = 'delivery',
  /** 便利店/即食 */
  CONVENIENCE = 'convenience',
  /** 食堂/团餐（V6.6 Phase 2-D） */
  CANTEEN = 'canteen',
  /** 未知/不限 */
  UNKNOWN = 'unknown',
}

/** 所有有效渠道值（用于校验） */
export const ALL_CHANNELS: AcquisitionChannel[] =
  Object.values(AcquisitionChannel);

/**
 * V6.4 Phase 3.2: 根据用户画像推断当前最可能的获取渠道
 *
 * 推断逻辑优先级:
 * 1. 显式传入的 channel 参数（客户端指定）
 * 2. 上下文画像场景推断（工作日午餐 → delivery/restaurant，周末 → home_cook）
 * 3. 用户声明的 canCook + takeoutFrequency
 * 4. 默认 unknown（不过滤）
 */
export function inferAcquisitionChannel(
  explicitChannel?: string | null,
  contextualProfile?: { scene?: string; dayType?: string } | null,
  declaredProfile?: {
    canCook?: boolean;
    takeoutFrequency?: string;
    /** V6.6 Phase 2-D: 主要用餐地点（'canteen'|'home'|'restaurant' 等） */
    primaryEatingLocation?: string | null;
  } | null,
  mealType?: string,
): AcquisitionChannel {
  // 1. 显式指定
  if (
    explicitChannel &&
    ALL_CHANNELS.includes(explicitChannel as AcquisitionChannel)
  ) {
    return explicitChannel as AcquisitionChannel;
  }

  // 2. 食堂场景推断（V6.6 Phase 2-D）：
  //    用户声明主要用餐地点为食堂，或工作日午餐且未开启外卖
  if (declaredProfile?.primaryEatingLocation === 'canteen') {
    return AcquisitionChannel.CANTEEN;
  }

  // 3. 上下文场景推断
  if (contextualProfile) {
    const { scene, dayType } = contextualProfile;
    const isWeekend = dayType === 'weekend';

    // 工作日午餐/晚餐 → 大概率外卖或餐厅
    if (!isWeekend && (mealType === 'lunch' || mealType === 'dinner')) {
      if (scene === 'working') return AcquisitionChannel.DELIVERY;
    }

    // 深夜场景 → 便利店/外卖
    if (scene === 'late_night') return AcquisitionChannel.CONVENIENCE;

    // 周末 → 在家烹饪概率高
    if (
      isWeekend &&
      (mealType === 'breakfast' ||
        mealType === 'lunch' ||
        mealType === 'dinner')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 4. 声明画像推断
  if (declaredProfile) {
    const { canCook, takeoutFrequency } = declaredProfile;
    if (canCook === false) return AcquisitionChannel.DELIVERY;
    if (takeoutFrequency === 'always' || takeoutFrequency === 'often') {
      return AcquisitionChannel.DELIVERY;
    }
    if (
      canCook &&
      (takeoutFrequency === 'rarely' || takeoutFrequency === 'never')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 5. 默认不限
  return AcquisitionChannel.UNKNOWN;
}

// ==================== V7.1 方向 5B: 渠道时段可获得性 ====================

/**
 * V7.1 方向 5B: 渠道时段可获得性
 *
 * 不同渠道在不同时段的可获得性分数，
 * 如：便利店深夜高，食堂深夜为 0，外卖凌晨低。
 */
export interface ChannelTimeAvailability {
  /** 早上 06:00-10:00 */
  morning: number;
  /** 中午 10:00-14:00 */
  midday: number;
  /** 下午/晚上 14:00-21:00 */
  evening: number;
  /** 深夜 21:00-06:00 */
  lateNight: number;
}

// ==================== V7.2 Phase 1-B: 现实策略可配置化 ====================

/**
 * V7.2: 现实性级别枚举
 *
 * 控制 RealisticFilter 的过滤严格度。
 * 场景→默认级别映射：
 * - HOME_COOK: normal
 * - RESTAURANT: relaxed
 * - DELIVERY: relaxed
 * - CANTEEN: strict
 * - CONVENIENCE: strict
 * - UNKNOWN: normal
 */
export type RealismLevel = 'strict' | 'normal' | 'relaxed' | 'off';

/**
 * V7.2: 现实性级别预设参数
 *
 * 每个 RealismLevel 对应一组完整的过滤阈值，
 * 替代 RealisticFilter 中的硬编码逻辑。
 */
export interface RealismPreset {
  /** 大众化最低阈值（commonalityScore 低于此值被过滤；0 = 不过滤） */
  commonalityThreshold: number;
  /** 是否启用预算过滤 */
  budgetFilterEnabled: boolean;
  /** 烹饪时间上限（分钟；Infinity = 不限） */
  cookTimeCap: number;
  /** 是否启用食堂模式过滤 */
  canteenFilterEnabled: boolean;
  /** 最高允许的烹饪技能等级（1-5；Infinity = 不限） */
  maxSkillLevel: number;
  /** 是否启用设备过滤 */
  equipmentFilterEnabled: boolean;
}

/**
 * V7.2: 四档现实性预设
 */
export const REALISM_PRESETS: Record<RealismLevel, RealismPreset> = {
  strict: {
    commonalityThreshold: 40,
    budgetFilterEnabled: true,
    cookTimeCap: 45,
    canteenFilterEnabled: true,
    maxSkillLevel: 2,
    equipmentFilterEnabled: true,
  },
  normal: {
    commonalityThreshold: 30,
    budgetFilterEnabled: true,
    cookTimeCap: 60,
    canteenFilterEnabled: true,
    maxSkillLevel: 3,
    equipmentFilterEnabled: true,
  },
  relaxed: {
    commonalityThreshold: 10,
    budgetFilterEnabled: false,
    cookTimeCap: 120,
    canteenFilterEnabled: false,
    maxSkillLevel: 5,
    equipmentFilterEnabled: false,
  },
  off: {
    commonalityThreshold: 0,
    budgetFilterEnabled: false,
    cookTimeCap: Infinity,
    canteenFilterEnabled: false,
    maxSkillLevel: Infinity,
    equipmentFilterEnabled: false,
  },
};

/**
 * V7.2: 场景→默认现实级别映射
 */
export const SCENE_DEFAULT_REALISM: Record<AcquisitionChannel, RealismLevel> = {
  [AcquisitionChannel.HOME_COOK]: 'normal',
  [AcquisitionChannel.RESTAURANT]: 'relaxed',
  [AcquisitionChannel.DELIVERY]: 'relaxed',
  [AcquisitionChannel.CANTEEN]: 'strict',
  [AcquisitionChannel.CONVENIENCE]: 'strict',
  [AcquisitionChannel.UNKNOWN]: 'normal',
};
