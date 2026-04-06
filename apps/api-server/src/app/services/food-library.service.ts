import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';
import { FoodRecord, MealType, RecordSource } from '../../entities/food-record.entity';
import { FoodService } from './food.service';

@Injectable()
export class FoodLibraryService {
  private readonly logger = new Logger(FoodLibraryService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    private readonly foodService: FoodService,
  ) {}

  /**
   * 模糊搜索食物（ILIKE + 别名匹配）
   */
  async search(q: string, limit: number = 10): Promise<FoodLibrary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const pattern = `%${q}%`;

    return this.foodLibraryRepo
      .createQueryBuilder('f')
      .where('f.name ILIKE :pattern OR f.aliases ILIKE :pattern', { pattern })
      .orderBy('f.search_weight', 'DESC')
      .addOrderBy('f.name', 'ASC')
      .limit(safeLimit)
      .getMany();
  }

  /**
   * 按分类获取热门食物
   */
  async getPopular(category?: string, limit: number = 20): Promise<FoodLibrary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const qb = this.foodLibraryRepo
      .createQueryBuilder('f')
      .where('f.is_verified = true');

    if (category) {
      qb.andWhere('f.category = :category', { category });
    }

    return qb
      .orderBy('f.search_weight', 'DESC')
      .limit(safeLimit)
      .getMany();
  }

  /**
   * 获取所有分类及条目数
   */
  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    return this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('f.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.category')
      .orderBy('count', 'DESC')
      .getRawMany();
  }

  /**
   * 按名称精确查找（SEO 落地页使用）
   */
  async findByName(name: string): Promise<FoodLibrary> {
    const food = await this.foodLibraryRepo.findOne({
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
  async findById(id: string): Promise<FoodLibrary> {
    const food = await this.foodLibraryRepo.findOne({
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
  async getRelated(name: string, limit: number = 5): Promise<FoodLibrary[]> {
    const food = await this.findByName(name);
    return this.foodLibraryRepo
      .createQueryBuilder('f')
      .where('f.category = :category', { category: food.category })
      .andWhere('f.name != :name', { name })
      .orderBy('f.search_weight', 'DESC')
      .limit(limit)
      .getMany();
  }

  /**
   * 获取所有食物（分页，供 sitemap 或 admin 使用）
   */
  async findAll(limit: number = 500): Promise<{ items: FoodLibrary[]; total: number }> {
    const [items, total] = await this.foodLibraryRepo.findAndCount({
      order: { searchWeight: 'DESC' },
      take: Math.min(limit, 1000),
    });
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
  ): Promise<FoodRecord> {
    const food = await this.findById(foodLibraryId);
    const calories = Math.round((food.caloriesPer100g * servingGrams) / 100);

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
  async getFrequent(userId: string, limit: number = 10): Promise<FoodLibrary[]> {
    // 从 food_records 的 JSONB foods 字段中统计用户常用食物名
    const frequentNames: Array<{ name: string }> = await this.foodRecordRepo
      .createQueryBuilder('fr')
      .select("food_item->>'name'", 'name')
      .addSelect('COUNT(*)', 'frequency')
      .from('food_records', 'fr')
      .innerJoin(
        "jsonb_array_elements(fr.foods)",
        'food_item',
        'true',
      )
      .where('fr.user_id = :userId', { userId })
      .groupBy("food_item->>'name'")
      .orderBy('frequency', 'DESC')
      .limit(limit)
      .getRawMany();

    if (frequentNames.length === 0) return [];

    const names = frequentNames.map((r) => r.name);
    return this.foodLibraryRepo
      .createQueryBuilder('f')
      .where('f.name IN (:...names)', { names })
      .getMany();
  }

  /**
   * 新增食物条目（管理员 / 后台用）
   */
  async create(data: Partial<FoodLibrary>): Promise<FoodLibrary> {
    const food = this.foodLibraryRepo.create(data);
    return this.foodLibraryRepo.save(food);
  }

  /**
   * 更新食物条目
   */
  async update(id: string, data: Partial<FoodLibrary>): Promise<FoodLibrary> {
    const food = await this.findById(id);
    Object.assign(food, data);
    return this.foodLibraryRepo.save(food);
  }

  /**
   * 删除食物条目
   */
  async remove(id: string): Promise<void> {
    const food = await this.findById(id);
    await this.foodLibraryRepo.remove(food);
  }
}
