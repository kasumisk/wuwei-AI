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

// ─── 渠道×时段可获得性系数（P3-3.2 区域分层） ───
// 时段: morning=6-10, midday=10-14, evening=14-21, lateNight=21-6
//
// 设计：CHANNEL_TIME_MATRIX_BY_REGION[region][channel][slot]
//   - 'default' = 现有矩阵原样（向后兼容；未指定 region 或 region 未配置都走此）
//   - 国别覆盖只列与 default 有显著差异的项；其他自动 fallback 到 default
// 区域差异调研依据：
//   - 'CN'：午餐外卖 1130-1330 高峰更集中、深夜便利店更普及（24h 占比高）
//   - 'JP'：便利店全时段高可获得性（24h コンビニ 文化）；居酒屋傍晚高峰
//   - 'US'：早餐外送渗透率较低（home_cook 主导）；fast-food restaurant 全天稳定
// 默认值（default）= 与历史完全一致，避免任何 region 缺省时改变行为。

type TimeSlot = 'morning' | 'midday' | 'evening' | 'lateNight';

const DEFAULT_CHANNEL_TIME_MATRIX: Record<string, Record<TimeSlot, number>> = {
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

const CHANNEL_TIME_MATRIX_BY_REGION: Record<
  string,
  Partial<Record<string, Partial<Record<TimeSlot, number>>>>
> = {
  // CN: 午餐外卖更集中、深夜便利店更强
  CN: {
    [AcquisitionChannel.DELIVERY]: { midday: 0.98, lateNight: 0.5 },
    [AcquisitionChannel.CONVENIENCE]: { lateNight: 0.95 },
  },
  // JP: 便利店全时段满级；居酒屋傍晚高峰
  JP: {
    [AcquisitionChannel.CONVENIENCE]: {
      morning: 0.95,
      midday: 0.95,
      evening: 0.95,
      lateNight: 0.95,
    },
    [AcquisitionChannel.RESTAURANT]: { evening: 0.97 },
  },
  // US: 早餐外送渗透率低；fast-food 全天稳定
  US: {
    [AcquisitionChannel.DELIVERY]: { morning: 0.4 },
    [AcquisitionChannel.RESTAURANT]: {
      morning: 0.65,
      midday: 0.9,
      evening: 0.9,
      lateNight: 0.5,
    },
  },
};

/**
 * 取（channel, slot, region）的可获得性系数
 *
 * 解析顺序：region 覆盖 → default 矩阵 → UNKNOWN 行
 */
function getChannelTimeMultiplier(
  channel: string,
  slot: TimeSlot,
  regionCode: string | null | undefined,
): number {
  // 优先 region override
  const country = regionCode?.split('-')[0]?.toUpperCase();
  if (country && CHANNEL_TIME_MATRIX_BY_REGION[country]) {
    const ov = CHANNEL_TIME_MATRIX_BY_REGION[country][channel]?.[slot];
    if (typeof ov === 'number') return ov;
  }
  // default 矩阵
  return (
    DEFAULT_CHANNEL_TIME_MATRIX[channel]?.[slot] ??
    DEFAULT_CHANNEL_TIME_MATRIX[AcquisitionChannel.UNKNOWN][slot]
  );
}

function resolveTimeSlot(hour: number): TimeSlot {
  if (hour >= 6 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 21) return 'evening';
  return 'lateNight';
}

// ─── L8-fix: 消费场景 → 可接受的购买渠道映射 ───────────────────────────────
//
// pipeline-builder.service.ts 硬过滤时使用相同逻辑：
//   若食物的 availableChannels 与 acceptableSources 有交集 → 保留（不过滤）。
// 因此到达此因子的食物已通过渠道硬过滤，但 strategy-1 仍用精确的
// AcquisitionChannel 枚举匹配，会将「通过硬过滤但不精确匹配」的食物
// 再次施加 ×0.3 双重惩罚。此处复制同一映射，保证两处语义一致。
// 注意：此映射应与 pipeline-builder.service.ts CHANNEL_TO_SOURCES 保持同步。
const CHANNEL_TO_ACCEPTABLE_SOURCES: Record<string, Set<string>> = {
  home_cook: new Set([
    'supermarket',
    'wet_market',
    'farmers_market',
    'online',
    'specialty_store',
    'butcher',
    'butcher_shop',
    'bakery',
    'pharmacy',
    'traditional_chinese_medicine_store',
    'chinese_medicine_store',
  ]),
  delivery: new Set([
    'restaurant',
    'takeout',
    'fast_food',
    'delivery',
    'convenience_store',
    'bakery',
  ]),
  restaurant: new Set(['restaurant']),
  convenience: new Set([
    'convenience_store',
    'convenience',
    'supermarket',
    'bakery',
  ]),
  canteen: new Set(['restaurant', 'canteen']),
};

/**
 * 判断食物的 availableChannels 是否与当前消费场景兼容。
 * 无 availableChannels 标注 → 默认全渠道可用 → 返回 true。
 */
function isFoodCompatibleWithChannel(
  food: FoodLibrary,
  channel: AcquisitionChannel,
): boolean {
  if (!food.availableChannels || food.availableChannels.length === 0)
    return true;
  // 精确匹配（枚举值一致）
  if (food.availableChannels.includes(channel)) return true;
  if (channel === AcquisitionChannel.UNKNOWN) return true;
  // 宽松匹配：查询渠道对应的可接受来源集合
  const acceptableSources = CHANNEL_TO_ACCEPTABLE_SOURCES[channel];
  if (acceptableSources) {
    return food.availableChannels.some((ch) => acceptableSources.has(ch));
  }
  return false;
}

export class ChannelAvailabilityFactor implements ScoringFactor {
  readonly name = 'channel-availability';
  readonly order = 25; // 在 price-fit(20) 之后

  private channel: AcquisitionChannel = AcquisitionChannel.UNKNOWN;
  private timeSlot: TimeSlot = 'midday';
  private regionCode: string | null = null;

  isApplicable(ctx: PipelineContext): boolean {
    return ctx.channel !== undefined && ctx.channel !== null;
  }

  init(ctx: PipelineContext): void {
    this.channel = ctx.channel ?? AcquisitionChannel.UNKNOWN;
    this.timeSlot = resolveTimeSlot(ctx.localHour ?? 12);
    this.regionCode = ctx.regionCode ?? null;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    // 策略 1：食物有明确渠道标注
    if (food.availableChannels && food.availableChannels.length > 0) {
      // L8-fix: 原逻辑仅做精确枚举匹配（food.availableChannels.includes(channel)），
      //         导致已通过 pipeline-builder 硬过滤（宽松来源匹配）的食物在此因子
      //         被再次施以 ×0.3 双重惩罚。改用与硬过滤相同的兼容性检查。
      const isAvail =
        isFoodCompatibleWithChannel(food, this.channel) ||
        this.channel === AcquisitionChannel.UNKNOWN;

      if (!isAvail) {
        // 渠道不匹配 → 明显降权
        const timeMultiplier = getChannelTimeMultiplier(
          this.channel,
          this.timeSlot,
          this.regionCode,
        );
        const multiplier = 0.3 * timeMultiplier;
        return {
          factorName: this.name,
          multiplier,
          additive: 0,
          explanationKey: null,
          reason: `channel=${this.channel} not in availableChannels, time=${this.timeSlot}, region=${this.regionCode ?? 'default'}`,
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

    // 叠加时段系数（P3-3.2: 区域分层）
    const timeMultiplier = getChannelTimeMultiplier(
      this.channel,
      this.timeSlot,
      this.regionCode,
    );
    const overall = channelAvail * timeMultiplier;

    // 将 overallAvailability (0-1) 映射到乘数：[0.5, 1.1]
    // 高可获得性略加分，低可获得性降权，中性值(0.7)映射接近1.0
    const multiplier = 0.5 + overall * 0.857; // 0→0.5, 0.7→1.1 (approx), 1→1.357 clamped to 1.1

    return {
      factorName: this.name,
      multiplier: Math.min(1.1, multiplier),
      additive: 0,
      explanationKey: null,
      reason: `channel=${this.channel} cat=${food.category} avail=${overall.toFixed(2)} time=${this.timeSlot} region=${this.regionCode ?? 'default'}`,
    };
  }
}
