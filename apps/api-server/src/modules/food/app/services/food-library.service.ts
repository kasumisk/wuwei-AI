import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MealType, RecordSource } from '../../../diet/diet.types';
import { FoodService } from '../../../diet/app/services/food.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class FoodLibraryService {
  private readonly logger = new Logger(FoodLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
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
         id, code, name, aliases, barcode, status,
         category, sub_category, food_group,
         calories, protein, fat, carbs, fiber, sugar,
         added_sugar, natural_sugar, saturated_fat, trans_fat,
         cholesterol, sodium, potassium, calcium, iron,
         vitamin_a, vitamin_c, vitamin_d, vitamin_e,
         vitamin_b12, folate, zinc, magnesium, purine, phosphorus,
         glycemic_index, glycemic_load,
         is_processed, is_fried, processing_level,
         allergens, quality_score, satiety_score, nutrient_density,
         meal_types, tags, main_ingredient, compatibility,
         standard_serving_g, standard_serving_desc, common_portions,
         image_url, thumbnail_url,
         primary_source, primary_source_id,
         data_version, confidence, is_verified,
         verified_by, verified_at, search_weight, popularity,
         cuisine, flavor_profile, cooking_methods,
         required_equipment, serving_temperature,
         texture_tags, dish_type, food_form, dish_priority,
         ingredient_list,
         prep_time_minutes, cook_time_minutes, skill_required,
         estimated_cost_level, shelf_life_days,
         fodmap_level, oxalate_level,
         available_channels, commonality_score,
         -- V7.9 营养素字段
         vitamin_b6, omega3, omega6,
         soluble_fiber, insoluble_fiber, water_content_percent,
         acquisition_difficulty,
         -- 补全元数据
         data_completeness, enrichment_status, last_enriched_at,
         field_sources, field_confidence,
         -- V8.1 审核
         review_status, reviewed_by, reviewed_at, failed_fields,
         created_at, updated_at,
         GREATEST(
           similarity(name, $1),
           similarity(COALESCE(aliases, ''), $1)
         ) AS sim_score
       FROM foods
       WHERE similarity(name, $1) > 0.2
          OR similarity(COALESCE(aliases, ''), $1) > 0.2
          OR name ILIKE $2
          OR aliases ILIKE $2
       ORDER BY sim_score DESC, search_weight DESC, name ASC
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

    return this.prisma.foods.findMany({
      where,
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
    const food = await this.prisma.foods.findFirst({
      where: { name },
    });
    if (!food) {
      throw new NotFoundException(`未找到食物: ${name}`);
    }
    return food;
  }

  /**
   * 按 ID 查找
   */
  async findById(id: string) {
    const food = await this.prisma.foods.findUnique({
      where: { id },
    });
    if (!food) {
      throw new NotFoundException(`未找到食物`);
    }
    return food;
  }

  /**
   * 获取同分类的相关食物
   */
  async getRelated(name: string, limit: number = 5) {
    const food = await this.findByName(name);
    return this.prisma.foods.findMany({
      where: {
        category: food.category,
        name: { not: name },
      },
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
      this.prisma.foods.findMany({
        orderBy: { searchWeight: 'desc' },
        take,
      }),
      this.prisma.foods.count(),
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
            food.glycemicIndex != null ? Number(food.glycemicIndex) : undefined,
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
    const frequentNames: Array<{ name: string }> =
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
    return this.prisma.foods.findMany({
      where: { name: { in: names } },
    });
  }

  /**
   * 新增食物条目（管理员 / 后台用）
   */
  async create(data: any) {
    return this.prisma.foods.create({ data });
  }

  /**
   * 更新食物条目
   */
  async update(id: string, data: any) {
    await this.findById(id);
    return this.prisma.foods.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除食物条目
   */
  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.foods.delete({ where: { id } });
  }

  /**
   * 批量自动补全缺失字段（基于规则推导，无 AI 成本）
   * 用于数据迁移或新入库食物的字段补全
   * V6 优化: 按 category 分组使用 updateMany 替代逐条 update，减少 DB 往返
   */
  async enrichMissingFields(): Promise<{ updated: number }> {
    const foods = await this.prisma.foods.findMany();
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
      const changes: Record<string, any> = {};

      if (!food.qualityScore) {
        changes.qualityScore = categoryQuality[food.category] || 5;
      }
      if (!food.satietyScore) {
        changes.satietyScore = categorySatiety[food.category] || 4;
      }
      if (!food.mealTypes || (food.mealTypes as string[]).length === 0) {
        changes.mealTypes = mealTypeMap[food.category] || ['lunch', 'dinner'];
      }
      if (food.isProcessed === undefined || food.isProcessed === null) {
        changes.isProcessed =
          ['snack', 'composite'].includes(food.category) ||
          /加工|方便|速食|罐头|腌/.test(food.name);
      }
      if (food.isFried === undefined || food.isFried === null) {
        changes.isFried = /炸|煎饺|油条|锅贴|油炸|煎饼/.test(food.name);
      }

      if (Object.keys(changes).length > 0) {
        batchUpdates.push({ id: food.id, data: changes });
      }
    }

    // 使用 $transaction 批量写入（每批 200 条）
    const TX_BATCH = 200;
    for (let i = 0; i < batchUpdates.length; i += TX_BATCH) {
      const chunk = batchUpdates.slice(i, i + TX_BATCH);
      await this.prisma.$transaction(
        chunk.map(({ id, data }) =>
          this.prisma.foods.update({ where: { id }, data }),
        ),
      );
      updated += chunk.length;
    }

    this.logger.log(
      `enrichMissingFields: updated ${updated}/${foods.length} foods`,
    );
    return { updated };
  }
}
