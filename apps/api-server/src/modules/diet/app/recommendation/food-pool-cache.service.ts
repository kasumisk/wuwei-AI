import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../../food/entities/food-library.entity';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache';
import {
  MicroNutrientDefaults,
  buildCategoryMicroAverages,
} from './recommendation.types';

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

const FOOD_POOL_SELECTABLE_PROPERTIES: Array<keyof FoodLibrary> = [
  'id',
  'code',
  'name',
  'aliases',
  'barcode',
  'status',
  'category',
  'subCategory',
  'foodGroup',
  'calories',
  'protein',
  'fat',
  'carbs',
  'fiber',
  'sugar',
  'saturatedFat',
  'transFat',
  'cholesterol',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminB12',
  'folate',
  'zinc',
  'magnesium',
  'glycemicIndex',
  'glycemicLoad',
  'isProcessed',
  'isFried',
  'processingLevel',
  'allergens',
  'qualityScore',
  'satietyScore',
  'nutrientDensity',
  'mealTypes',
  'tags',
  'mainIngredient',
  'compatibility',
  'standardServingG',
  'standardServingDesc',
  'commonPortions',
  'primarySource',
  'primarySourceId',
  'dataVersion',
  'confidence',
  'isVerified',
  'verifiedBy',
  'verifiedAt',
  'searchWeight',
  'popularity',
  'createdAt',
  'updatedAt',
  // V5 4.6: 嵌入扩展字段（用于 96 维嵌入生成 + 可解释性）
  'cuisine',
  'flavorProfile',
  'cookingMethod',
  'prepTimeMinutes',
  'cookTimeMinutes',
  'skillRequired',
  'estimatedCostLevel',
  'shelfLifeDays',
  'fodmapLevel',
  'oxalateLevel',
];

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
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
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
   */
  private async loadCategoryFromDB(category: string): Promise<FoodLibrary[]> {
    const selectColumns = await this.getSelectableColumns();
    const foods = await this.foodLibraryRepo
      .createQueryBuilder('food')
      .select(selectColumns)
      .where('food.isVerified = :isVerified', { isVerified: true })
      .andWhere('food.category = :category', { category })
      .getMany();

    this.logger.debug(
      `Food pool shard [${category}] loaded from DB: ${foods.length} foods`,
    );

    // 品类数据变化时清除均值缓存以便下次重算
    this.categoryMicroAverages = null;

    return foods;
  }

  private async getSelectableColumns(): Promise<string[]> {
    if (!this.selectableColumnsPromise) {
      this.selectableColumnsPromise = this.loadSelectableColumns();
    }

    return this.selectableColumnsPromise;
  }

  private async loadSelectableColumns(): Promise<string[]> {
    const existingColumns: Array<{ column_name: string }> =
      await this.foodLibraryRepo.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1`,
        ['foods'],
      );

    const existingColumnNames = new Set(
      existingColumns.map((column) => column.column_name),
    );
    const missingColumnNames: string[] = [];

    const selectableColumns = FOOD_POOL_SELECTABLE_PROPERTIES.flatMap(
      (propertyName) => {
        const column =
          this.foodLibraryRepo.metadata.findColumnWithPropertyName(
            propertyName,
          );

        if (!column) {
          return [];
        }

        if (!existingColumnNames.has(column.databaseName)) {
          missingColumnNames.push(column.databaseName);
          return [];
        }

        return [`food.${column.propertyPath}`];
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
