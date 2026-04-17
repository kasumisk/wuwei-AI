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
  'saturated_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'vitamin_a',
  'vitamin_c',
  'vitamin_d',
  'vitamin_e',
  'vitamin_b12',
  'vitamin_b6',
  'folate',
  'zinc',
  'magnesium',
  'glycemic_index',
  'glycemic_load',
  'is_processed',
  'is_fried',
  'processing_level',
  'allergens',
  'quality_score',
  'satiety_score',
  'nutrient_density',
  'meal_types',
  'tags',
  'main_ingredient',
  'compatibility',
  'standard_serving_g',
  'standard_serving_desc',
  'common_portions',
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
  // V5 4.6: 嵌入扩展字段（用于 96 维嵌入生成 + 可解释性）
  'cuisine',
  'flavor_profile',
  'prep_time_minutes',
  'cook_time_minutes',
  'skill_required',
  'estimated_cost_level',
  'shelf_life_days',
  // V7.5 P1-C: 含水量百分比
  'water_content_percent',
  'fodmap_level',
  'oxalate_level',
  // V6.4 Phase 3.3: 可获取渠道
  'available_channels',
  // V6.5: 大众化评分
  'commonality_score',
  // V7.3 Phase 1-A: 食物大众化扩展
  'food_form',
  'dish_priority',
  // V7.4 Phase 1-B: 食物可获得性
  'acquisition_difficulty',
  // V7.4 Phase 3-A: 精细化营养字段
  'omega3',
  'omega6',
  'soluble_fiber',
  'insoluble_fiber',
  // #fix Bug9: 痛风嘌呤惩罚需要 purine 数据
  'purine',
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
    prepTimeMinutes: nOpt(row.prepTimeMinutes) as number | undefined,
    cookTimeMinutes: nOpt(row.cookTimeMinutes) as number | undefined,
    skillRequired:
      row.skillRequired != null ? String(row.skillRequired) : undefined,
    estimatedCostLevel: nOpt(row.estimatedCostLevel) as number | undefined,
    shelfLifeDays: nOpt(row.shelfLifeDays) as number | undefined,
    waterContentPercent: nOpt(row.waterContentPercent),
    fodmapLevel: row.fodmapLevel != null ? String(row.fodmapLevel) : undefined,
    oxalateLevel:
      row.oxalateLevel != null ? String(row.oxalateLevel) : undefined,

    // 评分/指数
    glycemicIndex: nOpt(row.glycemicIndex) as number | undefined,
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
    embedding: row.embedding != null ? (row.embedding as number[]) : undefined,
    embeddingUpdatedAt:
      row.embeddingUpdatedAt != null
        ? new Date(row.embeddingUpdatedAt as string)
        : undefined,
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
    dishPriority: nOpt(row.dishPriority) as number | undefined,
    // V7.4 Phase 1-B: 食物可获得性
    acquisitionDifficulty: nOpt(row.acquisitionDifficulty) as
      | number
      | undefined,
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

  private selectableColumnsPromise: Promise<string[]> | null = null;
  /** V5 2.7: 品类微量营养素均值缓存（与食物池同步刷新） */
  private categoryMicroAverages: Map<string, MicroNutrientDefaults> | null =
    null;

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
  }

  /**
   * 获取已验证的活跃食物列表（聚合所有品类分片）
   * 接口兼容旧版，调用方无需修改
   */
  async getVerifiedFoods(): Promise<FoodLibrary[]> {
    const results = await Promise.all(
      FOOD_CATEGORIES.map((cat) => this.getVerifiedFoodsByCategory(cat)),
    );
    const allFoods = results.flat();
    // 聚合后构建品类微量营养素均值（兼容旧行为）
    if (!this.categoryMicroAverages && allFoods.length > 0) {
      this.categoryMicroAverages = buildCategoryMicroAverages(allFoods);
      this.logger.debug(
        `Category micro averages built for ${this.categoryMicroAverages.size} categories`,
      );
    }
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
   * V5 4.3: 从数据库加载指定品类的已验证食物
   * #12 fix: 原始 SQL 行（snake_case + Decimal 字符串）→ FoodLibrary（camelCase + number）
   */
  private async loadCategoryFromDB(category: string): Promise<FoodLibrary[]> {
    const selectColumns = await this.getSelectableColumns();
    const columnList = selectColumns.join(', ');
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT ${columnList}
       FROM foods
       WHERE is_verified = true
         AND category = $1`,
      category,
    );

    this.logger.debug(
      `Food pool shard [${category}] loaded from DB: ${rows.length} foods`,
    );

    // 品类数据变化时清除均值缓存以便下次重算
    this.categoryMicroAverages = null;

    return rows.map((row) => mapRowToFoodLibrary(normalizeRow(row)));
  }

  private async getSelectableColumns(): Promise<string[]> {
    if (!this.selectableColumnsPromise) {
      this.selectableColumnsPromise = this.loadSelectableColumns();
    }

    return this.selectableColumnsPromise;
  }

  private async loadSelectableColumns(): Promise<string[]> {
    const existingColumns: Array<{ column_name: string }> =
      await this.prisma.$queryRawUnsafe(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1`,
        'foods',
      );

    const existingColumnNames = new Set(
      existingColumns.map((column) => column.column_name),
    );
    const missingColumnNames: string[] = [];

    const selectableColumns = FOOD_POOL_SELECTABLE_COLUMNS.filter(
      (columnName) => {
        if (!existingColumnNames.has(columnName)) {
          missingColumnNames.push(columnName);
          return false;
        }
        return true;
      },
    );

    if (missingColumnNames.length > 0) {
      this.logger.warn(
        `Food pool query skipped missing columns: ${missingColumnNames.join(', ')}`,
      );
    }

    if (selectableColumns.length === 0) {
      throw new Error('No selectable columns available for foods table');
    }

    return selectableColumns;
  }

  /**
   * 手动失效全部缓存 — 应在食物管理操作后调用
   * V6 1.7: 委托 TieredCacheNamespace 双清 L1 + L2
   */
  invalidate(): void {
    this.selectableColumnsPromise = null;
    this.categoryMicroAverages = null;
    this.cache.invalidateAll().catch(() => {
      /* non-critical */
    });
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
    this.cache.invalidate(category).catch(() => {
      /* non-critical */
    });
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
