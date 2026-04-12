import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import {
  AcquisitionChannel,
  AvailabilityScore,
  ChannelTimeAvailability,
} from './recommendation.types';
import { SeasonalityService } from './seasonality.service';

/**
 * V6.9 Phase 1-C + Phase 3-E: 渠道可获得性评分器
 *
 * 职责：为每个食物在当前场景渠道下计算动态可获得性评分。
 * 替代静态 `commonalityScore` 的单一维度，提供更精细的渠道感知评分。
 *
 * 评分策略（优先级递减）：
 * 1. 食物有明确的 `availableChannels` 标注 → 直接判断是否包含当前渠道
 * 2. 使用渠道×品类默认可获得性矩阵 + commonalityScore 加权
 *
 * V6.9 Phase 3-E 扩展：
 * 3. 区域感知 — 利用 food_regional_info.local_popularity 调整可获得性
 * 4. 季节感知 — 利用 SeasonalityService 提供的时令分数调整可获得性
 *
 * V7.1 P2-H 扩展：
 * 5. 时段感知 — 不同渠道在不同时段的可获得性系数
 */
@Injectable()
export class AvailabilityScorerService {
  /** V6.9 Phase 3-E: 季节性分数在综合评分中的权重 */
  private static readonly SEASONALITY_WEIGHT = 0.15;
  /** V6.9 Phase 3-E: 区域地方流行度在综合评分中的权重 */
  private static readonly REGIONAL_WEIGHT = 0.1;

  constructor(private readonly seasonalityService: SeasonalityService) {}

  /**
   * 渠道×品类 默认可获得性矩阵
   *
   * 行: AcquisitionChannel, 列: FoodLibrary.category
   * 值: 0-1（0=该渠道几乎不提供该品类，1=随处可得）
   *
   * 数值来源：V6.9 设计文档 Step 4.3
   */
  private readonly CHANNEL_CATEGORY_MATRIX: Record<
    string,
    Record<string, number>
  > = {
    [AcquisitionChannel.HOME_COOK]: {
      protein: 0.9,
      grain: 0.95,
      veggie: 0.9,
      fruit: 0.85,
      dairy: 0.85,
      composite: 0.6,
      snack: 0.7,
      beverage: 0.8,
      fat: 0.9,
      condiment: 0.95,
    },
    [AcquisitionChannel.DELIVERY]: {
      protein: 0.7,
      grain: 0.8,
      veggie: 0.6,
      fruit: 0.4,
      dairy: 0.5,
      composite: 0.9,
      snack: 0.5,
      beverage: 0.7,
      fat: 0.3,
      condiment: 0.2,
    },
    [AcquisitionChannel.CONVENIENCE]: {
      protein: 0.3,
      grain: 0.6,
      veggie: 0.2,
      fruit: 0.5,
      dairy: 0.8,
      composite: 0.7,
      snack: 0.95,
      beverage: 0.95,
      fat: 0.1,
      condiment: 0.1,
    },
    [AcquisitionChannel.CANTEEN]: {
      protein: 0.8,
      grain: 0.9,
      veggie: 0.85,
      fruit: 0.5,
      dairy: 0.4,
      composite: 0.85,
      snack: 0.3,
      beverage: 0.6,
      fat: 0.3,
      condiment: 0.3,
    },
    [AcquisitionChannel.RESTAURANT]: {
      protein: 0.8,
      grain: 0.7,
      veggie: 0.7,
      fruit: 0.4,
      dairy: 0.5,
      composite: 0.95,
      snack: 0.4,
      beverage: 0.8,
      fat: 0.3,
      condiment: 0.3,
    },
    [AcquisitionChannel.UNKNOWN]: {
      protein: 0.7,
      grain: 0.8,
      veggie: 0.7,
      fruit: 0.6,
      dairy: 0.6,
      composite: 0.7,
      snack: 0.6,
      beverage: 0.7,
      fat: 0.5,
      condiment: 0.5,
    },
  };

  // ==================== V7.1 P2-H: 渠道时段可获得性矩阵 ====================

  /**
   * V7.1 P2-H: 渠道 × 时段 可获得性系数
   *
   * 静态矩阵，反映现实世界中不同渠道在不同时段的可获得性。
   * 值为 0~1 的乘数，作用于 channelAvailability 之上。
   *
   * 时段划分：
   * - morning:   06:00 - 10:00（早餐时段）
   * - midday:    10:00 - 14:00（午餐时段）
   * - evening:   14:00 - 21:00（下午/晚餐时段）
   * - lateNight: 21:00 - 06:00（深夜/凌晨）
   *
   * 设计依据：
   * - 食堂: 严格按餐次开放，深夜完全不可用
   * - 便利店: 24h 营业，深夜可获得性最高
   * - 外卖: 深夜可用但选择少，凌晨大幅降低
   * - 家做: 凌晨不太可能做饭
   * - 餐厅: 正餐时段为主，深夜部分关门
   */
  private static readonly CHANNEL_TIME_MATRIX: Record<
    string,
    ChannelTimeAvailability
  > = {
    [AcquisitionChannel.HOME_COOK]: {
      morning: 0.9,
      midday: 0.85,
      evening: 0.95,
      lateNight: 0.3,
    },
    [AcquisitionChannel.DELIVERY]: {
      morning: 0.6,
      midday: 0.95,
      evening: 0.9,
      lateNight: 0.4,
    },
    [AcquisitionChannel.CONVENIENCE]: {
      morning: 0.85,
      midday: 0.85,
      evening: 0.85,
      lateNight: 0.9,
    },
    [AcquisitionChannel.CANTEEN]: {
      morning: 0.8,
      midday: 0.95,
      evening: 0.7,
      lateNight: 0.0,
    },
    [AcquisitionChannel.RESTAURANT]: {
      morning: 0.5,
      midday: 0.9,
      evening: 0.95,
      lateNight: 0.3,
    },
    [AcquisitionChannel.UNKNOWN]: {
      morning: 0.8,
      midday: 0.9,
      evening: 0.9,
      lateNight: 0.5,
    },
  };

  /**
   * 计算单个食物在指定渠道下的可获得性评分
   *
   * @param food    食物数据
   * @param channel 当前获取渠道
   * @returns AvailabilityScore
   */
  score(food: FoodLibrary, channel: AcquisitionChannel): AvailabilityScore {
    // 策略 1: 食物有明确的 availableChannels 标注
    if (food.availableChannels && food.availableChannels.length > 0) {
      const isAvailable =
        food.availableChannels.includes(channel) ||
        channel === AcquisitionChannel.UNKNOWN;
      const commonality = Math.max(0.5, (food.commonalityScore ?? 50) / 100);
      return {
        channelAvailability: isAvailable ? 0.9 : 0.1,
        overallAvailability: isAvailable ? commonality : 0.1,
        source: 'food_data',
      };
    }

    // 策略 2: 渠道×品类默认矩阵 + commonalityScore 加权
    const channelMatrix =
      this.CHANNEL_CATEGORY_MATRIX[channel] ??
      this.CHANNEL_CATEGORY_MATRIX[AcquisitionChannel.UNKNOWN];
    const categoryScore = channelMatrix[food.category] ?? 0.5;
    const commonality = (food.commonalityScore ?? 50) / 100;
    const channelAvailability = categoryScore * 0.6 + commonality * 0.4;

    return {
      channelAvailability,
      overallAvailability: channelAvailability,
      source: 'channel_default',
    };
  }

  /**
   * 批量计算可获得性（性能优化：避免重复矩阵查找）
   *
   * @param foods   食物列表
   * @param channel 当前获取渠道
   * @returns Map<foodId, AvailabilityScore>
   */
  scoreBatch(
    foods: FoodLibrary[],
    channel: AcquisitionChannel,
  ): Map<string, AvailabilityScore> {
    const results = new Map<string, AvailabilityScore>();
    for (const food of foods) {
      results.set(food.id, this.score(food, channel));
    }
    return results;
  }

  // ==================== V7.1 P2-H: 时段感知评分 ====================

  /**
   * V7.1 P2-H: 解析时段标签
   *
   * 支持两种输入：
   * - mealType: 'breakfast'|'lunch'|'dinner'|'snack' → 映射为时段
   * - hour: 0-23 → 直接按区间判定
   *
   * @param mealTypeOrHour 餐次类型字符串或小时数
   * @returns 时段键名（morning/midday/evening/lateNight）
   */
  resolveTimeSlot(
    mealTypeOrHour: string | number,
  ): keyof ChannelTimeAvailability {
    if (typeof mealTypeOrHour === 'number') {
      const hour = mealTypeOrHour;
      if (hour >= 6 && hour < 10) return 'morning';
      if (hour >= 10 && hour < 14) return 'midday';
      if (hour >= 14 && hour < 21) return 'evening';
      return 'lateNight';
    }

    // 餐次类型映射
    switch (mealTypeOrHour) {
      case 'breakfast':
        return 'morning';
      case 'lunch':
        return 'midday';
      case 'dinner':
        return 'evening';
      case 'snack':
        return 'evening'; // 零食默认下午时段
      case 'late_night':
      case 'lateNight':
        return 'lateNight';
      default:
        return 'midday'; // 默认午餐时段
    }
  }

  /**
   * V7.1 P2-H: 获取渠道在指定时段的可获得性系数
   *
   * @param channel 获取渠道
   * @param timeSlot 时段键名
   * @returns 可获得性系数 (0~1)
   */
  getTimeMultiplier(
    channel: AcquisitionChannel,
    timeSlot: keyof ChannelTimeAvailability,
  ): number {
    const matrix =
      AvailabilityScorerService.CHANNEL_TIME_MATRIX[channel] ??
      AvailabilityScorerService.CHANNEL_TIME_MATRIX[AcquisitionChannel.UNKNOWN];
    return matrix[timeSlot];
  }

  /**
   * V7.1 P2-H: 时段感知可获得性评分
   *
   * 在基础 score() 之上叠加时段系数。
   * overallAvailability = base.overallAvailability × timeMultiplier
   *
   * @param food 食物数据
   * @param channel 当前获取渠道
   * @param mealTypeOrHour 餐次类型或小时数（用于确定时段）
   * @returns AvailabilityScore（source 标记为 'time_aware'）
   */
  scoreWithTime(
    food: FoodLibrary,
    channel: AcquisitionChannel,
    mealTypeOrHour: string | number,
  ): AvailabilityScore {
    const base = this.score(food, channel);
    const timeSlot = this.resolveTimeSlot(mealTypeOrHour);
    const timeMultiplier = this.getTimeMultiplier(channel, timeSlot);

    return {
      channelAvailability: base.channelAvailability,
      overallAvailability: Math.max(
        0,
        Math.min(1, base.overallAvailability * timeMultiplier),
      ),
      source: 'time_aware',
    };
  }

  /**
   * V7.1 P2-H: 时段 + 区域 + 季节 综合评分
   *
   * 在 scoreWithRegion() 之上叠加时段系数。
   * 这是最完整的可获得性评分方法，综合所有维度。
   *
   * overallAvailability = regionEnhanced.overallAvailability × timeMultiplier
   *
   * @param food 食物数据
   * @param channel 当前获取渠道
   * @param mealTypeOrHour 餐次类型或小时数
   * @param month 当前月份 (1-12)
   * @returns AvailabilityScore（source 标记为 'time_region_enhanced'）
   */
  scoreComprehensive(
    food: FoodLibrary,
    channel: AcquisitionChannel,
    mealTypeOrHour: string | number,
    month?: number,
  ): AvailabilityScore {
    const regionEnhanced = this.scoreWithRegion(food, channel, month);
    const timeSlot = this.resolveTimeSlot(mealTypeOrHour);
    const timeMultiplier = this.getTimeMultiplier(channel, timeSlot);

    return {
      channelAvailability: regionEnhanced.channelAvailability,
      overallAvailability: Math.max(
        0,
        Math.min(1, regionEnhanced.overallAvailability * timeMultiplier),
      ),
      source: 'time_region_enhanced',
    };
  }

  // ==================== V6.9 Phase 3-E: 区域/季节增强 ====================

  /**
   * 预加载区域数据 — 委托给 SeasonalityService
   *
   * 应在推荐请求初始化阶段调用，确保后续 scoreWithRegion 能获取时令数据。
   *
   * @param regionCode 区域代码（如 'CN', 'CN-GD'）
   */
  async preloadRegion(regionCode: string): Promise<void> {
    await this.seasonalityService.preloadRegion(regionCode);
  }

  /**
   * 清空区域缓存 — 委托给 SeasonalityService
   *
   * 应在推荐请求结束时调用。
   */
  clearRegionCache(): void {
    this.seasonalityService.clearCache();
  }

  /**
   * V6.9 Phase 3-E: 区域+季节增强评分
   *
   * 在基础 score() 的渠道可获得性之上，叠加：
   * - 时令性分数（SeasonalityService）— 当季食物加分，反季减分
   * - 区域流行度 — 基于 food_regional_info.local_popularity
   *
   * 综合公式：
   *   overallAvailability = channelScore * (1 - SW - RW) + seasonality * SW + regionalPop * RW
   *
   * 其中 SW = SEASONALITY_WEIGHT, RW = REGIONAL_WEIGHT
   *
   * @param food    食物数据
   * @param channel 当前获取渠道
   * @param month   当前月份 (1-12)，默认取系统月份
   * @returns AvailabilityScore（source 标记为 'regional_enhanced'）
   */
  scoreWithRegion(
    food: FoodLibrary,
    channel: AcquisitionChannel,
    month?: number,
  ): AvailabilityScore {
    // 先计算基础渠道评分
    const base = this.score(food, channel);

    // 获取时令分数（需已 preload）
    const seasonalityScore = this.seasonalityService.getSeasonalityScore(
      food.id,
      food.category,
      month,
    );

    // 将 overallAvailability 融合时令性
    const sw = AvailabilityScorerService.SEASONALITY_WEIGHT;
    const rw = AvailabilityScorerService.REGIONAL_WEIGHT;
    // 区域流行度: 0-100 → 0-1（SeasonalityService.getSeasonalityScore 已内部用 local_popularity）
    // 这里单独获取 local_popularity 比较复杂（需查缓存），改为利用 seasonalityScore 间接体现
    // 简化策略: seasonality 本身已考虑 availability，regional 用 commonalityScore 近似
    const regionalProxy = (food.commonalityScore ?? 50) / 100;

    const channelWeight = 1 - sw - rw;
    const enhancedAvailability =
      base.channelAvailability * channelWeight +
      seasonalityScore * sw +
      regionalProxy * rw;

    return {
      channelAvailability: base.channelAvailability,
      overallAvailability: Math.max(0, Math.min(1, enhancedAvailability)),
      source: 'regional_enhanced',
    };
  }

  /**
   * V6.9 Phase 3-E: 区域增强批量评分
   *
   * @param foods   食物列表
   * @param channel 当前获取渠道
   * @param month   当前月份 (1-12)
   * @returns Map<foodId, AvailabilityScore>
   */
  scoreBatchWithRegion(
    foods: FoodLibrary[],
    channel: AcquisitionChannel,
    month?: number,
  ): Map<string, AvailabilityScore> {
    const results = new Map<string, AvailabilityScore>();
    for (const food of foods) {
      results.set(food.id, this.scoreWithRegion(food, channel, month));
    }
    return results;
  }
}
