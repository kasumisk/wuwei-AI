import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { MetricsService } from '../../../../../core/metrics/metrics.service';
import { isSouthernHemisphere } from '../../../../../common/config/regional-defaults';
import {
  buildFoodRegionalFallbackWhere,
  getFoodRegionSpecificity,
} from '../../../../../common/utils/food-regional-info.util';

/**
 * V6.4 Phase 3.4 / V7.0 Phase 2-E: 时令感知服务
 *
 * V6.4: 基于 food_regional_info.availability 字段和当前月份计算时令性分数。
 * V7.0: 新增食物级月份权重 — 优先使用 food_regional_info.month_weights（12元素数组）。
 *
 * 评分优先级:
 * 1. month_weights 存在 → 平滑曲线插值（V7.0）
 * 2. availability=SEASONAL → 二值判断（当季1.0 / 非当季0.3）
 * 3. availability=YEAR_ROUND → 0.7
 * 4. availability=RARE → 0.4
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
  /**
   * 阶段 3.2: 法规信息（来自 food_regional_info.regulatory_info JSON）
   * 结构示例: { forbidden: true, reason: "banned in US" }
   * null 表示无法规限制数据
   */
  regulatoryForbidden: boolean;
  /** P2-2.2: 该区域内食物最低价格（per_serving，单位为 currencyCode） */
  priceMin: number | null;
  /** P2-2.2: 该区域内食物最高价格（per_serving，单位为 currencyCode） */
  priceMax: number | null;
  /** P2-2.2: 价格币种（ISO 4217） */
  currencyCode: string | null;
  /** P2-2.2: 价格单位（如 per_serving / per_kg），null/per_serving 视为可比 */
  priceUnit: string | null;
}

/** P2-2.2: 食物地区价格信息（PriceFitFactor 专用，对外提供精简视图） */
export interface FoodPriceInfo {
  priceMin: number | null;
  priceMax: number | null;
  currencyCode: string | null;
  priceUnit: string | null;
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

  /**
   * P0-2 修复（2026-05-02）：按 regionCode 分桶的内存缓存
   *
   * 旧设计：`Map<foodId, SeasonalityInfo>` — Singleton 单层 map，
   * 多 region 用户并发时互相覆盖（如 CN 用户数据被 AU 用户的 preload 替换），
   * 导致同一 foodId 在不同 region 下读取到错误的 availability/monthWeights。
   *
   * 新设计：`Map<regionCode, Map<foodId, SeasonalityInfo>>` — 二级隔离。
   * - 所有 getter 必须显式传入 regionCode（已经有的 caller 都已具备该上下文）
   * - 不传 regionCode 时回退到聚合视图（向后兼容，但会打 warn）
   * - clearCache(regionCode) 仅清单 region；clearCache() 清全部
   */
  private regionalCacheByRegion: Map<string, Map<string, SeasonalityInfo>> =
    new Map();

  /** 每个 region 缓存的最大保留时长（避免长期积累） */
  private static readonly MAX_REGIONS_IN_MEMORY = 32;

  /** LRU 跟踪：regionCode → 最近访问时间戳 */
  private regionLastAccess: Map<string, number> = new Map();

  /**
   * 阶段 2.3：并发 preloadRegion 防重复加载 mutex
   *
   * 同一进程内多个并发推荐请求可能同时调 preloadRegion(同一 regionCode)，
   * 导致多次重复 DB 查询。用 Promise 作为 mutex：
   * - 首次调用：创建并存储 Promise，后续复用同一 Promise
   * - Promise resolve 后自动从 map 删除，下次请求重新走完整逻辑
   */
  private readonly preloadInProgress = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly metricsService: MetricsService,
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

    // 阶段 2.3：并发防重复 — 若同 regionCode 已在加载中，等待同一 Promise
    const inflight = this.preloadInProgress.get(regionCode);
    if (inflight) return inflight;

    const loadPromise = this._doPreloadRegion(regionCode).finally(() => {
      this.preloadInProgress.delete(regionCode);
    });
    this.preloadInProgress.set(regionCode, loadPromise);
    return loadPromise;
  }

  /** 实际加载逻辑（由 preloadRegion mutex 包裹） */
  private async _doPreloadRegion(regionCode: string): Promise<void> {
    const cacheKey = `${SeasonalityService.CACHE_PREFIX}${regionCode}`;

    // P0-2: 当前 region 的隔离 map（不存在则新建）
    const regionMap = this.getOrCreateRegionMap(regionCode);

    // 尝试 Redis L2
    try {
      const cached =
        await this.redis.get<Record<string, SeasonalityInfo>>(cacheKey);
      if (cached) {
        for (const [foodId, info] of Object.entries(cached)) {
          regionMap.set(foodId, info);
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
      const rows = await this.prisma.foodRegionalInfo.findMany({
        where: buildFoodRegionalFallbackWhere(regionCode),
        select: {
          foodId: true,
          regionCode: true,
          cityCode: true,
          availability: true,
          localPopularity: true,
          monthWeights: true, // V7.0: 食物级月份权重
          regulatoryInfo: true, // 阶段 3.2: 法规信息
          // P2-2.2: 价格字段
          priceMin: true,
          priceMax: true,
          currencyCode: true,
          priceUnit: true,
        },
      });

      const map: Record<string, SeasonalityInfo> = {};
      for (const row of rows.sort(
        (a, b) => getFoodRegionSpecificity(b) - getFoodRegionSpecificity(a),
      )) {
        if (map[row.foodId]) continue;

        const regulatoryForbidden =
          row.regulatoryInfo !== null &&
          typeof row.regulatoryInfo === 'object' &&
          (row.regulatoryInfo as Record<string, unknown>)['forbidden'] === true;

        const info: SeasonalityInfo = {
          availability: row.availability,
          localPopularity: row.localPopularity,
          monthWeights: this.parseMonthWeights(row.monthWeights),
          regulatoryForbidden,
          // P2-2.2: 价格透传（Prisma Decimal → number）
          priceMin: row.priceMin != null ? Number(row.priceMin) : null,
          priceMax: row.priceMax != null ? Number(row.priceMax) : null,
          currencyCode: row.currencyCode ?? null,
          priceUnit: row.priceUnit ?? null,
        };
        map[row.foodId] = info;
        regionMap.set(row.foodId, info);
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
   * P0-2: 获取或创建指定 region 的内存 map，并执行 LRU 淘汰
   */
  private getOrCreateRegionMap(
    regionCode: string,
  ): Map<string, SeasonalityInfo> {
    this.regionLastAccess.set(regionCode, Date.now());

    const existing = this.regionalCacheByRegion.get(regionCode);
    if (existing) return existing;

    // LRU 淘汰：超过容量时删除最久未访问的 region
    if (
      this.regionalCacheByRegion.size >=
      SeasonalityService.MAX_REGIONS_IN_MEMORY
    ) {
      let oldestRegion: string | null = null;
      let oldestTs = Infinity;
      for (const [r, ts] of this.regionLastAccess.entries()) {
        if (ts < oldestTs) {
          oldestTs = ts;
          oldestRegion = r;
        }
      }
      if (oldestRegion && oldestRegion !== regionCode) {
        this.regionalCacheByRegion.delete(oldestRegion);
        this.regionLastAccess.delete(oldestRegion);
        this.logger.debug(
          `[seasonality] LRU evicted region=${oldestRegion} (capacity=${SeasonalityService.MAX_REGIONS_IN_MEMORY})`,
        );
      }
    }

    const fresh = new Map<string, SeasonalityInfo>();
    this.regionalCacheByRegion.set(regionCode, fresh);
    return fresh;
  }

  /**
   * P0-2: 读取指定 region + foodId 的 info（不会跨 region 污染）
   *
   * @param foodId 食物 ID
   * @param regionCode 用户区域码；强烈建议传入。未传入时会回退聚合所有
   *                   region 的 map，并打 warn — 这是过渡期的兼容路径，
   *                   一旦所有 caller 改完应移除该兜底。
   */
  /**
   * P0-4: foodRegionalInfoCoverage 采样计数器。
   * SeasonalityService.getInfo 在单次推荐内会被多个食物多次调用，
   * 直接每次 inc 会让 prom-client 客户端聚合开销不可忽略。
   * 采样率 1/32 足以观察整体 region/season 命中率分布。
   */
  private coverageSampleCounter = 0;
  private static readonly COVERAGE_SAMPLE_RATE = 32;

  private getInfo(
    foodId: string,
    regionCode?: string | null,
  ): SeasonalityInfo | undefined {
    let result: SeasonalityInfo | undefined;
    if (regionCode) {
      this.regionLastAccess.set(regionCode, Date.now());
      result = this.regionalCacheByRegion.get(regionCode)?.get(foodId);
    } else {
      // 兼容路径：遍历所有 region map（保留旧行为，避免 caller 一次改完）
      this.logger.warn(
        `[seasonality] getInfo called without regionCode for foodId=${foodId}; ` +
          `fallback to legacy aggregate lookup. Caller MUST be migrated.`,
      );
      for (const m of this.regionalCacheByRegion.values()) {
        const hit = m.get(foodId);
        if (hit) {
          result = hit;
          break;
        }
      }
    }

    // P0-4: 采样埋点 food_regional_info_coverage
    // status:
    //   no_region — 调用未传 regionCode（链路问题，应该被消灭）
    //   present   — 传了 regionCode 且查到该食物的区域信息
    //   missing   — 传了 regionCode 但区域表没该食物（走默认中性分数）
    this.coverageSampleCounter =
      (this.coverageSampleCounter + 1) %
      SeasonalityService.COVERAGE_SAMPLE_RATE;
    if (this.coverageSampleCounter === 0) {
      const status = !regionCode ? 'no_region' : result ? 'present' : 'missing';
      this.metricsService.foodRegionalInfoCoverage.inc({ status });
    }

    return result;
  }

  /**
   * 清空内存缓存
   *
   * @param regionCode 指定 region 时仅清该 region；不传则清全部
   */
  clearCache(regionCode?: string): void {
    if (regionCode) {
      this.regionalCacheByRegion.delete(regionCode);
      this.regionLastAccess.delete(regionCode);
    } else {
      this.regionalCacheByRegion.clear();
      this.regionLastAccess.clear();
    }
  }

  /**
   * 阶段 3.1：获取食物的区域 availability（用于候选过滤）
   *
   * @param regionCode 用户区域码（推荐传入；不传走兼容兜底）
   * @returns availability 字符串（'YEAR_ROUND'|'SEASONAL'|'RARE'|'LIMITED'|null）
   *          null 表示无区域数据，调用方应视为可用
   */
  getAvailability(foodId: string, regionCode?: string | null): string | null {
    return this.getInfo(foodId, regionCode)?.availability ?? null;
  }

  /**
   * 阶段 3.2：食物在当前区域是否被法规禁止
   *
   * @returns true = 禁止推荐；false / 无数据 = 允许
   */
  isRegulatoryForbidden(foodId: string, regionCode?: string | null): boolean {
    return this.getInfo(foodId, regionCode)?.regulatoryForbidden ?? false;
  }

  /**
   * P2-2.2: 获取食物的区域价格信息（用于 PriceFitFactor）
   *
   * @returns FoodPriceInfo（priceMin/priceMax/currencyCode/priceUnit），无数据时四字段均为 null
   */
  getPriceInfo(foodId: string, regionCode?: string | null): FoodPriceInfo {
    const info = this.getInfo(foodId, regionCode);
    if (!info) {
      return {
        priceMin: null,
        priceMax: null,
        currencyCode: null,
        priceUnit: null,
      };
    }
    return {
      priceMin: info.priceMin,
      priceMax: info.priceMax,
      currencyCode: info.currencyCode,
      priceUnit: info.priceUnit,
    };
  }

  /**
   * 计算食物的时令性分数
   *
   * V7.0 优先级:
   * 1. month_weights 存在 → 用平滑插值（相邻月加权）
   * 2. availability + 品类峰值月份（V6.4 原有逻辑）
   *
   * 阶段 4.3 — seasonalityConfidence 衰减：
   * 置信度低时将原始分向 0.5（中性）收缩，减少噪声数据对排序的影响。
   * score_final = score_raw * confidence + 0.5 * (1 - confidence)
   *
   * P3-3.4 — 南半球月份翻转：
   * monthWeights 与 CATEGORY_PEAK_MONTHS 数据均按北半球月份语义建立
   * （蔬菜春夏旺=3-9 月、水果夏秋旺=5-10 月）。当用户处于南半球时，
   * 实际季节相反（如 12 月对北半球冬而对南半球夏），故对入参月份做
   * 6 个月翻转：effectiveMonth = ((month - 1 + 6) % 12) + 1。
   * 通过 regionCode 触发；未传或非南半球地区保持原行为。
   *
   * @param foodId     食物 ID
   * @param category   食物品类（用于判断当季月份）
   * @param month      当前月份 (1-12)，**必填**——必须由调用方根据用户时区传入
   *                   （`pipeline-context-factory` 已用 `getUserLocalMonth(timezone)` 解析）。
   *                   原 fallback `new Date().getMonth()` 会与南半球翻转叠加产生双重错误，已移除。
   * @param regionCode 用户区域码（如 'AU' / 'AU-NSW'），南半球地区会触发月份翻转
   * @returns 0~1 的时令分数
   */
  getSeasonalityScore(
    foodId: string,
    category: string,
    month: number,
    regionCode?: string | null,
  ): number {
    // 防御：若调用方误传非法值，向上抛出而非静默走服务器时区
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(
        `[seasonality] month must be integer in [1,12], got ${month}. ` +
          `调用方必须根据用户时区传入 ctx.currentMonth（pipeline-context-factory 已解析）。`,
      );
    }
    const inputMonth = month;
    // P3-3.4: 南半球翻转 6 个月
    const currentMonth = isSouthernHemisphere(regionCode ?? null)
      ? ((inputMonth - 1 + 6) % 12) + 1
      : inputMonth;
    const info = this.getInfo(foodId, regionCode);

    // 无区域数据 → 中性分（置信度 0，完全衰减）
    if (!info) {
      return 0.5;
    }

    // V7.0: 食物级月份权重优先（高置信度：confidence=0.9）
    if (info.monthWeights?.length === 12) {
      const raw = this.interpolateMonthWeight(info.monthWeights, currentMonth);
      return this.applyConfidenceDecay(raw, 0.9);
    }

    // V6.4 原有逻辑: 基于 availability（置信度因数据质量而异）
    if (!info.availability) {
      return 0.5;
    }

    switch (info.availability) {
      case 'YEAR_ROUND':
        // 稳定可用，高置信度
        return this.applyConfidenceDecay(0.7, 0.85);

      case 'SEASONAL': {
        const peakMonths =
          CATEGORY_PEAK_MONTHS[category] ?? DEFAULT_PEAK_MONTHS;
        const isInSeason = peakMonths.includes(currentMonth);
        // 季节性判断依赖品类映射，中等置信度
        return this.applyConfidenceDecay(isInSeason ? 1.0 : 0.3, 0.75);
      }

      case 'RARE':
        // 数据稀疏，低置信度
        return this.applyConfidenceDecay(0.4, 0.6);

      case 'LIMITED':
        // 区域限制，低置信度
        return this.applyConfidenceDecay(0.45, 0.6);

      default:
        return 0.5;
    }
  }

  /**
   * 阶段 4.3：置信度衰减 — 将原始分向 0.5 收缩
   *
   * score_final = score_raw * confidence + 0.5 * (1 - confidence)
   *
   * @param raw       原始时令分 (0~1)
   * @param confidence 置信度 (0~1)，1=完全相信，0=完全退化为 0.5
   */
  private applyConfidenceDecay(raw: number, confidence: number): number {
    return raw * confidence + 0.5 * (1 - confidence);
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
    month: number,
    regionCode?: string | null,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const food of foods) {
      result.set(
        food.id,
        this.getSeasonalityScore(food.id, food.category, month, regionCode),
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
