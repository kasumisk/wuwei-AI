import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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

    // Build dynamic WHERE clauses for ILIKE support
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIdx = 1;

    if (keyword) {
      conditions.push(
        `(f.name ILIKE $${paramIdx} OR f.aliases ILIKE $${paramIdx} OR f.code ILIKE $${paramIdx})`,
      );
      params.push(`%${keyword}%`);
      paramIdx++;
    }
    if (category) {
      conditions.push(`f.category = $${paramIdx++}`);
      params.push(category);
    }
    if (status) {
      conditions.push(`f.status = $${paramIdx++}`);
      params.push(status);
    }
    if (isVerified !== undefined) {
      conditions.push(`f.is_verified = $${paramIdx++}`);
      params.push(isVerified);
    }
    if (primarySource) {
      conditions.push(`f.primary_source = $${paramIdx++}`);
      params.push(primarySource);
    }

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    const totalResult = await this.prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count FROM foods f WHERE ${whereClause}`,
      ...params,
    );
    const total = parseInt(totalResult[0]?.count ?? '0', 10);

    const list = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM foods f
       WHERE ${whereClause}
       ORDER BY f.search_weight DESC, f.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      ...params,
      pageSize,
      offset,
    );

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const food = await this.prisma.foods.findUnique({ where: { id } });
    if (!food) {
      throw new NotFoundException('食物不存在');
    }
    // Load relations separately
    const [translations, sources, conflicts] = await Promise.all([
      this.prisma.food_translations.findMany({ where: { food_id: id } }),
      this.prisma.food_sources.findMany({ where: { food_id: id } }),
      this.prisma.food_conflicts.findMany({ where: { food_id: id } }),
    ]);
    return { ...food, translations, sources, conflicts };
  }

  async create(dto: CreateFoodLibraryDto) {
    const existing = await this.prisma.foods.findFirst({
      where: { name: (dto as any).name },
    });
    if (existing) {
      throw new ConflictException(`食物 "${(dto as any).name}" 已存在`);
    }
    const codeExisting = await this.prisma.foods.findFirst({
      where: { code: (dto as any).code },
    });
    if (codeExisting) {
      throw new ConflictException(`编码 "${(dto as any).code}" 已存在`);
    }
    const saved = await this.prisma.foods.create({ data: dto as any });

    // 写变更日志
    await this.createChangeLog(
      saved.id,
      1,
      'create',
      dto as any,
      '创建食物',
      'admin',
    );
    return saved;
  }

  async update(id: string, dto: UpdateFoodLibraryDto, operator = 'admin') {
    const food = await this.findOne(id);
    if ((dto as any).name && (dto as any).name !== food.name) {
      const existing = await this.prisma.foods.findFirst({
        where: { name: (dto as any).name },
      });
      if (existing) {
        throw new ConflictException(`食物 "${(dto as any).name}" 已存在`);
      }
    }

    // 记录变更前后
    const changes: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && (food as any)[key] !== value) {
        changes[key] = { old: (food as any)[key], new: value };
      }
    }

    const newVersion = (food.data_version || 1) + 1;
    const saved = await this.prisma.foods.update({
      where: { id },
      data: { ...(dto as any), data_version: newVersion },
    });

    if (Object.keys(changes).length > 0) {
      await this.createChangeLog(
        id,
        saved.data_version,
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
    await this.prisma.foods.delete({ where: { id } });
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
        const existing = await this.prisma.foods.findFirst({
          where: { code: (dto as any).code },
        });
        if (existing) {
          skipped++;
          continue;
        }
        await this.prisma.foods.create({ data: dto as any });
        imported++;
      } catch (e) {
        errors.push(
          `${(dto as any).code} (${(dto as any).name}): ${e.message}`,
        );
      }
    }

    return { imported, skipped, errors };
  }

  async toggleVerified(id: string, operator = 'admin') {
    const food = await this.findOne(id);
    const newIsVerified = !food.is_verified;
    const newVersion = (food.data_version || 1) + 1;
    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        is_verified: newIsVerified,
        verified_by: newIsVerified ? operator : null,
        verified_at: newIsVerified ? new Date() : null,
        data_version: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.data_version,
      'verify',
      {
        isVerified: { old: !newIsVerified, new: newIsVerified },
      },
      undefined,
      operator,
    );
    return saved;
  }

  async updateStatus(id: string, newStatus: string, operator = 'admin') {
    const food = await this.findOne(id);
    const oldStatus = food.status;
    const newVersion = (food.data_version || 1) + 1;
    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        status: newStatus,
        data_version: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.data_version,
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
    const [total, verified] = await Promise.all([
      this.prisma.foods.count(),
      this.prisma.foods.count({ where: { is_verified: true } }),
    ]);
    const unverified = total - verified;

    const byCategory = await this.prisma.$queryRawUnsafe<
      { category: string; count: string }[]
    >(
      `SELECT category, COUNT(*)::text AS count FROM foods GROUP BY category ORDER BY COUNT(*) DESC`,
    );

    const bySource = await this.prisma.$queryRawUnsafe<
      { source: string; count: string }[]
    >(
      `SELECT primary_source AS source, COUNT(*)::text AS count FROM foods GROUP BY primary_source`,
    );

    const byStatus = await this.prisma.$queryRawUnsafe<
      { status: string; count: string }[]
    >(`SELECT status, COUNT(*)::text AS count FROM foods GROUP BY status`);

    const conflictCount = await this.prisma.food_conflicts.count({
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
    const result = await this.prisma.$queryRawUnsafe<{ category: string }[]>(
      `SELECT DISTINCT category FROM foods ORDER BY category ASC`,
    );
    return result.map((r) => r.category);
  }

  // ==================== 翻译管理 ====================

  async getTranslations(foodId: string) {
    return this.prisma.food_translations.findMany({
      where: { food_id: foodId },
      orderBy: { locale: 'asc' },
    });
  }

  async createTranslation(foodId: string, dto: CreateFoodTranslationDto) {
    await this.findOne(foodId); // validate food exists
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale: (dto as any).locale },
    });
    if (existing) {
      throw new ConflictException(`该食物的 ${(dto as any).locale} 翻译已存在`);
    }
    return this.prisma.food_translations.create({
      data: { ...(dto as any), food_id: foodId },
    });
  }

  async updateTranslation(
    translationId: string,
    dto: UpdateFoodTranslationDto,
  ) {
    const translation = await this.prisma.food_translations.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    return this.prisma.food_translations.update({
      where: { id: translationId },
      data: dto as any,
    });
  }

  async deleteTranslation(translationId: string) {
    const translation = await this.prisma.food_translations.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    await this.prisma.food_translations.delete({
      where: { id: translationId },
    });
    return { message: '翻译已删除' };
  }

  // ==================== 数据来源管理 ====================

  async getSources(foodId: string) {
    return this.prisma.food_sources.findMany({
      where: { food_id: foodId },
      orderBy: { priority: 'desc' },
    });
  }

  async createSource(foodId: string, dto: CreateFoodSourceDto) {
    await this.findOne(foodId);
    return this.prisma.food_sources.create({
      data: { ...(dto as any), food_id: foodId },
    });
  }

  async deleteSource(sourceId: string) {
    const source = await this.prisma.food_sources.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException('来源记录不存在');
    await this.prisma.food_sources.delete({ where: { id: sourceId } });
    return { message: '来源已删除' };
  }

  // ==================== 变更日志 ====================

  async getChangeLogs(foodId: string) {
    return this.prisma.food_change_logs.findMany({
      where: { food_id: foodId },
      orderBy: { version: 'desc' },
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
    return this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version,
        action,
        changes,
        reason: reason ?? null,
        operator: operator ?? null,
      },
    });
  }

  // ==================== 冲突管理 ====================

  async getConflicts(query: {
    foodId?: string;
    resolution?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { foodId, resolution, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (foodId) where.food_id = foodId;
    if (resolution) where.resolution = resolution;

    const [list, total] = await Promise.all([
      this.prisma.food_conflicts.findMany({
        where,
        include: { foods: true },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.food_conflicts.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async resolveConflict(
    conflictId: string,
    dto: ResolveFoodConflictDto,
    operator = 'admin',
  ) {
    const conflict = await this.prisma.food_conflicts.findUnique({
      where: { id: conflictId },
    });
    if (!conflict) throw new NotFoundException('冲突记录不存在');

    return this.prisma.food_conflicts.update({
      where: { id: conflictId },
      data: {
        resolution: (dto as any).resolution,
        resolved_value: (dto as any).resolvedValue,
        resolved_by: operator,
        resolved_at: new Date(),
      },
    });
  }
}
