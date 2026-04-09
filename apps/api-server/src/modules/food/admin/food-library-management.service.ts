import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../entities/food-library.entity';
import { FoodTranslation } from '../entities/food-translation.entity';
import { FoodSource } from '../entities/food-source.entity';
import { FoodChangeLog } from '../entities/food-change-log.entity';
import { FoodConflict } from '../entities/food-conflict.entity';
import {
  GetFoodLibraryQueryDto,
  CreateFoodLibraryDto,
  UpdateFoodLibraryDto,
  CreateFoodTranslationDto,
  UpdateFoodTranslationDto,
  CreateFoodSourceDto,
  ResolveFoodConflictDto,
} from './dto/food-library-management.dto';

@Injectable()
export class FoodLibraryManagementService {
  private readonly logger = new Logger(FoodLibraryManagementService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodTranslation)
    private readonly translationRepo: Repository<FoodTranslation>,
    @InjectRepository(FoodSource)
    private readonly sourceRepo: Repository<FoodSource>,
    @InjectRepository(FoodChangeLog)
    private readonly changeLogRepo: Repository<FoodChangeLog>,
    @InjectRepository(FoodConflict)
    private readonly conflictRepo: Repository<FoodConflict>,
  ) {}

  // ==================== 食物 CRUD ====================

  async findAll(query: GetFoodLibraryQueryDto) {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      category,
      isVerified,
      primarySource,
      status,
    } = query;
    const qb = this.foodLibraryRepo.createQueryBuilder('f');

    if (keyword) {
      qb.andWhere(
        '(f.name ILIKE :kw OR f.aliases ILIKE :kw OR f.code ILIKE :kw)',
        { kw: `%${keyword}%` },
      );
    }
    if (category) {
      qb.andWhere('f.category = :category', { category });
    }
    if (status) {
      qb.andWhere('f.status = :status', { status });
    }
    if (isVerified !== undefined) {
      qb.andWhere('f.isVerified = :isVerified', { isVerified });
    }
    if (primarySource) {
      qb.andWhere('f.primarySource = :primarySource', { primarySource });
    }

    qb.orderBy('f.searchWeight', 'DESC').addOrderBy('f.createdAt', 'DESC');

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

  async findOne(id: string): Promise<FoodLibrary> {
    const food = await this.foodLibraryRepo.findOne({
      where: { id },
      relations: ['translations', 'sources', 'conflicts'],
    });
    if (!food) {
      throw new NotFoundException('食物不存在');
    }
    return food;
  }

  async create(dto: CreateFoodLibraryDto): Promise<FoodLibrary> {
    const existing = await this.foodLibraryRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`食物 "${dto.name}" 已存在`);
    }
    const codeExisting = await this.foodLibraryRepo.findOne({
      where: { code: dto.code },
    });
    if (codeExisting) {
      throw new ConflictException(`编码 "${dto.code}" 已存在`);
    }
    const food = this.foodLibraryRepo.create(dto);
    const saved = await this.foodLibraryRepo.save(food);

    // 写变更日志
    await this.createChangeLog(saved.id, 1, 'create', dto, '创建食物', 'admin');
    return saved;
  }

  async update(
    id: string,
    dto: UpdateFoodLibraryDto,
    operator = 'admin',
  ): Promise<FoodLibrary> {
    const food = await this.findOne(id);
    if (dto.name && dto.name !== food.name) {
      const existing = await this.foodLibraryRepo.findOne({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`食物 "${dto.name}" 已存在`);
      }
    }

    // 记录变更前后
    const changes: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && (food as any)[key] !== value) {
        changes[key] = { old: (food as any)[key], new: value };
      }
    }

    Object.assign(food, dto);
    food.dataVersion = (food.dataVersion || 1) + 1;
    const saved = await this.foodLibraryRepo.save(food);

    if (Object.keys(changes).length > 0) {
      await this.createChangeLog(
        id,
        saved.dataVersion,
        'update',
        changes,
        undefined,
        operator,
      );
    }
    return saved;
  }

  async remove(id: string): Promise<{ message: string }> {
    const food = await this.findOne(id);
    await this.foodLibraryRepo.remove(food);
    return { message: `食物 "${food.name}" 已删除` };
  }

  async batchImport(
    foods: CreateFoodLibraryDto[],
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dto of foods) {
      try {
        const existing = await this.foodLibraryRepo.findOne({
          where: { code: dto.code },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const food = this.foodLibraryRepo.create(dto);
        await this.foodLibraryRepo.save(food);
        imported++;
      } catch (e) {
        errors.push(`${dto.code} (${dto.name}): ${e.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  async toggleVerified(id: string, operator = 'admin'): Promise<FoodLibrary> {
    const food = await this.findOne(id);
    food.isVerified = !food.isVerified;
    food.verifiedBy = food.isVerified ? operator : undefined;
    food.verifiedAt = food.isVerified ? new Date() : undefined;
    food.dataVersion = (food.dataVersion || 1) + 1;
    const saved = await this.foodLibraryRepo.save(food);

    await this.createChangeLog(
      id,
      saved.dataVersion,
      'verify',
      {
        isVerified: { old: !food.isVerified, new: food.isVerified },
      },
      undefined,
      operator,
    );
    return saved;
  }

  async updateStatus(
    id: string,
    newStatus: string,
    operator = 'admin',
  ): Promise<FoodLibrary> {
    const food = await this.findOne(id);
    const oldStatus = food.status;
    food.status = newStatus;
    food.dataVersion = (food.dataVersion || 1) + 1;
    const saved = await this.foodLibraryRepo.save(food);

    await this.createChangeLog(
      id,
      saved.dataVersion,
      newStatus === 'archived' ? 'archive' : 'update',
      {
        status: { old: oldStatus, new: newStatus },
      },
      undefined,
      operator,
    );
    return saved;
  }

  // ==================== 统计 ====================

  async getStatistics() {
    const total = await this.foodLibraryRepo.count();
    const verified = await this.foodLibraryRepo.count({
      where: { isVerified: true },
    });
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
      .select('f.primarySource', 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.primarySource')
      .getRawMany();

    const byStatus = await this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('f.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.status')
      .getRawMany();

    const conflictCount = await this.conflictRepo.count({
      where: { resolution: 'pending' },
    });

    return {
      total,
      verified,
      unverified,
      byCategory,
      bySource,
      byStatus,
      pendingConflicts: conflictCount,
    };
  }

  async getCategories(): Promise<string[]> {
    const result = await this.foodLibraryRepo
      .createQueryBuilder('f')
      .select('DISTINCT f.category', 'category')
      .orderBy('f.category', 'ASC')
      .getRawMany();
    return result.map((r) => r.category);
  }

  // ==================== 翻译管理 ====================

  async getTranslations(foodId: string) {
    return this.translationRepo.find({
      where: { foodId },
      order: { locale: 'ASC' },
    });
  }

  async createTranslation(foodId: string, dto: CreateFoodTranslationDto) {
    await this.findOne(foodId); // validate food exists
    const existing = await this.translationRepo.findOne({
      where: { foodId, locale: dto.locale },
    });
    if (existing) {
      throw new ConflictException(`该食物的 ${dto.locale} 翻译已存在`);
    }
    const translation = this.translationRepo.create({ ...dto, foodId });
    return this.translationRepo.save(translation);
  }

  async updateTranslation(
    translationId: string,
    dto: UpdateFoodTranslationDto,
  ) {
    const translation = await this.translationRepo.findOne({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    Object.assign(translation, dto);
    return this.translationRepo.save(translation);
  }

  async deleteTranslation(translationId: string) {
    const translation = await this.translationRepo.findOne({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    await this.translationRepo.remove(translation);
    return { message: '翻译已删除' };
  }

  // ==================== 数据来源管理 ====================

  async getSources(foodId: string) {
    return this.sourceRepo.find({
      where: { foodId },
      order: { priority: 'DESC' },
    });
  }

  async createSource(foodId: string, dto: CreateFoodSourceDto) {
    await this.findOne(foodId);
    const source = this.sourceRepo.create({ ...dto, foodId });
    return this.sourceRepo.save(source);
  }

  async deleteSource(sourceId: string) {
    const source = await this.sourceRepo.findOne({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('来源记录不存在');
    await this.sourceRepo.remove(source);
    return { message: '来源已删除' };
  }

  // ==================== 变更日志 ====================

  async getChangeLogs(foodId: string) {
    return this.changeLogRepo.find({
      where: { foodId },
      order: { version: 'DESC' },
      take: 50,
    });
  }

  private async createChangeLog(
    foodId: string,
    version: number,
    action: string,
    changes: Record<string, any>,
    reason?: string,
    operator?: string,
  ) {
    const log = this.changeLogRepo.create({
      foodId,
      version,
      action,
      changes,
      reason,
      operator,
    });
    return this.changeLogRepo.save(log);
  }

  // ==================== 冲突管理 ====================

  async getConflicts(query: {
    foodId?: string;
    resolution?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { foodId, resolution, page = 1, pageSize = 20 } = query;
    const qb = this.conflictRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.food', 'f');

    if (foodId) qb.andWhere('c.foodId = :foodId', { foodId });
    if (resolution) qb.andWhere('c.resolution = :resolution', { resolution });

    qb.orderBy('c.createdAt', 'DESC');

    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    return { list, total, page, pageSize };
  }

  async resolveConflict(
    conflictId: string,
    dto: ResolveFoodConflictDto,
    operator = 'admin',
  ) {
    const conflict = await this.conflictRepo.findOne({
      where: { id: conflictId },
    });
    if (!conflict) throw new NotFoundException('冲突记录不存在');

    conflict.resolution = dto.resolution;
    conflict.resolvedValue = dto.resolvedValue;
    conflict.resolvedBy = operator;
    conflict.resolvedAt = new Date();
    return this.conflictRepo.save(conflict);
  }
}
