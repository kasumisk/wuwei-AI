import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, ILike } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';
import {
  GetFoodLibraryQueryDto,
  CreateFoodLibraryDto,
  UpdateFoodLibraryDto,
} from '../dto/food-library-management.dto';

@Injectable()
export class FoodLibraryManagementService {
  private readonly logger = new Logger(FoodLibraryManagementService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
  ) {}

  /**
   * 分页查询食物库
   */
  async findAll(query: GetFoodLibraryQueryDto) {
    const { page = 1, pageSize = 20, keyword, category, isVerified, source } = query;
    const qb = this.foodLibraryRepo.createQueryBuilder('f');

    if (keyword) {
      qb.andWhere('(f.name ILIKE :kw OR f.aliases ILIKE :kw)', { kw: `%${keyword}%` });
    }
    if (category) {
      qb.andWhere('f.category = :category', { category });
    }
    if (isVerified !== undefined) {
      qb.andWhere('f.is_verified = :isVerified', { isVerified });
    }
    if (source) {
      qb.andWhere('f.source = :source', { source });
    }

    qb.orderBy('f.searchWeight', 'DESC')
      .addOrderBy('f.createdAt', 'DESC');

    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取食物详情
   */
  async findOne(id: string): Promise<FoodLibrary> {
    const food = await this.foodLibraryRepo.findOne({ where: { id } });
    if (!food) {
      throw new NotFoundException('食物不存在');
    }
    return food;
  }

  /**
   * 创建食物
   */
  async create(dto: CreateFoodLibraryDto): Promise<FoodLibrary> {
    const existing = await this.foodLibraryRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`食物 "${dto.name}" 已存在`);
    }
    const food = this.foodLibraryRepo.create(dto);
    return this.foodLibraryRepo.save(food);
  }

  /**
   * 更新食物
   */
  async update(id: string, dto: UpdateFoodLibraryDto): Promise<FoodLibrary> {
    const food = await this.findOne(id);
    if (dto.name && dto.name !== food.name) {
      const existing = await this.foodLibraryRepo.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new ConflictException(`食物 "${dto.name}" 已存在`);
      }
    }
    Object.assign(food, dto);
    return this.foodLibraryRepo.save(food);
  }

  /**
   * 删除食物
   */
  async remove(id: string): Promise<{ message: string }> {
    const food = await this.findOne(id);
    await this.foodLibraryRepo.remove(food);
    return { message: `食物 "${food.name}" 已删除` };
  }

  /**
   * 批量导入
   */
  async batchImport(foods: CreateFoodLibraryDto[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dto of foods) {
      try {
        const existing = await this.foodLibraryRepo.findOne({ where: { name: dto.name } });
        if (existing) {
          skipped++;
          continue;
        }
        const food = this.foodLibraryRepo.create(dto);
        await this.foodLibraryRepo.save(food);
        imported++;
      } catch (e) {
        errors.push(`${dto.name}: ${e.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  /**
   * 获取分类统计
   */
  async getStatistics() {
    const total = await this.foodLibraryRepo.count();
    const verified = await this.foodLibraryRepo.count({ where: { isVerified: true } });
    const unverified = total - verified;

    const byCategory = await this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('f.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.category')
      .orderBy('count', 'DESC')
      .getRawMany();

    const bySource = await this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('f.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.source')
      .getRawMany();

    return { total, verified, unverified, byCategory, bySource };
  }

  /**
   * 获取所有分类列表
   */
  async getCategories(): Promise<string[]> {
    const result = await this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('DISTINCT f.category', 'category')
      .orderBy('f.category', 'ASC')
      .getRawMany();
    return result.map((r) => r.category);
  }

  /**
   * 切换验证状态
   */
  async toggleVerified(id: string): Promise<FoodLibrary> {
    const food = await this.findOne(id);
    food.isVerified = !food.isVerified;
    return this.foodLibraryRepo.save(food);
  }
}
