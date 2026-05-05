import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../../core/cache';
import {
  MicroNutrientDefaults,
  buildCategoryMicroAverages,
  AcquisitionChannel,
} from '../types/recommendation.types';
import { FoodLibrary } from '../../../../food/food.types';

// ==================== V5 4.3: 品类分片常量 ====================

/** 10 个食物品类，与 food-library.entity 一致 */
const FOOD_CATEGORIES = [
  'protein',
  'grain',
  'veggie',
  'fruit',
  'dairy',
  'fat',
  'beverage',
  'snack',
  'condiment',
  'composite',
] as const;

type FoodCategoryType = (typeof FOOD_CATEGORIES)[number];

// ==================== V5 4.4 → V6 1.7: 缓存配置 ====================

/** L1 内存缓存 TTL: 30 分钟（与原 V5 4.4 一致） */
const L1_TTL_MS = 30 * 60 * 1000;

/** L2 Redis 缓存 TTL: 60 分钟（比 L1 长一倍，降级保护） */
const L2_TTL_MS = 60 * 60 * 1000;

/** TTL 到期前 2 分钟触发后台异步预热（与原 V5 4.4 一致） */
const REFRESH_AHEAD_MS = 2 * 60 * 1000;

/** L1 容量上限：20 条（10 个品类 + 余量） */
const L1_MAX_ENTRIES = 20;

// ==================== Step 6 P0：cold path L2 写入 + warmup ====================

/**
 * L2 Redis key（全量已验证食物池）
 * 版本号 v1：未来 schema 不兼容变更时升 v2 自然失效旧数据，无需手动清理。
 */
const L2_VERIFIED_FOODS_KEY = 'food_pool:verified_all:v1';
/** L2 Redis key（品类微量营养素均值），与 verified_foods 同生命周期 */
const L2_CATEGORY_MICRO_AVG_KEY = 'food_pool:category_micro_avg:v1';

/**
 * 启动时是否预热 L1（fire-and-forget，不阻塞 onModuleInit）
 * 默认 true；本地开发若想跳过可设 FOOD_POOL_WARMUP=false
 */
const WARMUP_ON_BOOT = process.env.FOOD_POOL_WARMUP !== 'false';

// ARB-2026-04: food 上帝表已拆分，food-pool 查询通过 JOIN 4 张分表获取完整数据。
// 此列表仅保留 foods 主表中仍存在的列；分表字段在 buildFoodPoolSQL() 中通过 JOIN 引入。
const FOOD_POOL_SELECTABLE_COLUMNS: string[] = [
  'id',
  'code',
  'name',
  'aliases',
  'barcode',
  'status',
  'category',
  'sub_category',
  'food_group',
  'calories',
  'protein',
  'fat',
  'carbs',
  'fiber',
  'sugar',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'main_ingredient',
  'primary_source',
  'primary_source_id',
  'data_version',
  'confidence',
  'is_verified',
  'verified_by',
  'verified_at',
  'search_weight',
  'popularity',
  'created_at',
  'updated_at',
  // V6.5: 大众化评分
  'commonality_score',
  // V7.3 Phase 1-A: 食物大众化扩展
  'food_form',
  'dish_priority',
  // V7.4 Phase 1-B: 食物可获得性
  'acquisition_difficulty',
  // image
  'image_url',
  'thumbnail_url',
];

// ==================== Raw row → FoodLibrary 映射 ====================

/**
 * #fix: 将 PostgreSQL 返回的 snake_case 行键统一转为 camelCase。
 * $queryRawUnsafe 原样返回列名（snake_case），
 * 而 mapRowToFoodLibrary 以 camelCase 读取属性。
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    out[camel] = row[key];
  }
  return out;
}

/** 安全转 number：Prisma Decimal / string / null → number */
function n(v: unknown): number {
  if (v == null) return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

/** 可选 number（null 保留为 undefined） */
function nOpt(v: unknown): number | undefined {
  if (v == null) return undefined;
  const num = Number(v);
  return Number.isFinite(num) ? num : undefined;
}

/** 安全解析 JSON 字段（raw query 返回时可能已是 object，也可能是 string） */
function jsonParse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * #fix: 标准化 commonPortions — 数据库中存在两种格式:
 *   1. 对象数组: [{"name":"1份≈200g","grams":200}]  ← 期望格式
 *   2. 字符串数组: ["1 teaspoon (2g)","1/4 cup (28g)"]  ← 需转换
 * 将字符串格式转为对象格式，从括号中提取 grams 数值。
 */
function normalizePortions(
  raw: unknown[],
): Array<{ name: string; grams: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((item) => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.grams === 'number' && obj.grams > 0) {
          return { name: String(obj.name ?? ''), grams: obj.grams };
        }
        return null;
      }
      if (typeof item === 'string') {
        // 从 "1 teaspoon (2g)" 或 "100g serving" 中提取 grams
        const match = item.match(/\((\d+(?:\.\d+)?)g\)/);
        if (match) {
          return { name: item, grams: Number(match[1]) };
        }
        return null;
      }
      return null;
    })
    .filter((p): p is { name: string; grams: number } => p !== null);
}

/**
 * 将 $queryRawUnsafe 返回的 snake_case 行转为 FoodLibrary（camelCase + 正确类型）
 */
function mapRowToFoodLibrary(row: Record<string, unknown>): FoodLibrary {
  return {
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    aliases: row.aliases != null ? String(row.aliases) : undefined,
    barcode: row.barcode != null ? String(row.barcode) : undefined,
    status: String(row.status ?? 'draft'),
    category: String(row.category ?? ''),
    subCategory: row.subCategory != null ? String(row.subCategory) : undefined,
    foodGroup: row.foodGroup != null ? String(row.foodGroup) : undefined,

    // 核心营养素 — Decimal → number
    calories: n(row.calories),
    protein: nOpt(row.protein),
    fat: nOpt(row.fat),
    carbs: nOpt(row.carbs),
    fiber: nOpt(row.fiber),
    sugar: nOpt(row.sugar),
    addedSugar: nOpt(row.addedSugar),
    naturalSugar: nOpt(row.naturalSugar),
    saturatedFat: nOpt(row.saturatedFat),
    transFat: nOpt(row.transFat),
    cholesterol: nOpt(row.cholesterol),
    sodium: nOpt(row.sodium),
    potassium: nOpt(row.potassium),
    calcium: nOpt(row.calcium),
    iron: nOpt(row.iron),
    vitaminA: nOpt(row.vitaminA),
    vitaminC: nOpt(row.vitaminC),
    vitaminD: nOpt(row.vitaminD),
    vitaminE: nOpt(row.vitaminE),
    vitaminB12: nOpt(row.vitaminB12),
    vitaminB6: nOpt(row.vitaminB6),
    folate: nOpt(row.folate),
    zinc: nOpt(row.zinc),
    magnesium: nOpt(row.magnesium),
    purine: nOpt(row.purine),
    phosphorus: nOpt(row.phosphorus),
    // V7.4 Phase 3-A: 精细化营养字段
    omega3: nOpt(row.omega3),
    omega6: nOpt(row.omega6),
    solubleFiber: nOpt(row.solubleFiber),
    insolubleFiber: nOpt(row.insolubleFiber),

    // 烹饪/风味扩展
    cuisine: row.cuisine != null ? String(row.cuisine) : undefined,
    flavorProfile: jsonParse(row.flavorProfile, undefined),
    cookingMethods: Array.isArray(row.cookingMethods)
      ? row.cookingMethods.map(String)
      : [],
    prepTimeMinutes: nOpt(row.prepTimeMinutes),
    cookTimeMinutes: nOpt(row.cookTimeMinutes),
    skillRequired:
      row.skillRequired != null ? String(row.skillRequired) : undefined,
    estimatedCostLevel: nOpt(row.estimatedCostLevel),
    shelfLifeDays: nOpt(row.shelfLifeDays),
    waterContentPercent: nOpt(row.waterContentPercent),
    fodmapLevel: row.fodmapLevel != null ? String(row.fodmapLevel) : undefined,
    oxalateLevel:
      row.oxalateLevel != null ? String(row.oxalateLevel) : undefined,

    // 评分/指数
    glycemicIndex: nOpt(row.glycemicIndex),
    glycemicLoad: nOpt(row.glycemicLoad),
    isProcessed: Boolean(row.isProcessed),
    isFried: Boolean(row.isFried),
    processingLevel: n(row.processingLevel) || 1,
    allergens: jsonParse<string[]>(row.allergens, []),
    qualityScore: nOpt(row.qualityScore),
    satietyScore: nOpt(row.satietyScore),
    nutrientDensity: nOpt(row.nutrientDensity),
    mealTypes: jsonParse<string[]>(row.mealTypes, []),
    tags: jsonParse<string[]>(row.tags, []),
    mainIngredient:
      row.mainIngredient != null ? String(row.mainIngredient) : undefined,
    compatibility: jsonParse<Record<string, string[]>>(row.compatibility, {}),

    // 份量
    standardServingG: n(row.standardServingG) || 100,
    standardServingDesc:
      row.standardServingDesc != null
        ? String(row.standardServingDesc)
        : undefined,
    commonPortions: normalizePortions(
      jsonParse<unknown[]>(row.commonPortions, []),
    ),

    // 媒体
    imageUrl: row.imageUrl != null ? String(row.imageUrl) : undefined,
    thumbnailUrl:
      row.thumbnailUrl != null ? String(row.thumbnailUrl) : undefined,

    // 来源/版本
    primarySource: String(row.primarySource ?? 'manual'),
    primarySourceId:
      row.primarySourceId != null ? String(row.primarySourceId) : undefined,
    dataVersion: n(row.dataVersion) || 1,
    confidence: n(row.confidence) || 1,
    isVerified: Boolean(row.isVerified),
    verifiedBy: row.verifiedBy != null ? String(row.verifiedBy) : undefined,
    verifiedAt:
      row.verifiedAt != null ? new Date(row.verifiedAt as string) : undefined,
    searchWeight: n(row.searchWeight) || 100,
    popularity: n(row.popularity),
    embedding: undefined,
    createdAt: new Date((row.createdAt as string) || Date.now()),
    updatedAt: new Date((row.updatedAt as string) || Date.now()),
    // V6.4 Phase 3.3: 可获取渠道
    availableChannels: jsonParse<string[]>(row.availableChannels, [
      'home_cook',
      'restaurant',
      'delivery',
      'convenience',
    ]),
    // V6.5: 大众化评分
    commonalityScore: n(row.commonalityScore) || 50,
    // V7.3 Phase 1-A: 食物大众化扩展
    foodForm:
      row.foodForm != null
        ? (String(row.foodForm) as FoodLibrary['foodForm'])
        : undefined,
    dishPriority: nOpt(row.dishPriority),
    // V7.4 Phase 1-B: 食物可获得性
    acquisitionDifficulty: nOpt(row.acquisitionDifficulty),
  };
}

/**
 * 食物池缓存服务
 *
 * V6 Phase 1.7: 迁移到 TieredCacheManager 统一缓存抽象
 *
 * 原 V5 4.3/4.4 手写的品类分片 + 双层缓存 + refresh-ahead 逻辑
 * 现在由 TieredCacheNamespace 统一提供：
 * - L1 内存 LRU（20 条，30 分钟 TTL）
 * - L2 Redis（60 分钟 TTL）
 * - Singleflight 防穿透
 * - Refresh-ahead（到期前 2 分钟后台异步刷新）
 *
 * 本 Service 只保留业务逻辑（DB 加载、品类聚合、微量营养素均值、失效策略）。
 */
@Injectable()
export class FoodPoolCacheService implements OnModuleInit {
  private readonly logger = new Logger(FoodPoolCacheService.name);

  /** V6 1.7: 统一缓存 namespace，key = 品类名 */
  private cache: TieredCacheNamespace<FoodLibrary[]>;

  /** V5 2.7: 品类微量营养素均值缓存（与食物池同步刷新） */
  private categoryMicroAverages: Map<string, MicroNutrientDefaults> | null =
    null;

  /**
   * Risk-5 修复（2026-05-04）: 全量食物池 L1 内存缓存 + singleflight
   *
   * connection_limit=1 + 10 品类分片 = 10 次串行 DB 查询（~2700ms）。
   * 改为全量单次 DB 查询（~300ms），L1 内存缓存 30 分钟，
   * 并发时 singleflight 保证只有 1 次 DB 查询。
   */
  private allFoodsL1: FoodLibrary[] | null = null;
  private allFoodsL1ExpiresAt = 0;
  private allFoodsSingleflight: Promise<FoodLibrary[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly cacheManager: TieredCacheManager,
  ) {}

  onModuleInit(): void {
    // 创建 food_pool namespace — 配置继承原 V5 4.3/4.4 参数
    this.cache = this.cacheManager.createNamespace<FoodLibrary[]>({
      namespace: 'food_pool',
      l1MaxEntries: L1_MAX_ENTRIES,
      l1TtlMs: L1_TTL_MS,
      l2TtlMs: L2_TTL_MS,
      refreshAheadMs: REFRESH_AHEAD_MS, // V6 1.7: stale-while-revalidate
    });

    // Step 6 P0-B：启动时 fire-and-forget 预热全量食物池 L1+L2
    // 不阻塞 onModuleInit；首请求几乎不会再撞 cold DB（除非 warmup 还没完成）
    // 多实例同时启动也安全：getVerifiedFoods singleflight + L2 互相覆盖最终一致
    if (WARMUP_ON_BOOT) {
      void this.warmupVerifiedFoods();
    }
  }

  /**
   * Step 6 P0-B：启动预热（不阻塞模块初始化）
   * 调用 getVerifiedFoods 走完整 L1→L2→DB 三层；首次启动会触发 DB 查询并写 L2，
   * 之后每个实例冷启都能直接命中 L2（0 次 DB）。
   */
  private async warmupVerifiedFoods(): Promise<void> {
    const t0 = Date.now();
    try {
      const foods = await this.getVerifiedFoods();
      this.logger.log(
        `[food-pool warmup] L1+L2 ready: ${foods.length} foods in ${Date.now() - t0}ms`,
      );
    } catch (err) {
      // warmup 失败不影响服务启动，首请求会走正常 cold path 兜底
      this.logger.warn(
        `[food-pool warmup] failed in ${Date.now() - t0}ms: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 获取已验证的活跃食物列表（聚合所有品类分片）
   * 接口兼容旧版，调用方无需修改
   *
   * Risk-5 修复（2026-05-04）: 优先走全量单次 DB 查询路径（L1 内存缓存 + singleflight），
   * 避免 connection_limit=1 下 10 个分片串行查询导致的 ~2700ms 延迟。
   * L1 命中时 <1ms；L1 miss 走全量 DB 单次查询（~300ms）。
   */
  async getVerifiedFoods(): Promise<FoodLibrary[]> {
    // 1. L1 命中（30 分钟 TTL）
    if (this.allFoodsL1 && Date.now() < this.allFoodsL1ExpiresAt) {
      return this.allFoodsL1;
    }

    // 2. singleflight：并发请求共享同一次"L2→DB"加载
    if (this.allFoodsSingleflight) {
      return this.allFoodsSingleflight;
    }

    this.allFoodsSingleflight = this.loadFromL2OrDB().finally(() => {
      this.allFoodsSingleflight = null;
    });

    return this.allFoodsSingleflight;
  }

  /**
   * Step 6 P0-A/D：先查 L2 Redis，命中即回填 L1 + microAverages（避免 DB 回表）；
   * miss 才走 DB 全表查询，查完异步回写 L2（不阻塞返回）。
   *
   * Cloud Run 多实例场景下，第一个实例 warmup 写好 L2 后，后续实例冷启动
   * 直接命中 L2（~10–50ms，跨网络），完全跳过 DB 全表 + JOIN。
   */
  private async loadFromL2OrDB(): Promise<FoodLibrary[]> {
    // 尝试 L2 Redis（已内置 800ms 超时与失败兜底）
    const tL2 = Date.now();
    const [cachedFoods, cachedMicro] = await Promise.all([
      this.redis.get<FoodLibrary[]>(L2_VERIFIED_FOODS_KEY),
      this.redis.get<Array<[string, MicroNutrientDefaults]>>(
        L2_CATEGORY_MICRO_AVG_KEY,
      ),
    ]);
    const l2Ms = Date.now() - tL2;

    if (cachedFoods && cachedFoods.length > 0) {
      // 回填 L1
      this.allFoodsL1 = cachedFoods;
      this.allFoodsL1ExpiresAt = Date.now() + L1_TTL_MS;

      // 回填 microAverages（如 L2 缺失则同步重算 — 仅 CPU，单次约 5–15ms）
      if (cachedMicro && cachedMicro.length > 0) {
        this.categoryMicroAverages = new Map(cachedMicro);
      } else {
        this.categoryMicroAverages = buildCategoryMicroAverages(cachedFoods);
        // 异步补写 microAverages L2，不阻塞返回
        void this.redis.set(
          L2_CATEGORY_MICRO_AVG_KEY,
          Array.from(this.categoryMicroAverages.entries()),
          L2_TTL_MS,
        );
      }

      this.logger.log(
        `[food-pool] L2 hit: ${cachedFoods.length} foods in ${l2Ms}ms (DB skipped)`,
      );
      return cachedFoods;
    }

    // L2 miss，走 DB 全表
    return this.loadAllFoodsFromDB(l2Ms);
  }

  /**
   * 全量食物池单次 DB 查询（替代 10 个分片 × 1 连接的串行瓶颈）
   * 查询完成后同步更新 L1 内存缓存 + 分片 L1（供 getVerifiedFoodsByCategory 使用）
   *
   * Step 6 P0-A/D：DB 加载完后，异步并行写入 L2 Redis，
   * 使后续实例冷启可命中 L2（~10–50ms）跳过 DB 全表 + JOIN。
   */
  private async loadAllFoodsFromDB(
    l2ProbeMs = 0,
  ): Promise<FoodLibrary[]> {
    const tDb = Date.now();
    const sql = this.buildFoodPoolSQL('WHERE f.is_verified = true');
    const rows: any[] = await this.prisma.$queryRawUnsafe(sql);
    const dbMs = Date.now() - tDb;

    const tMap = Date.now();
    const allFoods = rows.map((row) => mapRowToFoodLibrary(normalizeRow(row)));
    const mapMs = Date.now() - tMap;

    // 回填 L1 全量缓存
    this.allFoodsL1 = allFoods;
    this.allFoodsL1ExpiresAt = Date.now() + L1_TTL_MS;

    // 回填微量营养素均值
    const tMicro = Date.now();
    if (allFoods.length > 0) {
      this.categoryMicroAverages = buildCategoryMicroAverages(allFoods);
    }
    const microMs = Date.now() - tMicro;

    // Step 6 P0-A/D：异步写入 L2（不阻塞返回；失败已被 redis-cache 内部吞掉）
    if (allFoods.length > 0) {
      void this.redis.set(L2_VERIFIED_FOODS_KEY, allFoods, L2_TTL_MS);
      if (this.categoryMicroAverages) {
        void this.redis.set(
          L2_CATEGORY_MICRO_AVG_KEY,
          Array.from(this.categoryMicroAverages.entries()),
          L2_TTL_MS,
        );
      }
    }

    this.logger.log(
      `[food-pool] DB load: ${allFoods.length} foods L2probe=${l2ProbeMs}ms db=${dbMs}ms map=${mapMs}ms micro=${microMs}ms`,
    );

    return allFoods;
  }

  /**
   * V6.4 Phase 3.3: 按获取渠道过滤已验证食物
   *
   * 在已缓存的品类数据基础上做内存过滤（不增加 DB 查询），
   * channel=unknown 时返回全量（不过滤）。
   *
   * @param channel 获取渠道
   * @returns 过滤后的食物列表
   */
  async getVerifiedFoodsByChannel(
    channel: AcquisitionChannel,
  ): Promise<FoodLibrary[]> {
    const allFoods = await this.getVerifiedFoods();

    // unknown = 不过滤
    if (channel === AcquisitionChannel.UNKNOWN) {
      return allFoods;
    }

    return allFoods.filter((food) => {
      const channels = food.availableChannels;
      // 没有设置 availableChannels 的食物默认所有渠道可用
      if (!channels || channels.length === 0) return true;
      return channels.includes(channel);
    });
  }

  /**
   * V5 4.3: 按品类获取已验证的活跃食物列表
   * V6 1.7: 迁移到 TieredCacheNamespace，自动 L1→L2→DB 穿透 + refresh-ahead
   */
  async getVerifiedFoodsByCategory(category: string): Promise<FoodLibrary[]> {
    return this.cache.getOrSet(category, () =>
      this.loadCategoryFromDB(category),
    );
  }

  /**
   * ARB-2026-04: food 上帝表已拆分为 5 张子表。
   * 构建带 LEFT JOIN 的食物池查询 SQL，将主表 + 4 张分表数据合并为单行。
   * 主表列前缀 f.，分表列通过 COALESCE 提供默认值。
   */
  private buildFoodPoolSQL(whereClause: string): string {
    const mainCols = FOOD_POOL_SELECTABLE_COLUMNS.map((c) => `f.${c}`).join(
      ', ',
    );
    return `
      SELECT
        ${mainCols},
        -- food_nutrition_details
        fnd.vitamin_a, fnd.vitamin_c, fnd.vitamin_d, fnd.vitamin_e,
        fnd.vitamin_b6, fnd.vitamin_b12, fnd.folate, fnd.zinc,
        fnd.magnesium, fnd.phosphorus, fnd.purine, fnd.cholesterol,
        fnd.saturated_fat, fnd.trans_fat, fnd.omega3, fnd.omega6,
        fnd.added_sugar, fnd.natural_sugar, fnd.soluble_fiber, fnd.insoluble_fiber,
        -- food_health_assessments
        fha.glycemic_index, fha.glycemic_load,
        fha.is_processed, fha.is_fried, fha.processing_level,
        fha.fodmap_level, fha.oxalate_level,
        fha.quality_score, fha.satiety_score, fha.nutrient_density,
        -- food_taxonomies
        ftx.meal_types, ftx.tags, ftx.allergens, ftx.compatibility,
        ftx.available_channels, ftx.flavor_profile, ftx.texture_tags,
        ftx.cuisine, ftx.dish_type,
        -- food_portion_guides
        COALESCE(fpg.standard_serving_g, 100)  AS standard_serving_g,
        fpg.standard_serving_desc,
        COALESCE(fpg.common_portions, '[]'::jsonb) AS common_portions,
        COALESCE(fpg.cooking_methods, ARRAY[]::TEXT[]) AS cooking_methods,
        COALESCE(fpg.required_equipment, ARRAY[]::TEXT[]) AS required_equipment,
        fpg.prep_time_minutes, fpg.cook_time_minutes,
        fpg.skill_required, fpg.serving_temperature,
        fpg.estimated_cost_level, fpg.shelf_life_days, fpg.water_content_percent
      FROM foods f
      LEFT JOIN food_nutrition_details  fnd ON fnd.food_id = f.id
      LEFT JOIN food_health_assessments fha ON fha.food_id = f.id
      LEFT JOIN food_taxonomies         ftx ON ftx.food_id = f.id
      LEFT JOIN food_portion_guides     fpg ON fpg.food_id = f.id
      ${whereClause}
    `;
  }

  /**
   * V5 4.3: 从数据库加载指定品类的已验证食物
   * ARB-2026-04: 改为 JOIN 4 张分表获取完整字段。
   */
  private async loadCategoryFromDB(category: string): Promise<FoodLibrary[]> {
    const sql = this.buildFoodPoolSQL(
      'WHERE f.is_verified = true AND f.category = $1',
    );
    const rows: any[] = await this.prisma.$queryRawUnsafe(sql, category);

    this.logger.debug(
      `Food pool shard [${category}] loaded from DB: ${rows.length} foods`,
    );

    // 品类数据变化时清除均值缓存以便下次重算
    this.categoryMicroAverages = null;

    return rows.map((row) => mapRowToFoodLibrary(normalizeRow(row)));
  }

  /** @deprecated ARB-2026-04 后列过滤逻辑已由 buildFoodPoolSQL JOIN 替代，保留以防其他调用方引用 */
  private getSelectableColumns(): Promise<string[]> {
    return Promise.resolve(FOOD_POOL_SELECTABLE_COLUMNS);
  }

  /**
   * 手动失效全部缓存 — 应在食物管理操作后调用
   * V6 1.7: 委托 TieredCacheNamespace 双清 L1 + L2
   */
  invalidate(): void {
    this.categoryMicroAverages = null;
    this.allFoodsL1 = null;
    this.allFoodsL1ExpiresAt = 0;
    this.cache.invalidateAll().catch(() => {
      /* non-critical */
    });
    // Step 6 P0：清理新加的 L2 全量 key
    void this.redis.del(L2_VERIFIED_FOODS_KEY);
    void this.redis.del(L2_CATEGORY_MICRO_AVG_KEY);
    this.logger.log(
      'Food pool cache invalidated: all shards cleared (L1 + L2)',
    );
  }

  /**
   * V5 4.3: 失效单个品类分片
   * 适用于仅修改特定品类食物时的精准失效
   */
  invalidateCategory(category: string): void {
    this.categoryMicroAverages = null; // 均值依赖全量数据，需重算
    this.allFoodsL1 = null; // 全量 L1 也需清除（内容已变）
    this.allFoodsL1ExpiresAt = 0;
    this.cache.invalidate(category).catch(() => {
      /* non-critical */
    });
    // Step 6 P0：分片变化也意味着全量 L2 失效
    void this.redis.del(L2_VERIFIED_FOODS_KEY);
    void this.redis.del(L2_CATEGORY_MICRO_AVG_KEY);
    this.logger.log(`Food pool shard [${category}] invalidated`);
  }

  /**
   * 获取缓存状态（调试/健康检查用）
   * V6 1.7: 基于 TieredCacheNamespace 统计
   */
  getCacheStatus(): {
    isCached: boolean;
    stats: { l1Size: number; l1MaxEntries: number; refreshingCount: number };
    ttlMs: number;
    redisConnected: boolean;
  } {
    const stats = this.cache.getStats();
    return {
      isCached: stats.l1Size > 0,
      stats: {
        l1Size: stats.l1Size,
        l1MaxEntries: stats.l1MaxEntries,
        refreshingCount: stats.refreshingCount,
      },
      ttlMs: L1_TTL_MS,
      redisConnected: this.redis.isConnected,
    };
  }

  /**
   * V5 2.7: 获取品类微量营养素均值表
   * 在食物池加载时自动构建，用于 NRF 9.3 评分中插补缺失微量营养素
   */
  getCategoryMicroAverages(): Map<string, MicroNutrientDefaults> | null {
    return this.categoryMicroAverages;
  }

  /**
   * V5 4.3: 确保微量营养素均值已构建
   * 首次调用时聚合全量数据构建，后续直接返回缓存
   */
  async ensureCategoryMicroAverages(): Promise<
    Map<string, MicroNutrientDefaults>
  > {
    if (this.categoryMicroAverages) {
      return this.categoryMicroAverages;
    }
    const allFoods = await this.getVerifiedFoods();
    this.categoryMicroAverages = buildCategoryMicroAverages(allFoods);
    this.logger.debug(
      `Category micro averages built for ${this.categoryMicroAverages.size} categories`,
    );
    return this.categoryMicroAverages;
  }
}
