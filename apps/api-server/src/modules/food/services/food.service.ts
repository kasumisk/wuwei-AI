import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { FoodLibrary } from '../entities/food-library.entity';
import { SearchFoodDto, CreateFoodDto, UpdateFoodDto } from '../dto/food.dto';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private foodRepo: Repository<FoodLibrary>,
  ) {}

  async search(dto: SearchFoodDto) {
    const { keyword, category, page = 1, limit = 20 } = dto;

    const qb = this.foodRepo.createQueryBuilder('food');
    qb.where('food.status = :status', { status: 'active' });

    if (keyword) {
      qb.andWhere(
        '(food.name ILIKE :kw OR food.aliases ILIKE :kw OR food.code ILIKE :kw)',
        { kw: `%${keyword}%` },
      );
    }

    if (category) {
      qb.andWhere('food.category = :category', { category });
    }

    qb.orderBy('food.searchWeight', 'DESC')
      .addOrderBy('food.popularity', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async findById(id: string) {
    const food = await this.foodRepo.findOne({
      where: { id },
      relations: ['translations', 'sources'],
    });
    if (!food) throw new NotFoundException('食物不存在');
    return food;
  }

  async findByCode(code: string) {
    const food = await this.foodRepo.findOne({
      where: { code },
      relations: ['translations'],
    });
    if (!food) throw new NotFoundException('食物不存在');
    return food;
  }

  async create(dto: CreateFoodDto) {
    const food = this.foodRepo.create(dto);
    return this.foodRepo.save(food);
  }

  async update(id: string, dto: UpdateFoodDto) {
    const food = await this.findById(id);
    Object.assign(food, dto);
    return this.foodRepo.save(food);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.foodRepo.findByIds(ids);
  }

  async findActiveByCategory(category: string, limit = 50) {
    return this.foodRepo.find({
      where: { category, status: 'active' },
      order: { searchWeight: 'DESC' },
      take: limit,
    });
  }

  async findActiveByMealType(mealType: string, limit = 100) {
    const qb = this.foodRepo.createQueryBuilder('food');
    qb.where('food.status = :status', { status: 'active' });
    qb.andWhere(`food.meal_types @> :mealType`, { mealType: JSON.stringify([mealType]) });
    qb.orderBy('food.searchWeight', 'DESC');
    qb.take(limit);
    return qb.getMany();
  }

  async incrementPopularity(id: string) {
    await this.foodRepo.increment({ id }, 'popularity', 1);
  }
}
