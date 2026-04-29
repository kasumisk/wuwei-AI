import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MealType, RecordSource } from '../../../diet/diet.types';
import { FoodService } from '../../../diet/app/services/food.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import {
  upsertFoodSplitTables,
  FOOD_SPLIT_INCLUDE,
} from '../../food-split.helper';

@Injectable()
export class FoodLibraryService {
  private readonly logger = new Logger(FoodLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * V6.2 3.5: 混合搜索 — pg_trgm similarity + ILIKE 回退
   *
   * 策略:
   * 1. 先用 pg_trgm similarity 匹配（阈值 0.2），结果按相似度 + search_weight 排序
   * 2. 如果 similarity 结果不足，追加 ILIKE 兜底
   * 3. 已有 GIN 索引 idx_foods_name_trgm / idx_foods_aliases_trgm 支持
   */
  async search(q: string, limit: number = 10) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    // pg_trgm similarity 搜索（利用已有 GIN 索引）
    const results = await this.prisma.$queryRawUnsafe(
      `SELECT
         f.id, f.code, f.name, f.aliases, f.barcode, f.status,
         f.category, f.sub_category, f.food_group,
         f.calories, f.protein, f.fat, f.carbs, f.fiber, f.sugar,
         nd.added_sugar AS added_sugar, nd.natural_sugar AS natural_sugar, nd.saturated_fat AS saturated_fat, nd.trans_fat AS trans_fat,
         nd.cholesterol AS cholesterol, f.sodium, f.potassium, f.calcium, f.iron,
         nd.vitamin_a AS vitamin_a, nd.vitamin_c AS vitamin_c, nd.vitamin_d AS vitamin_d, nd.vitamin_e AS vitamin_e,
         nd.vitamin_b12 AS vitamin_b12, nd.folate AS folate, nd.zinc AS zinc, nd.magnesium AS magnesium, nd.purine AS purine, nd.phosphorus AS phosphorus,
         ha.glycemic_index AS glycemic_index, ha.glycemic_load AS glycemic_load,
         ha.is_processed AS is_processed, ha.is_fried AS is_fried, ha.processing_level AS processing_level,
         tx.allergens AS allergens, ha.quality_score AS quality_score, ha.satiety_score AS satiety_score, ha.nutrient_density AS nutrient_density,
         tx.meal_types AS meal_types, tx.tags AS tags, f.main_ingredient, tx.compatibility AS compatibility,
         pg.standard_serving_g AS standard_serving_g, pg.standard_serving_desc AS standard_serving_desc, pg.common_portions AS common_portions,
         f.image_url, f.thumbnail_url,
         f.primary_source, f.primary_source_id,
         f.data_version, f.confidence, f.is_verified,
         f.verified_by, f.verified_at, f.search_weight, f.popularity,
         tx.cuisine AS cuisine, tx.flavor_profile AS flavor_profile, pg.cooking_methods AS cooking_methods,
         pg.required_equipment AS required_equipment, pg.serving_temperature AS serving_temperature,
         tx.texture_tags AS texture_tags, tx.dish_type AS dish_type, f.food_form, f.dish_priority,
         f.ingredient_list,
         pg.prep_time_minutes AS prep_time_minutes, pg.cook_time_minutes AS cook_time_minutes, pg.skill_required AS skill_required,
         pg.estimated_cost_level AS estimated_cost_level, pg.shelf_life_days AS shelf_life_days,
         ha.fodmap_level AS fodmap_level, ha.oxalate_level AS oxalate_level,
         tx.available_channels AS available_channels, f.commonality_score,
         -- V7.9 营养素字段
         nd.vitamin_b6 AS vitamin_b6, nd.omega3 AS omega3, nd.omega6 AS omega6,
         nd.soluble_fiber AS soluble_fiber, nd.insoluble_fiber AS insoluble_fiber, pg.water_content_percent AS water_content_percent,
         f.acquisition_difficulty,
          -- 补全元数据
           f.data_completeness, f.enrichment_status, f.last_enriched_at,
          -- V8.1 审核
         f.review_status, f.reviewed_by, f.reviewed_at,
         f.created_at, f.updated_at,
         GREATEST(
           similarity(f.name, $1),
           similarity(COALESCE(f.aliases, ''), $1)
         ) AS sim_score
       FROM foods f
       LEFT JOIN food_nutrition_details nd ON nd.food_id = f.id
       LEFT JOIN food_health_assessments ha ON ha.food_id = f.id
       LEFT JOIN food_taxonomies tx ON tx.food_id = f.id
       LEFT JOIN food_portion_guides pg ON pg.food_id = f.id
       WHERE similarity(f.name, $1) > 0.2
          OR similarity(COALESCE(f.aliases, ''), $1) > 0.2
          OR f.name ILIKE $2
          OR f.aliases ILIKE $2
       ORDER BY sim_score DESC, f.search_weight DESC, f.name ASC
       LIMIT $3`,
      q,
      `%${q}%`,
      safeLimit,
    );

    return results;
  }

  /**
   * 按分类获取热门食物
   */
  async getPopular(category?: string, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const where: any = { isVerified: true };
    if (category) {
      where.category = category;
    }

    return this.prisma.food.findMany({
      where,
      include: FOOD_SPLIT_INCLUDE,
      orderBy: { searchWeight: 'desc' },
      take: safeLimit,
    });
  }

  /**
   * 获取所有分类及条目数
   */
  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ category: string; count: string }>
    >(
      `SELECT category, COUNT(*)::text AS count FROM foods GROUP BY category ORDER BY count DESC`,
    );
    return result.map((r) => ({
      category: r.category,
      count: Number(r.count),
    }));
  }

  /**
   * 按名称精确查找（SEO 落地页使用）
   */
  async findByName(name: string) {
    const food = await this.prisma.food.findFirst({
      where: { name },
      include: FOOD_SPLIT_INCLUDE,
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFoundByName', { name }));
    }
    return food;
  }

  /**
   * 按 ID 查找
   */
  async findById(id: string) {
    const food = await this.prisma.food.findUnique({
      where: { id },
      include: FOOD_SPLIT_INCLUDE,
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFound'));
    }
    return food;
  }

  /**
   * 获取同分类的相关食物
   */
  async getRelated(name: string, limit: number = 5) {
    const food = await this.findByName(name);
    return this.prisma.food.findMany({
      where: {
        category: food.category,
        name: { not: name },
      },
      include: FOOD_SPLIT_INCLUDE,
      orderBy: { searchWeight: 'desc' },
      take: limit,
    });
  }

  /**
   * 获取所有食物（分页，供 sitemap 或 admin 使用）
   */
  async findAll(limit: number = 500) {
    const take = Math.min(limit, 1000);
    const [items, total] = await Promise.all([
      this.prisma.food.findMany({
        include: FOOD_SPLIT_INCLUDE,
        orderBy: { searchWeight: 'desc' },
        take,
      }),
      this.prisma.food.count(),
    ]);
    return { items, total };
  }

  /**
   * 从食物库手动记录到饮食记录
   */
  async addFromLibrary(
    userId: string,
    foodLibraryId: string,
    servingGrams: number,
    mealType: MealType,
  ) {
    const food = await this.findById(foodLibraryId);
    const calories = Math.round((Number(food.calories) * servingGrams) / 100);
    const protein =
      food.protein != null
        ? Math.round(((Number(food.protein) * servingGrams) / 100) * 10) / 10
        : 0;
    const fat =
      food.fat != null
        ? Math.round(((Number(food.fat) * servingGrams) / 100) * 10) / 10
        : 0;
    const carbs =
      food.carbs != null
        ? Math.round(((Number(food.carbs) * servingGrams) / 100) * 10) / 10
        : 0;

    // 复用 FoodService.createRecord（统一写入 V8）
    return this.foodService.createRecord(userId, {
      foods: [
        {
          name: food.name,
          calories,
          quantity: `${servingGrams}g`,
          category: food.category,
          protein,
          fat,
          carbs,
          glycemicIndex:
            food.healthAssessment?.glycemicIndex != null
              ? Number(food.healthAssessment.glycemicIndex)
              : undefined,
        },
      ],
      totalCalories: calories,
      totalProtein: protein,
      totalFat: fat,
      totalCarbs: carbs,
      mealType,
      source: RecordSource.MANUAL,
    });
  }

  /**
   * 获取用户常用食物（基于历史记录频次）
   */
  async getFrequent(userId: string, limit: number = 10) {
    // 从 food_records 的 JSONB foods 字段中统计用户常用食物名
    const frequentNames: Array<{ name: string; frequency: string }> =
      await this.prisma.$queryRawUnsafe(
        `SELECT food_item->>'name' AS name, COUNT(*) AS frequency
       FROM food_records fr
       CROSS JOIN LATERAL jsonb_array_elements(fr.foods) AS food_item
       WHERE fr.user_id = $1::uuid
       GROUP BY food_item->>'name'
       ORDER BY frequency DESC
       LIMIT $2`,
        userId,
        limit,
      );

    if (frequentNames.length === 0) return [];

    const names = frequentNames.map((r) => r.name);
    const foods = await this.prisma.food.findMany({
      where: { name: { in: names } },
      include: FOOD_SPLIT_INCLUDE,
    });

    const foodByName = new Map(foods.map((f) => [f.name, f]));

    // Return shape: { name, count, food? } — matching frontend FrequentFood type
    return frequentNames.map((r) => ({
      name: r.name,
      count: Number(r.frequency),
      food: foodByName.get(r.name) ?? undefined,
    }));
  }

  /**
   * 新增食物条目（管理员 / 后台用）
   */
  async create(data: any) {
    const food = await this.prisma.food.create({ data });
    await upsertFoodSplitTables(this.prisma, food.id, data);
    return food;
  }

  /**
   * 更新食物条目
   */
  async update(id: string, data: any) {
    await this.findById(id);
    const food = await this.prisma.food.update({
      where: { id },
      data,
    });
    await upsertFoodSplitTables(this.prisma, id, data);
    return food;
  }

  /**
   * 删除食物条目
   */
  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.food.delete({ where: { id } });
  }

  /**
   * 批量自动补全缺失字段（基于规则推导，无 AI 成本）
   * 用于数据迁移或新入库食物的字段补全
   * V6 优化: 按 category 分组使用 updateMany 替代逐条 update，减少 DB 往返
   */
  async enrichMissingFields(): Promise<{ updated: number }> {
    const foods = await this.prisma.food.findMany({
      include: {
        healthAssessment: { select: { qualityScore: true, satietyScore: true, isProcessed: true, isFried: true } },
        taxonomy: { select: { mealTypes: true } },
      },
    });
    let updated = 0;

    const categoryQuality: Record<string, number> = {
      veggie: 8,
      fruit: 7,
      dairy: 6,
      protein: 6,
      grain: 5,
      composite: 4,
      beverage: 3,
      snack: 2,
      fat: 4,
      condiment: 3,
    };
    const categorySatiety: Record<string, number> = {
      protein: 7,
      grain: 7,
      dairy: 6,
      veggie: 5,
      composite: 5,
      fruit: 3,
      fat: 4,
      snack: 2,
      beverage: 2,
      condiment: 1,
    };
    const mealTypeMap: Record<string, string[]> = {
      grain: ['breakfast', 'lunch', 'dinner'],
      protein: ['lunch', 'dinner'],
      veggie: ['lunch', 'dinner'],
      dairy: ['breakfast', 'snack'],
      composite: ['lunch', 'dinner'],
      fruit: ['snack'],
      beverage: ['breakfast', 'snack'],
      snack: ['snack'],
      fat: ['lunch', 'dinner'],
      condiment: ['lunch', 'dinner'],
    };

    // 收集需要逐条更新的食物（因 isProcessed/isFried 依赖食物名，无法 updateMany）
    const batchUpdates: Array<{ id: string; data: Record<string, any> }> = [];

    for (const food of foods) {
      const ha = (food as any).healthAssessment;
      const tx = (food as any).taxonomy;
      const changes: Record<string, any> = {};

      if (!ha?.qualityScore) {
        changes.qualityScore = categoryQuality[food.category] || 5;
      }
      if (!ha?.satietyScore) {
        changes.satietyScore = categorySatiety[food.category] || 4;
      }
      const mealTypes = tx?.mealTypes as string[] | null;
      if (!mealTypes || mealTypes.length === 0) {
        changes.mealTypes = mealTypeMap[food.category] || ['lunch', 'dinner'];
      }
      if (ha?.isProcessed === undefined || ha?.isProcessed === null) {
        changes.isProcessed =
          ['snack', 'composite'].includes(food.category) ||
          /加工|方便|速食|罐头|腌/.test(food.name);
      }
      if (ha?.isFried === undefined || ha?.isFried === null) {
        changes.isFried = /炸|煎饺|油条|锅贴|油炸|煎饼/.test(food.name);
      }

      if (Object.keys(changes).length > 0) {
        batchUpdates.push({ id: food.id, data: changes });
      }
    }

    // 使用 $transaction 批量写入拆分表（每批 200 条）
    const TX_BATCH = 200;
    for (let i = 0; i < batchUpdates.length; i += TX_BATCH) {
      const chunk = batchUpdates.slice(i, i + TX_BATCH);
      for (const { id, data } of chunk) {
        await upsertFoodSplitTables(this.prisma, id, data);
      }
      updated += chunk.length;
    }

    this.logger.log(
      `enrichMissingFields: updated ${updated}/${foods.length} foods`,
    );
    return { updated };
  }
}
