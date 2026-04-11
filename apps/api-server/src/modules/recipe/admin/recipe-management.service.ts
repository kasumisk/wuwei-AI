import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  GetRecipesQueryDto,
  ImportExternalRecipesDto,
} from './dto/recipe-management.dto';

/**
 * V6.3 P2-6: 菜谱管理服务（Admin 端）
 *
 * CRUD + 数据质量评分
 */
@Injectable()
export class RecipeManagementService {
  private readonly logger = new Logger(RecipeManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== CRUD ====================

  /**
   * 分页查询菜谱列表
   */
  async findAll(query: GetRecipesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.recipesWhereInput = {};

    if (query.cuisine) where.cuisine = query.cuisine;
    if (query.difficulty) where.difficulty = query.difficulty;
    if (query.source) where.source = query.source;
    if (query.reviewStatus) where.review_status = query.reviewStatus;
    if (query.isActive !== undefined) where.is_active = query.isActive;
    if (query.keyword) {
      where.name = { contains: query.keyword, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.recipes.findMany({
        where,
        include: {
          recipe_ingredients: { orderBy: { sort_order: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.recipes.count({ where }),
    ]);

    return {
      records: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取菜谱详情
   */
  async findById(id: string) {
    const recipe = await this.prisma.recipes.findUnique({
      where: { id },
      include: {
        recipe_ingredients: {
          orderBy: { sort_order: 'asc' },
          include: {
            food: { select: { id: true, name: true, category: true } },
          },
        },
      },
    });

    if (!recipe) {
      throw new NotFoundException(`菜谱 ${id} 不存在`);
    }

    return recipe;
  }

  /**
   * 创建菜谱
   */
  async create(dto: CreateRecipeDto) {
    const { ingredients, ...recipeData } = dto;

    const qualityScore = this.calculateQualityScore(dto);
    const recipeSource = recipeData.source ?? 'ai_generated';
    const reviewStatus = recipeSource === 'user' ? 'pending' : 'approved';
    const isActive = recipeSource !== 'user';

    const recipe = await this.prisma.recipes.create({
      data: {
        name: recipeData.name,
        description: recipeData.description,
        cuisine: recipeData.cuisine,
        difficulty: recipeData.difficulty ?? 1,
        prep_time_minutes: recipeData.prepTimeMinutes,
        cook_time_minutes: recipeData.cookTimeMinutes,
        servings: recipeData.servings ?? 1,
        tags: recipeData.tags ?? [],
        instructions: recipeData.instructions ?? Prisma.JsonNull,
        image_url: recipeData.imageUrl,
        source: recipeSource,
        review_status: reviewStatus,
        is_active: isActive,
        calories_per_serving: recipeData.caloriesPerServing,
        protein_per_serving: recipeData.proteinPerServing,
        fat_per_serving: recipeData.fatPerServing,
        carbs_per_serving: recipeData.carbsPerServing,
        fiber_per_serving: recipeData.fiberPerServing,
        quality_score: qualityScore,
        recipe_ingredients: ingredients?.length
          ? {
              create: ingredients.map((ing, idx) => ({
                food_id: ing.foodId,
                ingredient_name: ing.ingredientName,
                amount: ing.amount,
                unit: ing.unit,
                is_optional: ing.isOptional ?? false,
                sort_order: ing.sortOrder ?? idx,
              })),
            }
          : undefined,
      },
      include: { recipe_ingredients: { orderBy: { sort_order: 'asc' } } },
    });

    this.logger.log(`菜谱已创建: ${recipe.name} (${recipe.id})`);
    return recipe;
  }

  /**
   * 批量创建菜谱（供 AI 批量生成使用）
   */
  async createBatch(
    dtos: CreateRecipeDto[],
  ): Promise<{ created: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    for (const dto of dtos) {
      try {
        await this.create(dto);
        created++;
      } catch (err: any) {
        errors.push(`${dto.name}: ${err.message}`);
        this.logger.warn(`批量创建菜谱失败: ${dto.name}`, err.message);
      }
    }

    return { created, errors };
  }

  /**
   * V6.3 P3-5: 导入外卖/食堂菜品数据
   *
   * 最小实现：统一落 recipes 表，source=imported，并通过 tags 标记来源场景。
   */
  async importExternalRecipes(dto: ImportExternalRecipesDto) {
    const sourceTag = dto.sourceType === 'canteen' ? 'canteen' : 'takeout';
    const platformTag = dto.platform ? `platform:${dto.platform}` : null;
    const regionTag = dto.regionCode ? `region:${dto.regionCode}` : null;

    const normalizedItems: CreateRecipeDto[] = dto.items.map((item) => ({
      ...item,
      source: 'imported',
      tags: [
        ...(item.tags ?? []),
        sourceTag,
        ...(platformTag ? [platformTag] : []),
        ...(regionTag ? [regionTag] : []),
      ].filter(
        (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
      ),
    }));

    const result = await this.createBatch(normalizedItems);
    return {
      ...result,
      sourceType: dto.sourceType,
      regionCode: dto.regionCode ?? null,
      platform: dto.platform ?? null,
      imported: normalizedItems.length,
    };
  }

  /**
   * 更新菜谱
   */
  async update(id: string, dto: UpdateRecipeDto) {
    const existing = await this.prisma.recipes.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`菜谱 ${id} 不存在`);
    }

    const { ingredients, ...updateData } = dto;

    // 重新计算质量评分
    const mergedForScore = {
      ...existing,
      ...updateData,
      caloriesPerServing:
        updateData.caloriesPerServing ??
        (existing.calories_per_serving
          ? Number(existing.calories_per_serving)
          : undefined),
      proteinPerServing:
        updateData.proteinPerServing ??
        (existing.protein_per_serving
          ? Number(existing.protein_per_serving)
          : undefined),
      fatPerServing:
        updateData.fatPerServing ??
        (existing.fat_per_serving
          ? Number(existing.fat_per_serving)
          : undefined),
      carbsPerServing:
        updateData.carbsPerServing ??
        (existing.carbs_per_serving
          ? Number(existing.carbs_per_serving)
          : undefined),
      fiberPerServing:
        updateData.fiberPerServing ??
        (existing.fiber_per_serving
          ? Number(existing.fiber_per_serving)
          : undefined),
    };
    const qualityScore = this.calculateQualityScore(mergedForScore as any);

    const recipe = await this.prisma.$transaction(async (tx) => {
      // 如果有食材更新，先删后建
      if (ingredients) {
        await tx.recipe_ingredients.deleteMany({ where: { recipe_id: id } });
        if (ingredients.length > 0) {
          await tx.recipe_ingredients.createMany({
            data: ingredients.map((ing, idx) => ({
              recipe_id: id,
              food_id: ing.foodId,
              ingredient_name: ing.ingredientName,
              amount: ing.amount,
              unit: ing.unit,
              is_optional: ing.isOptional ?? false,
              sort_order: ing.sortOrder ?? idx,
            })),
          });
        }
      }

      return tx.recipes.update({
        where: { id },
        data: {
          ...(updateData.name !== undefined && { name: updateData.name }),
          ...(updateData.description !== undefined && {
            description: updateData.description,
          }),
          ...(updateData.cuisine !== undefined && {
            cuisine: updateData.cuisine,
          }),
          ...(updateData.difficulty !== undefined && {
            difficulty: updateData.difficulty,
          }),
          ...(updateData.prepTimeMinutes !== undefined && {
            prep_time_minutes: updateData.prepTimeMinutes,
          }),
          ...(updateData.cookTimeMinutes !== undefined && {
            cook_time_minutes: updateData.cookTimeMinutes,
          }),
          ...(updateData.servings !== undefined && {
            servings: updateData.servings,
          }),
          ...(updateData.tags !== undefined && { tags: updateData.tags }),
          ...(updateData.instructions !== undefined && {
            instructions: updateData.instructions ?? Prisma.JsonNull,
          }),
          ...(updateData.imageUrl !== undefined && {
            image_url: updateData.imageUrl,
          }),
          ...(updateData.isActive !== undefined && {
            is_active: updateData.isActive,
          }),
          ...(updateData.caloriesPerServing !== undefined && {
            calories_per_serving: updateData.caloriesPerServing,
          }),
          ...(updateData.proteinPerServing !== undefined && {
            protein_per_serving: updateData.proteinPerServing,
          }),
          ...(updateData.fatPerServing !== undefined && {
            fat_per_serving: updateData.fatPerServing,
          }),
          ...(updateData.carbsPerServing !== undefined && {
            carbs_per_serving: updateData.carbsPerServing,
          }),
          ...(updateData.fiberPerServing !== undefined && {
            fiber_per_serving: updateData.fiberPerServing,
          }),
          quality_score: qualityScore,
          updated_at: new Date(),
        },
        include: { recipe_ingredients: { orderBy: { sort_order: 'asc' } } },
      });
    });

    this.logger.log(`菜谱已更新: ${recipe.name} (${id})`);
    return recipe;
  }

  /**
   * 删除菜谱（软删除 — 设为 is_active=false）
   */
  async softDelete(id: string) {
    const existing = await this.prisma.recipes.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`菜谱 ${id} 不存在`);
    }

    await this.prisma.recipes.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });

    this.logger.log(`菜谱已禁用: ${existing.name} (${id})`);
  }

  /**
   * V6.3 P3-4: 审核用户提交的菜谱
   */
  async reviewRecipe(
    id: string,
    params: {
      action: 'approved' | 'rejected';
      note?: string;
      adminUserId?: string;
    },
  ) {
    // V6.4: include recipe_ingredients 以支持审核通过时重算 quality_score
    const existing = await this.prisma.recipes.findUnique({
      where: { id },
      include: { recipe_ingredients: true },
    });
    if (!existing) {
      throw new NotFoundException(`菜谱 ${id} 不存在`);
    }

    const approved = params.action === 'approved';

    // V6.4: 审核通过时重新计算 quality_score
    // UGC 菜谱在提交时 quality_score=0，审核通过后可能已有更多信息（如 admin 补充了食材关联）
    const qualityScoreUpdate = approved
      ? { quality_score: this.calculateQualityScore(existing) }
      : {};

    const updated = await this.prisma.recipes.update({
      where: { id },
      data: {
        review_status: params.action,
        review_note: params.note,
        reviewed_by: params.adminUserId,
        reviewed_at: new Date(),
        is_active: approved,
        updated_at: new Date(),
        ...qualityScoreUpdate,
      },
      include: { recipe_ingredients: { orderBy: { sort_order: 'asc' } } },
    });

    this.logger.log(
      `菜谱审核完成: ${updated.name} (${id}) => ${params.action}`,
    );
    return updated;
  }

  /**
   * 获取菜谱统计
   */
  async getStatistics() {
    const [
      total,
      active,
      bySource,
      byCuisine,
      avgQuality,
      pendingReview,
      lowQualityCount,
      allRecipes,
    ] = await Promise.all([
      this.prisma.recipes.count(),
      this.prisma.recipes.count({ where: { is_active: true } }),
      this.prisma.recipes.groupBy({
        by: ['source'],
        _count: { id: true },
      }),
      this.prisma.recipes.groupBy({
        by: ['cuisine'],
        where: { is_active: true },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.recipes.aggregate({
        where: { is_active: true },
        _avg: { quality_score: true },
      }),
      this.prisma.recipes.count({ where: { review_status: 'pending' } }),
      this.prisma.recipes.count({ where: { quality_score: { lt: 60 } } }),
      this.prisma.recipes.findMany({
        select: {
          id: true,
          name: true,
          source: true,
          review_status: true,
          quality_score: true,
          description: true,
          image_url: true,
          calories_per_serving: true,
          protein_per_serving: true,
          fat_per_serving: true,
          carbs_per_serving: true,
          fiber_per_serving: true,
          instructions: true,
        },
        orderBy: [{ quality_score: 'asc' }, { created_at: 'desc' }],
        take: 100,
      }),
    ]);

    const qualityBuckets = {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    };
    const missingFieldStats = {
      missingDescription: 0,
      missingImage: 0,
      missingNutrition: 0,
      missingInstructions: 0,
    };

    for (const recipe of allRecipes) {
      const score = Number(recipe.quality_score) || 0;
      if (score >= 85) qualityBuckets.excellent++;
      else if (score >= 70) qualityBuckets.good++;
      else if (score >= 60) qualityBuckets.fair++;
      else qualityBuckets.poor++;

      if (!recipe.description) missingFieldStats.missingDescription++;
      if (!recipe.image_url) missingFieldStats.missingImage++;
      if (!recipe.instructions) missingFieldStats.missingInstructions++;
      if (
        !recipe.calories_per_serving ||
        !recipe.protein_per_serving ||
        !recipe.fat_per_serving ||
        !recipe.carbs_per_serving
      ) {
        missingFieldStats.missingNutrition++;
      }
    }

    const sampleIssues = allRecipes.slice(0, 10).map((recipe) => {
      const issues: string[] = [];
      if (!recipe.description) issues.push('缺少描述');
      if (!recipe.image_url) issues.push('缺少图片');
      if (!recipe.instructions) issues.push('缺少步骤');
      if (!recipe.calories_per_serving || !recipe.protein_per_serving) {
        issues.push('营养信息不完整');
      }
      if ((Number(recipe.quality_score) || 0) < 60) issues.push('质量分偏低');

      return {
        id: recipe.id,
        name: recipe.name,
        source: recipe.source,
        reviewStatus: recipe.review_status,
        qualityScore: Number(recipe.quality_score) || 0,
        issues,
      };
    });

    return {
      total,
      active,
      inactive: total - active,
      bySource: bySource.map((s) => ({
        source: s.source,
        count: s._count.id,
      })),
      topCuisines: byCuisine.map((c) => ({
        cuisine: c.cuisine ?? '未分类',
        count: c._count.id,
      })),
      avgQualityScore: avgQuality._avg.quality_score
        ? Number(avgQuality._avg.quality_score)
        : 0,
      qualityMonitoring: {
        pendingReview,
        lowQualityCount,
        qualityBuckets,
        missingFieldStats,
        sampleIssues,
      },
    };
  }

  // ==================== 批量质量评分重算 ====================

  /**
   * V6.4: 批量重算所有菜谱的 quality_score
   *
   * 使用场景：
   * - 评分规则变更后需要全量刷新
   * - 修复历史 UGC 菜谱 quality_score=0 的问题
   *
   * @param options.onlyZero 仅处理 quality_score=0 的菜谱（默认 false）
   * @param options.batchSize 每批处理数量（默认 100）
   * @returns 统计信息
   */
  async recalculateAllScores(
    options: { onlyZero?: boolean; batchSize?: number } = {},
  ): Promise<{
    total: number;
    updated: number;
    unchanged: number;
    errors: number;
  }> {
    const { onlyZero = false, batchSize = 100 } = options;

    const where: Prisma.recipesWhereInput = onlyZero
      ? { quality_score: { equals: 0 } }
      : {};

    const total = await this.prisma.recipes.count({ where });
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    let cursor: string | undefined;

    this.logger.log(
      `开始批量重算 quality_score: 总计 ${total} 条, onlyZero=${onlyZero}`,
    );

    while (true) {
      const batch = await this.prisma.recipes.findMany({
        where,
        include: { recipe_ingredients: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const recipe of batch) {
        try {
          const newScore = this.calculateQualityScore(recipe);
          const oldScore = Number(recipe.quality_score) || 0;

          if (newScore !== oldScore) {
            await this.prisma.recipes.update({
              where: { id: recipe.id },
              data: { quality_score: newScore, updated_at: new Date() },
            });
            updated++;
          } else {
            unchanged++;
          }
        } catch (err: any) {
          errors++;
          this.logger.warn(
            `重算菜谱 ${recipe.id} quality_score 失败: ${err.message}`,
          );
        }
      }

      cursor = batch[batch.length - 1].id;
      this.logger.debug(
        `批量重算进度: ${updated + unchanged + errors}/${total}`,
      );
    }

    this.logger.log(
      `批量重算完成: total=${total}, updated=${updated}, unchanged=${unchanged}, errors=${errors}`,
    );

    return { total, updated, unchanged, errors };
  }

  // ==================== 质量评分 ====================

  /**
   * 计算菜谱质量评分（0-100）
   *
   * 评分维度:
   * - 营养信息完整度 (30分): 卡路里/蛋白/脂肪/碳水/纤维
   * - 步骤完整度 (20分): 是否有 instructions
   * - 描述完整度 (10分): 是否有描述
   * - 图片 (10分): 是否有图片
   * - 食材关联 (15分): 食材是否关联到食物库
   * - 元数据完整度 (15分): 菜系/难度/时间/份数
   */
  private calculateQualityScore(dto: any): number {
    let score = 0;

    // 营养信息 (30分, 每项6分)
    if (dto.caloriesPerServing) score += 6;
    if (dto.proteinPerServing) score += 6;
    if (dto.fatPerServing) score += 6;
    if (dto.carbsPerServing) score += 6;
    if (dto.fiberPerServing) score += 6;

    // 步骤 (20分)
    if (dto.instructions) {
      const instructions = dto.instructions;
      if (Array.isArray(instructions) && instructions.length > 0) {
        score += 20;
      } else if (
        typeof instructions === 'object' &&
        Object.keys(instructions).length > 0
      ) {
        score += 15;
      } else {
        score += 5;
      }
    }

    // 描述 (10分)
    if (dto.description && dto.description.length > 10) {
      score += 10;
    } else if (dto.description) {
      score += 5;
    }

    // 图片 (10分)
    if (dto.imageUrl || dto.image_url) score += 10;

    // 食材关联 (15分)
    const ingredients = dto.ingredients ?? dto.recipe_ingredients ?? [];
    if (ingredients.length > 0) {
      score += 5; // 有食材
      const linkedCount = ingredients.filter(
        (i: any) => i.foodId || i.food_id,
      ).length;
      if (linkedCount > 0) {
        score += Math.min(
          10,
          Math.round((linkedCount / ingredients.length) * 10),
        );
      }
    }

    // 元数据 (15分)
    if (dto.cuisine) score += 4;
    if (dto.difficulty && dto.difficulty > 1) score += 3;
    if (dto.prepTimeMinutes || dto.prep_time_minutes) score += 3;
    if (dto.cookTimeMinutes || dto.cook_time_minutes) score += 3;
    if ((dto.servings ?? 1) > 0) score += 2;

    return Math.min(100, score);
  }

  // ==================== V6.4 Phase 3.7: 菜谱翻译管理 ====================

  /**
   * 获取菜谱的所有翻译
   */
  async getTranslations(recipeId: string): Promise<
    Array<{
      id: string;
      locale: string;
      name: string;
      description: string | null;
      instructions: unknown;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const rows = await this.prisma.recipe_translations.findMany({
      where: { recipe_id: recipeId },
      orderBy: { locale: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      locale: r.locale,
      name: r.name,
      description: r.description,
      instructions: r.instructions,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * 创建或更新菜谱翻译（upsert）
   */
  async upsertTranslation(params: {
    recipeId: string;
    locale: string;
    name: string;
    description?: string;
    instructions?: unknown;
  }): Promise<{ id: string; locale: string; name: string }> {
    // 验证菜谱存在
    const recipe = await this.prisma.recipes.findUnique({
      where: { id: params.recipeId },
      select: { id: true },
    });
    if (!recipe) {
      throw new NotFoundException(`菜谱 ${params.recipeId} 不存在`);
    }

    const existing = await this.prisma.recipe_translations.findFirst({
      where: {
        recipe_id: params.recipeId,
        locale: params.locale,
      },
    });

    if (existing) {
      const updated = await this.prisma.recipe_translations.update({
        where: { id: existing.id },
        data: {
          name: params.name,
          description: params.description ?? null,
          instructions: params.instructions
            ? (params.instructions as Prisma.InputJsonValue)
            : undefined,
          updated_at: new Date(),
        },
      });
      return { id: updated.id, locale: updated.locale, name: updated.name };
    }

    const created = await this.prisma.recipe_translations.create({
      data: {
        recipe_id: params.recipeId,
        locale: params.locale,
        name: params.name,
        description: params.description ?? null,
        instructions: params.instructions
          ? (params.instructions as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return { id: created.id, locale: created.locale, name: created.name };
  }

  /**
   * 删除菜谱翻译
   */
  async deleteTranslation(recipeId: string, locale: string): Promise<boolean> {
    const existing = await this.prisma.recipe_translations.findFirst({
      where: { recipe_id: recipeId, locale },
    });
    if (!existing) return false;

    await this.prisma.recipe_translations.delete({
      where: { id: existing.id },
    });
    return true;
  }
}
