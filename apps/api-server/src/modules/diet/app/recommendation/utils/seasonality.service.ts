import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';

/**
 * V6.4 Phase 3.4 / V7.0 Phase 2-E: 时令感知服务
 *
 * V6.4: 基于 food_regional_info.availability 字段和当前月份计算时令性分数。
 * V7.0: 新增食物级月份权重 — 优先使用 food_regional_info.month_weights（12元素数组）。
 *
 * 评分优先级:
 * 1. month_weights 存在 → 平滑曲线插值（V7.0）
 * 2. availability='seasonal' → 二值判断（当季1.0 / 非当季0.3）
 * 3. availability='common' → 0.7
 * 4. availability='rare' → 0.4
 * 5. 无数据 → 0.5（中性）
 *
 * 缓存策略:
 * - 按区域批量预加载 food_regional_info，缓存到 Redis（TTL 4h）
 * - 内存层 Map<foodId, SeasonalityInfo> 作为请求级缓存
 */

/** 食物的时令性信息 */
export interface SeasonalityInfo {
  /** availability 字段值 */
  availability: string | null;
  /** 地区人气 */
  localPopularity: number;
  /** V7.0: 食物级月份权重（12元素数组 0-1），null 时回退品类级逻辑 */
  monthWeights: number[] | null;
}

/** 品类 → 典型旺季月份映射（基于中国饮食文化） */
const CATEGORY_PEAK_MONTHS: Record<string, number[]> = {
  // 蔬菜类 — 春夏为主
  veggie: [3, 4, 5, 6, 7, 8, 9],
  // 水果类 — 夏秋为主
  fruit: [5, 6, 7, 8, 9, 10],
  // 蛋白质类 — 常年（水产有季节性，但整体品类无明显旺季）
  protein: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  // 谷物类 — 常年
  grain: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  // 乳制品 — 常年
  dairy: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

/** 默认旺季月份（无品类映射时使用） */
const DEFAULT_PEAK_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10];

@Injectable()
export class SeasonalityService {
  private readonly logger = new Logger(SeasonalityService.name);

  /** Redis 缓存 key 前缀 */
  private static readonly CACHE_PREFIX = 'seasonality:region:';
  /** Redis 缓存 TTL: 4 小时 */
  private static readonly CACHE_TTL = 4 * 60 * 60;

  /** 请求级内存缓存 — 由调用方在每次推荐请求前 preload */
  private regionalCache: Map<string, SeasonalityInfo> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 预加载指定区域的食物时令信息到内存缓存
   *
   * 流程: Redis L2 → DB → 写回 Redis + 内存
   * 由推荐引擎在每次推荐请求的初始化阶段调用
   *
   * @param regionCode 区域代码（如 'CN', 'CN-GD'）
   */
  async preloadRegion(regionCode: string): Promise<void> {
    if (!regionCode) return;

    const cacheKey = `${SeasonalityService.CACHE_PREFIX}${regionCode}`;

    // 尝试 Redis L2
    try {
      const cached =
        await this.redis.get<Record<string, SeasonalityInfo>>(cacheKey);
      if (cached) {
        for (const [foodId, info] of Object.entries(cached)) {
          this.regionalCache.set(foodId, info);
        }
        this.logger.debug(
          `Seasonality cache hit for region=${regionCode}, ${Object.keys(cached).length} foods`,
        );
        return;
      }
    } catch (err) {
      this.logger.warn(
        `Redis get failed for seasonality region=${regionCode}: ${err}`,
      );
    }

    // 查 DB
    try {
      const rows = await this.prisma.food_regional_info.findMany({
        where: { region: regionCode },
        select: {
          food_id: true,
          availability: true,
          local_popularity: true,
          month_weights: true, // V7.0: 食物级月份权重
        },
      });

      const map: Record<string, SeasonalityInfo> = {};
      for (const row of rows) {
        const info: SeasonalityInfo = {
          availability: row.availability,
          localPopularity: row.local_popularity,
          monthWeights: this.parseMonthWeights(row.month_weights),
        };
        map[row.food_id] = info;
        this.regionalCache.set(row.food_id, info);
      }

      // 写回 Redis
      if (Object.keys(map).length > 0) {
        this.redis
          .set(cacheKey, map, SeasonalityService.CACHE_TTL)
          .catch((err: unknown) =>
            this.logger.warn(
              `Redis set failed for seasonality region=${regionCode}: ${err}`,
            ),
          );
      }

      this.logger.debug(
        `Seasonality loaded from DB for region=${regionCode}, ${rows.length} foods`,
      );
    } catch (err) {
      this.logger.warn(
        `DB query failed for seasonality region=${regionCode}: ${err}`,
      );
    }
  }

  /**
   * 清空内存缓存 — 每次推荐请求结束后调用
   */
  clearCache(): void {
    this.regionalCache.clear();
  }

  /**
   * 计算食物的时令性分数
   *
   * V7.0 优先级:
   * 1. month_weights 存在 → 用平滑插值（相邻月加权）
   * 2. availability + 品类峰值月份（V6.4 原有逻辑）
   *
   * @param foodId 食物 ID
   * @param category 食物品类（用于判断当季月份）
   * @param month 当前月份 (1-12)，默认取系统当前月份
   * @returns 0~1 的时令分数
   */
  getSeasonalityScore(
    foodId: string,
    category: string,
    month?: number,
  ): number {
    const currentMonth = month ?? new Date().getMonth() + 1;
    const info = this.regionalCache.get(foodId);

    // 无区域数据 → 中性分
    if (!info) {
      return 0.5;
    }

    // V7.0: 食物级月份权重优先
    if (info.monthWeights?.length === 12) {
      return this.interpolateMonthWeight(info.monthWeights, currentMonth);
    }

    // V6.4 原有逻辑: 基于 availability
    if (!info.availability) {
      return 0.5;
    }

    switch (info.availability) {
      case 'common':
        return 0.7;

      case 'seasonal': {
        const peakMonths =
          CATEGORY_PEAK_MONTHS[category] ?? DEFAULT_PEAK_MONTHS;
        const isInSeason = peakMonths.includes(currentMonth);
        return isInSeason ? 1.0 : 0.3;
      }

      case 'rare':
        return 0.4;

      default:
        return 0.5;
    }
  }

  /**
   * 批量获取时令分数 — 用于候选池整批评分
   *
   * @param foods 食物列表（需含 id 和 category）
   * @param month 当前月份 (1-12)
   * @returns foodId → seasonalityScore 映射
   */
  getSeasonalityScores(
    foods: Array<{ id: string; category: string }>,
    month?: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const food of foods) {
      result.set(
        food.id,
        this.getSeasonalityScore(food.id, food.category, month),
      );
    }
    return result;
  }

  // ─── V7.0: 食物级月份权重辅助方法 ───

  /**
   * V7.0: 平滑插值月份权重
   *
   * 使用当前月 + 相邻月加权平均，避免月份边界跳变。
   * 权重分配: 当前月 0.6, 前一月 0.2, 后一月 0.2
   *
   * @param weights 12 元素数组 (index 0 = 1月)
   * @param month 当前月份 (1-12)
   * @returns 0-1 的平滑分数
   */
  private interpolateMonthWeight(weights: number[], month: number): number {
    const idx = month - 1; // 0-based
    const prevIdx = (idx + 11) % 12; // 循环到 12 月
    const nextIdx = (idx + 1) % 12; // 循环到 1 月

    const score =
      weights[idx] * 0.6 + weights[prevIdx] * 0.2 + weights[nextIdx] * 0.2;

    // clamp 到 [0, 1]
    return Math.max(0, Math.min(1, score));
  }

  /**
   * V7.0: 解析 month_weights JSON 字段
   *
   * 验证是否为有效的 12 元素数组，无效时返回 null（回退品类级逻辑）。
   */
  private parseMonthWeights(raw: unknown): number[] | null {
    if (!raw || !Array.isArray(raw) || raw.length !== 12) {
      return null;
    }

    // 验证所有元素都是有效数字
    const weights = raw.map(Number);
    if (weights.some((w) => isNaN(w) || w < 0 || w > 1)) {
      return null;
    }

    return weights;
  }
}
