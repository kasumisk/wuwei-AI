/**
 * V6 Phase 2.18 — 上下文画像服务（场景检测）
 *
 * 核心职责：
 * 1. 根据用户本地时间（时区感知）+ 星期几 → 推断当前饮食场景
 * 2. 结合短期画像行为模式 → 个性化调整场景权重修正
 * 3. 输出 ContextualProfile，供推荐引擎注入 PipelineContext
 *
 * 场景定义：
 * - weekday_breakfast    工作日早餐（快速/简单）
 * - weekday_lunch        工作日午餐（外卖概率高）
 * - weekday_dinner       工作日晚餐（回家做饭/外食）
 * - weekday_snack        工作日加餐（下午茶/办公室零食）
 * - weekend_brunch       周末早午餐（慢节奏，允许丰盛）
 * - weekend_lunch        周末午餐（社交聚餐概率高）
 * - weekend_dinner       周末晚餐（家庭/聚餐）
 * - weekend_snack        周末加餐
 * - late_night           深夜进食（21:00+，需额外约束）
 * - post_exercise        运动后进食（需高蛋白）
 *
 * 设计决策：
 * - 纯计算逻辑，无 DB / Redis 写入（只读短期画像）
 * - 场景权重修正叠加在 MEAL_WEIGHT_MODIFIERS 之上（不替代）
 * - 通过 Injectable 注入，方便测试
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  getUserLocalHour,
  getUserLocalDayOfWeek,
  isUserLocalWeekend,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import { ShortTermProfile } from './realtime-profile.service';
import { ScoreDimension } from '../../diet/app/recommendation/recommendation.types';

// ─── 场景类型 ───

/** 饮食场景标识 */
export type MealScene =
  | 'weekday_breakfast'
  | 'weekday_lunch'
  | 'weekday_dinner'
  | 'weekday_snack'
  | 'weekend_brunch'
  | 'weekend_lunch'
  | 'weekend_dinner'
  | 'weekend_snack'
  | 'late_night'
  | 'post_exercise';

/** 日期类型 */
export type DayType = 'weekday' | 'weekend';

/**
 * 上下文画像完整结构
 *
 * 传入 PipelineContext，推荐引擎可根据此信息调整评分/约束。
 */
export interface ContextualProfile {
  /** 当前饮食场景 */
  scene: MealScene;
  /** 日期类型（工作日 / 周末） */
  dayType: DayType;
  /** 用户本地小时（0-23） */
  localHour: number;
  /** 星期几（0=周日, 6=周六） */
  dayOfWeek: number;
  /** 是否为深夜场景（21:00 以后） */
  isLateNight: boolean;
  /**
   * 场景维度权重修正系数
   * 叠加在 MEAL_WEIGHT_MODIFIERS 之上（乘法叠加）
   * >1.0 = 该维度更重要, <1.0 = 该维度可放宽
   */
  sceneWeightModifiers: Partial<Record<ScoreDimension, number>>;
  /** 场景级约束调整建议 */
  constraintHints: ContextConstraintHints;
  /** 场景检测置信度（0~1，基于行为数据丰富度） */
  confidence: number;
}

/**
 * 场景级约束调整建议
 * 推荐引擎/约束生成器可根据这些提示微调约束条件
 */
export interface ContextConstraintHints {
  /** 建议增加的标签 */
  preferTags: string[];
  /** 建议排除的标签 */
  avoidTags: string[];
  /** 热量系数调整（如周末允许宽松 10%） */
  calorieMultiplier: number;
  /** 场景描述（人类可读，用于日志/解释） */
  description: string;
}

// ─── 场景权重修正表 ───

/**
 * 各场景对评分维度的额外修正（叠加在餐次修正之上）
 *
 * 设计依据：
 * - 工作日早餐追求快速+高饱腹+稳血糖 → satiety↑ glycemic↑
 * - 周末早午餐时间充裕 → 放宽约束，品质↑
 * - 深夜进食 → 热量严格控制，低 GI 优先
 * - 工作日午餐 → 外卖场景多，品质权重↑避免高加工
 */
const SCENE_WEIGHT_MODIFIERS: Record<
  MealScene,
  Partial<Record<ScoreDimension, number>>
> = {
  weekday_breakfast: {
    satiety: 1.15, // 工作日早餐需要持久饱腹
    glycemic: 1.1, // 稳定血糖支撑上午工作
    calories: 0.95, // 早餐热量可略宽松
  },
  weekday_lunch: {
    quality: 1.15, // 午餐外卖多，品质权重提升
    nutrientDensity: 1.1, // 确保营养密度
    inflammation: 1.1, // 减少高炎症加工食品
  },
  weekday_dinner: {
    calories: 1.1, // 晚餐热量控制稍严
    fiber: 1.1, // 纤维有助消化
  },
  weekday_snack: {
    calories: 1.2, // 加餐热量严格控制
    quality: 1.15, // 避免垃圾零食
  },
  weekend_brunch: {
    quality: 1.1, // 周末早午餐注重品质
    calories: 0.9, // 周末允许稍宽松
    satiety: 0.9, // 不用急着吃饱，后面还有时间
  },
  weekend_lunch: {
    calories: 0.95, // 周末稍微放宽
    quality: 1.05, // 聚餐场景品质保持
  },
  weekend_dinner: {
    quality: 1.05, // 家庭聚餐品质保持
    fiber: 1.05, // 周末往往蔬菜少，补充纤维
  },
  weekend_snack: {
    calories: 1.1, // 周末也要控制零食
    quality: 1.1,
  },
  late_night: {
    calories: 1.3, // 深夜严格控制热量
    glycemic: 1.2, // 深夜避免血糖飙升
    satiety: 0.8, // 深夜不追求饱腹
    fat: 1.15, // 控制脂肪摄入
  },
  post_exercise: {
    protein: 1.3, // 运动后蛋白质需求大增
    carbs: 1.2, // 运动后需要补充糖原
    calories: 0.9, // 稍放宽热量限制（已消耗）
    satiety: 1.1, // 运动后需要适度饱腹
  },
};

/**
 * 各场景的约束调整预设
 */
const SCENE_CONSTRAINT_HINTS: Record<MealScene, ContextConstraintHints> = {
  weekday_breakfast: {
    preferTags: ['breakfast', 'easy_digest', 'quick'],
    avoidTags: ['heavy_flavor', 'fried'],
    calorieMultiplier: 1.0,
    description: '工作日早餐 — 快速便捷，注重饱腹和血糖稳定',
  },
  weekday_lunch: {
    preferTags: ['balanced'],
    avoidTags: ['high_fat'],
    calorieMultiplier: 1.0,
    description: '工作日午餐 — 注重营养均衡和品质',
  },
  weekday_dinner: {
    preferTags: ['low_carb', 'high_protein', 'light'],
    avoidTags: ['high_carb', 'dessert'],
    calorieMultiplier: 1.0,
    description: '工作日晚餐 — 控制碳水和热量',
  },
  weekday_snack: {
    preferTags: ['low_calorie', 'snack', 'fruit'],
    avoidTags: ['fried', 'high_fat', 'dessert'],
    calorieMultiplier: 1.0,
    description: '工作日加餐 — 低卡健康零食',
  },
  weekend_brunch: {
    preferTags: ['breakfast', 'balanced'],
    avoidTags: [],
    calorieMultiplier: 1.1, // 周末早午餐允许多 10%
    description: '周末早午餐 — 时间充裕，可选择更丰盛的搭配',
  },
  weekend_lunch: {
    preferTags: ['balanced'],
    avoidTags: [],
    calorieMultiplier: 1.05, // 周末午餐稍宽松
    description: '周末午餐 — 社交聚餐场景，适度放宽',
  },
  weekend_dinner: {
    preferTags: ['balanced'],
    avoidTags: [],
    calorieMultiplier: 1.0,
    description: '周末晚餐 — 家庭聚餐，保持营养均衡',
  },
  weekend_snack: {
    preferTags: ['low_calorie', 'snack', 'fruit'],
    avoidTags: ['fried'],
    calorieMultiplier: 1.0,
    description: '周末加餐 — 适度享受但控制热量',
  },
  late_night: {
    preferTags: ['low_calorie', 'easy_digest', 'light'],
    avoidTags: ['fried', 'heavy_flavor', 'high_carb', 'high_fat', 'dessert'],
    calorieMultiplier: 0.8, // 深夜削减 20% 热量
    description: '深夜进食 — 严格控制热量和血糖，优选易消化食物',
  },
  post_exercise: {
    preferTags: ['high_protein', 'balanced', 'easy_digest'],
    avoidTags: ['fried', 'high_fat', 'dessert'],
    calorieMultiplier: 1.1, // 运动后允许多 10% 热量
    description: '运动后进食 — 高蛋白恢复肌肉，适量碳水补充糖原',
  },
};

// ─── 服务实现 ───

@Injectable()
export class ContextualProfileService {
  private readonly logger = new Logger(ContextualProfileService.name);

  /**
   * 检测当前饮食场景并构建上下文画像
   *
   * @param timezone 用户 IANA 时区
   * @param mealType 当前餐次类型（已由上层推断）
   * @param shortTermProfile 短期画像（可选，用于个性化调整）
   * @param now 当前时间（可选，主要用于测试注入）
   * @param exerciseSchedule 每周运动计划（可选，JSON格式）
   * @returns 上下文画像
   */
  detectScene(
    timezone: string = DEFAULT_TIMEZONE,
    mealType: string,
    shortTermProfile?: ShortTermProfile | null,
    now?: Date,
    exerciseSchedule?: Record<
      string,
      { startHour: number; durationHours: number }
    > | null,
  ): ContextualProfile {
    const date = now || new Date();
    const localHour = getUserLocalHour(timezone, date);
    const dayOfWeek = getUserLocalDayOfWeek(timezone, date);
    const isWeekend = isUserLocalWeekend(timezone, date);
    const isLateNight = localHour >= 21 || localHour < 5;
    const dayType: DayType = isWeekend ? 'weekend' : 'weekday';

    // 第一步: 基于时间 + 日期类型 推断场景
    let scene = this.inferScene(mealType, dayType, localHour, isWeekend);

    // 第 1.5 步: post_exercise 检测（优先级高于普通餐次但低于 late_night）
    if (scene !== 'late_night' && exerciseSchedule) {
      if (this.detectPostExercise(exerciseSchedule, dayOfWeek, localHour)) {
        scene = 'post_exercise';
      }
    }

    // 第二步: 根据短期画像微调场景 + 权重修正
    const { scene: refinedScene, modifiers: behaviorModifiers } =
      this.refineWithBehavior(scene, shortTermProfile, dayType, localHour);
    scene = refinedScene;

    // 第三步: 构建权重修正和约束提示
    const sceneWeightModifiers = { ...SCENE_WEIGHT_MODIFIERS[scene] };
    const constraintHints = { ...SCENE_CONSTRAINT_HINTS[scene] };

    // V6.8 Phase 1-E: 将行为信号产生的权重修正叠加到场景修正上
    if (behaviorModifiers) {
      for (const [dim, val] of Object.entries(behaviorModifiers)) {
        const key = dim as ScoreDimension;
        sceneWeightModifiers[key] = (sceneWeightModifiers[key] ?? 1.0) * val;
      }
    }

    // 第四步: 计算置信度（有短期画像数据时置信度更高）
    const confidence = this.calculateConfidence(shortTermProfile);

    // 如果置信度低（无行为数据），将修正系数向 1.0 收缩（减弱影响）
    if (confidence < 0.5) {
      for (const dim of Object.keys(sceneWeightModifiers) as ScoreDimension[]) {
        const mod = sceneWeightModifiers[dim]!;
        // 向 1.0 收缩: new = 1.0 + (old - 1.0) * confidence * 2
        sceneWeightModifiers[dim] = 1.0 + (mod - 1.0) * confidence * 2;
      }
    }

    const profile: ContextualProfile = {
      scene,
      dayType,
      localHour,
      dayOfWeek,
      isLateNight,
      sceneWeightModifiers,
      constraintHints: {
        ...constraintHints,
        // 深拷贝数组避免引用问题
        preferTags: [...constraintHints.preferTags],
        avoidTags: [...constraintHints.avoidTags],
      },
      confidence,
    };

    this.logger.debug(
      `场景检测: scene=${scene}, dayType=${dayType}, hour=${localHour}, dow=${dayOfWeek}, confidence=${confidence.toFixed(2)}`,
    );

    return profile;
  }

  // ─── 私有方法 ───

  /**
   * 基于餐次类型 + 日期类型 + 时间推断基础场景
   */
  private inferScene(
    mealType: string,
    dayType: DayType,
    localHour: number,
    isWeekend: boolean,
  ): MealScene {
    // 深夜场景优先级最高（不区分工作日/周末）
    if (localHour >= 21 || localHour < 5) {
      return 'late_night';
    }

    // 周末且早上 9:00-11:30 → 早午餐场景
    if (isWeekend && mealType === 'breakfast' && localHour >= 9) {
      return 'weekend_brunch';
    }
    // 周末且 10:00-11:30 且被推断为 lunch → 仍可能是 brunch
    if (isWeekend && mealType === 'lunch' && localHour < 12) {
      return 'weekend_brunch';
    }

    // 标准映射
    if (dayType === 'weekend') {
      switch (mealType) {
        case 'breakfast':
          return 'weekend_brunch'; // 周末 9 点前的 breakfast 也算 brunch
        case 'lunch':
          return 'weekend_lunch';
        case 'dinner':
          return 'weekend_dinner';
        case 'snack':
          return 'weekend_snack';
        default:
          return 'weekend_lunch';
      }
    }

    // 工作日
    switch (mealType) {
      case 'breakfast':
        return 'weekday_breakfast';
      case 'lunch':
        return 'weekday_lunch';
      case 'dinner':
        return 'weekday_dinner';
      case 'snack':
        return 'weekday_snack';
      default:
        return 'weekday_lunch';
    }
  }

  /**
   * V6.8 Phase 1-E: 根据短期画像行为信号微调场景 + 权重修正
   *
   * 消费 4 种行为信号：
   * 1. 依从性趋势 — dailyIntakes 热量趋势下降 → 增加饱腹感和可执行性
   * 2. 热量模式 — 持续超标时收紧热量权重
   * 3. 品类偏好 — 如果用户强烈偏好某品类，微调 preferTags
   * 4. 跳餐检测 — 今日记录数为 0 时增加当前餐热量分配
   *
   * @returns 微调后的场景 + 额外权重修正（乘法叠加到场景修正之上）
   */
  private refineWithBehavior(
    scene: MealScene,
    shortTermProfile: ShortTermProfile | null | undefined,
    dayType: DayType,
    localHour: number,
  ): {
    scene: MealScene;
    modifiers: Partial<Record<ScoreDimension, number>> | null;
  } {
    if (!shortTermProfile) return { scene, modifiers: null };

    const modifiers: Partial<Record<ScoreDimension, number>> = {};
    let sceneChanged = false;

    // ── 场景微调（保留原有逻辑） ──

    const timeSlots = shortTermProfile.activeTimeSlots;

    // 周末很少记录早餐 → 保持 brunch 判断
    if (dayType === 'weekend' && scene === 'weekend_brunch') {
      const breakfastActivity = timeSlots?.['breakfast'];
      if (!breakfastActivity || breakfastActivity.count < 2) {
        // 用户周末不太吃早餐，保持 brunch
      }
    }

    // 深夜场景不微调，始终保持严格约束
    if (scene === 'late_night') {
      return { scene: 'late_night', modifiers: null };
    }

    // ── V6.8: 行为信号消费 ──

    const intakes = shortTermProfile.dailyIntakes;

    // 1. 依从性趋势: 通过 dailyIntakes 热量序列计算简单趋势
    //    如果热量呈下降趋势（用户在努力控制），增加饱腹感和可执行性支持
    if (intakes && intakes.length >= 3) {
      const trend = this.calcCalorieTrend(intakes);
      if (trend < -0.15) {
        // 热量在下降 → 用户在努力，增加饱腹感和可执行性权重帮助坚持
        modifiers.satiety = 1.15;
        modifiers.executability = 1.1;
      }
    }

    // 2. 热量模式: 近期平均热量持续超标时收紧热量权重
    if (intakes && intakes.length > 0) {
      const avgCal =
        intakes.reduce((sum, d) => sum + d.calories, 0) / intakes.length;
      // 用 2000 作为 baseline 估算（实际应从 context 获取，但此处无 target 信息）
      const baselineCal = 2000;
      if (avgCal > 0) {
        const ratio = avgCal / baselineCal;
        if (ratio > 1.15) {
          // 超标幅度越大，热量权重提升越多（最高 ×1.3）
          const boost = Math.min(1.3, 1 + (ratio - 1) * 0.3);
          modifiers.calories = (modifiers.calories ?? 1.0) * boost;
        }
      }
    }

    // 3. 品类偏好: 用户近期高频消费的品类 → 可在 constraintHints 中使用
    //    这里将 top 品类的 acceptanceRate 映射到品质权重微调
    if (shortTermProfile.categoryPreferences) {
      const prefs = shortTermProfile.categoryPreferences;
      const topCategories = Object.entries(prefs)
        .filter(
          ([, pref]) => pref.accepted + pref.rejected + pref.replaced >= 3,
        )
        .sort(
          ([, a], [, b]) =>
            b.accepted +
            b.rejected +
            b.replaced -
            (a.accepted + a.rejected + a.replaced),
        )
        .slice(0, 3);

      // 如果用户近期大量消费低品质品类（snack/beverage），提升品质权重
      const lowQualityCats = ['snack', 'beverage'];
      const hasHighLowQualityConsumption = topCategories.some(([cat]) =>
        lowQualityCats.includes(cat),
      );
      if (hasHighLowQualityConsumption) {
        modifiers.quality = (modifiers.quality ?? 1.0) * 1.1;
        modifiers.nutrientDensity = (modifiers.nutrientDensity ?? 1.0) * 1.1;
      }
    }

    // 4. 跳餐检测: 今日无记录 → 可能跳餐，稍微放宽当前餐热量
    if (intakes && intakes.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const todayIntake = intakes.find((d) => d.date === today);
      if (todayIntake && todayIntake.mealCount === 0) {
        // 用户今天还没吃东西，稍放宽热量限制
        modifiers.calories = (modifiers.calories ?? 1.0) * 0.9; // 降低热量权重 = 放宽限制
      }
    }

    const hasModifiers = Object.keys(modifiers).length > 0;
    return { scene, modifiers: hasModifiers ? modifiers : null };
  }

  /**
   * V6.8: 计算近期热量趋势（简单线性回归斜率归一化）
   *
   * 返回值 < 0 表示下降趋势，> 0 表示上升趋势
   * 归一化到 [-1, 1] 范围
   */
  private calcCalorieTrend(intakes: { calories: number }[]): number {
    const n = intakes.length;
    if (n < 2) return 0;

    // 简单线性回归: y = calories, x = 0,1,2,...
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += intakes[i].calories;
      sumXY += i * intakes[i].calories;
      sumX2 += i * i;
    }
    const meanY = sumY / n;
    if (meanY === 0) return 0;

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denom;
    // 归一化斜率: slope / meanY 表示每天变化占均值的比例
    return Math.max(-1, Math.min(1, slope / meanY));
  }

  /**
   * 检测当前是否处于运动后窗口期
   *
   * 根据用户设置的 exerciseSchedule（每周运动计划）判断：
   * 如果今天有运动安排，且当前时间在运动结束后 0~2 小时内 → post_exercise
   *
   * exerciseSchedule 格式: { "mon": { "startHour": 7, "durationHours": 1 }, ... }
   * dayOfWeek: 0=周日, 1=周一, ..., 6=周六
   */
  private detectPostExercise(
    exerciseSchedule: Record<
      string,
      { startHour: number; durationHours: number }
    >,
    dayOfWeek: number,
    localHour: number,
  ): boolean {
    // dayOfWeek → 星期名映射
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = dayNames[dayOfWeek];
    if (!dayName) return false;

    const todayExercise = exerciseSchedule[dayName];
    if (
      !todayExercise ||
      !todayExercise.startHour ||
      !todayExercise.durationHours
    ) {
      return false;
    }

    const exerciseEndHour =
      todayExercise.startHour + todayExercise.durationHours;
    // 运动结束后 0~2 小时内属于 post_exercise 窗口
    return localHour >= exerciseEndHour && localHour <= exerciseEndHour + 2;
  }

  /**
   * 计算场景检测置信度
   *
   * 基于短期画像数据丰富度:
   * - 无短期画像 → 0.3（仅靠时间推断）
   * - 有短期画像但数据稀疏 → 0.5
   * - 短期画像数据丰富（≥5 天记录） → 0.8
   * - 短期画像 + 多餐次活跃 → 0.9
   */
  private calculateConfidence(
    shortTermProfile: ShortTermProfile | null | undefined,
  ): number {
    if (!shortTermProfile) return 0.3;

    let confidence = 0.5;

    // 每日摄入记录天数 → 数据丰富度
    const recordDays = shortTermProfile.dailyIntakes?.length || 0;
    if (recordDays >= 5) confidence += 0.2;
    else if (recordDays >= 3) confidence += 0.1;

    // 活跃餐次数量 → 行为多样性
    const activeMealTypes = Object.keys(
      shortTermProfile.activeTimeSlots || {},
    ).length;
    if (activeMealTypes >= 3) confidence += 0.1;
    else if (activeMealTypes >= 2) confidence += 0.05;

    // 品类偏好数据 → 口味信息丰富度
    const prefCount = Object.keys(
      shortTermProfile.categoryPreferences || {},
    ).length;
    if (prefCount >= 3) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }
}
