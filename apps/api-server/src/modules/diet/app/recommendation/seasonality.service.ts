import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';

/**
 * V6.4 Phase 3.4: 时令感知服务
 *
 * 基于 food_regional_info.availability 字段和当前月份，
 * 为食物计算时令性分数 (0~1)，用于推荐评分的第 11 维。
 *
 * 数据来源:
 * - food_regional_info.availability: 'common' | 'seasonal' | 'rare' | null
 * - 当前月份（用于判断时令食物是否当季）
 *
 * 评分逻辑:
 * - common  → 0.7 (常年可用，稍低于当季食物)
 * - seasonal + 当季 → 1.0 (完全当季，最高分)
 * - seasonal + 非当季 → 0.3 (反季，低分)
 * - rare → 0.4 (稀有食物，轻微惩罚)
 * - 无数据 → 0.5 (中性，不影响评分)
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
        },
      });

      const map: Record<string, SeasonalityInfo> = {};
      for (const row of rows) {
        const info: SeasonalityInfo = {
          availability: row.availability,
          localPopularity: row.local_popularity,
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
    if (!info || !info.availability) {
      return 0.5;
    }

    switch (info.availability) {
      case 'common':
        // 常年可用食物 — 稳定但不如当季食物加分
        return 0.7;

      case 'seasonal': {
        // 时令食物 — 判断是否当季
        const peakMonths =
          CATEGORY_PEAK_MONTHS[category] ?? DEFAULT_PEAK_MONTHS;
        const isInSeason = peakMonths.includes(currentMonth);
        return isInSeason ? 1.0 : 0.3;
      }

      case 'rare':
        // 稀有食物 — 轻微惩罚（不完全排除，用户可能确实想要）
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
}
