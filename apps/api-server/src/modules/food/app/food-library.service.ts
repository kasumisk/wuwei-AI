import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MealType } from '../../diet/diet.types';
import { FoodService } from '../../diet/app/food.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class FoodLibraryService {
  private readonly logger = new Logger(FoodLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
  ) {}

  /**
   * 模糊搜索食物（ILIKE + 别名匹配）
   */
  async search(q: string, limit: number = 10) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const pattern = `%${q}%`;

    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM foods
       WHERE name ILIKE $1 OR aliases ILIKE $1
       ORDER BY search_weight DESC, name ASC
       LIMIT $2`,
      pattern,
      safeLimit,
    );
  }

  /**
   * 按分类获取热门食物
   */
  async getPopular(category?: string, limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const where: any = { is_verified: true };
    if (category) {
      where.category = category;
    }

    return this.prisma.foods.findMany({
      where,
      orderBy: { search_weight: 'desc' },
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
      orderBy: { search_weight: 'desc' },
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
        orderBy: { search_weight: 'desc' },
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

    // 复用现有的 FoodService.saveRecord
    return this.foodService.saveRecord(userId, {
      foods: [
        {
          name: food.name,
          calories,
          quantity: `${servingGrams}g`,
          category: food.category,
        },
      ],
      totalCalories: calories,
      mealType,
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
       WHERE fr.user_id = $1
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
   */
  async enrichMissingFields(): Promise<{ updated: number }> {
    const foods = await this.prisma.foods.findMany();
    let updated = 0;

    for (const food of foods) {
      const changes: Record<string, any> = {};

      // 自动推导 qualityScore（如果为空）
      if (!food.quality_score) {
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
        changes.quality_score = categoryQuality[food.category] || 5;
      }

      // 自动推导 satietyScore（如果为空）
      if (!food.satiety_score) {
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
        changes.satiety_score = categorySatiety[food.category] || 4;
      }

      // 自动推导 mealTypes（如果为空数组）
      if (!food.meal_types || (food.meal_types as string[]).length === 0) {
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
        changes.meal_types = mealTypeMap[food.category] || ['lunch', 'dinner'];
      }

      // 自动推导 isProcessed
      if (food.is_processed === undefined || food.is_processed === null) {
        changes.is_processed =
          ['snack', 'composite'].includes(food.category) ||
          /加工|方便|速食|罐头|腌/.test(food.name);
      }

      // 自动推导 isFried
      if (food.is_fried === undefined || food.is_fried === null) {
        changes.is_fried = /炸|煎饺|油条|锅贴|油炸|煎饼/.test(food.name);
      }

      if (Object.keys(changes).length > 0) {
        await this.prisma.foods.update({
          where: { id: food.id },
          data: changes,
        });
        updated++;
      }
    }

    this.logger.log(
      `enrichMissingFields: updated ${updated}/${foods.length} foods`,
    );
    return { updated };
  }
}
