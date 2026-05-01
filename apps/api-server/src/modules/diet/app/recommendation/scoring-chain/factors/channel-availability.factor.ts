/**
 * 渠道×时段可获得性评分因子
 *
 * 将 AvailabilityScorerService（V6.9/V7.1）的渠道×品类矩阵 +
 * 渠道×时段矩阵逻辑接入 ScoringChain，替代原来的死代码路径。
 *
 * 评分策略（依优先级）：
 * 1. 食物有明确的 availableChannels 标注 → 直接判断渠道匹配
 * 2. 渠道×品类默认矩阵 + commonalityScore 加权 → channelAvailability
 * 3. 叠加渠道×时段系数（基于 ctx.localHour）
 *
 * 结果作为乘数接入 ScoringChain（overallAvailability → multiplier）。
 * 若无渠道信息（ctx.channel=undefined），因子跳过。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';
import { AcquisitionChannel } from '../../types/recommendation.types';

// ─── 渠道×品类默认可获得性矩阵 ───

const CHANNEL_CATEGORY_MATRIX: Record<string, Record<string, number>> = {
  [AcquisitionChannel.HOME_COOK]: {
    protein: 0.9, grain: 0.95, veggie: 0.9, fruit: 0.85,
    dairy: 0.85, composite: 0.6, snack: 0.7, beverage: 0.8,
    fat: 0.9, condiment: 0.95,
  },
  [AcquisitionChannel.DELIVERY]: {
    protein: 0.7, grain: 0.8, veggie: 0.6, fruit: 0.4,
    dairy: 0.5, composite: 0.9, snack: 0.5, beverage: 0.7,
    fat: 0.3, condiment: 0.2,
  },
  [AcquisitionChannel.CONVENIENCE]: {
    protein: 0.3, grain: 0.6, veggie: 0.2, fruit: 0.5,
    dairy: 0.8, composite: 0.7, snack: 0.95, beverage: 0.95,
    fat: 0.1, condiment: 0.1,
  },
  [AcquisitionChannel.CANTEEN]: {
    protein: 0.8, grain: 0.9, veggie: 0.85, fruit: 0.5,
    dairy: 0.4, composite: 0.85, snack: 0.3, beverage: 0.6,
    fat: 0.3, condiment: 0.3,
  },
  [AcquisitionChannel.RESTAURANT]: {
    protein: 0.8, grain: 0.7, veggie: 0.7, fruit: 0.4,
    dairy: 0.5, composite: 0.95, snack: 0.4, beverage: 0.8,
    fat: 0.3, condiment: 0.3,
  },
  [AcquisitionChannel.UNKNOWN]: {
    protein: 0.7, grain: 0.8, veggie: 0.7, fruit: 0.6,
    dairy: 0.6, composite: 0.7, snack: 0.6, beverage: 0.7,
    fat: 0.5, condiment: 0.5,
  },
};

// ─── 渠道×时段可获得性系数 ───
// 时段: morning=6-10, midday=10-14, evening=14-21, lateNight=21-6

type TimeSlot = 'morning' | 'midday' | 'evening' | 'lateNight';

const CHANNEL_TIME_MATRIX: Record<string, Record<TimeSlot, number>> = {
  [AcquisitionChannel.HOME_COOK]:    { morning: 0.9, midday: 0.85, evening: 0.95, lateNight: 0.3 },
  [AcquisitionChannel.DELIVERY]:     { morning: 0.6, midday: 0.95, evening: 0.9,  lateNight: 0.4 },
  [AcquisitionChannel.CONVENIENCE]:  { morning: 0.85, midday: 0.85, evening: 0.85, lateNight: 0.9 },
  [AcquisitionChannel.CANTEEN]:      { morning: 0.8, midday: 0.95, evening: 0.7,  lateNight: 0.0 },
  [AcquisitionChannel.RESTAURANT]:   { morning: 0.5, midday: 0.9,  evening: 0.95, lateNight: 0.3 },
  [AcquisitionChannel.UNKNOWN]:      { morning: 0.8, midday: 0.9,  evening: 0.9,  lateNight: 0.5 },
};

function resolveTimeSlot(hour: number): TimeSlot {
  if (hour >= 6 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 21) return 'evening';
  return 'lateNight';
}

export class ChannelAvailabilityFactor implements ScoringFactor {
  readonly name = 'channel-availability';
  readonly order = 25; // 在 price-fit(20) 之后

  private channel: AcquisitionChannel = AcquisitionChannel.UNKNOWN;
  private timeSlot: TimeSlot = 'midday';

  isApplicable(ctx: PipelineContext): boolean {
    return ctx.channel !== undefined && ctx.channel !== null;
  }

  init(ctx: PipelineContext): void {
    this.channel = ctx.channel ?? AcquisitionChannel.UNKNOWN;
    this.timeSlot = resolveTimeSlot(ctx.localHour ?? 12);
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    // 策略 1：食物有明确渠道标注
    if (food.availableChannels && food.availableChannels.length > 0) {
      const isAvail =
        food.availableChannels.includes(this.channel) ||
        this.channel === AcquisitionChannel.UNKNOWN;

      if (!isAvail) {
        // 渠道不匹配 → 明显降权
        const timeMultiplier =
          CHANNEL_TIME_MATRIX[this.channel]?.[this.timeSlot] ??
          CHANNEL_TIME_MATRIX[AcquisitionChannel.UNKNOWN][this.timeSlot];
        const multiplier = 0.3 * timeMultiplier;
        return {
          factorName: this.name,
          multiplier,
          additive: 0,
          explanationKey: null,
          reason: `channel=${this.channel} not in availableChannels, time=${this.timeSlot}`,
        };
      }
      return null; // 匹配 → 不调整
    }

    // 策略 2：渠道×品类矩阵 + commonalityScore
    const channelMatrix =
      CHANNEL_CATEGORY_MATRIX[this.channel] ??
      CHANNEL_CATEGORY_MATRIX[AcquisitionChannel.UNKNOWN];
    const categoryScore = channelMatrix[food.category] ?? 0.5;
    const commonality = (food.commonalityScore ?? 50) / 100;
    const channelAvail = categoryScore * 0.6 + commonality * 0.4;

    // 叠加时段系数
    const timeMultiplier =
      CHANNEL_TIME_MATRIX[this.channel]?.[this.timeSlot] ??
      CHANNEL_TIME_MATRIX[AcquisitionChannel.UNKNOWN][this.timeSlot];
    const overall = channelAvail * timeMultiplier;

    // 将 overallAvailability (0-1) 映射到乘数：[0.5, 1.1]
    // 高可获得性略加分，低可获得性降权，中性值(0.7)映射接近1.0
    const multiplier = 0.5 + overall * 0.857; // 0→0.5, 0.7→1.1 (approx), 1→1.357 clamped to 1.1

    return {
      factorName: this.name,
      multiplier: Math.min(1.1, multiplier),
      additive: 0,
      explanationKey: null,
      reason: `channel=${this.channel} cat=${food.category} avail=${overall.toFixed(2)} time=${this.timeSlot}`,
    };
  }
}
